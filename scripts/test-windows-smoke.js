// Native Windows smoke test: scaffolds an app with the branch's create-catalyst-app into a
// folder with a space and parentheses in its name, builds it, then answers a request from
// `catalyst start` and `catalyst serve`. Each of these failed on Windows in a different way,
// so all of them run for real: a green unit suite said nothing about any of them.
const { execFileSync, spawn, spawnSync } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

const repoRoot = path.resolve(__dirname, "..")
const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst smoke (x86) "))
const appName = "smoke-app"
const appDir = path.join(parentDir, appName)
const serverTimeoutMs = 120000

const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "github-actions[bot]",
    GIT_AUTHOR_EMAIL: "github-actions[bot]@users.noreply.github.com",
    GIT_COMMITTER_NAME: "github-actions[bot]",
    GIT_COMMITTER_EMAIL: "github-actions[bot]@users.noreply.github.com",
}

function run(label, args, options) {
    console.log(`\n=== ${label}`)
    const result = spawnSync(process.execPath, args, { stdio: "inherit", env, ...options })
    if (result.status !== 0) throw new Error(`${label} exited with ${result.status}`)
}

function stopTree(pid) {
    try {
        execFileSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" })
    } catch (error) {
        // Already gone.
    }
}

async function expectServerAnswers(command) {
    console.log(`\n=== catalyst ${command}`)
    const catalyst = path.join(appDir, "node_modules", "catalyst-core", "bin", "catalyst.js")
    const child = spawn(process.execPath, [catalyst, command], {
        cwd: appDir,
        stdio: "inherit",
        // A leftover PWD must not win over the folder the command runs in.
        env: { ...env, PWD: repoRoot },
    })
    const deadline = Date.now() + serverTimeoutMs
    try {
        while (Date.now() < deadline) {
            if (child.exitCode !== null) throw new Error(`catalyst ${command} exited with ${child.exitCode}`)
            try {
                const response = await fetch("http://localhost:3005/", { signal: AbortSignal.timeout(30000) })
                const body = await response.text()
                if (response.status !== 200 || !body.includes('id="app"')) {
                    throw new Error(`catalyst ${command} answered ${response.status}: ${body.slice(0, 300)}`)
                }
                console.log(`catalyst ${command} answered 200, ${body.length} chars`)
                return
            } catch (error) {
                if (error.message.startsWith("catalyst ")) throw error
                await new Promise((resolve) => setTimeout(resolve, 1000))
            }
        }
        throw new Error(`catalyst ${command} did not answer within ${serverTimeoutMs / 1000}s`)
    } finally {
        stopTree(child.pid)
    }
}

async function main() {
    // The sandbox script builds catalyst-core, scaffolds with create-catalyst-app and builds the app.
    run("scaffold and build", [
        path.join(repoRoot, "scripts", "create-release-sandbox.js"),
        "--target-dir",
        parentDir,
        "--name",
        appName,
        "--yes",
        "--force",
    ])
    await expectServerAnswers("start")
    await expectServerAnswers("serve")
    console.log("\nWindows smoke test passed")
}

main()
    .catch((error) => {
        console.error(`\nWindows smoke test failed: ${error.message}`)
        process.exitCode = 1
    })
    .finally(() => {
        fs.rmSync(parentDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    })
