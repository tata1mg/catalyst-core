import { EventEmitter } from "node:events"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

// serve.js runs on import; the preflight is stubbed and spawn is recorded so
// the test can check how the production server is started.
const preflight = vi.hoisted(() => ({ staleBuild: null as null | { code: string } }))
vi.mock("../../src/scripts/preflight.js", () => ({
    runStaticPreflightOrExit: () => {},
    checkBuildMatchesConfig: () => preflight.staleBuild,
    renderRegistryError: (error: { code: string }) => `rendered ${error.code}\n`,
}))

const spawned: { args: string[]; options: { stdio: unknown; env: Record<string, string> } }[] = []
vi.mock("child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("child_process")>()
    const spawn = (_cmd: string, args: string[], options: (typeof spawned)[number]["options"]) => {
        spawned.push({ args, options })
        return Object.assign(new EventEmitter(), { stdout: null, stderr: null, kill: () => true })
    }
    return { ...actual, default: { ...actual, spawn }, spawn }
})

let appDir: string
let stderr: string
let exit: ReturnType<typeof vi.spyOn>
const originalPwd = process.env.PWD

// serve.js runs on import, so each test loads a fresh copy.
async function serve() {
    vi.resetModules()
    await import("../../src/scripts/serve.js")
}

beforeEach(() => {
    appDir = mkdtempSync(path.join(tmpdir(), "catalyst-serve-"))
    mkdirSync(path.join(appDir, "config"))
    mkdirSync(path.join(appDir, "build"))
    writeFileSync(path.join(appDir, "config", "config.json"), JSON.stringify({ BUILD_OUTPUT_PATH: "build" }))
    writeFileSync(path.join(appDir, "package.json"), JSON.stringify({ name: "fixture-app" }))
    process.env.PWD = appDir
    spawned.length = 0
    preflight.staleBuild = null
    stderr = ""
    // Not thrown: startProd is not awaited, so a throw would surface as an
    // unhandled rejection rather than stop it.
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
        stderr += String(chunk)
        return true
    }) as never)
})

afterEach(() => {
    vi.restoreAllMocks()
    process.env.PWD = originalPwd
    for (const signal of ["SIGTERM", "SIGHUP"] as const) process.removeAllListeners(signal)
    rmSync(appDir, { recursive: true, force: true })
})

it("hands the production server the terminal's own stdout and stderr", async () => {
    await serve()
    await vi.waitFor(() => expect(spawned).toHaveLength(1))

    const { options } = spawned[0]
    // Inherited, so log shippers read the app's lines exactly as written --
    // and unwrapped, so the server prints no banner fences.
    expect(options.stdio).toBe("inherit")
    expect(options.env.CATALYST_WRAPPED).toBeUndefined()
    expect(options.env.NODE_ENV).toBe("production")
})

it("says to build first when there is no production build", async () => {
    rmSync(path.join(appDir, "build"), { recursive: true })
    await serve()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))

    expect(stderr).toMatch(/No production build in build\//)
    expect(stderr).toMatch(/Run catalyst build first, then catalyst serve\./)
})

it("refuses a build that no longer matches the config", async () => {
    preflight.staleBuild = { code: "BUILD_CONFIG_MISMATCH" }
    await serve()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))

    expect(stderr).toBe("rendered BUILD_CONFIG_MISMATCH\n")
})

it("passes --inspect through to the server", async () => {
    const argv = process.argv
    process.argv = [argv[0], "serve.js", "--inspect"]
    try {
        await serve()
        await vi.waitFor(() => expect(spawned).toHaveLength(1))
    } finally {
        process.argv = argv
    }
    expect(spawned[0].args[0]).toBe("--inspect")
})
