import { describe, it, expect, beforeAll, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import { fileURLToPath } from "url"
import scenarios from "../scenarios/index.js"
import { ERROR_CODES } from "catalyst-core/errors"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appDir = path.resolve(__dirname, "..")

let baselineSnapshot: Record<string, string> = {}

const TRACKED_FILES = [
    "config/config.json",
    "package.json",
    "server/index.js",
    "server/server.js",
    "server/document.js",
    "src/js/store/index.js",
    "src/js/routes/utils.js",
]

function snapshotApp() {
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
}

function killTree(child: any) {
    if (!child || child.killed) return
    try {
        if (child.pid) {
            process.kill(-child.pid, "SIGKILL")
        }
    } catch (_) {
        try {
            child.kill("SIGKILL")
        } catch (__) {}
    }
}

function getCatalystBin() {
    const localBin = path.join(appDir, "node_modules", ".bin", "catalyst")
    if (fs.existsSync(localBin)) return localBin
    return "npx"
}

async function executeCliStartup(scen: any): Promise<{ passed: boolean; output: string }> {
    return new Promise((resolve) => {
        let output = ""
        const bin = getCatalystBin()
        const cmdArgs = bin === "npx" ? ["catalyst", ...scen.run.args] : scen.run.args

        const child = spawn(bin, cmdArgs, {
            cwd: appDir,
            detached: true,
            env: { ...process.env, CATALYST_OUTPUT_MODE: "default" },
        })

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
            const hasAllOutputMatches = scen.expect.inOutput.every((expectedStr: string) =>
                output.includes(expectedStr)
            )
            const isServerReady =
                output.includes("http://localhost:") ||
                output.includes("server is running") ||
                output.includes("Server running") ||
                output.includes("mounting AI router")

            if (hasAllOutputMatches) {
                finish(true)
            } else if (isServerReady) {
                if (scen.tier === "warn" && !requestSent) {
                    requestSent = true
                    await new Promise((r) => setTimeout(r, 400))
                    try {
                        await fetch("http://localhost:3005/")
                    } catch (_) {}
                } else if (!requestSent) {
                    finish(false)
                }
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
    return new Promise((resolve) => {
        let output = ""
        const bin = getCatalystBin()
        const cmdArgs = bin === "npx" ? ["catalyst", "start"] : ["start"]

        const child = spawn(bin, cmdArgs, {
            cwd: appDir,
            detached: true,
            env: { ...process.env, CATALYST_OUTPUT_MODE: "default" },
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

        const timer = setTimeout(() => {
            finish(false, "Timeout waiting for HTTP response")
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

                    const statusOk = scen.expect.status ? status === scen.expect.status : true
                    const inOutputOk = scen.expect.inOutput.every(
                        (expectedStr: string) => bodyText.includes(expectedStr) || output.includes(expectedStr)
                    )

                    finish(statusOk && inOutputOk, `HTTP ${status} Response: ${bodyText}`)
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

describe("Error Catalog Contract Fixtures", () => {
    beforeAll(() => {
        baselineSnapshot = snapshotApp()
    })

    afterEach(() => {
        restoreSnapshot(baselineSnapshot)
    })

    // AI-000 needs a real request to api.openai.com to make the upstream
    // return non-2xx (route.js has no endpoint override). Skip it when there's
    // no reliable outbound network — CI, or an explicit opt-out.
    const skipNetwork = process.env.CI === "true" || process.env.ERROR_CATALOG_SKIP_NETWORK === "1"

    for (const scen of scenarios) {
        if (scen.tier === "no-call-site") {
            it.skip(`${scen.code}: ${scen.title} (validator exists, no live call site — see PR #450 ledger)`, () => {})
        } else if ((scen as { network?: boolean }).network && skipNetwork) {
            it.skip(`${scen.code}: ${scen.title} (needs live network — skipped in CI)`, () => {})
        } else {
            it(`${scen.code}: ${scen.title}`, async () => {
                scen.break(appDir)
                let res = { passed: false, output: "" }
                if (scen.run?.kind === "cli-startup") {
                    res = await executeCliStartup(scen)
                } else if (scen.run?.kind === "http") {
                    res = await executeHttp(scen)
                }
                scen.restore(appDir)
                expect(res.passed, `Expected ${scen.code} to match expect criteria. Output:\n${res.output}`).toBe(true)
            }, 30000)
        }
    }

    it("completeness: covers all 25 in-scope error codes", () => {
        const allCodes = Object.values(ERROR_CODES)
        const inScopeCodes = allCodes.filter((code: any) =>
            /^AI-00[0-3]$/.test(code) || /^PREFLIGHT-0(0[1-9]|1[0-9]|2[01])$/.test(code)
        )

        expect(inScopeCodes.length).toBe(25)

        const scenarioCodes = scenarios.map((s) => s.code)
        for (const code of inScopeCodes) {
            expect(scenarioCodes, `Missing scenario definition for code ${code}`).toContain(code)
        }

        console.log(`covered ${inScopeCodes.length}/25 in-scope error codes`)
    })
})
