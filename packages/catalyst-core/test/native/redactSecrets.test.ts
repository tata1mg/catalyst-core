import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { expandHome, runCommand } from "../../src/native/utils.js"

// The signing flow (renameAndroidProject.js) passes keystore passwords on the
// command line, then rethrows `Failed to create signed AAB: ${error.message}`
// and prints it. execSync's error.message carries the whole command line, so
// the passwords have to be gone from the error itself, not just from the log.
const STORE = "St0re-Secret-91"
const KEY = "K3y-Secret-27"

function failSigningCommand() {
    // Fails like a wrong keystore password would, echoing a password back
    // without its flag on both streams.
    const command = [
        `echo "using ${STORE}"; echo "bad key ${KEY}" >&2; exit 1;`,
        `: ./gradlew bundleRelease`,
        `-Pandroid.injected.signing.store.password="${STORE}"`,
        `-Pandroid.injected.signing.key.password="${KEY}"`,
        `-storepass "${STORE}" -keypass ${KEY}`,
    ].join(" ")
    try {
        runCommand(command)
    } catch (error) {
        return error
    }
    throw new Error("expected the command to fail")
}

describe("runCommand redacts signing passwords from failures", () => {
    afterEach(() => vi.restoreAllMocks())

    it("never surfaces a password in the thrown error or the log", () => {
        const logged: string[] = []
        vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(args.join(" ")))

        const error = failSigningCommand()
        // What renameAndroidProject.js builds from it and hands to progress.fail.
        const wrapped = new Error(`Failed to create signed AAB: ${error.message}`)

        const surfaces = [
            error.message,
            error.stack,
            error.stdout,
            error.stderr,
            String(error.cmd ?? ""),
            ...(error.output || []).map(String),
            wrapped.message,
            ...logged,
        ].join("\n")

        expect(error.message).toContain("Command failed")
        expect(surfaces).toContain("***")
        expect(surfaces).not.toContain(STORE)
        expect(surfaces).not.toContain(KEY)
    })
})

describe("expandHome", () => {
    it("expands a leading ~ so the SDK hint's example path works", () => {
        expect(expandHome("~/Library/Android/sdk")).toBe(path.join(os.homedir(), "Library/Android/sdk"))
        expect(expandHome("~")).toBe(os.homedir())
    })

    it("leaves other paths alone", () => {
        expect(expandHome("/opt/android-sdk")).toBe("/opt/android-sdk")
        expect(expandHome("relative/~/sdk")).toBe("relative/~/sdk")
        expect(expandHome(undefined)).toBe(undefined)
    })
})
