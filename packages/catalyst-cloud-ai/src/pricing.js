// Hardcoded USD price per 1M tokens. Update manually when providers change pricing.
const PRICING = {
    "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.60 },
    "gpt-5": { input: 0.625, cachedInput: 0.625, output: 5.00 },
    "gemini-3.5-flash": { input: 1.50, cachedInput: 0.15, output: 9.00 },
}

const DEFAULT_PRICING = { input: 0, cachedInput: 0, output: 0 }

function getPricing(model) {
    return PRICING[model] ?? DEFAULT_PRICING
}

module.exports = { PRICING, getPricing }
