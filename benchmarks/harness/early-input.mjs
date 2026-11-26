// What happens to input that arrives after the list is visible but before it hydrates (slow4g profile).
//   typing: type "pika" into the search box the moment it exists; after hydration, is the text still there
//           and is the list filtered to the matching Pokémon?
//   click:  tap the first card the moment it exists; does the browser reach the detail page?
// A run counts only if the action finished before the element it targets had hydrated. Runs where
// hydration came first are kept in the JSON, marked eligible: false, and left out of the summary,
// so a faster-hydrating build can't look better here by testing post-hydration behaviour.
// Writes every run to results/data/early-input.json.
//
// usage: node early-input.mjs [runs=5]
import puppeteer from "puppeteer-core"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { CHROME, HARNESS_DIR, LIST_CARD, PAGES, PROFILES, RESULTS_DIR, SEARCH_INPUT, VIEWPORT, ensureDir, environment, runCount, stats, watchHydration } from "./lib.mjs"

const RUNS = runCount(5)
const PROFILE = PROFILES.slow4g
const QUERY = "pika"
const pokemon = JSON.parse(readFileSync(path.resolve(HARNESS_DIR, "../pokedex/app/server/pokemon.json"), "utf8"))
const EXPECTED_MATCHES = pokemon.filter((p) => p.name.toLowerCase().includes(QUERY)).length

async function open(hydrationTarget) {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
    const page = await browser.newPage()
    await page.setViewport(VIEWPORT)
    const cdp = await page.createCDPSession()
    await cdp.send("Network.enable")
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpuRate })
    await cdp.send("Network.emulateNetworkConditions", PROFILE.network)
    await page.evaluateOnNewDocument(watchHydration, hydrationTarget)
    // Not awaited: the action happens before load. A failed navigation is reported here, not as a selector timeout.
    page.goto(PAGES.list, { waitUntil: "load", timeout: 120000 }).catch((error) => console.error(`early-input: navigation to ${PAGES.list} failed: ${error.message}`))
    return { browser, page }
}

// Page clock and hydration state at this moment.
const now = (page) => page.evaluate(() => ({ at: performance.now(), hydrated: window.__bench.hydrated }))

async function typing() {
    const { browser, page } = await open(SEARCH_INPUT)
    try {
        await page.waitForSelector(SEARCH_INPUT, { timeout: 30000 })
        await page.type(SEARCH_INPUT, QUERY)
        const typed = await now(page)
        await page.waitForFunction(() => window.__bench.hydrated !== null, { timeout: 30000, polling: 50 })
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const after = await page.evaluate((input, card) => ({
            hydrated: window.__bench.hydrated,
            value: document.querySelector(input).value,
            cards: document.querySelectorAll(card).length,
        }), SEARCH_INPUT, LIST_CARD)
        const textKept = after.value === QUERY
        const listFiltered = after.cards === EXPECTED_MATCHES
        return { typedAt: typed.at, eligible: typed.hydrated === null, ...after, textKept, listFiltered, kept: textKept && listFiltered }
    } finally {
        await browser.close()
    }
}

async function click() {
    const { browser, page } = await open(LIST_CARD)
    try {
        await page.waitForSelector(LIST_CARD, { timeout: 30000 })
        const before = await now(page)
        await page.click(LIST_CARD)
        let reached = false
        try {
            await page.waitForFunction(() => location.pathname.startsWith("/pokemon/") && document.querySelector("h1")?.textContent.toLowerCase().includes("bulbasaur"), { timeout: 30000, polling: 100 })
            reached = true
        } catch {
            // stayed on the list
        }
        const nav = await page.evaluate(() => performance.getEntriesByType("navigation")[0]?.name ?? null)
        return { clickedAt: before.at, eligible: before.hydrated === null, reached, fullPageLoad: nav !== null && new URL(nav).pathname.startsWith("/pokemon/") }
    } finally {
        await browser.close()
    }
}

const output = { runs: RUNS, environment: environment(), query: QUERY, expectedMatches: EXPECTED_MATCHES, typing: [], click: [] }
for (let i = 0; i < RUNS; i++) output.typing.push(await typing())
for (let i = 0; i < RUNS; i++) output.click.push(await click())
const typed = output.typing.filter((r) => r.eligible)
const clicked = output.click.filter((r) => r.eligible)
output.summary = {
    typingEligible: typed.length,
    typedAt: stats(typed.map((r) => r.typedAt)),
    hydrated: stats(typed.map((r) => r.hydrated)),
    textKept: typed.filter((r) => r.textKept).length,
    listFiltered: typed.filter((r) => r.listFiltered).length,
    clickEligible: clicked.length,
    clickedAt: stats(clicked.map((r) => r.clickedAt)),
    clickReached: clicked.filter((r) => r.reached).length,
    clickFullPageLoad: clicked.filter((r) => r.fullPageLoad).length,
}
writeFileSync(path.join(ensureDir(path.join(RESULTS_DIR, "data")), "early-input.json"), JSON.stringify(output, null, 1))
const s = output.summary
const ms = (v) => (v == null ? "–" : Math.round(v))
console.log(`typing: ${s.typingEligible}/${RUNS} runs before hydration, at ${ms(s.typedAt.median)} ms (hydrated ${ms(s.hydrated.median)} ms); text kept ${s.textKept}, list filtered ${s.listFiltered}`)
console.log(`click: ${s.clickEligible}/${RUNS} runs before hydration, at ${ms(s.clickedAt.median)} ms; reached detail page ${s.clickReached}, as a full page load ${s.clickFullPageLoad}`)
