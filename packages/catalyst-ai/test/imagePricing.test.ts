// Per-image pricing (AI_CONFIG.pricing[model].perImage) and the image cost helper, server (pricing.js) and browser (metrics.js).
const { normalizePricing, imageCost, PRICING } = require("../src/pricing.js")

describe("per-image pricing (perImage)", () => {
    const usage = { images: 2, promptTokens: 1_000_000, completionTokens: 500_000 }

    it("normalizePricing accepts perImage next to token prices and perImage alone", () => {
        const { pricing, errors } = normalizePricing({
            both: { input: 5, output: 40, perImage: 0.04 },
            only: { perImage: 0.02 },
            zero: { perImage: 0 },
            negative: { perImage: -1 },
            text: { perImage: "x" },
            noPrices: { audioInput: 1 },
        })
        expect(pricing.both).toEqual({ input: 5, cachedInput: 5, output: 40, audioInput: null, perImage: 0.04 })
        expect(pricing.only).toEqual({ input: null, cachedInput: null, output: null, audioInput: null, perImage: 0.02 })
        expect(pricing.zero.perImage).toBe(0)
        expect(Object.keys(pricing).sort()).toEqual(["both", "only", "zero"])
        expect(errors).toHaveLength(3)
        expect(errors.join("\n")).toMatch(/negative: perImage/)
    })
    it("token-only entries have no perImage key; the built-in table has no image prices", () => {
        expect(normalizePricing({ a: { input: 1, output: 2 } }).pricing.a).not.toHaveProperty("perImage")
        for (const p of Object.values(PRICING) as any[]) expect(p).not.toHaveProperty("perImage")
    })
    it("imageCost prices images and tokens, and flags what it could not price", () => {
        expect(imageCost(usage, { input: 5, output: 40, perImage: 0.04 })).toEqual({ cost: 0.08 + 5 + 20, partial: false })
        expect(imageCost(usage, { input: null, output: null, perImage: 0.04 })).toEqual({ cost: 0.08, partial: true })
        expect(imageCost(usage, { input: 5, output: 40 })).toEqual({ cost: 25, partial: true })
        expect(imageCost({ images: 1, promptTokens: 0, completionTokens: 0 }, { perImage: 0.04 })).toEqual({ cost: 0.04, partial: false })
        expect(imageCost(usage, undefined)).toEqual({ cost: null, partial: false })
        expect(imageCost(usage, { audioInput: null })).toEqual({ cost: null, partial: false })
        expect(imageCost(null, { perImage: 1 })).toEqual({ cost: null, partial: false })
    })
    it("browser side matches the server: setPricingOverrides + imageCost", async () => {
        const m: any = await import("../src/metrics.js")
        m.setPricingOverrides({ img: { input: 5, output: 40, perImage: 0.04 }, onlyimg: { perImage: 0.02 }, bad: { perImage: -1, input: 1, output: 1 } })
        expect(m.lookupPricing("bad")).toBeUndefined()
        expect(m.lookupPricing("onlyimg").input).toBeNull()
        expect(m.imageCost({ model: "img", ...usage }).cost).toBeCloseTo(25.08)
        expect(m.imageCost({ ...usage }, "onlyimg")).toEqual({ cost: 0.04, partial: true })
        expect(m.imageCost({ model: "unpriced", ...usage })).toEqual({ cost: null, partial: false })
        expect(m.imageCost({ model: "gpt-5", ...usage }).partial).toBe(true) // built-in: tokens only, no per-image price
        m.setPricingOverrides(null)
    })
})
