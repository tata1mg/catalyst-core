// Hardcoded USD price per 1M tokens. Update manually when providers change pricing.
const PRICING = {
    // audioInput: USD per 1M audio input tokens. null = the model takes no audio input, or no rate is confirmed; cost is
    // then reported as partial (audioCostUnknown) and never priced at the text rate.
    "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.60, audioInput: null },
    "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10.00, audioInput: null },
    // audioInput confirmed on https://ai.google.dev/gemini-api/docs/pricing (same as text for this model)
    "gemini-3.5-flash": { input: 1.50, cachedInput: 0.15, output: 9.00, audioInput: 1.50 },
}

// Claude (Anthropic). Cache reads are 0.1x the input price, except Fable 5.1 where the published rate is $0.25. Cache
// writes (1.25x input) are counted as plain input tokens, so a cache-heavy workload is slightly under-reported. Haiku 5.5
// prices above 100K-token prompts differ ($0.50 / $2.50) and are not modelled. Claude takes no audio input.
Object.assign(PRICING, {
    "claude-fable-5-1": { input: 10.0, cachedInput: 0.25, output: 50.0, audioInput: null },
    "claude-opus-5-5": { input: 4.0, cachedInput: 0.2, output: 20.0, audioInput: null },
    "claude-opus-5": { input: 5.0, cachedInput: 0.5, output: 25.0, audioInput: null },
    "claude-sonnet-5-5": { input: 2.0, cachedInput: 0.2, output: 10.0, audioInput: null },
    "claude-sonnet-5": { input: 2.0, cachedInput: 0.2, output: 10.0, audioInput: null },
    "claude-haiku-5-5": { input: 0.1, cachedInput: 0.01, output: 0.5, audioInput: null },
})

const DEFAULT_PRICING = { input: 0, cachedInput: 0, output: 0 }

function getPricing(model) {
    return PRICING[model] ?? DEFAULT_PRICING
}

module.exports = { PRICING, getPricing }
