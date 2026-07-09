// Hardcoded USD price per 1M tokens — mirrors pricing.js (server-side, CJS).
// Duplicated here (rather than imported) because this file ships to the
// browser bundle and pricing.js is a Node/CJS-only module used by route.js.
const PRICING = {
    "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.60 },
    "gpt-5": { input: 0.625, cachedInput: 0.625, output: 5.00 },
    "gemini-3.5-flash": { input: 1.50, cachedInput: 0.15, output: 9.00 },
}

const DEFAULT_PRICING = { input: 0, cachedInput: 0, output: 0 }

function getPricing(model) {
    return PRICING[model] ?? DEFAULT_PRICING
}

// usage: normalized { model, promptTokens, cachedTokens, completionTokens, reasoningTokens }
//   (completionTokens is visible-output-only; reasoningTokens is additive — see route.js normalizers)
// timing: { ttftMs, genMs }
export function computeMetrics(usage, timing) {
    if (!usage) return null

    const price = getPricing(usage.model)
    const billedInputTokens = Math.max(0, usage.promptTokens - usage.cachedTokens)
    const billedOutputTokens = usage.completionTokens + usage.reasoningTokens
    const totalTokens = usage.promptTokens + usage.completionTokens + usage.reasoningTokens

    const cost =
        (billedInputTokens / 1e6) * price.input +
        (usage.cachedTokens / 1e6) * price.cachedInput +
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
        totalTokens,
        cost,
        cacheSavings,
        device: null,
        dtype: null,
        loadMs: null,
        downloadBytes: null,
    }
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
