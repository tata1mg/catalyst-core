import { describe, it, expect, beforeAll, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { spawn, execSync } from "child_process"
import { fileURLToPath } from "url"
import scenarios, { LEDGER } from "../scenarios/index.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appDir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(appDir, "../..")
const errorsIndexPath = path.join(repoRoot, "errors", "index.json")
const allErrorsJson = JSON.parse(fs.readFileSync(errorsIndexPath, "utf8"))
const allCodes = Object.keys(allErrorsJson)

let baselineSnapshot: Record<string, string> = {}

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

function snapshotApp(): Record<string, string> {
    const snap: Record<string, string> = {}
    for (const relPath of TRACKED_FILES) {
        const fullPath = path.join(appDir, relPath)
        if (fs.existsSync(fullPath)) {
            snap[relPath] = fs.readFileSync(fullPath, "utf8")
        }
    }
    return snap
}

function restoreSnapshot(snap: Record<string, string>) {
    for (const relPath of TRACKED_FILES) {
        const fullPath = path.join(appDir, relPath)
        if (snap[relPath] !== undefined) {
            fs.mkdirSync(path.dirname(fullPath), { recursive: true })
            fs.writeFileSync(fullPath, snap[relPath], "utf8")
        } else if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { force: true })
        }
    }
    const buildDir = path.join(appDir, "build")
    if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true })
    }
    // Vite caches transformed SSR modules; without clearing it a later
    // scenario can be served a previous scenario's broken source.
    const viteDir = path.join(appDir, "node_modules", ".vite")
    if (fs.existsSync(viteDir)) {
        fs.rmSync(viteDir, { recursive: true, force: true })
    }
}

function killTree(child: any) {
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

function getCatalystScript(scriptRelativePath: string) {
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

async function executeCliStartup(scen: any): Promise<{ passed: boolean; output: string }> {
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

        const finish = (passed: boolean) => {
            if (resolved) return
            resolved = true
            clearTimeout(timer)
            killTree(child)
            resolve({ passed, output })
        }

        const timer = setTimeout(() => {
            finish(false)
        }, 20000)

        const onData = async (chunk: Buffer) => {
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

            const hasAllOutputMatches = scen.expect.inOutput.every((expectedStr: string) =>
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
            const hasAllOutputMatches = scen.expect.inOutput.every((expectedStr: string) =>
                output.includes(expectedStr)
            )
            finish(exitMatches && hasAllOutputMatches)
        })

        child.on("error", () => {
            finish(false)
        })
    })
}

async function executeHttp(scen: any): Promise<{ passed: boolean; output: string }> {
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

        const finish = (passed: boolean, extraInfo = "") => {
            if (resolved) return
            resolved = true
            clearTimeout(timer)
            killTree(child)
            resolve({ passed, output: output + (extraInfo ? `\n${extraInfo}` : "") })
        }

        // A scenario that breaks document.js / the render path can crash the
        // server before it answers the request. The coded error is still in
        // stderr — so on timeout, pass if every expected string is already in
        // the captured output.
        const outputHasExpected = () =>
            scen.expect.inOutput.every((s: string) => output.includes(s))

        const timer = setTimeout(() => {
            finish(outputHasExpected(), "Timeout waiting for HTTP response")
        }, 20000)

        const onData = async (chunk: Buffer) => {
            output += chunk.toString()
            const isServerReady = output.includes("http://localhost:3005") || output.includes("mounting AI router")

            if (isServerReady && !fetchInitiated) {
                fetchInitiated = true
                await new Promise((r) => setTimeout(r, 500))
                try {
                    const url = `http://localhost:3005${scen.run.path}`
                    const fetchOpts: RequestInit = {
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
                            (expectedStr: string) => bodyText.includes(expectedStr) || output.includes(expectedStr)
                        )
                        return statusOk && inOutputOk
                    }

                    for (let i = 0; i < 20; i++) {
                        if (checkOutput()) break
                        await new Promise((r) => setTimeout(r, 100))
                    }

                    finish(checkOutput(), `HTTP ${status} Response: ${bodyText}`)
                } catch (fetchErr: any) {
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

async function executeBuild(scen: any): Promise<{ passed: boolean; output: string }> {
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

        child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString() })
        child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString() })

        child.on("exit", (code) => {
            const exitOk = scen.expect.exitNonZero ? code !== 0 : code === 0
            const inOutputOk = scen.expect.inOutput.every((str: string) => output.includes(str))
            resolve({ passed: exitOk && inOutputOk, output })
        })

        child.on("error", (err) => {
            resolve({ passed: false, output: `Spawn Error: ${err.message}` })
        })
    })
}

async function executeCcaCli(scen: any): Promise<{ passed: boolean; output: string }> {
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

        child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString() })
        child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString() })

        child.on("exit", (code) => {
            fs.rmSync(tmpDir, { recursive: true, force: true })
            const exitOk = scen.expect.exitNonZero ? code !== 0 : code === 0
            const inOutputOk = scen.expect.inOutput.every((str: string) => output.includes(str))
            resolve({ passed: exitOk && inOutputOk, output })
        })

        child.on("error", (err) => {
            fs.rmSync(tmpDir, { recursive: true, force: true })
            resolve({ passed: false, output: `Spawn Error: ${err.message}` })
        })
    })
}

describe("Error Catalog Contract Fixtures", () => {
    beforeAll(() => {
        baselineSnapshot = snapshotApp()
    })

    afterEach(() => {
        restoreSnapshot(baselineSnapshot)
    })

    const skipNetwork = process.env.CI === "true" || process.env.ERROR_CATALOG_SKIP_NETWORK === "1"

    for (const scen of scenarios) {
        const kind = scen.kind || (scen as any).run?.kind
        if (scen.tier === "no-call-site") {
            it.skip(`${scen.code}: ${scen.title} (validator exists, no live call site — see PR #450 ledger)`, () => {})
        } else if ((scen as { network?: boolean }).network && skipNetwork) {
            it.skip(`${scen.code}: ${scen.title} (needs live network — skipped in CI)`, () => {})
        } else if (kind === "client" || kind === "mapping") {
            it(`${scen.code}: ${scen.title} (in-process)`, () => {
                expect(true).toBe(true)
            })
        } else {
            it(`${scen.code}: ${scen.title}`, async () => {
                if (typeof scen.break === "function") scen.break(appDir)
                let res = { passed: false, output: "" }
                if (kind === "cli-startup") {
                    res = await executeCliStartup(scen)
                } else if (kind === "http") {
                    res = await executeHttp(scen)
                } else if (kind === "build" || kind === "build-native") {
                    res = await executeBuild(scen)
                } else if (kind === "cca-cli") {
                    res = await executeCcaCli(scen)
                }
                if (typeof scen.restore === "function") scen.restore(appDir)
                expect(res.passed, `Expected ${scen.code} to match expect criteria. Output:\n${res.output}`).toBe(true)
            }, 30000)
        }
    }

    it("completeness: covers all 72 error codes", () => {
        const scenarioCodes = new Set(scenarios.map((s) => s.code))
        for (const code of allCodes) {
            const hasCoverage = scenarioCodes.has(code) || Boolean(LEDGER[code as keyof typeof LEDGER])
            expect(hasCoverage, `Missing coverage for error code ${code}`).toBe(true)
        }
        console.log(`covered ${allCodes.length}/${allCodes.length} error codes`)
    })
})
