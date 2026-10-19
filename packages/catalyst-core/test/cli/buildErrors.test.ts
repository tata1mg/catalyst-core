import { createRequire } from "module"
import { describe, expect, it } from "vitest"

import type buildErrorsModule from "../../src/cli/buildErrors.js"
import type hintsModule from "../../src/cli/hints.js"

// buildErrors.js pulls the real compiler errors out of a native or Vite build
// transcript; hints.js maps the failures we understand to a next step. Both
// are CommonJS and required by diagnostic.js, so they are required here too
// (one copy per file for v8 coverage).
const load = createRequire(import.meta.url)
const { extractBuildErrors, outputTail, MAX_ERRORS }: typeof buildErrorsModule = load(
    "../../src/cli/buildErrors.js"
)
const { hintFor }: typeof hintsModule = load("../../src/cli/hints.js")

const ESC = String.fromCharCode(27)

describe("extractBuildErrors (native)", () => {
    it("reads Kotlin, Swift/clang, javac and linker errors with their positions", () => {
        const output = [
            "> Task :app:compileDebugKotlin",
            "e: file:///app/android/Main.kt:12:5 Unresolved reference: bar",
            "/app/ios/View.swift:7:3: error: cannot find 'baz' in scope",
            "/app/android/Main.java:40: error: ';' expected",
            "ld: error: undefined symbol _main",
        ].join("\n")
        expect(extractBuildErrors(output)).toEqual([
            { file: "/app/android/Main.kt", line: 12, column: 5, message: "Unresolved reference: bar" },
            { file: "/app/ios/View.swift", line: 7, column: 3, message: "cannot find 'baz' in scope" },
            { file: "/app/android/Main.java", line: 40, column: undefined, message: "';' expected" },
            {
                file: undefined,
                line: undefined,
                column: undefined,
                message: "ld: error: undefined symbol _main",
            },
        ])
    })

    it("skips summary noise, strips colour and reports a repeated error once", () => {
        const output = [
            "FAILURE: Build failed with an exception.",
            "Execution failed for task ':app:compileDebugKotlin'.",
            `${ESC}[31me: /app/Main.kt:1:1 Boom${ESC}[0m`,
            "e: /app/Main.kt:1:1 Boom",
            "",
        ].join("\n")
        expect(extractBuildErrors(output)).toEqual([
            { file: "/app/Main.kt", line: 1, column: 1, message: "Boom" },
        ])
    })

    it("stops at the cap", () => {
        const output = Array.from(
            { length: MAX_ERRORS + 3 },
            (_, i) => `/a/F${i}.swift:1:1: error: e${i}`
        ).join("\n")
        expect(extractBuildErrors(output)).toHaveLength(MAX_ERRORS)
    })

    it("falls back to gradle's What went wrong block, preferring the innermost cause", () => {
        const output = [
            "* What went wrong:",
            "Could not determine the dependencies of task ':app:compileDebugJavaWithJavac'.",
            "> Could not resolve all task dependencies.",
            "   > SDK location not found. Define a valid SDK location with ANDROID_HOME.",
            "",
            "* Try:",
        ].join("\n")
        expect(extractBuildErrors(output)).toEqual([{ message: "SDK location not found." }])
    })

    it("uses the first line of the block when there is no > cause", () => {
        const output = "* What went wrong:\nA problem occurred configuring project ':app'.\n* Try:\n"
        expect(extractBuildErrors(output)).toEqual([
            { message: "A problem occurred configuring project ':app'." },
        ])
    })

    it("finds nothing in empty output or an empty What went wrong block", () => {
        expect(extractBuildErrors("")).toEqual([])
        expect(extractBuildErrors(undefined)).toEqual([])
        expect(extractBuildErrors("* What went wrong:\n\n* Try:")).toEqual([])
        expect(extractBuildErrors("BUILD SUCCESSFUL in 2s")).toEqual([])
    })
})

describe("extractBuildErrors (vite)", () => {
    it("points an unresolvable import at the file that imported it", () => {
        const output =
            "[vite]: Rollup failed. [plugin:vite:load-fallback] Could not load /app/src/missing.js (imported by src/App.js): ENOENT"
        expect(extractBuildErrors(output, { toolchain: "vite" })).toEqual([
            {
                file: "src/App.js",
                line: undefined,
                column: undefined,
                message: "Could not load /app/src/missing.js",
            },
        ])
    })

    it("reads resolve and esbuild transform failures", () => {
        const output = [
            'Failed to resolve entry for package "lodash".',
            "src/Home.js:3:14: ERROR: Unexpected token",
        ].join("\n")
        expect(extractBuildErrors(output, { toolchain: "vite" })).toEqual([
            {
                file: undefined,
                line: undefined,
                column: undefined,
                message: 'Failed to resolve entry for package "lodash"',
            },
            { file: "src/Home.js", line: 3, column: 14, message: "Unexpected token" },
        ])
    })
})

describe("outputTail", () => {
    it("keeps the last lines that carry evidence, without gradle's boilerplate", () => {
        const output = [
            "line 1",
            "line 2",
            `${ESC}[33mline 3${ESC}[0m`,
            "* Try:",
            "> Run with --stacktrace option to get the stack trace.",
            "> Get more help at https://help.gradle.org.",
            "BUILD FAILED in 4s",
            "",
        ].join("\n")
        expect(outputTail(output)).toBe("line 1\nline 2\nline 3")
        expect(outputTail(output, 1)).toBe("line 3")
        expect(outputTail("")).toBe("")
    })
})

describe("hintFor", () => {
    it("explains an unresolved import as a missing alias or package", () => {
        expect(hintFor('Failed to resolve import "@api/client" from "src/App.js"')).toEqual({
            hint: "The alias @api is not defined in package.json _moduleAliases. Add it, or import with a relative path.",
            docs: "https://catalyst.1mg.com/errors/unresolved-import",
        })
        expect(hintFor("Failed to resolve import 'lodash'").hint).toBe(
            "Check the path, or install the package with npm install lodash."
        )
    })

    it("names the busy port when it can, and still helps when it cannot", () => {
        expect(hintFor("listen EADDRINUSE: address already in use :::3005").hint).toBe(
            "Something is already on port 3005. Free it with `lsof -ti :3005 | xargs kill`, or set NODE_SERVER_PORT in config/config.json."
        )
        expect(hintFor("EADDRINUSE").hint).toBe(
            "Something is already on that port. Stop it, or set NODE_SERVER_PORT in config/config.json."
        )
    })

    it("covers the native setup failures it understands", () => {
        expect(hintFor("Unknown AVD name [Pixel_9]").hint).toMatch(/emulator -list-avds/)
        expect(hintFor("Command not found: adb ").hint).toBe(
            "adb is not on PATH. Install it, or correct the path in config/config.json."
        )
        expect(hintFor("No provisioning profile matches").hint).toMatch(/signing team/)
        expect(hintFor("No booted simulator found").hint).toMatch(/boot a device/)
        expect(hintFor("ANDROID_HOME is not set").hint).toMatch(/sdkPath/)
    })

    it("stays silent rather than guess", () => {
        expect(hintFor("Something unexpected happened")).toBeNull()
        expect(hintFor("")).toBeNull()
        expect(hintFor(undefined)).toBeNull()
    })
})
