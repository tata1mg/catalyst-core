import { spawn, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

// Simple JSON-RPC stdio client for chrome-devtools-mcp
class ChromeDevToolsMCPClient {
    constructor() {
        this.nextId = 1
        this.pending = new Map()
        this.buffer = ""
    }

    async start() {
        const mcpBin = process.env.CHROME_DEVTOOLS_MCP_BIN
        this.proc = spawn(
            process.execPath,
            [mcpBin, "--headless", "--isolated", "--viewport=1280x800"],
            {
                stdio: ["pipe", "pipe", "pipe"],
                env: { ...process.env },
            }
        )
        this.proc.stderr.setEncoding("utf8")
        this.proc.stderr.on("data", (d) => {
            if (process.env.DEBUG_MCP) process.stderr.write(d)
        })
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
            clientInfo: { name: "catalyst-benchmark", version: "1.0.0" },
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

function getRssKb(pid) {
    try {
        const out = spawnSync("ps", ["-o", "pid=,ppid=,rss=", "-ax"], { encoding: "utf8" }).stdout
        const lines = out
            .trim()
            .split("\n")
            .map((l) => l.trim().split(/\s+/).map(Number))
        const pids = new Set([pid])
        let added = true
        while (added) {
            added = false
            for (const [p, pp] of lines) {
                if (pids.has(pp) && !pids.has(p)) {
                    pids.add(p)
                    added = true
                }
            }
        }
        let rss = 0
        for (const [p, , r] of lines) {
            if (pids.has(p) && Number.isFinite(r)) rss += r
        }
        return rss
    } catch {
        return 0
    }
}

function percentile(sorted, p) {
    if (!sorted.length) return 0
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
    return sorted[idx]
}

async function benchmarkHttp(url, { warmup = 10, sequential = 100, concurrency = 20, totalConcurrent = 200 } = {}) {
    for (let i = 0; i < warmup; i++) {
        const r = await fetch(url)
        await r.text()
    }
    const seqTimes = []
    let htmlBytes = 0
    for (let i = 0; i < sequential; i++) {
        const t0 = performance.now()
        const r = await fetch(url)
        const txt = await r.text()
        const t1 = performance.now()
        seqTimes.push(t1 - t0)
        if (i === 0) htmlBytes = Buffer.byteLength(txt, "utf8")
    }
    seqTimes.sort((a, b) => a - b)

    const concTimes = []
    const tStart = performance.now()
    let completed = 0
    async function worker() {
        while (completed < totalConcurrent) {
            completed++
            const t0 = performance.now()
            const r = await fetch(url)
            await r.text()
            concTimes.push(performance.now() - t0)
        }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
    const totalConcWallMs = performance.now() - tStart
    concTimes.sort((a, b) => a - b)

    return {
        htmlBytes,
        sequential: {
            meanMs: +(seqTimes.reduce((a, b) => a + b, 0) / seqTimes.length).toFixed(2),
            p50Ms: +percentile(seqTimes, 50).toFixed(2),
            p95Ms: +percentile(seqTimes, 95).toFixed(2),
            p99Ms: +percentile(seqTimes, 99).toFixed(2),
            minMs: +seqTimes[0].toFixed(2),
        },
        concurrent20: {
            rps: +((totalConcurrent / totalConcWallMs) * 1000).toFixed(1),
            p50Ms: +percentile(concTimes, 50).toFixed(2),
            p95Ms: +percentile(concTimes, 95).toFixed(2),
            p99Ms: +percentile(concTimes, 99).toFixed(2),
        },
    }
}

async function benchmarkWithChromeMCP(mcp, url, label, clickSelector = null) {
    const pagesRes = await mcp.callTool("list_pages", {})
    const pagesText = pagesRes.content?.[0]?.text || ""
    const match = pagesText.match(/(\d+):/)
    const pageId = match ? Number(match[1]) : 1

    await mcp.callTool("navigate_page", { pageId, type: "url", url })
    await new Promise((r) => setTimeout(r, 800))

    await mcp.callTool("performance_start_trace", { pageId, reload: true, autoStop: false })
    await new Promise((r) => setTimeout(r, 1500))
    const traceRes = await mcp.callTool("performance_stop_trace", { pageId })
    const traceText = traceRes.content?.map((c) => c.text).join("\n") || ""

    const navRuns = []
    for (let i = 0; i < 5; i++) {
        await mcp.callTool("navigate_page", { pageId, type: "reload", ignoreCache: true })
        await new Promise((r) => setTimeout(r, 600))
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

    let routeTransitionMs = null
    if (clickSelector) {
        const transRes = await mcp.callTool("evaluate_script", {
            pageId,
            function: `async () => {
                const el = document.querySelector('${clickSelector}');
                if (!el) return { error: 'selector not found' };
                const t0 = performance.now();
                el.click();
                await new Promise(resolve => {
                    const check = () => {
                        if (location.pathname !== '/') {
                            requestAnimationFrame(() => resolve());
                        } else {
                            requestAnimationFrame(check);
                        }
                    };
                    requestAnimationFrame(check);
                });
                const t1 = performance.now();
                return { transitionMs: +(t1 - t0).toFixed(2), pathname: location.pathname };
            }`,
        })
        const transText = transRes.content?.map((c) => c.text).join("\n") || ""
        const m = transText.match(/\{[\s\S]*\}/)
        if (m) {
            try {
                routeTransitionMs = JSON.parse(m[0])
            } catch {}
        }
    }

    const avg = (key) => {
        const vals = navRuns.map((r) => r[key]).filter((v) => typeof v === "number")
        return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null
    }

    return {
        label,
        traceSummary: traceText.slice(0, 1500),
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
            totalDecodedBytes: navRuns[0]?.totalDecodedBytes,
            domNodes: navRuns[0]?.domNodes,
            usedJSHeapBytes: navRuns[navRuns.length - 1]?.memory?.usedJSHeapSize ?? null,
            totalJSHeapBytes: navRuns[navRuns.length - 1]?.memory?.totalJSHeapSize ?? null,
        },
        routeTransition: routeTransitionMs,
        rawRuns: navRuns,
    }
}

async function main() {
    const results = { timestamp: new Date().toISOString(), apps: {} }
    const children = []
    const catDogDir = resolve(repoRoot, "examples/catalyst-core-test")
    const catErrDir = resolve(repoRoot, "examples/error-catalog")
    const catDogCfgPath = resolve(catDogDir, "config/config.json")
    const catErrCfgPath = resolve(catErrDir, "config/config.json")
    const origDogCfg = readFileSync(catDogCfgPath, "utf8")
    const origErrCfg = readFileSync(catErrCfgPath, "utf8")

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
        try {
            writeFileSync(catDogCfgPath, origDogCfg, "utf8")
            writeFileSync(catErrCfgPath, origErrCfg, "utf8")
        } catch {}
    }
    process.on("exit", cleanup)

    // Configure ports 3015 and 3016 so there is no conflict with port 3005
    writeFileSync(catDogCfgPath, origDogCfg.replaceAll("3005", "3015"), "utf8")
    writeFileSync(catErrCfgPath, origErrCfg.replaceAll("3005", "3016"), "utf8")

    console.log("0. Rebuilding Catalyst apps for benchmark ports 3015 & 3016...")
    spawnSync("npm", ["run", "build"], { cwd: catDogDir, env: { ...process.env, PWD: catDogDir }, stdio: "inherit" })
    spawnSync("npm", ["run", "build"], { cwd: catErrDir, env: { ...process.env, PWD: catErrDir }, stdio: "inherit" })

    console.log("1. Starting servers...")
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

    const exactErr = spawn(
        `${process.env.HOME}/.bun/bin/bun`,
        ["exact.mjs", "serve", "dist", "--port", "8766", "--loopback"],
        {
            cwd: resolve(repoRoot, "benchmarks/exact-error-catalog"),
            detached: true,
            stdio: "ignore",
            env: {
                ...process.env,
                PATH: `${process.env.HOME}/.bun/bin:${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
                EXACT_FEEDBACK: "0",
            },
        }
    )
    children.push(exactErr)

    await waitForServer("http://localhost:3015/")
    await waitForServer("http://localhost:3016/")
    await waitForServer("http://127.0.0.1:8787/api/breeds/list/all")
    await waitForServer("http://127.0.0.1:8765/")
    await waitForServer("http://127.0.0.1:8766/")
    console.log("All 4 servers up!")

    console.log("2. Running HTTP/SSR benchmarks...")
    results.apps.catalystDogHome = {
        http: await benchmarkHttp("http://localhost:3015/"),
        httpBreedSsr: await benchmarkHttp("http://localhost:3015/breed/beagle"),
        rssKb: getRssKb(catDog.pid),
    }
    results.apps.exactDogHome = {
        http: await benchmarkHttp("http://127.0.0.1:8765/"),
        httpBreedSsr: await benchmarkHttp("http://127.0.0.1:8765/breed/beagle"),
        rssKb: getRssKb(exactDog.pid),
    }
    results.apps.catalystErrorCatalog = {
        http: await benchmarkHttp("http://localhost:3016/"),
        rssKb: getRssKb(catErr.pid),
    }
    results.apps.exactErrorCatalog = {
        http: await benchmarkHttp("http://127.0.0.1:8766/"),
        rssKb: getRssKb(exactErr.pid),
    }

    console.log("3. Running Chrome DevTools MCP browser benchmarks...")
    const mcp = new ChromeDevToolsMCPClient()
    await mcp.start()
    try {
        results.apps.catalystDogHome.chromeMcp = await benchmarkWithChromeMCP(
            mcp,
            "http://localhost:3015/",
            "Catalyst Core (catalyst-core-test)",
            'a[data-testid="beagle"]'
        )
        results.apps.exactDogHome.chromeMcp = await benchmarkWithChromeMCP(
            mcp,
            "http://127.0.0.1:8765/",
            "Exact Framework (exact-dog-adoption)",
            'a[data-testid="beagle"]'
        )
        results.apps.catalystErrorCatalog.chromeMcp = await benchmarkWithChromeMCP(
            mcp,
            "http://localhost:3016/",
            "Catalyst Core (error-catalog)",
            null
        )
        results.apps.exactErrorCatalog.chromeMcp = await benchmarkWithChromeMCP(
            mcp,
            "http://127.0.0.1:8766/",
            "Exact Framework (exact-error-catalog)",
            null
        )
    } finally {
        mcp.close()
    }

    writeFileSync(resolve(__dirname, "results.json"), JSON.stringify(results, null, 2))
    console.log("Benchmarks saved to benchmarks/results.json")
    cleanup()
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
