// Hardcoded USD price per 1M tokens — mirrors pricing.js (server-side, CJS).
// Duplicated here (rather than imported) because this file ships to the
// browser bundle and pricing.js is a Node/CJS-only module used by route.js.
export const PRICING = {
    // audioInput: USD per 1M audio input tokens. null = the model takes no audio input, or no rate is confirmed; cost is
    // then reported as partial (audioCostUnknown) and never priced at the text rate.
    "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.60, audioInput: null },
    "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10.00, audioInput: null },
    // audioInput confirmed on https://ai.google.dev/gemini-api/docs/pricing (same as text for this model)
    "gemini-3.5-flash": { input: 1.50, cachedInput: 0.15, output: 9.00, audioInput: 1.50 },
}

// Claude (Anthropic): keep in sync with pricing.js (see the notes there on cache writes and Haiku 5.5's long-prompt tier).
Object.assign(PRICING, {
    "claude-fable-5-1": { input: 10.0, cachedInput: 0.25, output: 50.0, audioInput: null },
    "claude-opus-5-5": { input: 4.0, cachedInput: 0.2, output: 20.0, audioInput: null },
    "claude-opus-5": { input: 5.0, cachedInput: 0.5, output: 25.0, audioInput: null },
    "claude-sonnet-5-5": { input: 2.0, cachedInput: 0.2, output: 10.0, audioInput: null },
    "claude-sonnet-5": { input: 2.0, cachedInput: 0.2, output: 10.0, audioInput: null },
    "claude-haiku-5-5": { input: 0.1, cachedInput: 0.01, output: 0.5, audioInput: null },
})

// Prices the developer set in AI_CONFIG.pricing (mirrors pricing.js's normalizePricing). They win over the table above.
let configuredPricing = {}
const validPrice = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0

/** Called with AI_CONFIG.pricing from the public config; anything malformed is ignored, never thrown. */
// The table is exported, so it is frozen: a consumer (or a test) changing a rate in place would change every later cost calculation.
for (const entry of Object.values(PRICING)) Object.freeze(entry)
Object.freeze(PRICING)

export function setPricingOverrides(raw) {
    const next = {}
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [model, p] of Object.entries(raw)) {
            if (!p || typeof p !== "object" || Array.isArray(p)) continue
            if (p.perImage !== undefined && !validPrice(p.perImage)) continue
            // A token field of any kind means the entry is not per-image-only: it must then carry full token rates, never lose one silently.
            const perImageOnly = p.perImage !== undefined && p.input === undefined && p.output === undefined && p.cachedInput === undefined
            if (!perImageOnly && (!validPrice(p.input) || !validPrice(p.output))) continue
            if (p.cachedInput !== undefined && !validPrice(p.cachedInput)) continue
            if (p.audioInput !== undefined && p.audioInput !== null && !validPrice(p.audioInput)) continue
            next[model] = perImageOnly
                ? { input: null, cachedInput: null, output: null, audioInput: p.audioInput ?? null, perImage: p.perImage }
                : { input: p.input, cachedInput: p.cachedInput ?? p.input, output: p.output, audioInput: p.audioInput ?? null, ...(p.perImage !== undefined && { perImage: p.perImage }) }
        }
    }
    configuredPricing = next
}

/** The price for a model (developer-set first, then the built-in table), or undefined when none is known. */
export function lookupPricing(model) {
    return Object.prototype.hasOwnProperty.call(configuredPricing, model) ? configuredPricing[model] : PRICING[model]
}

/**
 * Cost of an image.generate result (mirrors imageCost in pricing.js). usage = { model?, images, promptTokens, completionTokens };
 * returns { cost, partial }: cost null when no rate is known, partial when some billed part had none. Never invents a price.
 */
export function imageCost(usage, model = usage?.model) {
    const price = lookupPricing(model)
    if (!usage || !price) return { cost: null, partial: false }
    const images = usage.images ?? 0
    const tokens = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)
    const perImageKnown = typeof price.perImage === "number"
    const tokensKnown = typeof price.input === "number" && typeof price.output === "number"
    if (!perImageKnown && !tokensKnown) return { cost: null, partial: false }
    const cost =
        (perImageKnown ? images * price.perImage : 0) +
        (tokensKnown ? ((usage.promptTokens ?? 0) / 1e6) * price.input + ((usage.completionTokens ?? 0) / 1e6) * price.output : 0)
    const partial = (images > 0 && !perImageKnown) || (tokens > 0 && !tokensKnown)
    return { cost, partial }
}

const DEFAULT_PRICING = { input: 0, cachedInput: 0, output: 0, audioInput: null }

function getPricing(model) {
    return lookupPricing(model) ?? DEFAULT_PRICING
}

// usage: normalized { model, promptTokens, cachedTokens, completionTokens, reasoningTokens }
//   (completionTokens is visible-output-only; reasoningTokens is additive — see route.js normalizers)
// timing: { ttftMs, genMs }
export function computeMetrics(usage, timing = {}) {
    if (!usage) return null

    const price = getPricing(usage.model)
    // A per-image-only price has no token rates. Multiplying null by a token count gives 0, which would report the tokens as free
    // when their price is simply unknown, so the cost stays null.
    const tokenRatesKnown = typeof price.input === "number" && typeof price.output === "number"
    // Audio tokens are a subset of the prompt tokens and have their own rate. Without a confirmed rate they are left
    // out of the cost and the metrics say so, rather than pricing audio as text.
    const audioTokens = usage.audioTokens ?? 0
    const audioCostUnknown = audioTokens > 0 && price.audioInput == null
    const billedInputTokens = Math.max(0, usage.promptTokens - usage.cachedTokens - audioTokens)
    const billedOutputTokens = usage.completionTokens + usage.reasoningTokens
    const totalTokens = usage.promptTokens + usage.completionTokens + usage.reasoningTokens

    const cost = !tokenRatesKnown
        ? null
        : (billedInputTokens / 1e6) * price.input +
          (usage.cachedTokens / 1e6) * (price.cachedInput ?? price.input) +
          (audioCostUnknown ? 0 : (audioTokens / 1e6) * (price.audioInput ?? 0)) +
          (billedOutputTokens / 1e6) * price.output

    const cacheSavings = !tokenRatesKnown ? null : (usage.cachedTokens / 1e6) * (price.input - (price.cachedInput ?? price.input))

    const tps = billedOutputTokens > 0 && timing.genMs > 0
        ? parseFloat((billedOutputTokens / (timing.genMs / 1000)).toFixed(1))
        : null

    return {
        provider: usage.provider ?? null,
        model: usage.model ?? null,
        ttftMs: timing.ttftMs ?? null,
        genMs: timing.genMs ?? null,
        tps,
        promptTokens: usage.promptTokens,
        cachedTokens: usage.cachedTokens,
        completionTokens: usage.completionTokens,
        reasoningTokens: usage.reasoningTokens,
        audioTokens,
        audioCostUnknown,
        totalTokens,
        cost,
        cacheSavings,
        device: null,
        dtype: null,
        loadMs: null,
        downloadBytes: null,
    }
}

/**
 * What an on-device run would have cost on a cloud model. An ESTIMATE: token counts come from the on-device tokenizer,
 * which differs from the provider's, and only text rates are applied. Returns null when counts or the price are unknown.
 */
export function estimateCloudEquivalent({ inputTokens, outputTokens }, model = "gemini-3.5-flash") {
    if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return null
    const price = lookupPricing(model)
    if (!price || typeof price.input !== "number" || typeof price.output !== "number") return null
    return { model, cost: (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output, estimated: true }
}

// history: array of computeMetrics() results (or the token-count-only fallback shape)
// accumulated across a session. Returns null when history is empty.
export function aggregateSessionMetrics(history) {
    if (!history || history.length === 0) return null

    const generationCount = history.length
    let totalCost = 0
    let totalTokens = 0
    let totalAudioTokens = 0
    let audioCostUnknown = false
    let totalCachedTokens = 0
    let totalCacheSavings = 0
    let ttftSum = 0
    let ttftCount = 0
    let tpsSum = 0
    let tpsCount = 0
    let minTps = null
    let maxTps = null
    const byProvider = {}

    for (const m of history) {
        totalCost += m.cost ?? 0
        totalTokens += m.totalTokens ?? 0
        totalAudioTokens += m.audioTokens ?? 0
        if (m.audioCostUnknown === true) audioCostUnknown = true
        totalCachedTokens += m.cachedTokens ?? 0
        totalCacheSavings += m.cacheSavings ?? 0

        if (typeof m.ttftMs === "number") {
            ttftSum += m.ttftMs
            ttftCount++
        }
        if (typeof m.tps === "number") {
            tpsSum += m.tps
            tpsCount++
            minTps = minTps === null ? m.tps : Math.min(minTps, m.tps)
            maxTps = maxTps === null ? m.tps : Math.max(maxTps, m.tps)
        }

        const providerKey = m.provider ?? "unknown"
        if (!byProvider[providerKey]) {
            byProvider[providerKey] = { generationCount: 0, totalCost: 0, totalTokens: 0, audioCostUnknown: false }
        }
        byProvider[providerKey].generationCount++
        byProvider[providerKey].totalCost += m.cost ?? 0
        byProvider[providerKey].totalTokens += m.totalTokens ?? 0
        if (m.audioCostUnknown === true) byProvider[providerKey].audioCostUnknown = true
    }

    return {
        generationCount,
        totalCost,
        totalTokens,
        // audio tokens are billed at a separate rate; true when any generation had audio with no confirmed rate, so totalCost is partial
        totalAudioTokens,
        audioCostUnknown,
        totalCachedTokens,
        totalCacheSavings,
        avgTtftMs: ttftCount > 0 ? Math.round(ttftSum / ttftCount) : null,
        avgTps: tpsCount > 0 ? parseFloat((tpsSum / tpsCount).toFixed(1)) : null,
        minTps,
        maxTps,
        avgCostPerGeneration: generationCount > 0 ? totalCost / generationCount : 0,
        byProvider,
    }
}

// history: array of native per-generation metrics objects ({ device, ttftMs, tps, totalTokens, genMs })
// accumulated across a session. No cost/cachedTokens/cacheSavings/byProvider — native has no
// billing and only one local model, so those fields don't apply. Returns null when history is empty.
export function aggregateNativeSessionMetrics(history) {
    if (!history || history.length === 0) return null

    const generationCount = history.length
    let totalTokens = 0
    let totalGenMs = 0
    let ttftSum = 0
    let ttftCount = 0
    let tpsSum = 0
    let tpsCount = 0
    let minTps = null
    let maxTps = null

    for (const m of history) {
        totalTokens += m.totalTokens ?? 0
        totalGenMs += m.genMs ?? 0

        if (typeof m.ttftMs === "number") {
            ttftSum += m.ttftMs
            ttftCount++
        }
        if (typeof m.tps === "number") {
            tpsSum += m.tps
            tpsCount++
            minTps = minTps === null ? m.tps : Math.min(minTps, m.tps)
            maxTps = maxTps === null ? m.tps : Math.max(maxTps, m.tps)
        }
    }

    return {
        generationCount,
        totalTokens,
        totalGenMs,
        avgTtftMs: ttftCount > 0 ? Math.round(ttftSum / ttftCount) : null,
        avgTps: tpsCount > 0 ? parseFloat((tpsSum / tpsCount).toFixed(1)) : null,
        minTps,
        maxTps,
    }
}

// EXPERIMENTAL (see useWebAI.js) — metrics reflect a provider whose generation quality/backend
// selection isn't yet reliable, so tps/ttft numbers here are informative, not a guarantee.
//
// history: array of web per-generation metrics objects ({ device, dtype, ttftMs, tps, totalTokens, genMs })
// accumulated across a browser session. No cost/cachedTokens/cacheSavings/byProvider — web has no
// billing and one pipeline per session. device/dtype are taken from the most recent entry rather
// than aggregated, since they describe the loaded model/backend, not a per-generation value.
// Returns null when history is empty.
export function aggregateWebSessionMetrics(history) {
    if (!history || history.length === 0) return null

    const generationCount = history.length
    let totalTokens = 0
    let totalGenMs = 0
    let ttftSum = 0
    let ttftCount = 0
    let tpsSum = 0
    let tpsCount = 0
    let minTps = null
    let maxTps = null

    for (const m of history) {
        totalTokens += m.totalTokens ?? 0
        totalGenMs += m.genMs ?? 0

        if (typeof m.ttftMs === "number") {
            ttftSum += m.ttftMs
            ttftCount++
        }
        if (typeof m.tps === "number") {
            tpsSum += m.tps
            tpsCount++
            minTps = minTps === null ? m.tps : Math.min(minTps, m.tps)
            maxTps = maxTps === null ? m.tps : Math.max(maxTps, m.tps)
        }
    }

    const last = history[history.length - 1]

    return {
        generationCount,
        totalTokens,
        totalGenMs,
        avgTtftMs: ttftCount > 0 ? Math.round(ttftSum / ttftCount) : null,
        avgTps: tpsCount > 0 ? parseFloat((tpsSum / tpsCount).toFixed(1)) : null,
        minTps,
        maxTps,
        device: last?.device ?? null,
        dtype: last?.dtype ?? null,
    }
}
