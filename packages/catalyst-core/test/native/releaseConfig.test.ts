import fs from "fs"
import { createRequire } from "module"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

import { ERROR_DEFINITIONS } from "../../src/errors/registry.js"
import {
    MAX_BUILD_NUMBER,
    NATIVE_ERRORS,
    assertReleaseHost,
    computeStartUrl,
    deepMerge,
    parseNativeArgs,
    privateHostReason,
    resolveAppVersion,
    resolveNativeConfig,
} from "../../src/native/utils.js"

// buildIos/config.js is plain CJS with no ESM-syntax imports, so it loads with require.
const require = createRequire(import.meta.url)
const createIosConfigPhase = require("../../src/native/buildIos/config.js")

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-release-config-"))
    temps.push(dir)
    return dir
}

afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** Run fn and return what it threw. */
function thrown(fn: () => unknown): any {
    try {
        fn()
    } catch (error) {
        return error
    }
    throw new Error("expected a throw")
}

const NO_LOCAL = new Set<string>()

describe("parseNativeArgs", () => {
    it("reads --release and both --build-number forms", () => {
        expect(parseNativeArgs(["--release", "--build-number", "7"])).toMatchObject({
            release: true,
            buildNumber: "7",
        })
        expect(parseNativeArgs(["--build-number=12", "--verbose"])).toMatchObject({
            release: false,
            buildNumber: "12",
        })
        expect(parseNativeArgs([])).toEqual({
            release: false,
            buildNumber: undefined,
            yes: false,
            acceptLicenses: false,
        })
    })

    it("reads setup's --yes and --accept-licenses", () => {
        expect(parseNativeArgs(["--yes", "--accept-licenses"])).toMatchObject({
            yes: true,
            acceptLicenses: true,
        })
    })
})

describe("resolveNativeConfig", () => {
    const config = {
        BUILD_OUTPUT_PATH: "build-output",
        WEBVIEW_CONFIG: {
            LOCAL_IP: "192.168.1.20",
            port: 3005,
            apiBaseUrl: "https://api.example.com/",
            android: { packageName: "com.example.app", buildType: "debug", sdkPath: "/sdk" },
            accessControl: { enabled: true, allowedUrls: ["a.com", "b.com"] },
            release: {
                LOCAL_IP: "www.example.com",
                useHttps: true,
                port: 443,
                allowPrivateHost: false,
                android: { buildOptimisation: true },
                accessControl: { allowedUrls: ["c.com"] },
            },
        },
    }

    it("deep-merges the release block, replaces arrays and strips release and allowPrivateHost", () => {
        const resolved = resolveNativeConfig("android", { release: true, config })
        try {
            const wv = resolved.WEBVIEW_CONFIG
            expect(wv.release).toBeUndefined()
            expect(wv.allowPrivateHost).toBeUndefined()
            expect(wv.LOCAL_IP).toBe("www.example.com")
            expect(wv.useHttps).toBe(true)
            expect(wv.apiBaseUrl).toBe("https://api.example.com/")
            expect(wv.android).toEqual({
                packageName: "com.example.app",
                buildType: "debug",
                sdkPath: "/sdk",
                buildOptimisation: true,
            })
            expect(wv.accessControl).toEqual({ enabled: true, allowedUrls: ["c.com"] })
            expect(resolved.config.BUILD_OUTPUT_PATH).toBe("build-output")
            // The input is left alone.
            expect(config.WEBVIEW_CONFIG.LOCAL_IP).toBe("192.168.1.20")
        } finally {
            resolved.cleanup()
        }
    })

    it("writes the resolved config to a 0600 temp file and removes it on cleanup", () => {
        const resolved = resolveNativeConfig("android", { release: true, config })
        const written = JSON.parse(fs.readFileSync(resolved.configPath, "utf8"))
        expect(written.WEBVIEW_CONFIG.LOCAL_IP).toBe("www.example.com")
        expect(written.WEBVIEW_CONFIG.release).toBeUndefined()
        if (process.platform !== "win32") expect(fs.statSync(resolved.configPath).mode & 0o777).toBe(0o600)
        resolved.cleanup()
        expect(fs.existsSync(resolved.configPath)).toBe(false)
    })

    it("uses the base values for debug, still without the release block", () => {
        const resolved = resolveNativeConfig("android", { release: false, config })
        try {
            expect(resolved.WEBVIEW_CONFIG.LOCAL_IP).toBe("192.168.1.20")
            expect(resolved.WEBVIEW_CONFIG.release).toBeUndefined()
        } finally {
            resolved.cleanup()
        }
    })

    it("warns that a release without a release block is deprecated", () => {
        const logs: Array<[string, string | undefined]> = []
        const resolved = resolveNativeConfig("android", {
            release: true,
            config: { WEBVIEW_CONFIG: { LOCAL_IP: "www.example.com" } },
            log: (message: string, type?: string) => logs.push([message, type]),
        })
        resolved.cleanup()
        expect(resolved.WEBVIEW_CONFIG.LOCAL_IP).toBe("www.example.com")
        expect(logs).toHaveLength(1)
        expect(logs[0][1]).toBe("warning")
        expect(logs[0][0]).toMatch(/WEBVIEW_CONFIG\.release is not set/)
    })

    it("reads config/config.json from the given path", () => {
        const dir = tempDir()
        const file = path.join(dir, "config.json")
        fs.writeFileSync(file, JSON.stringify(config))
        const resolved = resolveNativeConfig("ios", { release: true, configPath: file })
        resolved.cleanup()
        expect(resolved.WEBVIEW_CONFIG.LOCAL_IP).toBe("www.example.com")
        expect(resolved.allowPrivateHost).toBe(false)
    })

    it("deepMerge replaces scalars and arrays", () => {
        expect(deepMerge({ a: { b: 1, c: [1] }, d: 1 }, { a: { c: [2] }, d: { e: 1 } })).toEqual({
            a: { b: 1, c: [2] },
            d: { e: 1 },
        })
    })
})

describe("computeStartUrl", () => {
    it("builds the Android URL with the configured port and initial_url", () => {
        expect(
            computeStartUrl("android", {
                LOCAL_IP: "app.example.com",
                useHttps: true,
                port: 8443,
                initial_url: "home",
            }).url
        ).toBe("https://app.example.com:8443/home")
    })

    it("falls back to 127.0.0.1 for an Android release, as generateWebViewConfig does", () => {
        expect(computeStartUrl("android", {}, { release: true }).host).toBe("127.0.0.1")
    })

    it("forces port 443 for iOS under HTTPS", () => {
        expect(computeStartUrl("ios", { LOCAL_IP: "app.example.com", useHttps: true, port: 3005 }).url).toBe(
            "https://app.example.com:443/"
        )
        expect(computeStartUrl("ios", { port: 3005 }).url).toBe("http://localhost:3005/")
    })
})

describe("privateHostReason", () => {
    it.each([
        ["localhost", "localhost"],
        ["dev.localhost", "localhost"],
        ["127.0.0.1", "a loopback address"],
        ["127.8.9.10", "a loopback address"],
        ["0.0.0.0", "an unroutable address"],
        ["10.1.2.3", "a private (RFC 1918) address"],
        ["172.16.0.1", "a private (RFC 1918) address"],
        ["172.31.255.255", "a private (RFC 1918) address"],
        ["192.168.1.20", "a private (RFC 1918) address"],
        ["169.254.10.10", "a link-local address"],
        ["::1", "a loopback address"],
        ["[fe80::1]", "a link-local address"],
        ["fd12:3456::1", "a private (unique local) address"],
        ["::ffff:192.168.0.1", "a private (RFC 1918) address"],
        ["my-mac.local", "a local network (mDNS) name"],
    ])("%s is %s", (host, reason) => {
        expect(privateHostReason(host, { localHosts: NO_LOCAL })).toBe(reason)
    })

    it.each(["www.example.com", "172.32.0.1", "8.8.8.8", "2606:4700::1111"])("%s is public", (host) => {
        expect(privateHostReason(host, { localHosts: NO_LOCAL })).toBeNull()
    })

    it("flags this machine's own LAN address and hostname", () => {
        const localHosts = new Set(["100.64.1.5", "build-box"])
        expect(privateHostReason("100.64.1.5", { localHosts })).toBe("this machine's own address")
        expect(privateHostReason("BUILD-BOX", { localHosts })).toBe("this machine's own address")
    })
})

describe("assertReleaseHost", () => {
    it("fails a private host with ANDROID-002", () => {
        const error = thrown(() =>
            assertReleaseHost("android", { LOCAL_IP: "192.168.1.20", port: 3005 }, { localHosts: NO_LOCAL })
        )
        expect(error.code).toBe("ANDROID-002")
        expect(error.message).toContain("http://192.168.1.20:3005/")
        expect(error.hint).toMatch(/allowPrivateHost/)
        expect(error.docUrl).toBe(
            "https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-002.md"
        )
    })

    it("fails an Android release with no LOCAL_IP (127.0.0.1)", () => {
        expect(thrown(() => assertReleaseHost("android", {}, { localHosts: NO_LOCAL })).code).toBe(
            "ANDROID-002"
        )
    })

    it("only warns when allowPrivateHost is set, and warns on plain HTTP", () => {
        const logs: string[] = []
        const start = assertReleaseHost(
            "android",
            { LOCAL_IP: "10.0.0.5", port: 80 },
            { allowPrivateHost: true, localHosts: NO_LOCAL, log: (message: string) => logs.push(message) }
        )
        expect(start.url).toBe("http://10.0.0.5:80/")
        expect(logs.some((line) => /allowPrivateHost/.test(line))).toBe(true)
        expect(logs.some((line) => /plain HTTP/.test(line))).toBe(true)
    })

    it("passes a public HTTPS host quietly", () => {
        const logs: string[] = []
        assertReleaseHost(
            "android",
            { LOCAL_IP: "www.example.com", useHttps: true, port: 443 },
            { localHosts: NO_LOCAL, log: (message: string) => logs.push(message) }
        )
        expect(logs).toEqual([])
    })
})

describe("resolveAppVersion", () => {
    const wv = { android: { version: { major: 2, minor: 3, patch: 4, buildNumber: 5 } } }

    it("prefers --build-number, then CATALYST_BUILD_NUMBER, then version.buildNumber", () => {
        expect(
            resolveAppVersion("android", {
                WEBVIEW_CONFIG: wv,
                buildNumber: "9",
                env: { CATALYST_BUILD_NUMBER: "8" },
            })
        ).toEqual({
            versionName: "2.3.4",
            buildNumber: 9,
            buildNumberSource: "--build-number",
        })
        expect(
            resolveAppVersion("android", { WEBVIEW_CONFIG: wv, env: { CATALYST_BUILD_NUMBER: "8" } })
                .buildNumber
        ).toBe(8)
        expect(resolveAppVersion("android", { WEBVIEW_CONFIG: wv, env: {} }).buildNumber).toBe(5)
    })

    it("falls back to the app's package.json version", () => {
        const cwd = tempDir()
        fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ version: "1.4.0" }))
        expect(resolveAppVersion("android", { WEBVIEW_CONFIG: {}, env: {}, cwd }).versionName).toBe("1.4.0")
    })

    it("leaves the version name unset when there is none", () => {
        expect(
            resolveAppVersion("android", { WEBVIEW_CONFIG: {}, env: {}, cwd: tempDir() }).versionName
        ).toBeUndefined()
    })

    it("defaults debug to build 1 and fails a release without one (ANDROID-003)", () => {
        expect(
            resolveAppVersion("android", { WEBVIEW_CONFIG: {}, env: {}, cwd: tempDir() }).buildNumber
        ).toBe(1)
        const error = thrown(() =>
            resolveAppVersion("android", { WEBVIEW_CONFIG: {}, env: {}, release: true })
        )
        expect(error.code).toBe("ANDROID-003")
    })

    it.each(["0", "-1", "1.5", "abc", String(MAX_BUILD_NUMBER + 1)])("rejects %s (ANDROID-004)", (value) => {
        const error = thrown(() =>
            resolveAppVersion("android", { WEBVIEW_CONFIG: {}, env: {}, buildNumber: value, release: true })
        )
        expect(error.code).toBe("ANDROID-004")
    })

    it("accepts the Play maximum", () => {
        expect(
            resolveAppVersion("android", {
                WEBVIEW_CONFIG: {},
                env: {},
                buildNumber: String(MAX_BUILD_NUMBER),
            }).buildNumber
        ).toBe(MAX_BUILD_NUMBER)
    })
})

describe("native error strings", () => {
    it("match the registry they are copied from", () => {
        for (const [code, entry] of Object.entries(NATIVE_ERRORS)) {
            const def = (ERROR_DEFINITIONS as Record<string, any>)[code]
            expect(def, code).toBeDefined()
            expect(entry.message, code).toBe(def.defaultMessage)
            expect(entry.hint, code).toBe(def.suggestedAction)
        }
    })
})

describe("iOS ConfigConstants", () => {
    it("never emits the release override block", async () => {
        const projectDir = tempDir()
        const progress = { start() {}, complete() {}, fail() {}, log() {} }
        const { generateConfigConstants } = createIosConfigPhase({
            WEBVIEW_CONFIG: { port: 3005, release: { LOCAL_IP: "www.example.com" } },
            iosConfig: {},
            PROJECT_DIR: projectDir,
            PUBLIC_PATH: tempDir(),
            url: "http://localhost:3005",
            progress,
        })
        await generateConfigConstants()
        const swift = fs.readFileSync(
            path.join(
                projectDir,
                "CoreLogic",
                "Sources",
                "CatalystCoreLogic",
                "Constants",
                "ConfigConstants.swift"
            ),
            "utf8"
        )
        expect(swift).toContain("public static let port")
        expect(swift).not.toMatch(/release/i)
    })
})
