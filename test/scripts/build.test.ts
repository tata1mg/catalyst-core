import { EventEmitter } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type themeModule from "../../src/cli/theme.js"

// Required, the way build.js itself loads it, so v8 coverage sees one copy.
const theme: typeof themeModule = createRequire(import.meta.url)("../../src/cli/theme.js")

// build.js runs on import, so each test re-imports it against a throwaway app
// with the preflight stubbed and spawn faked: every step "runs" by printing
// the given output and exiting with the given code.
vi.mock("../../src/scripts/preflight.js", () => ({
    runStaticPreflightOrExit: () => {},
    writeBuildInfo: () => {},
}))

// `spawnError` makes the step fail to start at all; `run` stands in for what
// the step writes to disk.
type Step = { output: string; code: number; spawnError?: Error; run?: () => void }
const steps: Record<"server" | "client" | "manifest", Step> = {
    server: { output: "", code: 0 },
    client: { output: "", code: 0 },
    manifest: { output: "", code: 0 },
}

vi.mock("child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("child_process")>()
    const spawn = (_cmd: string, args: string[]) => {
        const name = args.includes("--ssr")
            ? "server"
            : args.some((arg) => arg.includes("generateOfflineManifest"))
              ? "manifest"
              : "client"
        const child = Object.assign(new EventEmitter(), {
            stdout: new PassThrough(),
            stderr: new PassThrough(),
        })
        const step = steps[name]
        setImmediate(() => {
            if (step.spawnError) return child.emit("error", step.spawnError)
            step.run?.()
            child.stderr.write(step.output)
            setImmediate(() => child.emit("close", step.code))
        })
        return child
    }
    return { ...actual, default: { ...actual, spawn }, spawn }
})

const plain = (text: string) => text.replace(theme.ANSI, "")

let appDir: string
let stderr: string
let stdout: string
let exitCode: Promise<number>
const originalArgv = process.argv
const originalPwd = process.env.PWD

async function runBuild(argv: string[] = []) {
    process.argv = [originalArgv[0], "build.js", ...argv]
    let settle: (code: number) => void
    exitCode = new Promise((resolve) => (settle = resolve))
    let exited = false
    // The first exit is the one under test; throwing stops build() there, and
    // its top-level catch then calls exit again, which is ignored.
    vi.spyOn(process, "exit").mockImplementation(((code: number) => {
        if (exited) return undefined as never
        exited = true
        settle(code)
        throw new Error("exit")
    }) as never)
    vi.resetModules()
    await import("../../src/scripts/build.js")
    return exitCode
}

beforeEach(() => {
    appDir = mkdtempSync(path.join(tmpdir(), "catalyst-build-"))
    mkdirSync(path.join(appDir, "config"))
    writeFileSync(path.join(appDir, "config", "config.json"), JSON.stringify({ BUILD_OUTPUT_PATH: "build" }))
    writeFileSync(path.join(appDir, "package.json"), JSON.stringify({ name: "fixture-app" }))
    process.env.PWD = appDir
    stderr = ""
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
        stderr += String(chunk)
        return true
    }) as never)
    stdout = ""
    // Spinner lines go to stdout.write, the rest through console.log.
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
        stdout += String(chunk)
        return true
    }) as never)
    vi.spyOn(console, "log").mockImplementation((line: string) => {
        stdout += `${String(line)}\n`
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const name of Object.keys(steps) as (keyof typeof steps)[]) steps[name] = { output: "", code: 0 }
})

afterEach(() => {
    vi.restoreAllMocks()
    process.argv = originalArgv
    process.env.PWD = originalPwd
    rmSync(appDir, { recursive: true, force: true })
})

describe("catalyst build failure output", () => {
    it("reports both bundles when only one bundle's error is recognised", async () => {
        steps.server = { output: "src/js/App.js:3:10: ERROR: Expected ';' but found 'x'\n", code: 1 }
        steps.client = { output: "something the patterns do not know\n", code: 1 }

        expect(await runBuild()).toBe(1)
        const text = plain(stderr)
        expect(text).toMatch(/Expected ';' but found 'x'/)
        expect(text).toMatch(/The client bundle failed/)
        expect(text).toMatch(/something the patterns do not know/)
    })

    it("shows the tail of a failed offline manifest step", async () => {
        steps.manifest = {
            output: "TypeError: Cannot read properties of undefined\n    at generate (/app/gen.js:4:2)\n",
            code: 2,
        }

        expect(await runBuild()).toBe(2)
        const text = plain(stderr)
        expect(text).toMatch(/offline manifest failed/)
        expect(text).toMatch(/TypeError: Cannot read properties of undefined/)
        expect(text).not.toMatch(/Full output:/)
    })

    it("shows the manifest step's full output under --verbose", async () => {
        steps.manifest = {
            output: "TypeError: Cannot read properties of undefined\n    at generate (/app/gen.js:4:2)\n",
            code: 1,
        }

        expect(await runBuild(["--verbose"])).toBe(1)
        const text = plain(stderr)
        expect(text).toMatch(/Full output:/)
        expect(text).toMatch(/at generate \(\/app\/gen\.js:4:2\)/)
    })
})

describe("catalyst build failure reporting", () => {
    it("reports one cause once when it broke both bundles", async () => {
        const error = "src/js/App.js:3:10: ERROR: Expected ';' but found 'x'\n"
        steps.server = { output: error, code: 1 }
        steps.client = { output: error, code: 1 }

        expect(await runBuild()).toBe(1)
        const text = plain(stderr)
        expect(text.match(/Expected ';' but found 'x'/g)).toHaveLength(1)
        expect(text).toMatch(/server \+ client bundle/)
        expect(plain(stdout)).toMatch(/✗ Build failed/)
    })

    it("adds the registry code and the bundlers' full output under --verbose", async () => {
        steps.client = { output: "something the patterns do not know\n", code: 4 }

        expect(await runBuild(["--verbose"])).toBe(4)
        const text = plain(stderr)
        expect(text).toMatch(/The client bundle failed/)
        expect(text).toMatch(/Full output:/)
        expect(text).toMatch(/\[client\]/)
    })

    it("includes the environment under --debug", async () => {
        steps.server = { output: "unknown failure\n", code: 1 }

        expect(await runBuild(["--debug"])).toBe(1)
        expect(plain(stderr)).toContain(process.version)
    })

    it("exits 1 rather than crashing when a bundler cannot be spawned", async () => {
        steps.server = {
            output: "",
            code: 0,
            spawnError: Object.assign(new Error("spawn node ENOENT"), { code: "ENOENT" }),
        }

        expect(await runBuild()).toBe(1)
        // A spawn error carries no bundle label, so the report stays generic.
        expect(plain(stderr)).toMatch(/The production bundle failed/)
    })
})

describe("catalyst build success output", () => {
    async function runSuccessfulBuild(argv: string[] = []) {
        void runBuild(argv)
        await vi.waitFor(() => expect(plain(stdout)).toMatch(/Built in/))
        return plain(stdout)
    }

    it("cleans the previous output, surfaces bundle warnings, and lists the assets", async () => {
        const buildDir = path.join(appDir, "build")
        mkdirSync(buildDir)
        writeFileSync(path.join(buildDir, "stale.js"), "old")

        steps.client = {
            output: [
                "vite v5 building for production...",
                "(!) Some chunks are larger than 500 kB after minification.",
                "(!) Some chunks are larger than 500 kB after minification.",
                "✓ built in 1.2s",
            ].join("\n"),
            code: 0,
        }
        steps.server = { output: "[plugin vite:reporter] dynamic import will not move module\n", code: 0 }
        // The manifest step runs after the bundles, so it stands in for
        // what they wrote.
        steps.manifest = {
            output: "",
            code: 0,
            run: () => {
                mkdirSync(path.join(buildDir, "public", "client"), { recursive: true })
                mkdirSync(path.join(buildDir, "server"), { recursive: true })
                for (let i = 0; i < 13; i++) {
                    writeFileSync(
                        path.join(buildDir, "public", "client", `chunk-${i}.js`),
                        "x".repeat(100 * (i + 1))
                    )
                }
                writeFileSync(path.join(buildDir, "public", "client", "main.css"), "body{}".repeat(500))
                writeFileSync(path.join(buildDir, "public", "client", "readme.txt"), "not an asset")
                writeFileSync(path.join(buildDir, "server", "index.js"), "export default 1")
            },
        }

        const text = await runSuccessfulBuild()
        expect(text).toMatch(/Cleaned previous output/)
        expect(existsSync(path.join(buildDir, "stale.js"))).toBe(false)
        expect(text.match(/client Some chunks are larger than 500 kB/g)).toHaveLength(1)
        expect(text).toMatch(/server \[plugin vite:reporter\] dynamic import will not move module/)
        expect(plain(stderr)).toBe("")

        expect(text).toMatch(/Client {2}build\//)
        // Largest first, capped at twelve rows.
        expect(text).toMatch(/├ public\/client\/main\.css\s+2\.9 kB\s+\d+ B gzip/)
        expect(text).toMatch(/and 2 more/)
        expect(text).not.toMatch(/readme\.txt/)
        expect(text).toMatch(/Server {2}build\/server\/ {2}1 file, 16 B/)
        expect(text).toMatch(/Run catalyst serve to start the production server/)
    })

    it("closes the table on its last row and skips it when nothing was produced", async () => {
        steps.manifest = {
            output: "",
            code: 0,
            run: () => {
                mkdirSync(path.join(appDir, "build", "server"), { recursive: true })
                writeFileSync(path.join(appDir, "build", "app.js"), "console.log(1)")
                writeFileSync(path.join(appDir, "build", "server", "a.js"), "1")
                writeFileSync(path.join(appDir, "build", "server", "b.js"), "2")
            },
        }
        const text = await runSuccessfulBuild()
        expect(text).toMatch(/└ app\.js/)
        expect(text).toMatch(/2 files, 2 B/)
        expect(text).not.toMatch(/Cleaned previous output/)
    })

    it("prints no asset table when the build wrote nothing", async () => {
        const text = await runSuccessfulBuild()
        expect(text).not.toMatch(/Client {2}/)
        expect(text).toMatch(/Built client and server bundles/)
        expect(text).toMatch(/Generated offline manifest/)
    })
})
