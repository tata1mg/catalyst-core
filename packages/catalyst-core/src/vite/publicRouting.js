// AI_CONFIG.routing is copied into the browser bundle (AI_PUBLIC_CONFIG). Copy only the fields the router reads, by
// type, instead of the whole object: anything else someone put there (a header, an endpoint, a token) must never ship.

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const isNumber = (v) => typeof v === "number" && Number.isFinite(v)
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : undefined)
const ON_DEVICE_KEYS = ["ios", "android", "web", "web-desktop", "web-mobile"]

function pick(source, spec) {
    const out = {}
    for (const [key, kind] of Object.entries(spec)) {
        const v = source[key]
        if (v === undefined) continue
        if (kind === "string" && typeof v === "string") out[key] = v
        else if (kind === "number" && isNumber(v)) out[key] = v
        else if (kind === "boolean" && typeof v === "boolean") out[key] = v
        else if (kind === "strings" && strings(v)) out[key] = strings(v)
    }
    return out
}

function candidate(raw) {
    if (!isObject(raw)) return null
    const out = pick(raw, {
        id: "string", engine: "string", model: "string", modelPath: "string", provider: "string",
        modalities: "strings", tasks: "strings", ttftMs: "number", tps: "number", loadMs: "number",
    })
    if (isObject(raw.price) && isNumber(raw.price.input) && isNumber(raw.price.output)) {
        out.price = { input: raw.price.input, output: raw.price.output }
    }
    return out
}

function policy(raw) {
    if (!isObject(raw)) return undefined
    const out = pick(raw, {
        objective: "string", order: "strings", cloud: "string", cloudMedia: "string", autoDownload: "boolean",
        expectedInputTokens: "number", expectedOutputTokens: "number",
    })
    if (isObject(raw.weights)) out.weights = pick(raw.weights, { cost: "number", latency: "number", tps: "number" })
    if (isObject(raw.constraints)) out.constraints = pick(raw.constraints, { maxLatencyMs: "number", minTps: "number", maxCostUsd: "number" })
    return out
}

/** The browser-safe copy of AI_CONFIG.routing: known fields only, each checked for its type. */
export function publicRouting(raw) {
    if (!isObject(raw)) return undefined
    const out = {}
    const p = policy(raw.policy)
    if (p) out.policy = p
    if (typeof raw.platformSpeech === "boolean") out.platformSpeech = raw.platformSpeech
    if (isObject(raw.onDevice)) {
        out.onDevice = {}
        for (const key of ON_DEVICE_KEYS) {
            if (Array.isArray(raw.onDevice[key])) out.onDevice[key] = raw.onDevice[key].map(candidate).filter(Boolean)
        }
    }
    if (Array.isArray(raw.cloud)) out.cloud = raw.cloud.map(candidate).filter(Boolean)
    return out
}
