import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import pkg from "../../package.json"

import spinnerImported from "../../src/cli/spinner.js"
import themeImported from "../../src/cli/theme.js"

// The CLI modules are CommonJS. The build commands load them with require; src/native/utils.js imports them. That makes two copies in one
// test run, and v8 coverage merges two copies of a file badly: the coverage of these files swung between 57% and 100% with how the test
// files happened to be spread over workers. So every suite here runs against BOTH copies, and whichever copy the merge keeps is fully covered.
const load = createRequire(import.meta.url)
const copies: Array<[string, { spinner: typeof spinnerImported; theme: typeof themeImported }]> = [
    ["required", { spinner: load("../../src/cli/spinner.js"), theme: load("../../src/cli/theme.js") }],
    ["imported", { spinner: spinnerImported, theme: themeImported }],
]

for (const [copyName, copy] of copies) describe(`${copyName} copy`, () => {
const theme = copy.theme
const { Spinner } = copy.spinner
const plain = (text: string) => text.replace(theme.ANSI, "")

describe("theme helpers", () => {
    it("isInteractive needs a TTY and no CI", () => {
        vi.stubEnv("CI", "")
        expect(theme.isInteractive({ isTTY: true } as any)).toBe(true)
        expect(theme.isInteractive({ isTTY: false } as any)).toBe(false)
        vi.stubEnv("CI", "true")
        expect(theme.isInteractive({ isTTY: true } as any)).toBe(false)
        vi.unstubAllEnvs()
    })

    it("isVerbose reads the flags and CATALYST_OUTPUT_MODE", () => {
        expect(theme.isVerbose(["node", "x", "--verbose"], {})).toBe(true)
        expect(theme.isVerbose(["node", "x", "--debug"], {})).toBe(true)
        expect(theme.isVerbose([], { CATALYST_OUTPUT_MODE: "verbose" })).toBe(true)
        expect(theme.isVerbose([], { CATALYST_OUTPUT_MODE: "debug" })).toBe(true)
        expect(theme.isVerbose([], { CATALYST_OUTPUT_MODE: "quiet" })).toBe(false)
    })

    it("version() is the package's own version and is cached", () => {
        const v = theme.version()
        expect(v).toBe(pkg.version) // this package's own version, not null and not another package's
        expect(theme.version()).toBe(v)
    })

    it("header shows title, version and subtitle; row aligns the key", () => {
        const h = plain(theme.header("catalyst build", "production"))
        expect(h).toContain("catalyst build")
        expect(h).toContain(String(pkg.version)) // the header shows the version
        expect(h).toContain("production")
        expect(plain(theme.header("only title"))).not.toContain("production")
        expect(plain(theme.row("Port", "3005"))).toMatch(/Port\s+3005/)
        expect(plain(theme.row("K", "v", 4))).toMatch(/K\s{3}v/)
    })

    it("formats durations and byte sizes across their ranges", () => {
        expect(theme.duration(250)).toBe("250ms")
        expect(theme.duration(1500)).toBe("1.5s")
        expect(theme.duration(125000)).toBe("2m 5s")
        expect(theme.bytes(512)).toBe("512 B")
        expect(theme.bytes(2048)).toBe("2.0 kB")
        expect(theme.bytes(5 * 1024 * 1024)).toBe("5.00 MB")
    })

    it("displayPath prefers relative, then ~, then absolute", () => {
        const root = path.join(path.sep, "work", "app")
        expect(theme.displayPath(path.join(root, "src", "a.js"), root)).toBe(path.join("src", "a.js"))
        expect(theme.displayPath(path.join(os.homedir(), "x", "y"), root)).toBe(`~${path.sep}x${path.sep}y`.replace(/\\/g, path.sep))
        expect(theme.displayPath(path.join(path.sep, "elsewhere", "z"), root)).toBe(path.join(path.sep, "elsewhere", "z"))
        expect(theme.displayPath("", root)).toBe("")
        expect(theme.displayPath(undefined as any, root)).toBeUndefined()
    })

    it("step marks done, warn and fail and hides timings below the noise floor", () => {
        expect(plain(theme.step("Built", 50))).not.toMatch(/\d/) // under the noise floor: no timing shown
        expect(plain(theme.step("Built", 2500))).toContain("2.5s")
        expect(plain(theme.step("Built", null))).toContain("Built")
        const marks = ["done", "warn", "fail"].map((s) => plain(theme.step("x", 0, s)).trim()[0])
        expect(new Set(marks).size).toBe(3)
    })
})

describe("Spinner edge cases", () => {
    const fake = (isTTY: boolean) => {
        const writes: string[] = []
        return { writes, stream: { isTTY, write: (c: string) => (writes.push(String(c)), true) } as any }
    }
    beforeEach(() => {
        vi.useFakeTimers()
        vi.stubEnv("CI", "")
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllEnvs()
    })

    it("starting twice replaces the first animation instead of stacking timers", () => {
        const { stream, writes } = fake(true)
        const s = new Spinner(stream).start("one")
        s.start("two")
        const before = writes.length
        vi.advanceTimersByTime(120)
        expect(writes.length - before).toBe(1) // one timer, one frame
        s.stop()
    })

    it("update() redraws only while interactive and active", () => {
        const { stream, writes } = fake(true)
        const s = new Spinner(stream)
        s.update("ignored before start")
        expect(writes).toHaveLength(0)
        s.start("a")
        s.update("b")
        expect(plain(writes.at(-1)!)).toContain("b")
        s.stop()
    })

    it("pause()/resume() are no-ops when not interactive or not active", () => {
        const plainStream = fake(false)
        const s = new Spinner(plainStream.stream).start("x")
        s.pause()
        s.resume()
        const afterPauseResume = plainStream.writes.slice()
        s.stop()
        // Nothing that moves the cursor or clears a line on a stream that is not a terminal (colour codes are a separate matter and are not asserted here).
        expect(afterPauseResume.some((w: string) => w.includes("\r") || w.includes("\u001b[2K") || /\u001b\[\d*[ABCDGHJK]/.test(w))).toBe(false)
        const tty = fake(true)
        const idle = new Spinner(tty.stream)
        idle.pause()
        idle.resume()
        expect(tty.writes).toHaveLength(0)
    })

    it("resume() does nothing while the animation is already running", () => {
        const { stream, writes } = fake(true)
        const s = new Spinner(stream).start("x")
        const before = writes.length
        s.resume()
        expect(writes.length).toBe(before)
        s.stop()
    })

    it("stop() on a spinner that never started writes nothing", () => {
        const { stream, writes } = fake(true)
        new Spinner(stream).stop()
        expect(writes).toHaveLength(0)
    })
})
})
