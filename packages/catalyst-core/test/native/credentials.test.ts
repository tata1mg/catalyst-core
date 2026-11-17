import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import crypto from "crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import zlib from "zlib"

import { EventEmitter } from "events"
import {
    MAX_CREDENTIALS_SECRET_BYTES,
    cleanupOnSignal,
    credentialsEnvName,
    maskSecret,
    packCredentials,
    resolveCredentials,
    unpackCredentials,
} from "../../src/native/credentials.js"
import { runExportCredentials } from "../../src/native/exportCredentials.js"

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-credentials-test-"))
    temps.push(dir)
    return dir
}
afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** An app with fake (throwaway) Android credentials. */
function appWithCredentials() {
    const cwd = tempDir()
    const dir = path.join(cwd, "credentials", "android")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "upload.p12"), "fake-keystore-bytes")
    fs.writeFileSync(path.join(dir, "keystore.properties"), "storePassword=not-a-real-password\n")
    return cwd
}

function thrown(fn: () => unknown): any {
    try {
        fn()
    } catch (error) {
        return error
    }
    throw new Error("expected a throw")
}

describe("credentials", () => {
    it("names one secret per platform", () => {
        expect(credentialsEnvName("android")).toBe("CATALYST_ANDROID_CREDENTIALS")
        expect(credentialsEnvName("ios")).toBe("CATALYST_IOS_CREDENTIALS")
    })

    it("round-trips the folder through the secret value", () => {
        const value = packCredentials("android", { cwd: appWithCredentials() })
        expect(value).toMatch(/^[A-Za-z0-9+/]+=*$/)
        const ci = tempDir()
        const resolved = resolveCredentials("android", {
            cwd: ci,
            env: { CATALYST_ANDROID_CREDENTIALS: value },
        })
        try {
            expect(resolved.source).toBe("env")
            expect(resolved.dir.startsWith(ci)).toBe(false)
            expect(fs.readFileSync(path.join(resolved.dir, "upload.p12"), "utf8")).toBe("fake-keystore-bytes")
            expect(fs.existsSync(path.join(ci, "credentials"))).toBe(false)
        } finally {
            resolved.cleanup()
        }
        expect(fs.existsSync(resolved.dir)).toBe(false)
    })

    it("removes the unpacked secret when the build is interrupted", () => {
        const value = packCredentials("android", { cwd: appWithCredentials() })
        const signals = new EventEmitter()
        const exits: number[] = []
        const resolved = resolveCredentials("android", {
            cwd: tempDir(),
            env: { CATALYST_ANDROID_CREDENTIALS: value },
            signals,
            exit: (code: number) => exits.push(code),
        })
        expect(signals.listenerCount("SIGINT")).toBe(1)
        signals.emit("SIGINT", "SIGINT")
        expect(fs.existsSync(resolved.dir)).toBe(false)
        expect(exits).toEqual([130])
        expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0)

        // A normal cleanup removes the handlers as well.
        const again = resolveCredentials("android", {
            cwd: tempDir(),
            env: { CATALYST_ANDROID_CREDENTIALS: value },
            signals,
            exit: (code: number) => exits.push(code),
        })
        again.cleanup()
        expect(fs.existsSync(again.dir)).toBe(false)
        expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0)
    })

    it("lets a later signal handler run its cleanup and exit", () => {
        const signals = new EventEmitter()
        const order: string[] = []
        const exits: number[] = []
        const exit = (code: number) => exits.push(code)
        cleanupOnSignal(() => order.push("credentials"), { signals, exit })
        cleanupOnSignal(() => order.push("keychain"), { signals, exit })
        signals.emit("SIGTERM", "SIGTERM")
        expect(order).toEqual(["credentials", "keychain"])
        expect(exits).toEqual([143])
    })

    it("prefers the project folder over the secret", () => {
        const cwd = appWithCredentials()
        const resolved = resolveCredentials("android", {
            cwd,
            env: { CATALYST_ANDROID_CREDENTIALS: "garbage" },
        })
        expect(resolved).toMatchObject({ source: "folder", dir: path.join(cwd, "credentials", "android") })
    })

    it("reports none when there is neither", () => {
        const cwd = tempDir()
        expect(resolveCredentials("ios", { cwd, env: {} })).toMatchObject({
            source: "none",
            dir: path.join(cwd, "credentials", "ios"),
        })
    })

    it("refuses a value that is not a gzipped tar (NATIVE-007)", () => {
        const error = thrown(() =>
            resolveCredentials("android", {
                cwd: tempDir(),
                env: { CATALYST_ANDROID_CREDENTIALS: "aGVsbG8=" },
            })
        )
        expect(error.code).toBe("NATIVE-007")
        expect(error.message).toContain("CATALYST_ANDROID_CREDENTIALS")
    })

    it("refuses gzipped data that is not a tar archive (NATIVE-007)", () => {
        const value = zlib.gzipSync(Buffer.from("not a tar archive at all\n".repeat(40))).toString("base64")
        const error = thrown(() =>
            unpackCredentials(value, tempDir(), { envName: "CATALYST_IOS_CREDENTIALS" })
        )
        expect(error.code).toBe("NATIVE-007")
        expect(error.message).toContain("CATALYST_IOS_CREDENTIALS could not be read as a tar archive")
    })

    it("names the platforms it knows", () => {
        expect(() => credentialsEnvName("windows" as any)).toThrow(
            'Unknown platform "windows": expected android or ios'
        )
        expect(() => packCredentials("web" as any, { cwd: tempDir() })).toThrow(/Unknown platform "web"/)
    })

    it("refuses an archive with paths outside the folder or links", () => {
        const work = tempDir()
        fs.mkdirSync(path.join(work, "inner"))
        fs.symlinkSync("/etc/hosts", path.join(work, "inner", "link"))
        const archive = execFileSync("tar", ["-czf", "-", "-C", path.join(work, "inner"), "."])
        expect(thrown(() => unpackCredentials(archive.toString("base64"), tempDir())).code).toBe("NATIVE-007")
    })

    it("fails to export a missing folder (NATIVE-008)", () => {
        expect(thrown(() => packCredentials("ios", { cwd: tempDir() })).code).toBe("NATIVE-008")
    })

    it("fails to export more than 48 KB (NATIVE-009)", () => {
        const cwd = tempDir()
        const dir = path.join(cwd, "credentials", "ios")
        fs.mkdirSync(dir, { recursive: true })
        // Random bytes do not compress.
        fs.writeFileSync(path.join(dir, "big.bin"), crypto.randomBytes(60 * 1024))
        const error = thrown(() => packCredentials("ios", { cwd }))
        expect(error.code).toBe("NATIVE-009")
        expect(MAX_CREDENTIALS_SECRET_BYTES).toBe(48 * 1024)
    })

    it("masks secrets only under GitHub Actions", () => {
        const out: string[] = []
        const write = (text: string) => out.push(text)
        expect(maskSecret("s3cret", { env: {}, write })).toBe(false)
        expect(maskSecret("", { env: { GITHUB_ACTIONS: "true" }, write })).toBe(false)
        expect(maskSecret("50%\nx", { env: { GITHUB_ACTIONS: "true" }, write })).toBe(true)
        expect(out).toEqual(["::add-mask::50%25%0Ax\n"])
    })

    it("writes the mask to stdout by default", () => {
        const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
        expect(maskSecret("abc", { env: { GITHUB_ACTIONS: "true" } })).toBe(true)
        expect(write).toHaveBeenCalledWith("::add-mask::abc\n")
    })
})

describe("catalyst credentials:export", () => {
    it("prints the value on stdout and where to paste it on stderr", () => {
        const out: string[] = []
        const err: string[] = []
        const code = runExportCredentials({
            argv: ["android"],
            cwd: appWithCredentials(),
            stdout: (text: string) => out.push(text),
            stderr: (text: string) => err.push(text),
        })
        expect(code).toBe(0)
        expect(out.join("").trim()).toMatch(/^[A-Za-z0-9+/]+=*$/)
        expect(err.join("")).toContain("CATALYST_ANDROID_CREDENTIALS")
    })

    it("prints the coded error and exits 1", () => {
        const err: string[] = []
        const code = runExportCredentials({
            argv: ["ios"],
            cwd: tempDir(),
            stdout: () => {},
            stderr: (text: string) => err.push(text),
        })
        expect(code).toBe(1)
        expect(err.join("")).toContain("NATIVE-008")
    })

    it("writes to the process streams by default", () => {
        const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
        const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
        expect(runExportCredentials({ argv: ["android"], cwd: appWithCredentials() })).toBe(0)
        expect(String(out.mock.calls[0][0]).trim()).toMatch(/^[A-Za-z0-9+/]+=*$/)
        expect(String(err.mock.calls[0][0])).toContain("CATALYST_ANDROID_CREDENTIALS")
    })

    it("needs a platform", () => {
        const err: string[] = []
        expect(runExportCredentials({ argv: [], stdout: () => {}, stderr: (t: string) => err.push(t) })).toBe(
            1
        )
        expect(err.join("")).toContain("<android|ios>")
    })
})
