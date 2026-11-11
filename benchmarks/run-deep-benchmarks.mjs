import { spawn, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

class ChromeDevToolsMCPClient {
    constructor() {
        this.nextId = 1
        this.pending = new Map()
        this.buffer = ""
    }

    async start() {
        const mcpBin =
            process.env.CHROME_DEVTOOLS_MCP_BIN
        this.proc = spawn(
            process.execPath,
            [mcpBin, "--headless", "--isolated", "--viewport=1280x800", "--no-performance-crux", "--no-usage-statistics"],
            {
                stdio: ["pipe", "pipe", "pipe"],
                env: { ...process.env },
            }
        )
        this.proc.stdout.setEncoding("utf8")
        this.proc.stdout.on("data", (chunk) => {
            this.buffer += chunk
            let idx
            while ((idx = this.buffer.indexOf("\n")) !== -1) {
                const line = this.buffer.slice(0, idx).trim()
                this.buffer = this.buffer.slice(idx + 1)
                if (!line) continue
                try {
                    const msg = JSON.parse(line)
                    if (msg.id && this.pending.has(msg.id)) {
                        const { resolve, reject } = this.pending.get(msg.id)
                        this.pending.delete(msg.id)
                        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
                        else resolve(msg.result)
                    }
                } catch {}
            }
        })
        await this.request("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "catalyst-deep-benchmark", version: "1.0.0" },
        })
        this.notify("notifications/initialized", {})
    }

    request(method, params) {
        const id = this.nextId++
        const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id)
                reject(new Error(`Timeout waiting for ${method}`))
            }, 45000)
            this.pending.set(id, {
                resolve: (val) => {
                    clearTimeout(timer)
                    resolve(val)
                },
                reject: (err) => {
                    clearTimeout(timer)
                    reject(err)
                },
            })
            this.proc.stdin.write(payload)
        })
    }

    notify(method, params) {
        this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")
    }

    async callTool(name, args = {}) {
        return this.request("tools/call", { name, arguments: args })
    }

    close() {
        try {
            this.proc.kill("SIGKILL")
        } catch {}
    }
}

async function waitForServer(url, timeoutMs = 20000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url)
            if (res.status < 500) return true
        } catch {}
        await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`)
}

async function runBrowserSuite(mcp, url, label, clickSelector = null) {
    const pagesRes = await mcp.callTool("list_pages", {})
    const pagesText = pagesRes.content?.[0]?.text || ""
    const match = pagesText.match(/(\d+):/)
    const pageId = match ? Number(match[1]) : 1

    await mcp.callTool("navigate_page", { pageId, type: "url", url })
    await new Promise((r) => setTimeout(r, 800))

    await mcp.callTool("performance_start_trace", { pageId, reload: true, autoStop: false })
    await new Promise((r) => setTimeout(r, 1200))
    const traceRes = await mcp.callTool("performance_stop_trace", { pageId })
    const traceText = traceRes.content?.map((c) => c.text).join("\n") || ""

    const navRuns = []
    for (let i = 0; i < 5; i++) {
        await mcp.callTool("navigate_page", { pageId, type: "reload", ignoreCache: true })
        await new Promise((r) => setTimeout(r, 500))
        const evalRes = await mcp.callTool("evaluate_script", {
            pageId,
            function: `() => {
                const nav = performance.getEntriesByType('navigation')[0];
                const paints = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, p.startTime]));
                const resources = performance.getEntriesByType('resource');
                const jsResources = resources.filter(r => r.initiatorType === 'script' || r.name.endsWith('.js'));
                const totalTransfer = resources.reduce((s, r) => s + (r.transferSize || 0), 0);
                const totalDecoded = resources.reduce((s, r) => s + (r.decodedBodySize || 0), 0);
                const mem = performance.memory ? {
                    usedJSHeapSize: performance.memory.usedJSHeapSize,
                    totalJSHeapSize: performance.memory.totalJSHeapSize
                } : null;
                return {
                    ttfbMs: nav ? +(nav.responseStart - nav.requestStart).toFixed(2) : null,
                    responseEndMs: nav ? +nav.responseEnd.toFixed(2) : null,
                    domInteractiveMs: nav ? +nav.domInteractive.toFixed(2) : null,
                    domContentLoadedMs: nav ? +nav.domContentLoadedEventEnd.toFixed(2) : null,
                    loadEventEndMs: nav ? +nav.loadEventEnd.toFixed(2) : null,
                    fpMs: paints['first-paint'] ? +paints['first-paint'].toFixed(2) : null,
                    fcpMs: paints['first-contentful-paint'] ? +paints['first-contentful-paint'].toFixed(2) : null,
                    resourceCount: resources.length,
                    jsResourceCount: jsResources.length,
                    totalTransferBytes: totalTransfer,
                    totalDecodedBytes: totalDecoded,
                    domNodes: document.querySelectorAll('*').length,
                    memory: mem
                };
            }`,
        })
        const evalText = evalRes.content?.map((c) => c.text).join("\n") || ""
        const jsonMatch = evalText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
            try {
                navRuns.push(JSON.parse(jsonMatch[0]))
            } catch {}
        }
    }

    let postInteraction = null
    if (clickSelector) {
        const transRes = await mcp.callTool("evaluate_script", {
            pageId,
            function: `async () => {
                const el = document.querySelector('${clickSelector}');
                if (!el) return { error: 'selector not found' };
                const t0 = performance.now();
                el.click();
                await new Promise((resolve) => {
                    const start = performance.now();
                    const check = () => {
                        if (location.pathname !== '/' || performance.now() - start > 3000) {
                            requestAnimationFrame(() => resolve());
                        } else {
                            requestAnimationFrame(check);
                        }
                    };
                    requestAnimationFrame(check);
                });
                const t1 = performance.now();
                await new Promise(r => setTimeout(r, 300));
                const resources = performance.getEntriesByType('resource');
                const jsResources = resources.filter(r => r.initiatorType === 'script' || r.name.endsWith('.js'));
                return {
                    transitionMs: +(t1 - t0).toFixed(2),
                    pathname: location.pathname,
                    jsResourcesAfterClick: jsResources.length,
                    totalDecodedBytesAfterClick: resources.reduce((s, r) => s + (r.decodedBodySize || 0), 0),
                    usedJSHeapAfterClick: performance.memory ? performance.memory.usedJSHeapSize : null
                };
            }`,
        })
        const transText = transRes.content?.map((c) => c.text).join("\n") || ""
        const m = transText.match(/\{[\s\S]*\}/)
        if (m) {
            try {
                postInteraction = JSON.parse(m[0])
            } catch {}
        }
    }

    const avg = (key) => {
        const vals = navRuns.map((r) => r[key]).filter((v) => typeof v === "number")
        return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null
    }

    return {
        label,
        traceSummary: traceText.slice(0, 1200),
        metricsMean5Runs: {
            ttfbMs: avg("ttfbMs"),
            responseEndMs: avg("responseEndMs"),
            domInteractiveMs: avg("domInteractiveMs"),
            domContentLoadedMs: avg("domContentLoadedMs"),
            loadEventEndMs: avg("loadEventEndMs"),
            fpMs: avg("fpMs"),
            fcpMs: avg("fcpMs"),
            resourceCount: navRuns[0]?.resourceCount,
            jsResourceCount: navRuns[0]?.jsResourceCount,
            totalTransferBytes: navRuns[0]?.totalTransferBytes,
            totalDecodedBytes: navRuns[0]?.totalDecodedBytes,
            domNodes: navRuns[0]?.domNodes,
            usedJSHeapBytes: navRuns[0]?.memory?.usedJSHeapSize ?? null,
        },
        postInteraction,
    }
}

function benchmarkDiagnostics() {
    const catErrDir = resolve(repoRoot, "examples/error-catalog")
    const exactErrDir = resolve(repoRoot, "benchmarks/exact-error-catalog")
    const exactCompiler =
        `${process.env.EXACT_REPO}/target/release/exact-web-js`

    // 1. Catalyst PREFLIGHT-003 (missing key in config.json)
    const cfgPath = resolve(catErrDir, "config/config.json")
    const origCfg = readFileSync(cfgPath, "utf8")
    writeFileSync(cfgPath, JSON.stringify({ NODE_SERVER_PORT: 3005 }), "utf8")
    const preflightTimes = []
    for (let i = 0; i < 5; i++) {
        const t0 = performance.now()
        spawnSync("npx", ["catalyst", "build"], { cwd: catErrDir, env: { ...process.env, PWD: catErrDir } })
        preflightTimes.push(performance.now() - t0)
    }
    writeFileSync(cfgPath, origCfg, "utf8")

    // 2. Catalyst BUNDLE-000 (syntax error in Home.jsx caught by Vite/Rollup)
    const homePath = resolve(catErrDir, "src/js/containers/App/Home.jsx")
    const origHome = readFileSync(homePath, "utf8")
    writeFileSync(homePath, "export default function Home() { return <div> }\n", "utf8")
    const bundleErrTimes = []
    for (let i = 0; i < 3; i++) {
        const t0 = performance.now()
        spawnSync("npx", ["catalyst", "build"], { cwd: catErrDir, env: { ...process.env, PWD: catErrDir } })
        bundleErrTimes.push(performance.now() - t0)
    }
    writeFileSync(homePath, origHome, "utf8")

    // 3. Exact Contract compiler error detection via bun exact.mjs web-build AND direct Rust binary
    const contractPath = resolve(exactErrDir, "app.contract")
    const origContract = readFileSync(contractPath, "utf8")
    writeFileSync(
        contractPath,
        origContract.replace('padding=16', 'padding=16 border="1px solid var(--unknown-token)"'),
        "utf8"
    )
    const exactCliErrTimes = []
    const exactRustDirectTimes = []
    for (let i = 0; i < 5; i++) {
        const t0 = performance.now()
        spawnSync(`${process.env.HOME}/.bun/bin/bun`, ["exact.mjs", "web-build", "--out", "dist"], {
            cwd: exactErrDir,
            env: {
                ...process.env,
                PATH: `${process.env.HOME}/.bun/bin:${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
                EXACT_FEEDBACK: "0",
            },
        })
        exactCliErrTimes.push(performance.now() - t0)

        const t1 = performance.now()
        spawnSync(exactCompiler, ["js", contractPath, "-o", "/tmp/exact-err-test", "--app", exactErrDir], {
            cwd: exactErrDir,
        })
        exactRustDirectTimes.push(performance.now() - t1)
    }
    writeFileSync(contractPath, origContract, "utf8")

    const mean = (arr) => +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)
    return {
        catalystPreflight003Ms: mean(preflightTimes),
        catalystBundle000SyntaxErrorMs: mean(bundleErrTimes),
        exactCliCompileErrorMs: mean(exactCliErrTimes),
        exactRustBinaryDirectCompileErrorMs: mean(exactRustDirectTimes),
    }
}

async function main() {
    const catDogDir = resolve(repoRoot, "examples/catalyst-core-test")
    const catErrDir = resolve(repoRoot, "examples/error-catalog")
    const catDogCfgPath = resolve(catDogDir, "config/config.json")
    const catErrCfgPath = resolve(catErrDir, "config/config.json")
    const catDogDocPath = resolve(catDogDir, "server/document.js")
    const catErrDocPath = resolve(catErrDir, "server/document.js")

    const origDogCfg = readFileSync(catDogCfgPath, "utf8")
    const origErrCfg = readFileSync(catErrCfgPath, "utf8")
    const origDogDoc = readFileSync(catDogDocPath, "utf8")
    const origErrDoc = readFileSync(catErrDocPath, "utf8")

    const children = []
    const cleanup = () => {
        for (const c of children) {
            try {
                process.kill(-c.pid, "SIGKILL")
            } catch {
                try {
                    c.kill("SIGKILL")
                } catch {}
            }
        }
        writeFileSync(catDogCfgPath, origDogCfg, "utf8")
        writeFileSync(catErrCfgPath, origErrCfg, "utf8")
        writeFileSync(catDogDocPath, origDogDoc, "utf8")
        writeFileSync(catErrDocPath, origErrDoc, "utf8")
    }
    process.on("exit", cleanup)

    console.log("1. Running compile-time / error-catalog diagnostic benchmarks...")
    const diagnostics = benchmarkDiagnostics()
    console.log("Diagnostics:", diagnostics)

    // Remove Google Fonts from catalyst-core-test/server/document.js for pure local comparison,
    // and use proper <Head /><Body /> in error-catalog/server/document.js
    const localDoc = `import React from "react"
import { Head, Body } from "catalyst-core"
function Document(props) {
    return (
        <html lang="en">
            <Head {...props} />
            <Body {...props} />
        </html>
    )
}
export default Document
`
    writeFileSync(catDogDocPath, localDoc, "utf8")
    writeFileSync(catErrDocPath, localDoc, "utf8")
    writeFileSync(catDogCfgPath, origDogCfg.replaceAll("3005", "3015"), "utf8")
    writeFileSync(catErrCfgPath, origErrCfg.replaceAll("3005", "3016"), "utf8")

    spawnSync("npm", ["run", "build"], { cwd: catDogDir, env: { ...process.env, PWD: catDogDir }, stdio: "ignore" })
    spawnSync("npm", ["run", "build"], { cwd: catErrDir, env: { ...process.env, PWD: catErrDir }, stdio: "ignore" })

    const catDog = spawn("npm", ["run", "serve"], {
        cwd: catDogDir,
        detached: true,
        stdio: "ignore",
        env: { ...process.env, PWD: catDogDir },
    })
    children.push(catDog)

    const catErr = spawn("npm", ["run", "serve"], {
        cwd: catErrDir,
        detached: true,
        stdio: "ignore",
        env: { ...process.env, PWD: catErrDir },
    })
    children.push(catErr)

    const exactApi = spawn(`${process.env.HOME}/.bun/bin/bun`, ["server.ts"], {
        cwd: resolve(repoRoot, "benchmarks/exact-dog-adoption"),
        detached: true,
        stdio: "ignore",
        env: { ...process.env, API_BASE_URL: "http://127.0.0.1:8787" },
    })
    children.push(exactApi)

    const exactDog = spawn(
        `${process.env.HOME}/.bun/bin/bun`,
        ["exact.mjs", "serve", "dist", "--port", "8765", "--loopback"],
        {
            cwd: resolve(repoRoot, "benchmarks/exact-dog-adoption"),
            detached: true,
            stdio: "ignore",
            env: {
                ...process.env,
                PATH: `${process.env.HOME}/.bun/bin:${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
                EXACT_FEEDBACK: "0",
            },
        }
    )
    children.push(exactDog)

    await waitForServer("http://localhost:3015/")
    await waitForServer("http://localhost:3016/")
    await waitForServer("http://127.0.0.1:8787/api/breeds/list/all")
    await waitForServer("http://127.0.0.1:8765/")

    const mcp = new ChromeDevToolsMCPClient()
    await mcp.start()
    const deepResults = { diagnostics, browser: {} }
    try {
        deepResults.browser.catalystDogNoExternalFonts = await runBrowserSuite(
            mcp,
            "http://localhost:3015/",
            "Catalyst Core (catalyst-core-test, no external Google Fonts)",
            'a[data-testid="beagle"]'
        )
        deepResults.browser.exactDogWithInteraction = await runBrowserSuite(
            mcp,
            "http://127.0.0.1:8765/",
            "Exact Framework (exact-dog-adoption, with click activation)",
            'a[data-testid="beagle"]'
        )
        deepResults.browser.catalystErrorCatalogFullSsr = await runBrowserSuite(
            mcp,
            "http://localhost:3016/",
            "Catalyst Core (error-catalog with full Head/Body SSR)",
            null
        )
    } finally {
        mcp.close()
    }

    writeFileSync(resolve(__dirname, "deep-results.json"), JSON.stringify(deepResults, null, 2))
    console.log("Saved benchmarks/deep-results.json")
    cleanup()
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})

