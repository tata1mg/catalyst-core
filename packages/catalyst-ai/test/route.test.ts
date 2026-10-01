// describe/it/expect come from vitest's `globals: true` config (see
// vitest.config.mjs) — vitest's own exports can't be require()'d, only
// import'd, so globals injects them instead.
//
// route.js itself is loaded via require() rather than import — it's a
// CommonJS module (module.exports = router), matching how every other
// require("catalyst-ai/route") call site in this repo loads it. Typed
// against the hand-written declaration in ../src/route.d.ts rather than
// left as `unknown` (route.js stays plain JS until #420's source
// conversion).
const router: typeof import("../src/route.js") = require("../src/route.js")
const { getAIConfig, isAIEnabled, getProviderConfig, validateRequestBody, MODEL_NAME_RE, normalizeOpenAIChatUsage, normalizeOpenAIResponsesUsage, normalizeGeminiUsage, normalizeGeminiInteractionUsage, throwProviderError } = router._internal

// Framework-level (Tier 1) contract tests for catalyst-ai's route.js
// internals — see issue #340/#411. route.js's primary export (the Express
// router) is unchanged; these tests reach the pure-logic helpers via
// router._internal instead of spinning up a real HTTP server/router.

describe("router export shape", () => {
    it("still exports the Express router as the primary export (expressServer.js's require(\"catalyst-ai/route\") contract)", () => {
        expect(typeof router).toBe("function")
        expect(typeof router.use).toBe("function") // Express routers expose .use
    })

    it("exposes testable internals without changing what require(...) returns", () => {
        expect(router._internal).toBeDefined()
        expect(typeof router._internal.validateRequestBody).toBe("function")
    })
})

describe("getAIConfig() / isAIEnabled() / getProviderConfig()", () => {
    const ORIGINAL_ENV = process.env.AI_CONFIG

    afterEach(() => {
        if (ORIGINAL_ENV === undefined) delete process.env.AI_CONFIG
        else process.env.AI_CONFIG = ORIGINAL_ENV
    })

    it("returns {} when AI_CONFIG is unset", () => {
        delete process.env.AI_CONFIG
        expect(getAIConfig()).toEqual({})
        expect(isAIEnabled()).toBe(false)
    })

    it("returns {} on invalid JSON rather than throwing", () => {
        process.env.AI_CONFIG = "{not valid json"
        expect(getAIConfig()).toEqual({})
    })

    it("parses a valid AI_CONFIG and reports enabled correctly", () => {
        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: { openai: { apiKey: "sk-test" } } })
        expect(isAIEnabled()).toBe(true)
        expect(getProviderConfig("openai")).toEqual({ apiKey: "sk-test" })
    })

    it("getProviderConfig returns null for an unconfigured provider", () => {
        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: {} })
        expect(getProviderConfig("openai")).toBeNull()
    })

    it("getProviderConfig returns null when the provider has no apiKey", () => {
        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: { openai: { defaultModel: "gpt-4o" } } })
        expect(getProviderConfig("openai")).toBeNull()
    })
})

describe("MODEL_NAME_RE", () => {
    it("accepts realistic model names", () => {
        expect(MODEL_NAME_RE.test("gemini-2.0-flash")).toBe(true)
        expect(MODEL_NAME_RE.test("gpt-4o-mini")).toBe(true)
        expect(MODEL_NAME_RE.test("claude-sonnet-5")).toBe(true)
    })

    it("rejects URL-structural characters — this is what stops req.body.model from injecting a path segment into Gemini's request URL", () => {
        expect(MODEL_NAME_RE.test("../../etc/passwd")).toBe(false)
        expect(MODEL_NAME_RE.test("model/../other")).toBe(false)
        expect(MODEL_NAME_RE.test("model?query=1")).toBe(false)
        expect(MODEL_NAME_RE.test("model with spaces")).toBe(false)
    })

    it("a bare '..' passes the charset check but can't traverse without a '/' (documented, not a bug)", () => {
        expect(MODEL_NAME_RE.test("..")).toBe(true)
    })
})

describe("validateRequestBody()", () => {
    const cfg = { defaultModel: "gpt-4o-mini" }

    it("rejects a missing/empty messages array", () => {
        expect(validateRequestBody({ body: {} }, cfg)).toMatch(/messages must be a non-empty array/)
        expect(validateRequestBody({ body: { messages: [] } }, cfg)).toMatch(/messages must be a non-empty array/)
        expect(validateRequestBody({ body: { messages: "not an array" } }, cfg)).toMatch(/messages must be a non-empty array/)
    })

    it("rejects when no model is given and the provider has no defaultModel", () => {
        const result = validateRequestBody({ body: { messages: [{ role: "user", content: "hi" }] } }, {})
        expect(result).toMatch(/no model specified/)
    })

    it("falls back to the provider's defaultModel when req.body.model is absent", () => {
        const result = validateRequestBody({ body: { messages: [{ role: "user", content: "hi" }] } }, cfg)
        expect(result).toBeNull()
    })

    it("rejects a model name with invalid characters (the injection guard)", () => {
        const result = validateRequestBody({ body: { messages: [{ role: "user", content: "hi" }], model: "../etc" } }, cfg)
        expect(result).toMatch(/model contains invalid characters/)
    })

    it("returns null (valid) for a well-formed request", () => {
        const result = validateRequestBody({ body: { messages: [{ role: "user", content: "hi" }], model: "gpt-4o-mini" } }, cfg)
        expect(result).toBeNull()
    })
})

describe("usage normalization — every provider/API shape maps to the same {model, promptTokens, cachedTokens, completionTokens, reasoningTokens} shape", () => {
    it("normalizeOpenAIChatUsage subtracts reasoning out of completion_tokens (reasoning is a subset, not additive)", () => {
        const usage = normalizeOpenAIChatUsage(
            { prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 20 }, prompt_tokens_details: { cached_tokens: 10 } },
            "gpt-4o"
        )
        expect(usage).toEqual({ model: "gpt-4o", promptTokens: 100, cachedTokens: 10, completionTokens: 30, reasoningTokens: 20 })
    })

    it("normalizeOpenAIChatUsage returns null when usage is absent", () => {
        expect(normalizeOpenAIChatUsage(null, "gpt-4o")).toBeNull()
    })

    it("normalizeOpenAIResponsesUsage uses input_tokens/output_tokens naming, same subtraction rule", () => {
        const usage = normalizeOpenAIResponsesUsage(
            { input_tokens: 100, output_tokens: 50, output_tokens_details: { reasoning_tokens: 20 }, input_tokens_details: { cached_tokens: 5 } },
            "gpt-4o"
        )
        expect(usage).toEqual({ model: "gpt-4o", promptTokens: 100, cachedTokens: 5, completionTokens: 30, reasoningTokens: 20 })
    })

    it("normalizeGeminiUsage does NOT subtract thoughtsTokenCount — Gemini's candidatesTokenCount already excludes it (additive, not a subset)", () => {
        const usage = normalizeGeminiUsage(
            { promptTokenCount: 100, candidatesTokenCount: 30, thoughtsTokenCount: 20, cachedContentTokenCount: 10 },
            "gemini-2.0-flash"
        )
        expect(usage).toEqual({ model: "gemini-2.0-flash", promptTokens: 100, cachedTokens: 10, completionTokens: 30, reasoningTokens: 20 })
    })

    it("normalizeGeminiInteractionUsage uses the stateful Interactions API's distinct field names", () => {
        const usage = normalizeGeminiInteractionUsage(
            { total_input_tokens: 100, total_output_tokens: 30, total_thought_tokens: 20, total_cached_tokens: 10 },
            "gemini-2.0-flash"
        )
        expect(usage).toEqual({ model: "gemini-2.0-flash", promptTokens: 100, cachedTokens: 10, completionTokens: 30, reasoningTokens: 20 })
    })

    it("all four normalizers default missing numeric fields to 0, never NaN/undefined", () => {
        expect(normalizeOpenAIChatUsage({}, "m")).toEqual({ model: "m", promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0 })
        expect(normalizeGeminiUsage({}, "m")).toEqual({ model: "m", promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0 })
    })
})

describe("throwProviderError()", () => {
    it("throws a CatalystError (AI-000) carrying the upstream status/body as cause, never reinterpreting it", async () => {
        const fakeResponse = { status: 429, text: async () => '{"error":"rate limited"}' }
        await expect(throwProviderError("openai", fakeResponse)).rejects.toMatchObject({
            code: "AI-000",
            cause: expect.objectContaining({ provider: "openai", status: 429 }),
        })
    })

    it("preserves the exact upstream body text in the cause message, not a paraphrase", async () => {
        const fakeResponse = { status: 500, text: async () => "Internal server error from upstream" }
        try {
            await throwProviderError("gemini", fakeResponse)
            expect.unreachable("should have thrown")
        } catch (err) {
            expect((err as { cause: { message: string } }).cause.message).toContain("Internal server error from upstream")
        }
    })
})
