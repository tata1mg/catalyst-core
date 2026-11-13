import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const bin = fileURLToPath(new URL("../../bin/catalyst.js", import.meta.url))

describe("catalyst buildApp and setupEmulator", () => {
    let cwd: string
    beforeEach(() => {
        // No config here, so the Android half stops straight after starting.
        cwd = mkdtempSync(path.join(tmpdir(), "catalyst-bin-"))
    })
    afterEach(() => rmSync(cwd, { recursive: true, force: true }))

    const run = (command: string) => {
        const result = spawnSync(process.execPath, [bin, command], { cwd, encoding: "utf8" })
        return `${result.stdout}${result.stderr}`
    }

    // Stopping at iOS would mean never reaching the platform this machine can build.
    it.runIf(process.platform !== "darwin").each(["buildApp", "setupEmulator"])(
        "%s skips iOS away from a Mac and goes on to Android",
        (command) => {
            const output = run(command)
            expect(output).toContain("Skipping iOS: it needs macOS and Xcode.")
            expect(output).not.toContain("IOS-007")
        }
    )

    it.runIf(process.platform === "darwin").each(["buildApp", "setupEmulator"])(
        "%s does not skip iOS on a Mac",
        (command) => {
            expect(run(command)).not.toContain("Skipping iOS")
        }
    )
})
