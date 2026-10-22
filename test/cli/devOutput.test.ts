import { spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { PassThrough } from "node:stream"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type themeModule from "../../src/cli/theme.js"

// Loaded with require, the way serve.js and the native commands load them:
// v8 coverage then sees one copy of each CommonJS file rather than an
// import-transformed one and a required one that merge badly.
const load = createRequire(import.meta.url)
const devOutput: unknown = load("../../src/cli/devOutput.js")
const theme: typeof themeModule = load("../../src/cli/theme.js")

// devOutput.js shapes `catalyst start`'s server output and supervises the
// `catalyst serve` child. Colour depends on the environment, so assertions
// are on the ANSI-stripped text.
// Loosely typed: the JSDoc types are narrower than what the tests pass in
// (a state with `verbose`, a fake child process).
type State = Record<string, unknown>
const {
    formatDevLine,
    wireServerOutput,
    superviseServer,
    ensurePortFree,
    createLineReader,
    BANNER_START,
    BANNER_END,
    NEXT_STEP,
} = devOutput as {
    formatDevLine: (line: string, state: State) => string | null
    wireServerOutput: (child: unknown) => {
        state: State
        flushRemaining: (options?: { dropLastError?: boolean }) => void
    }
    superviseServer: (
        child: unknown,
        options: { scope: string; label: string; passthrough?: boolean }
    ) => State
    ensurePortFree: (options: { port: unknown; host?: string; scope: string }) => Promise<void>
    createLineReader: (onLine: (line: string) => void) => { push: (chunk: string) => void; flush: () => void }
    BANNER_START: string
    BANNER_END: string
    NEXT_STEP: string
}
const plain = (text: string | null) => (text == null ? text : String(text).replace(theme.ANSI, ""))
const DEV_OUTPUT = fileURLToPath(new URL("../../src/cli/devOutput.js", import.meta.url))

function fakeChild() {
    const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
    })
    return child
}

describe("formatDevLine before the banner", () => {
    it("shows a startup Error line instead of only remembering it", () => {
        const state: State = { seenWarnings: new Set(), verbose: false }
        const line = formatDevLine("Error: connect ECONNREFUSED 127.0.0.1:6379", state)
        expect(plain(line)).toMatch(/✗ connect ECONNREFUSED 127\.0\.0\.1:6379/)
        expect(state.lastError).toBe("connect ECONNREFUSED 127.0.0.1:6379")
        expect(state.lastErrorLine).toBe(line)
    })

    it("shows an unhandled rejection", () => {
        const state = { seenWarnings: new Set(), verbose: false }
        expect(plain(formatDevLine("unhandledRejection in Catalyst boom", state))).toMatch(
            /✗ Unhandled promise rejection boom/
        )
    })

    it("keeps stack frames under --verbose and condenses them otherwise", () => {
        const frame = "    at connect (/app/server/index.js:3:9)"
        expect(formatDevLine(frame, { seenWarnings: new Set(), verbose: false })).toBeNull()
        expect(plain(formatDevLine(frame, { seenWarnings: new Set(), verbose: true }))).toMatch(
            /at connect \(\/app\/server\/index\.js:3:9\)/
        )
    })
})

describe("wireServerOutput", () => {
    let logged: string[]

    beforeEach(() => {
        vi.useFakeTimers()
        logged = []
        vi.spyOn(console, "log").mockImplementation((line: string) => {
            logged.push(plain(String(line)) as string)
        })
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it("prints a startup diagnostic promptly when the banner never arrives", () => {
        const child = fakeChild()
        wireServerOutput(child)
        child.stderr.write(
            "\n  error dev server\n  Could not start the server: listen EADDRNOTAVAIL 10.0.0.9:3005\n"
        )
        expect(logged).toEqual([])

        vi.advanceTimersByTime(600)
        expect(logged.join("\n")).toMatch(/EADDRNOTAVAIL/)
    })

    it("prints a non-fatal startup error promptly", () => {
        const child = fakeChild()
        wireServerOutput(child)
        child.stderr.write("Error: Redis down\n")
        vi.advanceTimersByTime(600)
        expect(logged.join("\n")).toMatch(/✗ Redis down/)
    })

    it("still holds plain notices for the banner", () => {
        const child = fakeChild()
        wireServerOutput(child)
        child.stdout.write("8:00:53 pm [vite] (client) something worth reading\n")
        vi.advanceTimersByTime(600)
        expect(logged).toEqual([])

        child.stdout.write(`${BANNER_START}\nbanner\n${BANNER_END}\n`)
        vi.advanceTimersByTime(300)
        expect(logged.join("\n")).toMatch(/banner[\s\S]*Notices[\s\S]*something worth reading/)
    })

    it("leaves out the one-line error the exit diagnostic is about to repeat", () => {
        const child = fakeChild()
        const { flushRemaining } = wireServerOutput(child)
        child.stderr.write("Error: Cannot find module 'x'\n")
        flushRemaining({ dropLastError: true })
        expect(logged.join("\n")).not.toMatch(/Cannot find module/)
    })
})

describe("superviseServer passthrough (catalyst serve)", () => {
    it("propagates the exit code without wiring output", () => {
        const child = fakeChild()
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
        const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
        try {
            superviseServer(child, { scope: "server", label: "production server", passthrough: true })
            child.emit("close", 3, null)
            expect(exit).toHaveBeenCalledWith(3)
            // The app's own output already said why; nothing is added.
            expect(stderr).not.toHaveBeenCalled()
            expect(child.stdout.listenerCount("data")).toBe(0)
        } finally {
            vi.restoreAllMocks()
            for (const signal of ["SIGTERM", "SIGHUP"] as const) process.removeAllListeners(signal)
        }
    })

    it("delivers the app's stdout and stderr byte-for-byte to the right streams", () => {
        // A real wrapper process around a real inherited child, as serve.js
        // runs it: JSON log lines, a logged error object and a stack must
        // arrive exactly as written.
        const app = [
            `process.stdout.write('{"level":"info","message":"order placed"}\\n')`,
            `process.stderr.write("{\\n  code: 'ECONNRESET',\\n  port: 6379\\n}\\n")`,
            `process.stderr.write("Error: upstream timeout\\n    at handler (/app/server.js:10:5)\\n")`,
            `process.exit(3)`,
        ].join(";")
        const wrapper = [
            `const { spawn } = require("child_process")`,
            `const { superviseServer } = require(${JSON.stringify(DEV_OUTPUT)})`,
            `const child = spawn(process.execPath, ["-e", ${JSON.stringify(app)}], { stdio: "inherit" })`,
            `superviseServer(child, { scope: "server", label: "production server", passthrough: true })`,
        ].join(";")
        const result = spawnSync(process.execPath, ["-e", wrapper], { encoding: "utf8" })

        expect(result.status).toBe(3)
        expect(result.stdout).toBe('{"level":"info","message":"order placed"}\n')
        expect(result.stderr).toBe(
            "{\n  code: 'ECONNRESET',\n  port: 6379\n}\nError: upstream timeout\n    at handler (/app/server.js:10:5)\n"
        )
    })
})

describe("formatDevLine classification", () => {
    const fresh = (extra: State = {}): State => ({ seenWarnings: new Set(), verbose: false, ...extra })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("swallows Vite's own SSR evaluation report up to the server's diagnostic", () => {
        const state = fresh()
        expect(formatDevLine("Error when evaluating SSR module /src/App.js:", state)).toBeNull()
        expect(formatDevLine("    file: /app/src/App.js:3:9", state)).toBeNull()
        expect(formatDevLine("", state)).toBeNull()
        // The blank line that opened the report was swallowed with Vite's block.
        expect(formatDevLine("  error dev server", state)).toBe("\n  error dev server")
        expect(formatDevLine("    Cannot read properties of undefined", state)).toBe(
            "    Cannot read properties of undefined"
        )
        // Blank lines are layout once a diagnostic is open.
        expect(formatDevLine("", state)).toBe("")
    })

    it("stops swallowing at Vite's next notice or after a bounded run", () => {
        const state = fresh()
        formatDevLine("Error when evaluating SSR module /src/App.js:", state)
        expect(plain(formatDevLine("8:00:53 pm [vite] server restarted.", state))).toBe(
            "  • server restarted."
        )

        const bounded = fresh()
        formatDevLine("Error when evaluating SSR module /src/App.js:", bounded)
        for (let i = 0; i < 60; i++) expect(formatDevLine(`    frame ${i}`, bounded)).toBeNull()
        expect(plain(formatDevLine("finally visible", bounded))).toBe("  • finally visible")
    })

    it("keeps the SSR report under --verbose", () => {
        expect(
            plain(formatDevLine("Error when evaluating SSR module /src/App.js:", fresh({ verbose: true })))
        ).toBe("  • Error when evaluating SSR module /src/App.js:")
    })

    it("drops boilerplate the user cannot act on", () => {
        for (const line of [
            "Debugger attached.",
            "For help, see: https://nodejs.org/en/docs/inspector",
            "(Use `node --trace-warnings ...` to show where the warning was created)",
            "  code: 'ECONNREFUSED',",
            "{",
            "}",
            "Caught exception: Error: boom",
            "2",
        ]) {
            expect(formatDevLine(line, fresh())).toBeNull()
        }
    })

    it("hides Vite bookkeeping unless verbose", () => {
        const line = "8:00:53 pm [vite] (client) Re-optimizing dependencies because lockfile has changed"
        expect(formatDevLine(line, fresh())).toBeNull()
        expect(plain(formatDevLine(line, fresh({ verbose: true })))).toBe(
            "  • client Re-optimizing dependencies because lockfile has changed"
        )
    })

    it("rewords reloads and shows one line for both channels", () => {
        vi.spyOn(Date, "now").mockReturnValue(1000)
        const state = fresh()
        expect(plain(formatDevLine("8:00:53 pm [vite] (client) page reload src/App.js", state))).toBe(
            "  ↻ src/App.js"
        )
        expect(formatDevLine("8:00:53 pm [vite] (ssr) page reload src/App.js", state)).toBeNull()
        expect(plain(formatDevLine("8:00:54 pm [vite] (client) hmr update /src/a.css (x2)", state))).toBe(
            "  ↻ /src/a.css (x2)"
        )
    })

    it("shortens unknown routes and a taken HMR port", () => {
        expect(plain(formatDevLine('No routes matched location "/nope"', fresh()))).toBe(
            "  ▲ No route matches /nope"
        )
        expect(plain(formatDevLine("WebSocket server error: Port 24678 is already in use", fresh()))).toBe(
            "  ▲ Live reload is off: port 24678 is used by another dev server"
        )
    })

    it("shows stack frames once the banner has printed", () => {
        expect(plain(formatDevLine("    at handler (/app/server.js:10:5)", fresh({ flushed: true })))).toBe(
            "  at handler (/app/server.js:10:5)"
        )
    })

    it("reports an unhandled rejection without an empty object", () => {
        const state = fresh()
        expect(plain(formatDevLine("unhandledRejection in Catalyst {}", state))).toBe(
            "  ✗ Unhandled promise rejection"
        )
        expect(state.lastError).toBe("Unhandled promise rejection")
    })

    it("keeps the inspector URL", () => {
        expect(plain(formatDevLine("Debugger listening on ws://127.0.0.1:9229/abc", fresh()))).toBe(
            "  Inspect  ws://127.0.0.1:9229/abc"
        )
    })

    it("collapses Node warnings to one line each", () => {
        const typeless = "(node:123) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///x.js"
        expect(formatDevLine(typeless, fresh())).toBeNull()
        expect(plain(formatDevLine(typeless, fresh({ verbose: true })))).toBe(
            '  ▲ Add "type": "module" to package.json to silence a Node reparse warning'
        )

        const state = fresh()
        const experimental = "(node:1) [EXPERIMENTAL_FEATURE] Warning: Fetch is experimental."
        expect(plain(formatDevLine(experimental, state))).toBe("  ▲ Fetch is experimental.")
        expect(
            formatDevLine("(node:2) [EXPERIMENTAL_FEATURE] Warning: Fetch is experimental.", state)
        ).toBeNull()
        expect(plain(formatDevLine("(node:3) Warning: uncoded advisory", state))).toBe("  ▲ uncoded advisory")
    })

    it("keeps a Vite notice's channel and passes anything else through dimmed", () => {
        expect(plain(formatDevLine("8:00:53 pm [vite] (ssr) something happened", fresh()))).toBe(
            "  • ssr something happened"
        )
        expect(plain(formatDevLine("hello from the app", fresh()))).toBe("  • hello from the app")
    })
})

describe("createLineReader", () => {
    it("holds a partial line until its newline or a flush", () => {
        const seen: string[] = []
        const reader = createLineReader((line) => seen.push(line))
        reader.push("one\ntw")
        expect(seen).toEqual(["one"])
        reader.push("o\nthree")
        expect(seen).toEqual(["one", "two"])
        reader.flush()
        reader.flush()
        expect(seen).toEqual(["one", "two", "three"])
    })
})

describe("wireServerOutput after the banner", () => {
    let logged: string[]

    beforeEach(() => {
        vi.useFakeTimers()
        logged = []
        vi.spyOn(console, "log").mockImplementation((line: string) => {
            logged.push(plain(String(line)) as string)
        })
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it("prints the next step after the notices, then live events as they happen", () => {
        const child = fakeChild()
        wireServerOutput(child)
        child.stdout.write("8:00:53 pm [vite] (client) a startup notice\n")
        child.stdout.write(`${BANNER_START}\n  Local  http://localhost:3005\n`)
        child.stdout.write(`${NEXT_STEP}Run catalyst build next\n${BANNER_END}\n${BANNER_END}\n`)
        vi.advanceTimersByTime(300)
        expect(logged).toEqual([
            "  Local  http://localhost:3005",
            "\n  Notices",
            "  • client a startup notice",
            "\nRun catalyst build next\n",
        ])

        child.stderr.write("Error: request failed\n")
        expect(logged.at(-1)).toBe("  ✗ request failed")
    })

    it("flushes a trailing partial line when the server exits", () => {
        const child = fakeChild()
        const { flushRemaining } = wireServerOutput(child)
        child.stderr.write("Error: no newline at the end")
        expect(logged).toEqual([])
        flushRemaining()
        expect(logged).toEqual(["  ✗ no newline at the end"])
    })
})

describe("superviseServer (catalyst start)", () => {
    let stderr: string
    let logged: string[]
    let added: { signal: "SIGTERM" | "SIGHUP"; listener: () => void }[]
    let exit: ReturnType<typeof vi.fn>

    const supervise = (child: ReturnType<typeof fakeChild>) => {
        const before = {
            SIGTERM: process.listeners("SIGTERM"),
            SIGHUP: process.listeners("SIGHUP"),
        }
        const state = superviseServer(child, { scope: "dev server", label: "dev server" })
        for (const signal of ["SIGTERM", "SIGHUP"] as const) {
            for (const listener of process.listeners(signal)) {
                if (!before[signal].includes(listener)) {
                    added.push({ signal, listener: listener as () => void })
                }
            }
        }
        return state
    }

    beforeEach(() => {
        stderr = ""
        logged = []
        added = []
        // Thrown, as the real exit would stop execution there.
        exit = vi.fn((code?: number) => {
            throw new Error(`exit ${code}`)
        })
        vi.spyOn(process, "exit").mockImplementation(exit as never)
        vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
            stderr += plain(String(chunk))
            return true
        }) as never)
        vi.spyOn(console, "log").mockImplementation((line: string) => {
            logged.push(plain(String(line)) as string)
        })
    })
    afterEach(() => {
        vi.restoreAllMocks()
        for (const { signal, listener } of added) process.removeListener(signal, listener)
    })

    it("forwards SIGTERM and SIGHUP to the child", () => {
        const child = fakeChild()
        supervise(child)
        expect(added.map((entry) => entry.signal)).toEqual(["SIGTERM", "SIGHUP"])
        for (const { listener } of added) listener()
        expect(child.kill).toHaveBeenCalledWith("SIGTERM")
        expect(child.kill).toHaveBeenCalledWith("SIGHUP")
    })

    it("reports a spawn failure and exits 1", () => {
        const child = fakeChild()
        supervise(child)
        expect(() => child.emit("error", new Error("spawn node ENOENT"))).toThrow("exit 1")
        expect(stderr).toMatch(/Could not start the dev server: spawn node ENOENT/)
    })

    it("treats Ctrl-C as a clean stop", () => {
        const child = fakeChild()
        supervise(child)
        expect(() => child.emit("close", null, "SIGINT")).toThrow("exit 0")
        expect(stderr).toBe("")
    })

    it("exits 0 when the server exits cleanly", () => {
        const child = fakeChild()
        supervise(child)
        expect(() => child.emit("close", 0, null)).toThrow("exit 0")
    })

    it("renders the last error once, as a diagnostic with its hint", () => {
        const child = fakeChild()
        supervise(child)
        child.stderr.write("Error: listen EADDRINUSE: address already in use :::3005\n")
        expect(() => child.emit("close", 1, null)).toThrow("exit 1")
        expect(stderr).toMatch(/listen EADDRINUSE: address already in use :::3005/)
        expect(stderr).toMatch(/Something is already on/)
        // The one-line form is dropped, so the error is not said twice.
        expect(logged.join("\n")).not.toMatch(/EADDRINUSE/)
    })

    it("still says something when a crash printed nothing", () => {
        const child = fakeChild()
        supervise(child)
        expect(() => child.emit("close", null, "SIGKILL")).toThrow("exit 1")
        expect(stderr).toMatch(/The server exited unexpectedly \(code null\)/)
    })

    it("adds nothing when the server already printed its own diagnostic", () => {
        const child = fakeChild()
        const state = supervise(child)
        child.stderr.write("\n  error dev server\n    Could not load config\n")
        expect(() => child.emit("close", 2, null)).toThrow("exit 2")
        expect(state.sawDiagnostic).toBe(true)
        expect(stderr).toBe("")
        expect(logged.join("\n")).toMatch(/error dev server[\s\S]*Could not load config/)
    })
})

describe("ensurePortFree", () => {
    const net: typeof import("node:net") = load("node:net")
    const childProcess: typeof import("node:child_process") = load("node:child_process")
    let stderr: string
    let exit: ReturnType<typeof vi.spyOn>

    // A server whose listen() reports the given outcome, with no socket opened.
    const fakeServer = (outcome: { error?: { code: string } }) => {
        const server = Object.assign(new EventEmitter(), {
            listen: vi.fn(() => {
                if (outcome.error) server.emit("error", outcome.error)
                else server.emit("listening")
            }),
            close: vi.fn((done: () => void) => done()),
        })
        vi.spyOn(net, "createServer").mockReturnValue(server as unknown as import("node:net").Server)
        return server
    }

    beforeEach(() => {
        stderr = ""
        exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
        vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
            stderr += plain(String(chunk))
            return true
        }) as never)
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("skips the probe for a missing or invalid port", async () => {
        const createServer = vi.spyOn(net, "createServer")
        await ensurePortFree({ port: undefined, scope: "server" })
        await ensurePortFree({ port: "abc", scope: "server" })
        await ensurePortFree({ port: 0, scope: "server" })
        expect(createServer).not.toHaveBeenCalled()
    })

    it("resolves once a free port has been probed and released", async () => {
        const server = fakeServer({})
        await ensurePortFree({ port: "3005", host: "127.0.0.1", scope: "server" })
        expect(server.listen).toHaveBeenCalledWith({ port: 3005, host: "127.0.0.1" })
        expect(server.close).toHaveBeenCalled()
        expect(exit).not.toHaveBeenCalled()
    })

    it("lets the server report errors other than a taken port", async () => {
        fakeServer({ error: { code: "EACCES" } })
        await ensurePortFree({ port: 80, scope: "server" })
        expect(exit).not.toHaveBeenCalled()
    })

    it("names the process holding a taken port", () => {
        fakeServer({ error: { code: "EADDRINUSE" } })
        const lsof = vi.spyOn(childProcess, "execFileSync").mockReturnValue("p4242\ncnode\n")
        void ensurePortFree({ port: 3005, scope: "dev server" })
        expect(lsof).toHaveBeenCalledWith("lsof", expect.arrayContaining(["-iTCP:3005"]), expect.anything())
        expect(stderr).toMatch(/Port 3005 is already in use by node \(pid 4242\)/)
        expect(stderr).toMatch(/kill 4242/)
        expect(exit).toHaveBeenCalledWith(1)
    })

    it("falls back to a generic owner and hint", () => {
        fakeServer({ error: { code: "EADDRINUSE" } })
        vi.spyOn(childProcess, "execFileSync").mockReturnValue("p77\n")
        void ensurePortFree({ port: 3005, scope: "server" })
        expect(stderr).toMatch(/in use by another process \(pid 77\)/)

        stderr = ""
        vi.spyOn(childProcess, "execFileSync").mockImplementation(() => {
            throw new Error("lsof: not found")
        })
        void ensurePortFree({ port: 3006, scope: "server" })
        expect(stderr).toMatch(/Port 3006 is already in use\n/)
        expect(stderr).toMatch(/Stop whatever is using it/)
    })
})
