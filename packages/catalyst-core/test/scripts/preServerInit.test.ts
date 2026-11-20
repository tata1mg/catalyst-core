import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

// preServerInit.js runs on import. Env loading is stubbed, and process.exit
// throws so a failed startup check stops the module where it would stop.
vi.mock("../../src/scripts/loadEnvironmentVariables.js", () => ({ default: async () => {} }))

class Exit extends Error {}

let appDir: string
let stderr: string
const originalSrcPath = process.env.src_path

// A minimal app: react-router satisfies the startup check, and server/index.js
// is whatever the test writes.
function makeApp(serverIndex?: string) {
    appDir = mkdtempSync(path.join(tmpdir(), "catalyst-preinit-"))
    writeFileSync(path.join(appDir, "package.json"), JSON.stringify({ name: "fixture-app" }))
    mkdirSync(path.join(appDir, "node_modules", "react-router"), { recursive: true })
    writeFileSync(
        path.join(appDir, "node_modules", "react-router", "package.json"),
        JSON.stringify({ name: "react-router", version: "7.18.2" })
    )
    if (serverIndex !== undefined) {
        mkdirSync(path.join(appDir, "server"))
        writeFileSync(path.join(appDir, "server", "index.js"), serverIndex)
    }
    process.env.src_path = appDir
}

async function runPreInit() {
    vi.resetModules()
    try {
        await import("../../src/scripts/preServerInit.js")
        return "ran"
    } catch (error) {
        if (error instanceof Exit) return "exited"
        throw error
    }
}

beforeEach(() => {
    stderr = ""
    vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Exit()
    }) as never)
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
        stderr += String(chunk)
        return true
    }) as never)
})

afterEach(() => {
    vi.restoreAllMocks()
    process.env.src_path = originalSrcPath
    delete (globalThis as any).__preInitCalls
    rmSync(appDir, { recursive: true, force: true })
})

it("stops startup and says why when server/index.js exists but fails to import", async () => {
    makeApp('import "$missing/thing.js"\nexport const preServerInit = () => {}\n')

    expect(await runPreInit()).toBe("exited")
    expect(process.exit).toHaveBeenCalledWith(1)
    expect(stderr).toMatch(/server\/index\.js could not be imported, so preServerInit cannot run/)
})

it("starts without preServerInit when the app has no server/index.js", async () => {
    makeApp()

    expect(await runPreInit()).toBe("ran")
    expect(stderr).not.toMatch(/could not be imported/)
})

it("runs preServerInit from a server/index.js that imports cleanly", async () => {
    makeApp(
        "export const preServerInit = () => { globalThis.__preInitCalls = (globalThis.__preInitCalls || 0) + 1 }\n"
    )

    expect(await runPreInit()).toBe("ran")
    expect((globalThis as any).__preInitCalls).toBe(1)
})
