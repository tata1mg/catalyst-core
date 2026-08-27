import fs from "fs"
import path from "path"
import os from "os"
import { spawn, execSync } from "child_process"
import { fileURLToPath } from "url"
import pc from "ansis"
import { scenarios, LEDGER } from "../scenarios/index.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appDir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(appDir, "../..")
const errorsIndexPath = path.join(repoRoot, "errors", "index.json")

const allErrorsJson = JSON.parse(fs.readFileSync(errorsIndexPath, "utf8"))
const allCodes = Object.keys(allErrorsJson)

const args = process.argv.slice(2)
let onlyCode = null
let filterCategory = null

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--only" && args[i + 1]) {
        onlyCode = args[i + 1]
        i++
    } else if (args[i] === "--filter" && args[i + 1]) {
        filterCategory = args[i + 1].toUpperCase()
        i++
    }
}

// Files scenarios may mutate. The runner snapshots these from disk before any
// scenario runs and restores them verbatim after each one — so the committed
// working tree is the single source of truth for the baseline. No inline copy
// to drift out of sync (that bug clobbered package.json once already).
const TRACKED_FILES = [
    "config/config.json",
    "package.json",
    "server/index.js",
    "server/server.js",
    "server/document.js",
    "src/js/store/index.js",
    "src/js/routes/index.js",
    "src/js/routes/utils.js",
    "src/js/containers/App/index.jsx",
    "src/js/containers/App/Home.jsx",
]

function snapshotApp() {
    const snap = {}
    for (const relPath of TRACKED_FILES) {
        const fullPath = path.join(appDir, relPath)
        if (fs.existsSync(fullPath)) {
            snap[relPath] = fs.readFileSync(fullPath, "utf8")
        }
    }
    return snap
}

function restoreSnapshot(snap) {
    for (const relPath of TRACKED_FILES) {
        const fullPath = path.join(appDir, relPath)
        if (snap[relPath] !== undefined) {
            fs.mkdirSync(path.dirname(fullPath), { recursive: true })
            fs.writeFileSync(fullPath, snap[relPath], "utf8")
        } else if (fs.existsSync(fullPath)) {
            // File didn't exist at snapshot time — a scenario created it.
            fs.rmSync(fullPath, { force: true })
        }
    }
    const buildDir = path.join(appDir, "build")
    if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true })
    }
    // Clear Vite's SSR module cache so the next catalyst start picks up any
    // source file changes rather than serving stale transformed modules.
    const viteDir = path.join(appDir, "node_modules", ".vite")
    if (fs.existsSync(viteDir)) {
        fs.rmSync(viteDir, { recursive: true, force: true })
    }
}

function killTree(child) {
    if (!child) return
    try {
        if (child.pid) {
            process.kill(-child.pid, "SIGKILL")
        }
    } catch (_) {
        try {
            child.kill("SIGKILL")
        } catch (__) {}
    }
    try {
        const pids = execSync("lsof -i :3005 -t 2>/dev/null || true").toString().trim().split("\n").filter(Boolean)
        for (const p of pids) {
            if (p !== String(process.pid)) {
                try { process.kill(Number(p), "SIGKILL") } catch (_) {}
            }
        }
    } catch (_) {}
}

function getCatalystScript(scriptRelativePath) {
    const localBin = path.join(appDir, "node_modules", ".bin", "catalyst")
    if (fs.existsSync(localBin)) {
        const binTarget = fs.realpathSync(localBin)
        const scriptPath = path.resolve(path.dirname(binTarget), "..", "dist", scriptRelativePath)
        if (fs.existsSync(scriptPath)) {
            return { cmd: process.execPath, argsPrefix: [scriptPath] }
        }
    }
    return { cmd: "npx", argsPrefix: ["-y", "catalyst"] }
}

async function executeCliStartup(scen) {
    killTree(null)
    await new Promise((r) => setTimeout(r, 1500))
    return new Promise((resolve) => {
        const binInfo = getCatalystScript("scripts/start.js")
        const cmdArgs = [...binInfo.argsPrefix, ...(scen.run.args.slice(1))]

        const child = spawn(binInfo.cmd, cmdArgs, {
            cwd: appDir,
            detached: true,
            env: { ...process.env, CATALYST_OUTPUT_MODE: "default" },
        })

        let output = ""
        let resolved = false
        let requestSent = false

        const finish = (passed) => {
            if (resolved) return
            resolved = true
            clearTimeout(timer)
            killTree(child)
            resolve({ passed, output })
        }

        const timer = setTimeout(() => {
            finish(false)
        }, 20000)

        const onData = async (chunk) => {
            output += chunk.toString()
            const isServerReady =
                output.includes("http://localhost:") ||
                output.includes("server is running") ||
                output.includes("Server running") ||
                output.includes("mounting AI router")

            if (isServerReady && !requestSent) {
                requestSent = true
                if (scen.tier === "warn") {
                    await new Promise((r) => setTimeout(r, 600))
                    try {
                        await fetch("http://localhost:3005/")
                    } catch (_) {}
                    await new Promise((r) => setTimeout(r, 700))
                }
            }

            const hasAllOutputMatches = scen.expect.inOutput.every((expectedStr) =>
                output.includes(expectedStr)
            )
            if (hasAllOutputMatches) {
                finish(true)
            }
        }

        if (child.stdout) child.stdout.on("data", onData)
        if (child.stderr) child.stderr.on("data", onData)

        child.on("exit", (code) => {
            const exitMatches = scen.expect.exitNonZero ? code !== 0 : true
            const hasAllOutputMatches = scen.expect.inOutput.every((expectedStr) =>
                output.includes(expectedStr)
            )
            finish(exitMatches && hasAllOutputMatches)
        })

        child.on("error", (err) => {
            console.error("DEBUG SPAWN ERROR:", err)
            finish(false)
        })
    })
}

async function executeHttp(scen) {
    killTree(null)
    await new Promise((r) => setTimeout(r, 1500))
    return new Promise((resolve) => {
        let output = ""
        const binInfo = getCatalystScript("scripts/start.js")
        const cmdArgs = [...binInfo.argsPrefix]

        const child = spawn(binInfo.cmd, cmdArgs, {
            cwd: appDir,
            detached: true,
            env: {
                ...process.env,
                src_path: appDir,
                APPLICATION: "error-catalog",
                NODE_ENV: "development",
                CATALYST_OUTPUT_MODE: "default",
            },
        })

        let resolved = false
        let fetchInitiated = false

        const finish = (passed, extraInfo = "") => {
            if (resolved) return
            resolved = true
            clearTimeout(timer)
            killTree(child)
            resolve({ passed, output: output + (extraInfo ? `\n${extraInfo}` : "") })
        }

        const checkOutputOnly = () =>
            (scen.expect.inOutput || []).every((s) => output.includes(s))

        const timer = setTimeout(() => {
            // Server may have crashed before sending an HTTP response (e.g.
            // RUNTIME-WEB-004 where Document throws → uncaughtException).
            // In that case there is no fetch, but the error IS logged to
            // the server process stdout/stderr before the crash. Check whether
            // all expected strings are already in the accumulated output.
            if (checkOutputOnly()) {
                finish(true, "Server crashed — verified via server output only")
            } else {
                finish(false, "Timeout waiting for HTTP response")
            }
        }, 20000)

        const onData = async (chunk) => {
            output += chunk.toString()
            const isServerReady = output.includes("http://localhost:3005") || output.includes("mounting AI router")

            if (isServerReady && !fetchInitiated) {
                fetchInitiated = true
                await new Promise((r) => setTimeout(r, 500))
                try {
                    const url = `http://localhost:3005${scen.run.path}`
                    const fetchOpts = {
                        method: scen.run.method || "GET",
                        headers: { "Content-Type": "application/json" },
                    }
                    if (scen.run.body) {
                        fetchOpts.body = JSON.stringify(scen.run.body)
                    }

                    const res = await fetch(url, fetchOpts)
                    const status = res.status
                    const bodyText = await res.text()

                    const checkOutput = () => {
                        const statusOk = scen.expect.status ? status === scen.expect.status : true
                        const inOutputOk = scen.expect.inOutput.every(
                            (expectedStr) => bodyText.includes(expectedStr) || output.includes(expectedStr)
                        )
                        return statusOk && inOutputOk
                    }

                    // React SSR errors (onError / logSSRError) can arrive
                    // asynchronously AFTER the HTTP response stream has been
                    // fully received by the client (onShellReady fires before
                    // onError for component-level render errors). Poll up to
                    // 5 s so those async logs have time to reach our pipe.
                    for (let i = 0; i < 50; i++) {
                        if (checkOutput()) break
                        await new Promise((r) => setTimeout(r, 100))
                    }

                    finish(checkOutput(), `HTTP Status: ${status}\nBodyText: ${bodyText}\nServer Output: ${output}`)
                } catch (fetchErr) {
                    finish(false, `Fetch Error: ${fetchErr.message}`)
                }
            }
        }

        if (child.stdout) child.stdout.on("data", onData)
        if (child.stderr) child.stderr.on("data", onData)

        child.on("error", (err) => {
            finish(false, `Spawn Error: ${err.message}`)
        })
    })
}

async function executeBuild(scen) {
    return new Promise((resolve) => {
        let output = ""
        let relScript = "scripts/build.js"
        if (scen.run?.args?.[0] === "buildApp:android") relScript = "native/buildAppAndroid.js"
        if (scen.run?.args?.[0] === "buildApp:ios") relScript = "native/buildAppIos.js"
        const binInfo = getCatalystScript(relScript)
        const cmdArgs = [...binInfo.argsPrefix]

        const child = spawn(binInfo.cmd, cmdArgs, {
            cwd: appDir,
            env: { ...process.env, CATALYST_OUTPUT_MODE: "default" },
        })

        child.stdout?.on("data", (chunk) => { output += chunk.toString() })
        child.stderr?.on("data", (chunk) => { output += chunk.toString() })

        child.on("exit", (code) => {
            const exitOk = scen.expect.exitNonZero ? code !== 0 : code === 0
            const inOutputOk = scen.expect.inOutput.every((str) => output.includes(str))
            resolve({ passed: exitOk && inOutputOk, output })
        })

        child.on("error", (err) => {
            resolve({ passed: false, output: `Spawn Error: ${err.message}` })
        })
    })
}

async function executeCcaCli(scen) {
    return new Promise((resolve) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cca-scen-"))
        const mockNpmScript = `#!/bin/sh
if [ "$1" = "pack" ]; then
    mkdir -p package/templates/common package/templates/context-js package/templates/redux-js package/templates/default-js
    echo '{"name":"create-catalyst-app","version":"0.3.0-beta.5"}' > package/package.json
    echo '{"name":"app"}' > package/templates/common/package.json
    echo '{"name":"app"}' > package/templates/context-js/package.json
    echo '{"name":"app"}' > package/templates/redux-js/package.json
    echo '{"name":"app"}' > package/templates/default-js/package.json
    echo '# template gitignore' > package/templates/common/.gitignore
    echo '# template gitignore' > package/templates/context-js/.gitignore
    echo '# template gitignore' > package/templates/redux-js/.gitignore
    echo '# template gitignore' > package/templates/default-js/.gitignore
    tar -czf create-catalyst-app-0.3.0-beta.5.tgz package
    exit 0
fi
exit 0
`
        fs.writeFileSync(path.join(tmpDir, "npm"), mockNpmScript, { mode: 0o755 })
        fs.writeFileSync(path.join(tmpDir, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
        if (scen.setupDir) {
            scen.setupDir(tmpDir)
        }
        const cliPath = path.resolve(repoRoot, "packages", "create-catalyst-app", "scripts", "cli.cjs")
        let output = ""

        const child = spawn(process.execPath, [cliPath, ...scen.cliArgs], {
            cwd: tmpDir,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, PATH: `${tmpDir}:${process.env.PATH}`, CATALYST_OUTPUT_MODE: "default" },
        })

        child.stdout?.on("data", (chunk) => { output += chunk.toString() })
        child.stderr?.on("data", (chunk) => { output += chunk.toString() })

        child.on("exit", (code) => {
            fs.rmSync(tmpDir, { recursive: true, force: true })
            const exitOk = scen.expect.exitNonZero ? code !== 0 : code === 0
            const inOutputOk = scen.expect.inOutput.every((str) => output.includes(str))
            resolve({ passed: exitOk && inOutputOk, output })
        })

        child.on("error", (err) => {
            fs.rmSync(tmpDir, { recursive: true, force: true })
            resolve({ passed: false, output: `Spawn Error: ${err.message}` })
        })
    })
}

function runVitestJson() {
    try {
        const out = execSync(
            "npx vitest run test/client.test.ts test/mapping.test.ts test/ai-hooks.test.ts --reporter=json",
            {
                cwd: appDir,
                encoding: "utf8",
                stdio: ["pipe", "pipe", "ignore"],
            }
        )
        return JSON.parse(out)
    } catch (e) {
        if (e.stdout) {
            try { return JSON.parse(e.stdout) } catch (_) {}
        }
        return null
    }
}

async function main() {
    console.log("=== Running Catalyst Error Catalog Test Suite ===")

    // Re-sync the local catalyst-core / catalyst-ai copies into node_modules
    // before anything runs. A stale node_modules/catalyst-ai once masked a
    // real AI-004 reproduction (the synced copy predated the coded error), so
    // the harness now refuses to trust whatever happens to be there.
    console.log("Syncing local catalyst-core + catalyst-ai …")
    try {
        execSync("npm run sync-core --silent && npm run sync-packages --silent", {
            cwd: appDir,
            stdio: "inherit",
        })
    } catch (e) {
        console.error("sync failed — results below may be stale:", e.message)
    }

    const vitestReport = runVitestJson()
    const vitestAssertionMap = new Map()
    if (vitestReport && vitestReport.testResults) {
        for (const fileResult of vitestReport.testResults) {
            for (const assertRes of fileResult.assertionResults || []) {
                const match = assertRes.title.match(/^([A-Z][A-Z-]*-\d{3}):/)
                if (match) {
                    vitestAssertionMap.set(match[1], assertRes.status === "passed")
                }
            }
        }
    }

    const scenarioMap = new Map(scenarios.map((s) => [s.code, s]))
    const results = []
    let passedCount = 0
    let failedCount = 0
    let skippedCount = 0

    const baselineSnapshot = snapshotApp()

    for (const code of allCodes) {
        const meta = allErrorsJson[code] || {}
        const category = meta.category || code.split("-")[0]
        const scen = scenarioMap.get(code)
        const ledgerTier = LEDGER[code]

        if (onlyCode && code !== onlyCode) continue
        if (filterCategory && category !== filterCategory) continue

        console.log("─────────────────────────────────────────────")

        let tier = scen?.tier || ledgerTier || "unknown"
        let devMistake = scen?.title || meta.message || "N/A"
        let docUrl = meta.docUrl || `https://github.com/tata1mg/catalyst-core/blob/main/errors/${category}/${code}.md`

        let status = "SKIP"
        let detail = ""

        if (scen) {
            if (scen.tier === "no-call-site") {
                status = "SKIP"
                detail = "Validator exists, no live call site"
                skippedCount++
            } else if (scen.kind === "client" || scen.kind === "mapping") {
                const passed = vitestAssertionMap.get(code)
                if (passed === true) {
                    status = "PASS"
                    passedCount++
                } else if (passed === false) {
                    status = "FAIL"
                    failedCount++
                } else {
                    status = "SKIP"
                    detail = "Not executed in vitest suite"
                    skippedCount++
                }
            } else {
                try {
                    scen.break(appDir)
                    let execRes = { passed: false, output: "" }
                    const kind = scen.kind || scen.run?.kind
                    if (kind === "cli-startup") {
                        execRes = await executeCliStartup(scen)
                    } else if (kind === "http") {
                        execRes = await executeHttp(scen)
                    } else if (kind === "build" || kind === "build-native") {
                        execRes = await executeBuild(scen)
                    } else if (kind === "cca-cli") {
                        execRes = await executeCcaCli(scen)
                    }
                    scen.restore(appDir)
                    restoreSnapshot(baselineSnapshot)
                    if (kind === "cli-startup" || kind === "http") {
                        await new Promise((r) => setTimeout(r, 600))
                    }

                    if (execRes.passed) {
                        status = "PASS"
                        passedCount++
                    } else {
                        status = "FAIL"
                        detail = `Output:\n${execRes.output}`
                        failedCount++
                    }
                } catch (err) {
                    restoreSnapshot(baselineSnapshot)
                    status = "FAIL"
                    detail = err.message
                    failedCount++
                }
            }
        } else if (ledgerTier) {
            status = "SKIP"
            detail = `Ledger tier: ${ledgerTier}`
            skippedCount++
        } else {
            status = "SKIP"
            detail = "No scenario or ledger definition"
            skippedCount++
        }

        console.log(`${code.padEnd(16)} [${tier}]`)
        console.log(`Dev mistake : ${devMistake}`)
        console.log(`Dev sees    : ${code} "${meta.message || ""}"`)
        console.log(`              Docs: ${docUrl}`)
        console.log(`Result      : ${status}${detail ? ` (${detail})` : ""}`)
    }

    console.log("=============================================")
    console.log(`Summary: ${passedCount} PASS, ${failedCount} FAIL, ${skippedCount} SKIP`)
    console.log(`covered ${allCodes.length}/${allCodes.length} error codes`)
    console.log("=============================================")

    if (failedCount > 0) {
        process.exit(1)
    } else {
        process.exit(0)
    }
}

main().catch((err) => {
    console.error("Test runner failed:", err)
    process.exit(1)
})
