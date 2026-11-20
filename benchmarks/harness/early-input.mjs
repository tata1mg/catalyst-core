// What happens to input that arrives after the list is visible but before it hydrates (slow4g profile).
//   typing: type "pika" into the search box the moment it exists; after hydration, is the text still there and the list filtered?
//   click:  tap the first card the moment it exists; does the browser reach the detail page?
// Writes every run to results/data/early-input.json.
//
// usage: node early-input.mjs [runs=5]
import puppeteer from "puppeteer-core"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { CHROME, LIST_CARD, PAGES, PROFILES, RESULTS_DIR, SEARCH_INPUT, VIEWPORT, ensureDir, runCount, stats } from "./lib.mjs"

const RUNS = runCount(5)
const PROFILE = PROFILES.slow4g

function watchHydration() {
    window.__bench = { hydrated: null }
    const poll = () => {
        const input = document.querySelector('input[aria-label="Search Pokémon"]')
        if (input && Object.keys(input).some((k) => k.startsWith("__reactProps"))) window.__bench.hydrated = performance.now()
        else requestAnimationFrame(poll)
    }
    requestAnimationFrame(poll)
}

async function open() {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
    const page = await browser.newPage()
    await page.setViewport(VIEWPORT)
    const cdp = await page.createCDPSession()
    await cdp.send("Network.enable")
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpuRate })
    await cdp.send("Network.emulateNetworkConditions", PROFILE.network)
    await page.evaluateOnNewDocument(watchHydration)
    page.goto(PAGES.list, { waitUntil: "load", timeout: 120000 }).catch(() => {}) // not awaited: we act before load
    return { browser, page }
}

async function typing() {
    const { browser, page } = await open()
    try {
        await page.waitForSelector(SEARCH_INPUT, { timeout: 30000 })
        const visibleAt = await page.evaluate(() => performance.now())
        await page.type(SEARCH_INPUT, "pika")
        const typedAt = await page.evaluate(() => performance.now())
        await page.waitForFunction(() => window.__bench.hydrated !== null, { timeout: 30000, polling: 50 })
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const after = await page.evaluate((input, card) => ({
            hydrated: window.__bench.hydrated,
            value: document.querySelector(input).value,
            cards: document.querySelectorAll(card).length,
        }), SEARCH_INPUT, LIST_CARD)
        return { visibleAt, typedAt, ...after, kept: after.value === "pika" }
    } finally {
        await browser.close()
    }
}

async function click() {
    const { browser, page } = await open()
    try {
        await page.waitForSelector(LIST_CARD, { timeout: 30000 })
        const clickedAt = await page.evaluate(() => performance.now())
        await page.click(LIST_CARD)
        let reached = false
        try {
            await page.waitForFunction(() => location.pathname.startsWith("/pokemon/") && document.querySelector("h1")?.textContent.toLowerCase().includes("bulbasaur"), { timeout: 30000, polling: 100 })
            reached = true
        } catch {
            // stayed on the list
        }
        const nav = await page.evaluate(() => performance.getEntriesByType("navigation")[0]?.name ?? null)
        return { clickedAt, reached, fullPageLoad: nav !== null && new URL(nav).pathname.startsWith("/pokemon/") }
    } finally {
        await browser.close()
    }
}

const output = { runs: RUNS, typing: [], click: [] }
for (let i = 0; i < RUNS; i++) output.typing.push(await typing())
for (let i = 0; i < RUNS; i++) output.click.push(await click())
output.summary = {
    typedAt: stats(output.typing.map((r) => r.typedAt)),
    hydrated: stats(output.typing.map((r) => r.hydrated)),
    textKept: output.typing.filter((r) => r.kept).length,
    clickedAt: stats(output.click.map((r) => r.clickedAt)),
    clickReached: output.click.filter((r) => r.reached).length,
    clickFullPageLoad: output.click.filter((r) => r.fullPageLoad).length,
}
writeFileSync(path.join(ensureDir(path.join(RESULTS_DIR, "data")), "early-input.json"), JSON.stringify(output, null, 1))
const s = output.summary
console.log(`typing at ${Math.round(s.typedAt.median)} ms: text kept after hydration in ${s.textKept}/${RUNS} runs (hydrated ${Math.round(s.hydrated.median)} ms)`)
console.log(`click at ${Math.round(s.clickedAt.median)} ms: reached detail page in ${s.clickReached}/${RUNS} runs, as a full page load in ${s.clickFullPageLoad}/${RUNS}`)
