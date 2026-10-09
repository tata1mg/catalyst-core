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

const DEFAULT_PRICING = { input: 0, cachedInput: 0, output: 0, audioInput: null }

function getPricing(model) {
    return PRICING[model] ?? DEFAULT_PRICING
}

// usage: normalized { model, promptTokens, cachedTokens, completionTokens, reasoningTokens }
//   (completionTokens is visible-output-only; reasoningTokens is additive — see route.js normalizers)
// timing: { ttftMs, genMs }
export function computeMetrics(usage, timing = {}) {
    if (!usage) return null

    const price = getPricing(usage.model)
    // Audio tokens are a subset of the prompt tokens and have their own rate. Without a confirmed rate they are left
    // out of the cost and the metrics say so, rather than pricing audio as text.
    const audioTokens = usage.audioTokens ?? 0
    const audioCostUnknown = audioTokens > 0 && price.audioInput == null
    const billedInputTokens = Math.max(0, usage.promptTokens - usage.cachedTokens - audioTokens)
    const billedOutputTokens = usage.completionTokens + usage.reasoningTokens
    const totalTokens = usage.promptTokens + usage.completionTokens + usage.reasoningTokens

    const cost =
        (billedInputTokens / 1e6) * price.input +
        (usage.cachedTokens / 1e6) * price.cachedInput +
        (audioCostUnknown ? 0 : (audioTokens / 1e6) * (price.audioInput ?? 0)) +
        (billedOutputTokens / 1e6) * price.output

    const cacheSavings = (usage.cachedTokens / 1e6) * (price.input - price.cachedInput)

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
    const price = PRICING[model]
    if (!price) return null
    return { model, cost: (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output, estimated: true }
}

// history: array of computeMetrics() results (or the token-count-only fallback shape)
// accumulated across a session. Returns null when history is empty.
export function aggregateSessionMetrics(history) {
    if (!history || history.length === 0) return null

    const generationCount = history.length
    let totalCost = 0
    let totalTokens = 0
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
            byProvider[providerKey] = { generationCount: 0, totalCost: 0, totalTokens: 0 }
        }
        byProvider[providerKey].generationCount++
        byProvider[providerKey].totalCost += m.cost ?? 0
        byProvider[providerKey].totalTokens += m.totalTokens ?? 0
    }

    return {
        generationCount,
        totalCost,
        totalTokens,
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
