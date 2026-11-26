// Shared settings for every benchmark script: targets, throttling profiles, and statistics.
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import os from "node:os"
import path from "node:path"

export const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url))
export const RESULTS_DIR = path.resolve(HARNESS_DIR, "../pokedex/results")

// run.mjs starts the app on this origin's port (config/config.json), so it refuses an override;
// the measuring scripts accept APP_ORIGIN when you start the server yourself.
export const DEFAULT_APP_ORIGIN = "http://localhost:3016"
export const APP_ORIGIN = process.env.APP_ORIGIN || DEFAULT_APP_ORIGIN

// The two pages of the Pokédex: the list (151 cards, search box) and one detail page.
export const PAGES = {
    list: `${APP_ORIGIN}/`,
    detail: `${APP_ORIGIN}/pokemon/charizard`,
}

const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
export const CHROME = process.env.CHROME || DEFAULT_CHROME
if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}; set CHROME to its path`)

// "slow4g" is Lighthouse's own Slow 4G preset as it applies it with DevTools throttling
// (request latency 150 ms x 3.75, throughput x 0.9) plus a 4x CPU slowdown.
// "unthrottled" is the same machine with no network or CPU throttling.
export const PROFILES = {
    slow4g: {
        cpuRate: 4,
        network: {
            offline: false,
            latency: 150 * 3.75,
            downloadThroughput: Math.floor((1.6 * 1024 * 1024 * 0.9) / 8),
            uploadThroughput: Math.floor((750 * 1024 * 0.9) / 8),
        },
    },
    unthrottled: { cpuRate: 1, network: null },
}

// Moto G Power-sized mobile viewport, the one Lighthouse's mobile preset uses.
export const VIEWPORT = { width: 412, height: 823, isMobile: true, hasTouch: true, deviceScaleFactor: 1.75 }

export const LIST_CARD = 'a[href*="/pokemon/"]'
export const SEARCH_INPUT = 'input[aria-label="Search Pokémon"]'
// On both pages. The default element whose hydration counts as "the page hydrated".
export const HEADER_LINK = "header.site a"

// Runs in the page (pass to page.evaluateOnNewDocument with a selector). React marks a hydrated DOM node
// with a "__reactProps$<id>" key, so the first animation frame in which the first element matching the
// selector carries that key is when hydration reached it. Sets window.__bench.hydrated (ms from navigation start).
// The key is a React internal: if a React upgrade renames it, every script stops seeing hydration
// and fails its wait, rather than reporting a wrong number.
export function watchHydration(selector) {
    window.__bench = Object.assign(window.__bench || {}, { hydrated: null })
    const poll = () => {
        const el = document.querySelector(selector)
        if (el && Object.keys(el).some((k) => k.startsWith("__reactProps"))) window.__bench.hydrated = performance.now()
        else requestAnimationFrame(poll)
    }
    requestAnimationFrame(poll)
}

// What produced a data file, captured when the data is collected: the commit (and whether benchmarks/
// or packages/catalyst-core had uncommitted changes, results excluded), the catalyst-core version installed in the app, and the machine.
export function environment() {
    const git = (...args) => execFileSync("git", args, { cwd: HARNESS_DIR, encoding: "utf8" }).trim()
    const appDir = path.resolve(HARNESS_DIR, "../pokedex/app")
    const core = JSON.parse(readFileSync(path.join(appDir, "node_modules/catalyst-core/package.json"), "utf8"))
    return {
        collectedAt: new Date().toISOString(),
        commit: git("rev-parse", "HEAD"),
        workingTreeClean: git("status", "--porcelain", "--", "..", "../../packages/catalyst-core", ":(exclude)../pokedex/results").length === 0,
        catalystCore: core.version,
        node: process.version,
        cpu: os.cpus()[0].model,
        cores: os.cpus().length,
        memoryGiB: Math.round(os.totalmem() / 2 ** 30),
        os: `${os.type()} ${os.release()}`,
    }
}

// Nearest-rank percentile. For an even count the median is the lower middle value;
// medianIndex() gives the same position so a "median run" kept as an artifact matches the table.
export function medianIndex(count) {
    return Math.max(0, Math.ceil(count / 2) - 1)
}

export function percentile(values, p) {
    const sorted = values.filter((v) => v != null).sort((a, b) => a - b)
    if (!sorted.length) return null
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
    return sorted[index]
}

export function stats(values) {
    const present = values.filter((v) => v != null)
    return {
        n: present.length,
        median: percentile(present, 50),
        p75: percentile(present, 75),
        p95: percentile(present, 95),
        min: present.length ? Math.min(...present) : null,
        max: present.length ? Math.max(...present) : null,
    }
}

export function ensureDir(dir) {
    mkdirSync(dir, { recursive: true })
    return dir
}

export function runCount(defaultRuns) {
    const fromArg = Number(process.argv[2])
    return Number.isInteger(fromArg) && fromArg > 0 ? fromArg : defaultRuns
}
