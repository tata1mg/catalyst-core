// Hardcoded USD price per 1M tokens. Update manually when providers change pricing.
const PRICING = {
    // audioInput: USD per 1M audio input tokens. null = the model takes no audio input, or no rate is confirmed; cost is
    // then reported as partial (audioCostUnknown) and never priced at the text rate.
    "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.60, audioInput: null },
    "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10.00, audioInput: null },
    // audioInput confirmed on https://ai.google.dev/gemini-api/docs/pricing (same as text for this model)
    "gemini-3.5-flash": { input: 1.50, cachedInput: 0.15, output: 9.00, audioInput: 1.50 },
}

const DEFAULT_PRICING = { input: 0, cachedInput: 0, output: 0 }

function getPricing(model) {
    return PRICING[model] ?? DEFAULT_PRICING
}

module.exports = { PRICING, getPricing }
