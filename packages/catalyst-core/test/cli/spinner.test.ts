import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type spinnerModule from "../../src/cli/spinner.js"
import type themeModule from "../../src/cli/theme.js"

// Loaded with require, the way build.js and the native commands load them, so
// v8 coverage sees one copy of each CommonJS file.
const load = createRequire(import.meta.url)
const { Spinner, withSpinnersPaused }: typeof spinnerModule = load("../../src/cli/spinner.js")
const theme: typeof themeModule = load("../../src/cli/theme.js")

const ESC = String.fromCharCode(27)
const CLEAR_LINE = `\r${ESC}[2K`
const plain = (text: string) => text.replace(theme.ANSI, "")

// A stream that records every write, TTY or not.
function fakeStream(isTTY: boolean) {
    const writes: string[] = []
    const stream = {
        isTTY,
        write: (chunk: string) => {
            writes.push(String(chunk))
            return true
        },
    }
    return { stream: stream as unknown as typeof process.stdout, writes }
}

beforeEach(() => {
    vi.useFakeTimers()
    // isInteractive also requires CI to be unset, and CI sets it.
    vi.stubEnv("CI", "")
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

describe("Spinner in a terminal", () => {
    it("animates in place and settles into a timed result line", () => {
        const { stream, writes } = fakeStream(true)
        const spinner = new Spinner(stream).start("Building bundles")
        expect(writes).toHaveLength(1)
        expect(plain(writes[0])).toBe(`${CLEAR_LINE}  ◐ Building bundles`)

        vi.advanceTimersByTime(120 * 4)
        expect(writes.map(plain).slice(1)).toEqual(
            ["◓", "◑", "◒", "◐"].map((frame) => `${CLEAR_LINE}  ${frame} Building bundles`)
        )

        spinner.update("Building client")
        expect(plain(writes.at(-1) as string)).toBe(`${CLEAR_LINE}  ◐ Building client`)

        vi.advanceTimersByTime(1000)
        writes.length = 0
        spinner.stop("done", "Built bundles")
        expect(writes.map(plain)).toEqual([CLEAR_LINE, "  ✓ Built bundles  1.5s\n"])

        // A stopped spinner neither redraws nor settles twice.
        vi.advanceTimersByTime(1000)
        spinner.stop()
        expect(writes).toHaveLength(2)
    })

    it("marks a failure and keeps the label when none is given", () => {
        const { stream, writes } = fakeStream(true)
        const spinner = new Spinner(stream).start("Generating manifest")
        writes.length = 0
        spinner.stop("fail")
        expect(writes.map(plain)).toEqual([CLEAR_LINE, "  ✗ Generating manifest\n"])
    })

    it("does not leave a second timer running when started twice", () => {
        const { stream, writes } = fakeStream(true)
        const spinner = new Spinner(stream).start("first")
        spinner.start("second")
        writes.length = 0
        vi.advanceTimersByTime(120)
        expect(writes.map(plain)).toEqual([`${CLEAR_LINE}  ◓ second`])
        spinner.stop()
    })

    it("erases its row while paused and redraws on resume", () => {
        const { stream, writes } = fakeStream(true)
        const spinner = new Spinner(stream).start("Installing")
        writes.length = 0

        spinner.pause()
        expect(writes).toEqual([CLEAR_LINE])
        vi.advanceTimersByTime(1000)
        expect(writes).toHaveLength(1)
        // A paused spinner can be paused again without a second erase.
        spinner.pause()
        expect(writes).toHaveLength(2)

        spinner.resume()
        expect(plain(writes.at(-1) as string)).toBe(`${CLEAR_LINE}  ◐ Installing`)
        // Already running: resuming again does nothing.
        spinner.resume()
        const count = writes.length
        vi.advanceTimersByTime(120)
        expect(writes).toHaveLength(count + 1)
        spinner.stop()

        // Stopped: pause and resume are both inert.
        writes.length = 0
        spinner.pause()
        spinner.resume()
        expect(writes).toEqual([])
    })
})

describe("Spinner without a terminal", () => {
    it("prints a plain start line and a plain result, with no escape codes", () => {
        const { stream, writes } = fakeStream(false)
        const spinner = new Spinner(stream).start("Building bundles")
        spinner.update("Building client")
        spinner.pause()
        spinner.resume()
        vi.advanceTimersByTime(2000)
        spinner.stop("warn", "Built with warnings")

        expect(writes.map(plain)).toEqual(["  · Building bundles\n", "  ▲ Built with warnings  2.0s\n"])
        expect(writes.join("")).not.toContain("\r")
    })

    it("treats a TTY under CI as non-interactive", () => {
        vi.stubEnv("CI", "true")
        const { stream, writes } = fakeStream(true)
        new Spinner(stream).start("Building").stop()
        expect(writes.map(plain)).toEqual(["  · Building\n", "  ✓ Building\n"])
    })

    it("defaults to process.stdout", () => {
        expect(new Spinner().stream).toBe(process.stdout)
    })
})

describe("withSpinnersPaused", () => {
    it("stands every live spinner down while fn runs and brings them back", async () => {
        const { stream, writes } = fakeStream(true)
        const spinner = new Spinner(stream).start("Configuring")
        writes.length = 0

        const result = await withSpinnersPaused(async () => {
            expect(writes).toEqual([CLEAR_LINE])
            return "answer"
        })
        expect(result).toBe("answer")
        expect(plain(writes.at(-1) as string)).toBe(`${CLEAR_LINE}  ◐ Configuring`)
        spinner.stop()
    })

    it("brings them back when fn throws", async () => {
        const { stream, writes } = fakeStream(true)
        const spinner = new Spinner(stream).start("Configuring")
        writes.length = 0

        await expect(
            withSpinnersPaused(() => {
                throw new Error("prompt failed")
            })
        ).rejects.toThrow("prompt failed")
        expect(plain(writes.at(-1) as string)).toBe(`${CLEAR_LINE}  ◐ Configuring`)
        spinner.stop()
    })

    it("leaves stopped spinners alone", async () => {
        const { stream, writes } = fakeStream(true)
        new Spinner(stream).start("Done already").stop()
        writes.length = 0
        await withSpinnersPaused(() => undefined)
        expect(writes).toEqual([])
    })
})
