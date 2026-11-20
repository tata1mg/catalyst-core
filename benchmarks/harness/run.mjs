// Runs the whole benchmark: starts the sprite server and the built Catalyst app, then
// navigation.mjs, lighthouse.mjs, early-input.mjs, record.mjs and summary.mjs, then stops both servers.
// Build first (see benchmarks/README.md); this script measures, it does not build.
//
// usage: node run.mjs [--quick]     (--quick: 2 runs each, for checking the setup)
import { spawn, execFileSync } from "node:child_process"
import path from "node:path"
import { APP_ORIGIN, HARNESS_DIR } from "./lib.mjs"

const quick = process.argv.includes("--quick")
const pokedexDir = path.resolve(HARNESS_DIR, "../pokedex")

async function waitFor(url) {
    for (let i = 0; i < 120; i++) {
        try {
            if ((await fetch(url)).ok) return
        } catch {
            // not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`${url} did not come up within 60 s`)
}

const servers = [
    spawn(process.execPath, ["static-server.mjs"], { cwd: pokedexDir, stdio: "ignore" }),
    spawn("npm", ["run", "serve"], { cwd: path.join(pokedexDir, "app"), stdio: "ignore", detached: true }),
]

try {
    await waitFor("http://localhost:4000/sprites/1.png")
    await waitFor(`${APP_ORIGIN}/`)
    const step = (script, runs) => execFileSync(process.execPath, [script, ...(quick ? ["2"] : runs ? [String(runs)] : [])], { cwd: HARNESS_DIR, stdio: "inherit" })
    step("navigation.mjs", 10)
    step("lighthouse.mjs", 5)
    step("early-input.mjs", 5)
    execFileSync(process.execPath, ["record.mjs"], { cwd: HARNESS_DIR, stdio: "inherit" })
    execFileSync(process.execPath, ["summary.mjs"], { cwd: HARNESS_DIR, stdio: "inherit" })
} finally {
    servers[0].kill()
    try {
        process.kill(-servers[1].pid) // npm's process group, so the catalyst server under it stops too
    } catch {
        servers[1].kill()
    }
}
