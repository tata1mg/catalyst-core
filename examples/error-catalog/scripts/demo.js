import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import { fileURLToPath } from "url"
import readline from "readline"
import { scenarios } from "../scenarios/index.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appDir = path.resolve(__dirname, "..")

const args = process.argv.slice(2)
let onlyCode = null
let pause = false

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--only" && args[i + 1]) {
        onlyCode = args[i + 1]
        i++
    } else if (args[i] === "--pause") {
        pause = true
    }
}

function waitForKey() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        })
        rl.question("Press Enter to continue...", () => {
            rl.close()
            resolve()
        })
    })
}

function killTree(child) {
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

async function runCliStartup(scen) {
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
            const str = chunk.toString()
            output += str

            const hasAllOutputMatches = scen.expect.inOutput.every((expectedStr) => output.includes(expectedStr))

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
            const hasAllOutputMatches = scen.expect.inOutput.every((expectedStr) => output.includes(expectedStr))
            finish(exitMatches && hasAllOutputMatches)
        })

        child.on("error", () => {
            finish(false)
        })
    })
}

async function runHttp(scen) {
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

        const finish = (passed, extraInfo = "") => {
            if (resolved) return
            resolved = true
            clearTimeout(timer)
            killTree(child)
            resolve({ passed, output: output + (extraInfo ? `\n${extraInfo}` : "") })
        }

        // A scenario that crashes the SSR render mid-response leaves fetch()
        // hanging — but the coded error is already in the server's stdout. On
        // timeout, pass iff every expected string showed up in the output.
        const outputHasExpected = () => scen.expect.inOutput.every((s) => output.includes(s))

        const timer = setTimeout(() => {
            finish(outputHasExpected(), "Timeout waiting for HTTP response")
        }, 20000)

        const onData = async (chunk) => {
            const str = chunk.toString()
            output += str

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

                    const statusOk = scen.expect.status ? status === scen.expect.status : true
                    const inOutputOk = scen.expect.inOutput.every(
                        (expectedStr) => bodyText.includes(expectedStr) || output.includes(expectedStr)
                    )

                    finish(
                        statusOk && inOutputOk,
                        `HTTP ${status} Response: ${bodyText}`
                    )
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

async function main() {
    console.log("==========================================")
    console.log(" Catalyst Error Catalog Interactive Demo  ")
    console.log("==========================================\n")

    const results = []

    for (let i = 0; i < scenarios.length; i++) {
        const scen = scenarios[i]

        if (onlyCode && scen.code !== onlyCode) {
            continue
        }

        console.log(`[${i + 1}/${scenarios.length}] ${scen.code} — ${scen.title}`)

        let result = { passed: false, output: "" }

        // The interactive demo only walks scenarios that surface an error from
        // a running server / the CLI. client, mapping, build, cca-cli and
        // build-native kinds are contract assertions — run `npm run test:error`
        // to see those (it covers all 72). Skip them here rather than crash on
        // their missing break()/run.
        const SERVER_KINDS = new Set(["cli-startup", "http"])

        if (scen.tier === "no-call-site") {
            console.log("    (validator exists, no live call site — see PR #450 ledger)")
            result = { passed: true, output: "Skipped (no-call-site)" }
        } else if (!scen.run || !SERVER_KINDS.has(scen.run.kind)) {
            console.log(`    (${scen.kind || scen.tier} scenario — see npm run test:error)`)
            result = { passed: true, output: `Not shown in demo (kind: ${scen.kind || scen.tier})` }
        } else {
            if (typeof scen.break === "function") scen.break(appDir)
            if (scen.run.kind === "cli-startup") {
                result = await runCliStartup(scen)
            } else if (scen.run.kind === "http") {
                result = await runHttp(scen)
            }
        }

        const indentedOutput = result.output
            .split("\n")
            .map((line) => `    ${line}`)
            .join("\n")
        console.log(indentedOutput)

        if (typeof scen.restore === "function") scen.restore(appDir)

        results.push({
            code: scen.code,
            title: scen.title,
            tier: scen.tier,
            passed: result.passed,
        })

        if (pause && i < scenarios.length - 1) {
            await waitForKey()
        }
    }

    console.log("\n==========================================")
    console.log("              Summary Table               ")
    console.log("==========================================")
    console.log("CODE         | TIER         | STATUS")
    console.log("-------------|--------------|---------")

    let allPassed = true
    for (const r of results) {
        const status = r.passed ? "PASS" : "FAIL"
        if (!r.passed) allPassed = false
        console.log(`${r.code.padEnd(12)} | ${r.tier.padEnd(12)} | ${status}`)
    }

    console.log("==========================================")

    if (!allPassed) {
        console.error("\nSome scenarios failed.")
        process.exit(1)
    } else {
        console.log("\nAll executed scenarios passed successfully.")
        process.exit(0)
    }
}

main().catch((err) => {
    console.error("Demo failed:", err)
    process.exit(1)
})
