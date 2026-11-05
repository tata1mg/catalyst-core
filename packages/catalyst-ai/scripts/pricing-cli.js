// `catalyst-ai pricing`: finds the cloud models an app's AI_CONFIG uses, shows which have a price (set by the developer,
// built into catalyst-ai, or missing) and asks for the rest. Answers go to AI_CONFIG.pricing in config/config.json.
//
//   catalyst-ai pricing                       ask for every model that has no price
//   catalyst-ai pricing --all                 walk every model, Enter keeps the current price
//   catalyst-ai pricing --check               print the table, exit 1 if a model has no price (for CI)
//   catalyst-ai pricing --set gpt-x=2,10[,0.2]  set input,output[,cachedInput] without asking (repeatable)
//   --config <path>                           another config file (default: ./config/config.json)
//
// Prices are USD per 1 million tokens. The config file also holds API keys: it is read and written as JSON and its
// contents are never printed.

const fs = require("fs")
const path = require("path")
const readline = require("readline")
const { normalizePricing, priceSource, lookupPricing } = require("../src/pricing.js")

const num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0

/** Cloud models the config can send a request to: each provider's defaultModel and every routing.cloud[].model. */
function collectModels(aiConfig) {
    const found = new Map()
    const add = (model, provider, via) => {
        if (typeof model !== "string" || !model) return
        const entry = found.get(model) || { model, providers: new Set(), via: new Set() }
        if (provider) entry.providers.add(provider)
        entry.via.add(via)
        found.set(model, entry)
    }
    for (const [provider, cfg] of Object.entries(aiConfig?.providers || {})) add(cfg?.defaultModel, provider, "defaultModel")
    for (const c of Array.isArray(aiConfig?.routing?.cloud) ? aiConfig.routing.cloud : []) add(c?.model, c?.provider, "routing")
    return [...found.values()]
        .map((e) => ({ model: e.model, providers: [...e.providers], via: [...e.via] }))
        .sort((a, b) => a.model.localeCompare(b.model))
}

/** "gpt-x=2,10,0.2" -> { model, input, output, cachedInput? } or throws a message the user can act on. */
function parseSet(spec) {
    const m = /^([^=\s]+)=([^,\s]+),([^,\s]+)(?:,([^,\s]+))?$/.exec(spec || "")
    if (!m) throw new Error(`--set expects <model>=<input>,<output>[,<cachedInput>], got "${spec}"`)
    const [input, output, cached] = [m[2], m[3], m[4]].map((v) => (v === undefined ? undefined : Number(v)))
    for (const [label, v] of [["input", input], ["output", output], ["cachedInput", cached]]) {
        if (v !== undefined && !num(v)) throw new Error(`--set ${m[1]}: ${label} must be a non-negative number`)
    }
    return { model: m[1], input, output, ...(cached !== undefined && { cachedInput: cached }) }
}

function parseArgs(argv) {
    const opts = { all: false, check: false, sets: [], config: null }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === "--all") opts.all = true
        else if (a === "--check") opts.check = true
        else if (a === "--set") opts.sets.push(parseSet(argv[++i]))
        else if (a === "--config") opts.config = argv[++i]
        else if (a === "--help" || a === "-h") opts.help = true
        else throw new Error(`Unknown option "${a}"`)
    }
    return opts
}

const HELP = `Usage: catalyst-ai pricing [--all] [--check] [--set <model>=<in>,<out>[,<cached>]] [--config <path>]

Finds the cloud models in AI_CONFIG, shows which have a price and asks for the missing ones.
Prices are USD per 1M tokens and are saved to AI_CONFIG.pricing in config/config.json.
`

const fmt = (p) => (p ? `$${p.input} in / $${p.output} out${p.cachedInput !== undefined && p.cachedInput !== p.input ? ` / $${p.cachedInput} cached` : ""}` : "no price")

function renderTable(rows) {
    const width = Math.max(5, ...rows.map((r) => r.model.length))
    return rows
        .map((r) => `  ${r.model.padEnd(width)}  ${r.source.padEnd(10)}  ${fmt(r.price)}`)
        .join("\n")
}

/** Asks one question; resolves "" on empty input. */
function makeAsk() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const ask = (q) => new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())))
    ask.close = () => rl.close()
    return ask
}

async function askPrice(ask, out, label, current) {
    for (;;) {
        const hint = current !== undefined ? ` [${current}]` : ""
        const answer = await ask(`    ${label} (USD per 1M tokens)${hint}: `)
        if (answer === "") return current
        const v = Number(answer)
        if (num(v)) return v
        out("    Enter a number such as 2 or 0.15\n")
    }
}

/**
 * @param argv   arguments after "pricing"
 * @param io     { cwd, ask, out, err, isTTY } (injectable for tests)
 * @returns exit code
 */
async function run(argv, io = {}) {
    const out = io.out || ((s) => process.stdout.write(s))
    const err = io.err || ((s) => process.stderr.write(s))
    const cwd = io.cwd || process.cwd()
    let opts
    try {
        opts = parseArgs(argv)
    } catch (e) {
        err(`${e.message}\n\n${HELP}`)
        return 2
    }
    if (opts.help) { out(HELP); return 0 }

    const configPath = path.resolve(cwd, opts.config || path.join("config", "config.json"))
    let config
    try {
        config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    } catch (e) {
        err(`Could not read ${configPath}: ${e.code === "ENOENT" ? "file not found" : e.message}\n`)
        return 2
    }
    const aiConfig = config.AI_CONFIG
    if (!aiConfig || typeof aiConfig !== "object") {
        err(`${configPath} has no AI_CONFIG block, so there is nothing to price.\n`)
        return 2
    }

    const { pricing: current, errors } = normalizePricing(aiConfig.pricing)
    for (const e of errors) err(`Ignoring AI_CONFIG.pricing entry, ${e}\n`)
    const models = collectModels(aiConfig)
    const rowsOf = (pricing) => models.map((m) => ({ ...m, source: priceSource(m.model, pricing), price: lookupPricing(m.model, pricing) }))

    if (!models.length) {
        out("No cloud models found in AI_CONFIG (providers.*.defaultModel or routing.cloud[].model), nothing to price.\n")
        return 0
    }

    const updates = {}
    for (const s of opts.sets) {
        updates[s.model] = { input: s.input, output: s.output, ...(s.cachedInput !== undefined && { cachedInput: s.cachedInput }) }
    }

    if (opts.check) {
        const rows = rowsOf(current)
        out(`${renderTable(rows)}\n`)
        const missing = rows.filter((r) => r.source === "missing")
        if (missing.length) {
            err(`\n${missing.length} model(s) have no price: ${missing.map((r) => r.model).join(", ")}. Run: npx catalyst-ai pricing\n`)
            return 1
        }
        return 0
    }

    const interactive = !Object.keys(updates).length
    if (interactive) {
        const tty = io.isTTY !== undefined ? io.isTTY : process.stdin.isTTY
        if (!io.ask && !tty) {
            err("No terminal to ask on. Use --check to report, or --set <model>=<input>,<output> to set a price.\n")
            return 2
        }
        const rows = rowsOf(current)
        out(`Models in AI_CONFIG and where their price comes from:\n${renderTable(rows)}\n\n`)
        const todo = rows.filter((r) => opts.all || r.source === "missing")
        if (!todo.length) { out("Every model has a price. Use --all to review them.\n"); return 0 }
        out(`Prices are USD per 1M tokens, from your provider's pricing page. Enter keeps the value shown.\n`)
        const ask = io.ask || makeAsk()
        try {
            for (const r of todo) {
                out(`\n  ${r.model}  (${r.providers.join(", ") || "no provider"})\n`)
                const input = await askPrice(ask, out, "input", r.price?.input)
                const output = await askPrice(ask, out, "output", r.price?.output)
                if (input === undefined || output === undefined) { out("    skipped\n"); continue }
                const cachedInput = await askPrice(ask, out, "cached input, Enter for none", r.price && r.price.cachedInput !== r.price.input ? r.price.cachedInput : undefined)
                updates[r.model] = { input, output, ...(cachedInput !== undefined && { cachedInput }) }
            }
        } finally {
            if (ask.close) ask.close()
        }
    }

    if (!Object.keys(updates).length) { out("\nNothing changed.\n"); return 0 }

    // Raw entries are kept as the developer wrote them (not the normalised copies) so unrelated entries are untouched.
    const next = { ...(aiConfig.pricing && typeof aiConfig.pricing === "object" && !Array.isArray(aiConfig.pricing) ? aiConfig.pricing : {}), ...updates }
    const checked = normalizePricing(next)
    if (checked.errors.length) { err(`Not saved:\n  ${checked.errors.join("\n  ")}\n`); return 2 }
    config.AI_CONFIG = { ...aiConfig, pricing: next }
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
    out(`\nSaved ${Object.keys(updates).length} price(s) to AI_CONFIG.pricing in ${path.relative(cwd, configPath) || configPath}:\n${renderTable(rowsOf(checked.pricing).filter((r) => updates[r.model]))}\n`)
    return 0
}

module.exports = { run, collectModels, parseSet, parseArgs }
