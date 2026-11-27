// Cost metrics for cloud runs and the cloud-equivalent estimate for on-device runs (tracking issue #523, task 1.5).
// Rates come from provider pricing pages; an unknown audio rate must never be silently priced as text.
const metrics = import("../src/metrics.js")
const cm = async (u: any, t?: any) => (await metrics).computeMetrics(u, t)!
const pricing: { PRICING: Record<string, any> } = require("../src/pricing.js")
const route: typeof import("../src/route.js") = require("../src/route.js")

const usage = (over: Record<string, unknown> = {}) => ({
    provider: "gemini", model: "gemini-3.5-flash", promptTokens: 1_000_000, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0, ...over,
})

describe("pricing tables", () => {
    it("pricing.js (server) and metrics.js (browser) carry identical prices", async () => {
        const { PRICING } = await metrics
        expect(PRICING).toEqual(pricing.PRICING)
    })

    it("every entry states an audio-input rate explicitly (a number or null), never leaves it implied", () => {
        for (const [model, price] of Object.entries(pricing.PRICING)) {
            expect(price, model).toHaveProperty("audioInput")
        }
    })
})

describe("computeMetrics", () => {
    it("text-only cost is unchanged: input, cached and output at their rates", async () => {
        const m = await cm(usage({ promptTokens: 1_000_000, cachedTokens: 200_000, completionTokens: 100_000 }), { genMs: 1000 })
        // 800k * 1.5 + 200k * 0.15 + 100k * 9 per 1M
        expect(m.cost).toBeCloseTo(1.2 + 0.03 + 0.9, 6)
        expect(m.audioTokens).toBe(0)
        expect(m.audioCostUnknown).toBe(false)
    })

    it("prices audio tokens at the audio rate, not the text rate", async () => {
        const { PRICING } = await metrics
        const saved = PRICING["gemini-3.5-flash"].audioInput
        PRICING["gemini-3.5-flash"].audioInput = 3 // pretend audio costs more than text (1.5)
        try {
            const m = await cm(usage({ promptTokens: 1_000_000, audioTokens: 400_000 }))
            expect(m.cost).toBeCloseTo(0.6 * 1.5 + 0.4 * 3, 6)
            expect(m.audioTokens).toBe(400_000)
            expect(m.audioCostUnknown).toBe(false)
        } finally {
            PRICING["gemini-3.5-flash"].audioInput = saved
        }
    })

    it("flags audio cost as unknown when the model has no confirmed audio rate, instead of pricing it as text", async () => {
        const m = await cm(usage({ provider: "openai", model: "gpt-4o-mini", promptTokens: 1_000_000, audioTokens: 400_000 }))
        expect(m.audioCostUnknown).toBe(true)
        expect(m.cost).toBeCloseTo(0.6 * 0.15, 6) // only the non-audio input is costed
    })

    it("gemini-3.5-flash audio is priced at the confirmed official rate", async () => {
        const { PRICING } = await metrics
        expect(PRICING["gemini-3.5-flash"].audioInput).toBe(1.5)
    })
})

describe("usage normalizers carry audio tokens only when present", () => {
    const n = route._internal

    it("openai chat: prompt_tokens_details.audio_tokens", () => {
        const u = n.normalizeOpenAIChatUsage({ prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { audio_tokens: 60 } }, "gpt-audio-1.5")
        expect(u!.audioTokens).toBe(60)
    })

    it("gemini: promptTokensDetails AUDIO", () => {
        const u = n.normalizeGeminiUsage(
            { promptTokenCount: 100, candidatesTokenCount: 5, promptTokensDetails: [{ modality: "TEXT", tokenCount: 20 }, { modality: "AUDIO", tokenCount: 80 }] },
            "gemini-3.5-flash"
        )
        expect(u!.audioTokens).toBe(80)
    })

    it("the key is absent for text-only usage, so existing payloads are unchanged", () => {
        expect(n.normalizeOpenAIChatUsage({ prompt_tokens: 10, completion_tokens: 5 }, "gpt-4o")).not.toHaveProperty("audioTokens")
        expect(n.normalizeGeminiUsage({ promptTokenCount: 10, candidatesTokenCount: 5 }, "g")).not.toHaveProperty("audioTokens")
    })
})

describe("estimateCloudEquivalent (on-device runs)", () => {
    it("prices known input and output tokens at the reference model's text rates and labels it an estimate", async () => {
        const { estimateCloudEquivalent } = await metrics
        const e = estimateCloudEquivalent({ inputTokens: 1_000_000, outputTokens: 100_000 }, "gemini-3.5-flash")
        expect(e).toEqual({ model: "gemini-3.5-flash", cost: 1.5 + 0.9, estimated: true })
    })

    it("returns null when token counts are unknown or the model has no price", async () => {
        const { estimateCloudEquivalent } = await metrics
        expect(estimateCloudEquivalent({ inputTokens: null, outputTokens: 10 })).toBeNull()
        expect(estimateCloudEquivalent({ inputTokens: 10, outputTokens: 10 }, "no-such-model")).toBeNull()
    })
})
