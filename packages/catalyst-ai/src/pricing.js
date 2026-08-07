// Hardcoded USD price per 1M tokens. Update manually when providers change pricing.
const PRICING = {
    "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
    "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10.0 },
    "gemini-3.5-flash": { input: 1.5, cachedInput: 0.15, output: 9.0 },
}

const DEFAULT_PRICING = { input: 0, cachedInput: 0, output: 0 }

function getPricing(model) {
    return PRICING[model] ?? DEFAULT_PRICING
}

module.exports = { PRICING, getPricing }
