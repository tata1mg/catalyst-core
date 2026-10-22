import os from "os"
import path from "path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createRequire } from "module"
import pkg from "../../package.json"
import type themeModule from "../../src/cli/theme.js"

// Loaded with require, the way diagnostic.js and the native commands load it:
// v8 coverage then sees one copy of the file rather than two that it merges
// badly across test files.
const theme: typeof themeModule = createRequire(import.meta.url)("../../src/cli/theme.js")

// theme.js is the shared visual language for every CLI command. Colour is
// decided by ansis from the environment (it turns on under CI), so every
// assertion here strips ANSI codes and checks what a reader would see.
const { ANSI, GUTTER, glyph, SPINNER_FRAMES, t } = theme
const plain = (text: string) => String(text).replace(ANSI, "")

describe("theme constants", () => {
    it("uses single-width glyphs and a calm four-frame spinner", () => {
        for (const mark of [...Object.values(glyph), ...SPINNER_FRAMES]) {
            expect([...mark]).toHaveLength(1)
        }
        expect(SPINNER_FRAMES).toEqual(["◐", "◓", "◑", "◒"])
        expect(GUTTER).toBe("  ")
    })

    it("ANSI strips colour codes and nothing else", () => {
        const esc = String.fromCharCode(27)
        expect(`${esc}[36mcyan${esc}[39m ${esc}[1;31mbold red${esc}[0m`.replace(ANSI, "")).toBe(
            "cyan bold red"
        )
        expect(plain(t.accent(t.bold("text")))).toBe("text")
    })
})

describe("isInteractive", () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it("is true only for a TTY outside CI", () => {
        vi.stubEnv("CI", "")
        const stream = (isTTY?: boolean) => ({ isTTY }) as unknown as typeof process.stdout
        expect(theme.isInteractive(stream(true))).toBe(true)
        expect(theme.isInteractive(stream(false))).toBe(false)
        expect(theme.isInteractive(stream())).toBe(false)

        vi.stubEnv("CI", "true")
        expect(theme.isInteractive(stream(true))).toBe(false)
    })
})

describe("isVerbose", () => {
    it("is on for --verbose or --debug on this process", () => {
        expect(theme.isVerbose(["node", "catalyst", "--verbose"], {})).toBe(true)
        expect(theme.isVerbose(["node", "catalyst", "--debug"], {})).toBe(true)
    })

    it("is on when a parent forwarded the mode", () => {
        expect(theme.isVerbose([], { CATALYST_OUTPUT_MODE: "verbose" })).toBe(true)
        expect(theme.isVerbose([], { CATALYST_OUTPUT_MODE: "debug" })).toBe(true)
    })

    it("is off by default and for any other mode", () => {
        expect(theme.isVerbose(["node", "catalyst", "build"], {})).toBe(false)
        expect(theme.isVerbose([], { CATALYST_OUTPUT_MODE: "default" })).toBe(false)
    })
})

describe("version and header", () => {
    it("reads catalyst-core's own package version", () => {
        expect(theme.version()).toBe(pkg.version)
        // Cached: a second call returns the same value.
        expect(theme.version()).toBe(pkg.version)
    })

    it("opens with title, version and subtitle over a rule", () => {
        const lines = plain(theme.header("catalyst build", "production")).split("\n")
        expect(lines).toEqual([
            "",
            `  catalyst build v${pkg.version}  ›  production`,
            `  ${"─".repeat(46)}`,
            "",
        ])
    })

    it("omits the subtitle separator when there is no subtitle", () => {
        const title = plain(theme.header("catalyst serve")).split("\n")[1]
        expect(title).toBe(`  catalyst serve v${pkg.version}`)
    })
})

describe("row", () => {
    it("pads the key so values line up in one column", () => {
        expect(plain(theme.row("Local", "http://localhost:3005"))).toBe("  Local    http://localhost:3005")
        expect(plain(theme.row("Network", "http://10.0.0.2:3005"))).toBe("  Network  http://10.0.0.2:3005")
        expect(plain(theme.row("a", "b", 3))).toBe("  a  b")
    })
})

describe("duration", () => {
    it("uses ms under a second, one decimal under a minute, then m/s", () => {
        expect(theme.duration(0)).toBe("0ms")
        expect(theme.duration(999)).toBe("999ms")
        expect(theme.duration(1000)).toBe("1.0s")
        expect(theme.duration(12345)).toBe("12.3s")
        expect(theme.duration(60000)).toBe("1m 0s")
        expect(theme.duration(125400)).toBe("2m 5s")
    })
})

describe("bytes", () => {
    it("picks B, kB or MB by size", () => {
        expect(theme.bytes(0)).toBe("0 B")
        expect(theme.bytes(1023)).toBe("1023 B")
        expect(theme.bytes(1024)).toBe("1.0 kB")
        expect(theme.bytes(1536)).toBe("1.5 kB")
        expect(theme.bytes(1024 * 1024)).toBe("1.00 MB")
        expect(theme.bytes(5.5 * 1024 * 1024)).toBe("5.50 MB")
    })
})

describe("displayPath", () => {
    const root = path.join(os.tmpdir(), "catalyst-app")

    it("is relative when the file is inside the app", () => {
        expect(theme.displayPath(path.join(root, "src", "App.js"), root)).toBe(path.join("src", "App.js"))
    })

    it("uses ~ for files under home but outside the app", () => {
        const file = path.join(os.homedir(), "Library", "DerivedData", "Build.log")
        expect(theme.displayPath(file, root)).toBe(
            `~${path.sep}${path.join("Library", "DerivedData", "Build.log")}`
        )
    })

    it("keeps absolute paths elsewhere, and the root itself", () => {
        const outside = path.join(path.parse(root).root, "opt-catalyst-elsewhere", "file.js")
        expect(theme.displayPath(outside, root)).toBe(outside)
        expect(theme.displayPath(root, root)).toBe(root)
    })

    it("passes empty values through", () => {
        expect(theme.displayPath(undefined, root)).toBeUndefined()
        expect(theme.displayPath("", root)).toBe("")
    })
})

describe("step", () => {
    it("marks state with a glyph and shows meaningful timings", () => {
        expect(plain(theme.step("Bundled client", 1200))).toBe("  ✓ Bundled client  1.2s")
        expect(plain(theme.step("Type check", 250, "warn"))).toBe("  ▲ Type check  250ms")
        expect(plain(theme.step("Gradle build", 61000, "fail"))).toBe("  ✗ Gradle build  1m 1s")
    })

    it("drops timings that are noise or missing", () => {
        expect(plain(theme.step("Copied assets", 40))).toBe("  ✓ Copied assets")
        expect(plain(theme.step("Copied assets"))).toBe("  ✓ Copied assets")
        expect(plain(theme.step("Copied assets", null))).toBe("  ✓ Copied assets")
    })
})
