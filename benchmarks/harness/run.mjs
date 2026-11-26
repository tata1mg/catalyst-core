// Runs the whole benchmark: starts the sprite server and the built Catalyst app, then
// navigation.mjs, lighthouse.mjs, early-input.mjs, waterfall.mjs, record.mjs and summary.mjs, then stops both servers.
// Build first (see benchmarks/README.md); this script measures, it does not build.
//
// usage: node run.mjs [--quick]     (--quick: 2 runs each, for checking the setup)
import { spawn, execFileSync } from "node:child_process"
import path from "node:path"
import { APP_ORIGIN, DEFAULT_APP_ORIGIN, HARNESS_DIR } from "./lib.mjs"

// This script starts the app itself, on the port in app/config/config.json. Measuring any other
// origin would time out or measure a different server, so refuse instead.
if (APP_ORIGIN !== DEFAULT_APP_ORIGIN) {
    console.error(`run.mjs starts the app on ${DEFAULT_APP_ORIGIN}; unset APP_ORIGIN, or start your server and run the scripts one by one`)
    process.exit(1)
}

const quick = process.argv.includes("--quick")
const pokedexDir = path.resolve(HARNESS_DIR, "../pokedex")

// Polls until the URL answers 2xx, giving up at an absolute deadline; each request is cut off at the deadline too.
async function waitFor(url, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            if ((await fetch(url, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) })).ok) return
        } catch {
            // not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`${url} did not come up within ${timeoutMs / 1000} s`)
}

const servers = [
    spawn(process.execPath, ["static-server.mjs"], { cwd: pokedexDir, stdio: "ignore" }),
    spawn("npm", ["run", "serve"], { cwd: path.join(pokedexDir, "app"), stdio: "ignore", detached: true }),
]

// Stops both servers once, on normal exit, an error, Ctrl-C or SIGTERM.
let stopped = false
function stopServers() {
    if (stopped) return
    stopped = true
    servers[0].kill()
    try {
        process.kill(-servers[1].pid) // npm's process group, so the catalyst server under it stops too
    } catch {
        servers[1].kill()
    }
}
process.on("exit", stopServers)
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    process.on(signal, () => {
        stopServers()
        process.exit(code)
    })
}

const run = (script, args = []) => execFileSync(process.execPath, [script, ...args], { cwd: HARNESS_DIR, stdio: "inherit" })
const runs = (n) => [String(quick ? 2 : n)]

try {
    await waitFor("http://localhost:4000/sprites/1.png")
    await waitFor(`${APP_ORIGIN}/`)
    run("navigation.mjs", runs(10))
    run("lighthouse.mjs", runs(5))
    run("early-input.mjs", runs(5))
    run("waterfall.mjs", runs(5))
    run("record.mjs")
    run("summary.mjs")
} finally {
    stopServers()
}
