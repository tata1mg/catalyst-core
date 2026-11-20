// Shared settings for every benchmark script: targets, throttling profiles, and statistics.
import { existsSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

export const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url))
export const RESULTS_DIR = path.resolve(HARNESS_DIR, "../pokedex/results")

export const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3016"

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
