// Developer-set prices (AI_CONFIG.pricing) over the built-in table, and the `catalyst-ai pricing` command.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { normalizePricing, priceSource, lookupPricing, PRICING } = require("../src/pricing.js")
const cli = require("../scripts/pricing-cli.js")

describe("normalizePricing / lookupPricing", () => {
    it("fills the optional fields and drops bad entries with a reason", () => {
        const { pricing, errors } = normalizePricing({
            good: { input: 2, output: 10 },
            cached: { input: 2, output: 10, cachedInput: 0.2, audioInput: 4 },
            negative: { input: -1, output: 1 },
            missing: { input: 1 },
            text: "x",
            badCached: { input: 1, output: 2, cachedInput: "y" },
        })
        expect(pricing.good).toEqual({ input: 2, cachedInput: 2, output: 10, audioInput: null })
        expect(pricing.cached).toEqual({ input: 2, cachedInput: 0.2, output: 10, audioInput: 4 })
        expect(Object.keys(pricing).sort()).toEqual(["cached", "good"])
        expect(errors).toHaveLength(4)
        expect(normalizePricing([] as any).errors).toHaveLength(1)
        expect(normalizePricing(undefined)).toEqual({ pricing: {}, errors: [] })
    })
    it("developer prices win over the built-in table; unknown models are missing", () => {
        const { pricing } = normalizePricing({ "gpt-5": { input: 99, output: 100 } })
        expect(priceSource("gpt-5", pricing)).toBe("configured")
        expect(lookupPricing("gpt-5", pricing).input).toBe(99)
        expect(priceSource("gpt-5", {})).toBe("built-in")
        expect(lookupPricing("gpt-5", {})).toBe(PRICING["gpt-5"])
        expect(priceSource("never-heard-of-it", pricing)).toBe("missing")
        expect(lookupPricing("never-heard-of-it", pricing)).toBeUndefined()
    })
})

describe("browser side (metrics.js)", () => {
    it("setPricingOverrides changes cost, ignores junk, and can be cleared", async () => {
        const m: any = await import("../src/metrics.js")
        const usage = { model: "my-model", promptTokens: 1_000_000, cachedTokens: 0, completionTokens: 1_000_000, reasoningTokens: 0 }
        expect(m.computeMetrics(usage).cost).toBe(0) // unknown model: costed as free, the trap the command exists to close
        m.setPricingOverrides({ "my-model": { input: 2, output: 10 }, broken: { input: "x" }, arr: [] })
        expect(m.computeMetrics(usage).cost).toBeCloseTo(12)
        expect(m.lookupPricing("broken")).toBeUndefined()
        m.setPricingOverrides({ "gpt-5": { input: 1, output: 1 } })
        expect(m.lookupPricing("gpt-5").input).toBe(1) // overrides built-in
        expect(m.lookupPricing("my-model")).toBeUndefined() // replaced, not merged
        m.setPricingOverrides(null)
        expect(m.lookupPricing("gpt-5")).toBe(m.PRICING["gpt-5"])
    })
})

describe("catalyst-ai pricing command", () => {
    let dir: string
    const aiConfig = (extra: object = {}) => ({
        enabled: true,
        providers: { openai: { apiKey: "sk-secret-do-not-print", defaultModel: "gpt-5" }, gemini: { apiKey: "g-secret", defaultModel: "new-flash" } },
        routing: { cloud: [{ id: "c", provider: "openai", model: "new-mini" }], onDevice: { ios: [{ id: "gemma", model: "e2b" }] } },
        ...extra,
    })
    const write = (ai: object | null = aiConfig()) => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "cai-pricing-"))
        fs.mkdirSync(path.join(dir, "config"))
        fs.writeFileSync(path.join(dir, "config", "config.json"), JSON.stringify({ NAME: "app", ...(ai && { AI_CONFIG: ai }) }, null, 2))
        return dir
    }
    const read = () => JSON.parse(fs.readFileSync(path.join(dir, "config", "config.json"), "utf8"))
    const harness = (answers: string[] = []) => {
        const out: string[] = []
        const err: string[] = []
        const asked: string[] = []
        const queue = [...answers]
        return { out, err, asked, io: { cwd: dir, out: (s: string) => out.push(s), err: (s: string) => err.push(s), ask: async (q: string) => { asked.push(q); return queue.shift() ?? "" } } }
    }

    it("collects cloud models from providers and routing, not on-device ones", () => {
        expect(cli.collectModels(aiConfig()).map((m: any) => m.model)).toEqual(["gpt-5", "new-flash", "new-mini"])
        expect(cli.collectModels({}).length).toBe(0)
    })

    it("--check lists the table and fails while a model has no price", async () => {
        write()
        const h = harness()
        expect(await cli.run(["--check"], h.io)).toBe(1)
        expect(h.out.join("")).toMatch(/gpt-5\s+built-in/)
        expect(h.out.join("")).toMatch(/new-flash\s+missing/)
        expect(h.err.join("")).toContain("new-flash, new-mini")
    })

    it("asks only for models with no price, saves the answers, and --check then passes", async () => {
        write()
        // new-flash: input 0.75, output 3.75, cached none; new-mini: input 0.1, output 0.5, cached 0.01
        const h = harness(["0.75", "3.75", "", "0.1", "0.5", "0.01"])
        expect(await cli.run([], h.io)).toBe(0)
        expect(h.asked.join("")).not.toContain("gpt-5")
        expect(read().AI_CONFIG.pricing).toEqual({
            "new-flash": { input: 0.75, output: 3.75 },
            "new-mini": { input: 0.1, output: 0.5, cachedInput: 0.01 },
        })
        expect(await cli.run(["--check"], harness().io)).toBe(0)
    })

    it("never prints keys and leaves every other part of the file alone", async () => {
        write()
        const before = read()
        const h = harness(["1", "2", "", "3", "4", ""])
        await cli.run([], h.io)
        expect(h.out.join("") + h.err.join("")).not.toMatch(/sk-secret|g-secret/)
        const after = read()
        expect(after.NAME).toBe("app")
        expect(after.AI_CONFIG.providers).toEqual(before.AI_CONFIG.providers)
        expect(after.AI_CONFIG.routing).toEqual(before.AI_CONFIG.routing)
    })

    it("re-asks on a bad number and keeps the current value on Enter with --all", async () => {
        write(aiConfig({ pricing: { "new-flash": { input: 1, output: 2 }, "new-mini": { input: 3, output: 4 } } }))
        const h = harness(["abc", "5", "", "", "", "", "", "", "", "", ""]) // gpt-5 (built-in): bad input, then 5; rest kept
        expect(await cli.run(["--all"], h.io)).toBe(0)
        expect(h.out.join("")).toContain("Enter a number")
        const saved = read().AI_CONFIG.pricing
        expect(saved["gpt-5"].input).toBe(5)
        expect(saved["gpt-5"].output).toBe(10) // built-in output kept on Enter
        expect(saved["new-flash"]).toEqual({ input: 1, output: 2 })
    })

    it("--set is non-interactive, repeatable, and validated", async () => {
        write()
        const h = harness()
        expect(await cli.run(["--set", "new-flash=0.75,3.75", "--set", "new-mini=0.1,0.5,0.01"], h.io)).toBe(0)
        expect(h.asked).toEqual([])
        expect(read().AI_CONFIG.pricing["new-mini"]).toEqual({ input: 0.1, output: 0.5, cachedInput: 0.01 })
        expect(await cli.run(["--set", "oops"], harness().io)).toBe(2)
        expect(await cli.run(["--set", "m=-1,2"], harness().io)).toBe(2)
    })

    it("explains itself when there is no config, no AI_CONFIG, no terminal or an unknown option", async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "cai-pricing-"))
        expect(await cli.run([], harness().io)).toBe(2)
        write(null)
        const noAi = harness()
        expect(await cli.run([], noAi.io)).toBe(2)
        expect(noAi.err.join("")).toContain("no AI_CONFIG")
        write()
        const noTty = { ...harness().io, ask: undefined, isTTY: false }
        expect(await cli.run([], noTty as any)).toBe(2)
        expect(await cli.run(["--bogus"], harness().io)).toBe(2)
    })
})
