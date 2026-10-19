import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createRequire } from "module"
import type buildErrorsModule from "../../src/cli/buildErrors.js"
import type themeModule from "../../src/cli/theme.js"

// diagnostic.js turns a failure into the block a person reads: what broke,
// where, the code around it, and what to do. Colour depends on the
// environment, so every assertion is on the ANSI-stripped text.
//
// The CLI modules are CommonJS and require one another, so they are loaded
// with require here too: v8 coverage then sees a single copy of each file
// instead of an import-transformed one and a required one that merge badly.
// `any` because tsc reads the JSDoc as exact signatures (every option
// required, `error` always an Error) and these tests pass partial input.
const load = createRequire(import.meta.url)
const diagnostics: any = load("../../src/cli/diagnostic.js")
const buildErrors: typeof buildErrorsModule = load("../../src/cli/buildErrors.js")
const theme: typeof themeModule = load("../../src/cli/theme.js")
const { diagnostic, buildFailure, registryFailure, runtimeFailure, verboseOutput } = diagnostics
const { codeFrame, parseFrames, isAppFrame } = diagnostics
const plain = (text: string | null) => (text == null ? text : String(text).replace(theme.ANSI, ""))
const lines = (text: string) => plain(text).split("\n")

const SOURCE = [
    "import React from 'react'",
    "",
    "export default function Home() {",
    "\tconst data = useData()",
    "    return <div>{data.title}</div>",
    "}",
    "",
].join("\n")

let app: string
let file: string

beforeAll(() => {
    // realpath: on macOS tmpdir() is a /var symlink to /private/var, and the
    // module compares paths textually.
    app = realpathSync(mkdtempSync(path.join(tmpdir(), "catalyst-diagnostic-")))
    mkdirSync(path.join(app, "src"))
    file = path.join(app, "src", "Home.js")
    writeFileSync(file, SOURCE)
})

afterAll(() => {
    rmSync(app, { recursive: true, force: true })
})

describe("diagnostic", () => {
    it("renders a message-only failure as a complete block", () => {
        expect(lines(diagnostic({ message: "Port is not a number" }))).toEqual([
            "",
            "  error",
            "  Port is not a number",
            "",
        ])
    })

    it("labels the code and scope, then lists each detail line", () => {
        const out = lines(
            diagnostic({
                message: "Build does not match config",
                code: "CONFIG-004",
                scope: "preflight",
                details: "PUBLIC_STATIC_ASSET_URL: a\nBUILD_OUTPUT_PATH: b",
            })
        )
        expect(out.slice(1, 5)).toEqual([
            "  error CONFIG-004  preflight",
            "  Build does not match config",
            "  PUBLIC_STATIC_ASSET_URL: a",
            "  BUILD_OUTPUT_PATH: b",
        ])
    })

    it("points at the file relative to the app with a code frame and caret", () => {
        const out = lines(diagnostic({ message: "data is undefined", file, line: 4, column: 19, cwd: app }))
        expect(out).toContain(`  at ${path.join("src", "Home.js")}:4:19`)
        // Two lines of context either side, the failing one marked, tabs expanded.
        const frame = out.slice(out.indexOf("") + 1).filter((l) => l.includes("│"))
        expect(frame).toEqual([
            "     2 │ ",
            "     3 │ export default function Home() {",
            "  >  4 │     const data = useData()",
            "       │                   ^",
            "     5 │     return <div>{data.title}</div>",
            "     6 │ }",
        ])
    })

    it("keeps paths outside the app absolute and omits a missing column", () => {
        const out = lines(diagnostic({ message: "x", file, line: 1, cwd: path.join(app, "elsewhere-app") }))
        expect(out).toContain(`  at ${file}:1`)
        expect(out.some((l) => l.includes("^"))).toBe(false)
    })

    it("names a file without a line and shows no frame", () => {
        const out = lines(diagnostic({ message: "x", file, cwd: app }))
        expect(out).toContain(`  at ${path.join("src", "Home.js")}`)
        expect(out.some((l) => l.includes("│"))).toBe(false)
    })

    it("wraps a long hint at 72 columns under a hanging indent", () => {
        const hint =
            "Set the Android SDK path in config/config.json under WEBVIEW_CONFIG.android.sdkPath, or export ANDROID_HOME before you run the build again."
        const out = lines(diagnostic({ message: "SDK missing", hint }))
        const start = out.findIndex((l) => l.startsWith("  hint  "))
        expect(out[start - 1]).toBe("")
        const hintLines = out.slice(start, out.length - 1)
        expect(hintLines.length).toBeGreaterThan(1)
        for (const line of hintLines.slice(1)) expect(line.startsWith("        ")).toBe(true)
        expect(hintLines.map((l) => l.trim().replace(/^hint\s+/, "")).join(" ")).toBe(hint)
        for (const line of hintLines)
            expect(line.replace(/^\s+(hint\s+)?/, "").length).toBeLessThanOrEqual(72)
    })

    it("puts docs straight under a hint, but leaves a gap under a code frame", () => {
        const withHint = lines(diagnostic({ message: "x", hint: "Do y.", docs: "https://d" }))
        expect(withHint.slice(-3)).toEqual(["  hint  Do y.", "  docs  https://d", ""])

        const withFrame = lines(diagnostic({ message: "x", file, line: 6, docs: "https://d", cwd: app }))
        expect(withFrame.slice(-4)).toEqual(["     7 │ ", "", "  docs  https://d", ""])

        const bare = lines(diagnostic({ message: "x", docs: "https://d" }))
        expect(bare).toEqual(["", "  error", "  x", "  docs  https://d", ""])
    })
})

describe("codeFrame", () => {
    it("returns null rather than throwing when it cannot show the source", () => {
        expect(codeFrame(path.join(app, "missing.js"), 1, 1)).toBeNull()
        expect(codeFrame(file, 0, 1)).toBeNull()
        expect(codeFrame(file, 99, 1)).toBeNull()
    })

    it("clips context at the start of the file and skips a zero column caret", () => {
        const frame = lines(codeFrame(file, 1, 0))
        expect(frame).toEqual([
            "  >  1 │ import React from 'react'",
            "     2 │ ",
            "     3 │ export default function Home() {",
        ])
    })
})

describe("registryFailure", () => {
    it("renders a CatalystError with its cause, action and docs", () => {
        const error = Object.assign(new Error("Server failed to start"), {
            code: "SERVER-001",
            cause: new Error("listen EADDRINUSE"),
            suggestedAction: "Free the port.",
            docUrl: "https://catalyst.1mg.com/errors/server-001",
        })
        expect(lines(registryFailure(error, { scope: "serve" }))).toEqual([
            "",
            "  error SERVER-001  serve",
            "  Server failed to start",
            "  listen EADDRINUSE",
            "",
            "  hint  Free the port.",
            "  docs  https://catalyst.1mg.com/errors/server-001",
            "",
        ])
    })

    it("falls back to details, a string cause, and drops non-string codes", () => {
        const withDetails = lines(
            registryFailure({ message: "Bad config", code: 7, details: "PORT missing" })
        )
        expect(withDetails.slice(1, 4)).toEqual(["  error", "  Bad config", "  PORT missing"])

        const stringCause = lines(registryFailure({ message: "Failed", cause: "timeout" }))
        expect(stringCause[3]).toBe("  timeout")
    })

    it("accepts anything thrown, not only errors", () => {
        expect(lines(registryFailure("plain string failure"))[2]).toBe("  plain string failure")
    })
})

describe("buildFailure", () => {
    const kotlinError = () =>
        `> Task :app:compileDebugKotlin FAILED\ne: file://${file}:4:19 Unresolved reference: useData\n`

    it("shows each compiler error with its location and source", () => {
        const error = Object.assign(new Error("Command failed with exit code 1"), { output: kotlinError() })
        const out = lines(buildFailure({ error, stage: "Gradle build", cwd: app }))
        expect(out[1]).toBe("  error Gradle build")
        expect(out).toContain("  Unresolved reference: useData")
        expect(out).toContain(`  at ${path.join("src", "Home.js")}:4:19`)
        expect(out).toContain("  >  4 │     const data = useData()")
        expect(out.join("\n")).not.toContain("hint")
    })

    it("counts several errors, reads output from the cause, and mines a hint", () => {
        const output = [
            "ld: error: code signing failed for target",
            `${file}:5:9: error: cannot find 'data' in scope`,
        ].join("\n")
        const error = Object.assign(new Error("wrapped"), {
            code: "BUNDLE-000",
            suggestedAction: "Read the error above.",
            cause: { output },
        })
        const out = lines(buildFailure({ error, stage: "Xcode build", cwd: app }))
        expect(out[1]).toBe("  2 errors BUNDLE-000 Xcode build")
        expect(out).toContain("  ld: error: code signing failed for target")
        expect(out).toContain("  cannot find 'data' in scope")
        // Wrapper codes (-000) only say "read the error above", so the hint
        // mined from the first error wins over their suggestedAction.
        expect(out.find((l) => l.startsWith("  hint"))).toMatch(/pick a signing team/)
    })

    it("prefers the registry's authored advice over a mined hint", () => {
        const error = Object.assign(new Error("Build failed"), {
            code: "ANDROID-012",
            suggestedAction: "Accept the SDK licences with sdkmanager --licenses.",
            output: "FAILURE: SDK location not found.",
        })
        const out = lines(buildFailure({ error, stage: "Gradle build", cwd: app }))
        expect(out).toContain("  hint  Accept the SDK licences with sdkmanager --licenses.")
    })

    it("mines a hint from the first error when no advice was authored", () => {
        const error = { message: "x", output: "error: SDK location not found." }
        const out = lines(buildFailure({ error, stage: "Gradle build", cwd: app }))
        expect(out.find((l) => l.startsWith("  hint"))).toMatch(/WEBVIEW_CONFIG\.android\.sdkPath/)
    })

    it("notes that more errors may follow once the cap is reached", () => {
        const output = Array.from(
            { length: buildErrors.MAX_ERRORS + 2 },
            (_, i) => `/nowhere/F${i}.swift:1:1: error: e${i}`
        ).join("\n")
        const out = lines(buildFailure({ error: { output }, stage: "Xcode build", cwd: app }))
        expect(out[1]).toBe(`  ${buildErrors.MAX_ERRORS} errors Xcode build`)
        expect(out).toContain("  … more errors may follow; the full build output is above.")
    })

    it("names the stage instead of a bare exit code and shows the output tail", () => {
        const error = Object.assign(new Error("Command failed with exit code 65"), {
            output: "Compiling...\nSomething odd happened\nBUILD FAILED in 3s\n",
        })
        const out = lines(buildFailure({ error, stage: "Xcode build", cwd: app }))
        expect(out[1]).toBe("  error")
        expect(out[2]).toBe("  Xcode build failed")
        expect(out).toContain("  Last output from the build:")
        expect(out).toContain("  │ Compiling...")
        expect(out).toContain("  │ Something odd happened")
        expect(out.join("\n")).not.toContain("BUILD FAILED in 3s")
    })

    it("keeps a real message and its stage, with the error's own hint and docs", () => {
        const error = {
            message: "Simulator could not be launched",
            code: "IOS-003",
            hint: "Reboot the simulator.",
            docUrl: "https://d/ios-003",
        }
        expect(lines(buildFailure({ error, stage: "Launch", cwd: app }))).toEqual([
            "",
            "  error IOS-003  Launch",
            "  Simulator could not be launched",
            "",
            "  hint  Reboot the simulator.",
            "  docs  https://d/ios-003",
            "",
        ])
    })

    it("labels with the stage's wrapper code unless the error carries a registry code", () => {
        const spawnError = Object.assign(new Error("spawnSync plutil ENOENT"), { code: "ENOENT" })
        expect(lines(buildFailure({ error: spawnError, stage: "iOS build", code: "IOS-000" }))[1]).toBe(
            "  error IOS-000  iOS build"
        )
        const owned = { message: "Simulator could not be launched", code: "IOS-003" }
        expect(lines(buildFailure({ error: owned, stage: "Launch", code: "IOS-000" }))[1]).toBe(
            "  error IOS-003  Launch"
        )
    })

    it("falls back to a known hint, and to a generic message without a stage", () => {
        const known = lines(buildFailure({ error: new Error("No booted simulator found"), cwd: app }))
        expect(known).toContain(
            "  hint  Open Simulator and boot a device, or run catalyst setupEmulator:ios."
        )

        expect(lines(buildFailure({ error: new Error("Command failed with exit code 1") }))[2]).toBe(
            "  The build failed"
        )
        expect(lines(buildFailure({ error: undefined, stage: "Gradle" }))[2]).toBe("  The build failed")
    })
})

describe("parseFrames", () => {
    it("parses named and anonymous V8 frames and skips everything else", () => {
        const stack = [
            "TypeError: x is not a function",
            "    at render (/app/src/Home.js:4:19)",
            "    at file:///app/src/routes.js:10:2",
            "    at new Promise (<anonymous>)",
            "    at node:internal/process/task_queues:95:5",
        ].join("\n")
        expect(parseFrames(stack)).toEqual([
            { fn: "render", file: "/app/src/Home.js", line: 4, column: 19 },
            { fn: null, file: "/app/src/routes.js", line: 10, column: 2 },
            { fn: null, file: "node:internal/process/task_queues", line: 95, column: 5 },
        ])
        expect(parseFrames(undefined)).toEqual([])
    })
})

describe("isAppFrame", () => {
    it("accepts only frames inside the app and outside node_modules", () => {
        const at = (f: string) => ({ file: f, line: 1, column: 1 })
        expect(isAppFrame(at(file), app)).toBe(true)
        expect(isAppFrame(at(path.join(app, "node_modules", "react-dom", "index.js")), app)).toBe(false)
        expect(isAppFrame(at("node:internal/modules/cjs/loader"), app)).toBe(false)
        expect(isAppFrame(at(path.join(path.dirname(app), "other", "x.js")), app)).toBe(false)
        expect(isAppFrame(at(app), app)).toBe(false)
        expect(isAppFrame({ file: null }, app)).toBe(false)
    })
})

describe("runtimeFailure", () => {
    const thrown = () => {
        const error = new TypeError("data is undefined")
        error.stack = [
            "TypeError: data is undefined",
            `    at ${path.join(app, "node_modules", "react-dom", "server.js")}:100:10`,
            `    at Home (${file}:4:19)`,
            "    at node:internal/process/task_queues:95:5",
            `    at render (${file}:5:5)`,
        ].join("\n")
        return error
    }

    it("points at the first app frame, skipping library frames", () => {
        const out = lines(
            runtimeFailure({ error: thrown(), code: "RUNTIME-WEB-001", scope: "GET /", cwd: app })
        )
        expect(out[1]).toBe("  error RUNTIME-WEB-001  GET /")
        expect(out[2]).toBe("  TypeError: data is undefined")
        expect(out).toContain(`  at ${path.join("src", "Home.js")}:4:19`)
        expect(out.join("\n")).not.toContain("react-dom")
        expect(out.join("\n")).not.toContain("stack")
    })

    it("lists the app's frames in verbose mode", () => {
        const out = lines(runtimeFailure({ error: thrown(), mode: "verbose", cwd: app }))
        const rel = path.join("src", "Home.js")
        expect(out).toContain("  stack")
        expect(out).toContain(`    at Home (${rel}:4:19)`)
        expect(out).toContain(`    at render (${rel}:5:5)`)
    })

    it("prints the whole stack and environment in debug mode", () => {
        const out = lines(
            runtimeFailure({ error: thrown(), mode: "debug", env: { NODE_ENV: "development" }, cwd: app })
        )
        expect(out).toContain("  at node:internal/process/task_queues:95:5")
        expect(out).toContain(`  at ${path.join(app, "node_modules", "react-dom", "server.js")}:100:10`)
        expect(out).toContain("  NODE_ENV  development")
    })

    it("uses a Vite transform location and keeps only the first sentence", () => {
        const error = Object.assign(
            new Error(
                `Failed to resolve import "@api/client" from "src/Home.js". Does the file exist? Check the alias configuration and try again.`
            ),
            { loc: { file, line: 1, column: 8 } }
        )
        const out = lines(runtimeFailure({ error, cwd: app }))
        expect(out[2]).toBe(`  Failed to resolve import "@api/client" from "src/Home.js".`)
        expect(out).toContain(`  at ${path.join("src", "Home.js")}:1:8`)
        expect(out.find((l) => l.startsWith("  hint"))).toMatch(/alias @api is not defined/)
        expect(out).toContain("  docs  https://catalyst.1mg.com/errors/unresolved-import")
    })

    it("handles non-Error throws and lets explicit docs win", () => {
        const out = lines(
            runtimeFailure({ error: "boom", docs: "https://d/runtime", mode: "debug", cwd: app })
        )
        expect(out).toEqual(["", "  error", "  boom", "  docs  https://d/runtime", ""])

        const objectThrow = lines(runtimeFailure({ error: { message: "", name: "AbortError" }, cwd: app }))
        expect(objectThrow[2]).toBe("  AbortError: AbortError")
    })
})

describe("verboseOutput", () => {
    it("is empty when there is nothing to add", () => {
        expect(verboseOutput({})).toBe("")
        expect(verboseOutput({ output: "   \n" })).toBe("")
    })

    it("lists the code, docs and every line the tool printed", () => {
        const out = lines(
            verboseOutput({ code: "BUNDLE-000", docs: "https://d", output: "line one\nline two\n\n" })
        )
        expect(out).toEqual([
            "",
            "  BUNDLE-000  ·  https://d",
            "  Full output:",
            "  │ line one",
            "  │ line two",
            "",
            "",
        ])
    })

    it("adds the stack and environment in debug mode", () => {
        const error = new Error("x")
        error.stack = "Error: x\n    at build (/app/build.js:1:1)"
        const out = lines(
            verboseOutput({ code: "BUNDLE-000", mode: "debug", error, env: { PLATFORM: "android" } })
        )
        expect(out).toEqual([
            "",
            "  BUNDLE-000",
            "",
            "  at build (/app/build.js:1:1)",
            "",
            "  PLATFORM  android",
            "",
            "",
        ])
    })
})
