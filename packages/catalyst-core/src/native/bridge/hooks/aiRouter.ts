// Auto routing for useAI ({ provider: "auto" }).
//
// Candidates come from AI_CONFIG.routing in config.json, split into on-device (per platform: ios, android, web; each
// may list several models) and cloud (provider + model). Every call is decided in three steps:
//   1. availability: can this candidate run right now, and does it take the call's modalities?
//   2. privacy:      may this call leave the device? (cloud / cloudMedia policy, download consent)
//   3. preference:   score the survivors on cost, latency and tokens/sec and take the best.
// Config values are priors. Metrics observed from real calls (the same ones useAI reports) replace them as samples
// accumulate. Everything here is pure; useAI supplies the signals and stores the observed metrics.

export type Platform = "ios" | "android" | "web"
export type Target = "onDevice" | "cloud"
export type Modality = "text" | "image" | "audio"
export type CloudPolicy = "allow" | "ask" | "deny"
export type Objective = "balanced" | "cost" | "latency" | "speed" | "order"

export interface Price {
    /** USD per 1M tokens. */
    input: number
    output: number
}

export interface Priors {
    ttftMs?: number
    /** Output tokens per second. */
    tps?: number
    /** Time to load this model when it is not the one currently loaded (on-device only). */
    loadMs?: number
}

export interface Candidate {
    id: string
    target: Target
    mode: "native" | "local" | "cloud"
    /** On-device: native engine ("litert" | "foundation-models") or omitted for web. */
    engine?: string
    model?: string
    modelPath?: string
    /** Cloud only. */
    provider?: string
    modalities: Modality[]
    priors: Priors
    price?: Price
}

export interface Policy {
    /**
     * Default priority, applied left to right as sort keys. An entry is a candidate id or a group ("onDevice",
     * "cloud"), which puts those candidates first, or a metric: "cost" (cheapest first), "latency" (quickest
     * first), "tps" (most tokens/sec first), which sorts by the estimate. A later entry only matters where earlier
     * ones tie, and candidates still tied follow config order. It breaks score ties and, with objective "order",
     * is the whole decision.
     */
    order: string[]
    objective: Objective
    weights: { cost: number; latency: number; tps: number }
    constraints: { maxLatencyMs?: number; minTps?: number; maxCostUsd?: number }
    cloud: CloudPolicy
    cloudMedia: CloudPolicy
    autoDownload: boolean
    expectedInputTokens: number
    expectedOutputTokens: number
}

export interface Observed {
    n: number
    ttftMs?: number
    tps?: number
}

export interface Signals {
    platform: Platform
    nativeAvailable: boolean
    webgpu: boolean
    online: boolean
    /** Web model already in memory; false means using it starts a download. */
    webModelLoaded: boolean
    /** Candidate currently loaded on device (a different on-device pick pays loadMs). */
    loadedId?: string | null
    /** Providers the server has keys for. Undefined = unknown, assume all configured. */
    cloudProviders?: string[]
}

export interface Consent {
    cloud?: boolean
    download?: boolean
}

export interface Estimate {
    latencyMs: number
    tps: number
    costUsd: number
    /** "observed" once real samples back the numbers; "config" while it is still the prior. */
    source: "observed" | "config" | "default"
}

export interface Skipped {
    id: string
    why: string
}

export interface RouteDecision {
    action: "run" | "ask" | "deny"
    candidate: Candidate | null
    reason: string
    estimate?: Estimate
    scores: { id: string; score: number; estimate: Estimate }[]
    skipped: Skipped[]
}

export const DEFAULT_ORDER = ["onDevice", "cloud"]
export const ORDER_METRICS = ["cost", "latency", "tps"]

const OBJECTIVES: Record<Objective, Policy["weights"]> = {
    order: { cost: 0, latency: 0, tps: 0 },
    balanced: { cost: 0.4, latency: 0.4, tps: 0.2 },
    cost: { cost: 0.8, latency: 0.15, tps: 0.05 },
    latency: { cost: 0.1, latency: 0.7, tps: 0.2 },
    speed: { cost: 0.05, latency: 0.25, tps: 0.7 },
}
const MODALITIES: Modality[] = ["text", "image", "audio"]
const POLICIES: CloudPolicy[] = ["allow", "ask", "deny"]
const STRICT: Record<CloudPolicy, number> = { allow: 0, ask: 1, deny: 2 }
/** Observed numbers fully replace priors after roughly this many samples (blend n / (n + K)). */
const BLEND_K = 3
const DEFAULT_TTFT_MS = 1500
const DEFAULT_TPS = 15
const DEFAULT_LOAD_MS = 8000

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined)

function normalizeCandidate(raw: any, target: Target, platform: string, warn: (m: string) => void): Candidate | null {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) {
        warn(`routing: ${target}/${platform} candidate needs an "id"`)
        return null
    }
    const modalities = (Array.isArray(raw.modalities) ? raw.modalities : ["text"]).filter((m: any) => MODALITIES.includes(m))
    if (!modalities.length) {
        warn(`routing: "${raw.id}" lists no valid modalities`)
        return null
    }
    const priors: Priors = { ttftMs: num(raw.ttftMs), tps: num(raw.tps), loadMs: num(raw.loadMs) }
    const price =
        raw.price && num(raw.price.input) !== undefined && num(raw.price.output) !== undefined
            ? { input: raw.price.input, output: raw.price.output }
            : undefined
    if (target === "cloud") {
        if (typeof raw.provider !== "string") {
            warn(`routing: cloud candidate "${raw.id}" needs a "provider"`)
            return null
        }
        return { id: raw.id, target, mode: "cloud", provider: raw.provider, model: raw.model, modalities, priors, price }
    }
    const web = platform === "web"
    return {
        id: raw.id,
        target,
        mode: web ? "local" : "native",
        engine: web ? undefined : raw.engine,
        model: raw.model,
        modelPath: raw.modelPath,
        modalities,
        priors,
    }
}

/**
 * AI_CONFIG.routing -> policy + the candidates that apply to this platform. A per-call override is merged over the
 * policy only; candidates always come from config.json. Bad entries are dropped with a warning, never thrown.
 *
 *   routing: {
 *     policy: { objective, weights, constraints: { maxLatencyMs, minTps, maxCostUsd }, cloud, cloudMedia, autoDownload },
 *     onDevice: { ios: [...], android: [...], web: [...] },
 *     cloud: [{ id, provider, model, modalities, ttftMs, tps, price: { input, output } }]
 *   }
 */
export function normalizeRouting(
    raw: any,
    platform: Platform,
    override: any = null,
    warn: (m: string) => void = (m) => console.warn(`[catalyst-core] ${m}`)
): { policy: Policy; candidates: Candidate[] } {
    const base = { ...(raw?.policy || {}), ...(override || {}) }
    const objective: Objective = base.objective in OBJECTIVES ? base.objective : "balanced"
    const weights = { ...OBJECTIVES[objective] }
    for (const k of ["cost", "latency", "tps"] as const) {
        const w = num(base.weights?.[k])
        if (w !== undefined) weights[k] = w
    }
    const c = base.constraints || {}
    const policy: Policy = {
        order: Array.isArray(base.order) && base.order.every((x: unknown) => typeof x === "string") ? base.order : DEFAULT_ORDER,
        objective,
        weights,
        constraints: { maxLatencyMs: num(c.maxLatencyMs), minTps: num(c.minTps), maxCostUsd: num(c.maxCostUsd) },
        cloud: POLICIES.includes(base.cloud) ? base.cloud : "ask",
        cloudMedia: POLICIES.includes(base.cloudMedia) ? base.cloudMedia : "deny",
        autoDownload: base.autoDownload === true,
        expectedInputTokens: num(base.expectedInputTokens) ?? 500,
        expectedOutputTokens: num(base.expectedOutputTokens) ?? 256,
    }
    const list = (v: any) => (Array.isArray(v) ? v : [])
    const candidates: Candidate[] = [
        // A native app can use its platform's models and the in-WebView engine; a plain browser only the web list.
        ...(platform === "web" ? [] : list(raw?.onDevice?.[platform])).map((x: any) => normalizeCandidate(x, "onDevice", platform, warn)),
        ...list(raw?.onDevice?.web).map((x: any) => normalizeCandidate(x, "onDevice", "web", warn)),
        ...list(raw?.cloud).map((x: any) => normalizeCandidate(x, "cloud", "cloud", warn)),
    ].filter(Boolean) as Candidate[]
    const seen = new Set<string>()
    return { policy, candidates: candidates.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))) }
}

/** Fold one finished call's metrics (computeMetrics output) into the running average. */
export function recordObserved(prev: Observed | undefined, metrics: { ttftMs?: number | null; tps?: number | null } | null): Observed | undefined {
    if (!metrics) return prev
    const a = 0.3
    const mix = (old: number | undefined, v: number | null | undefined) =>
        typeof v === "number" && v > 0 ? (old === undefined ? v : old * (1 - a) + v * a) : old
    const ttftMs = mix(prev?.ttftMs, metrics.ttftMs)
    const tps = mix(prev?.tps, metrics.tps)
    if (ttftMs === undefined && tps === undefined) return prev
    return { n: (prev?.n ?? 0) + 1, ttftMs, tps }
}

export function estimate(c: Candidate, policy: Policy, observed: Observed | undefined, loadedId?: string | null): Estimate {
    const w = observed ? observed.n / (observed.n + BLEND_K) : 0
    const blend = (prior: number | undefined, seen: number | undefined, fallback: number) =>
        prior === undefined && seen === undefined ? fallback : seen === undefined ? (prior as number) : prior === undefined ? seen : prior * (1 - w) + seen * w
    let ttft = blend(c.priors.ttftMs, observed?.ttftMs, DEFAULT_TTFT_MS)
    const tps = Math.max(0.1, blend(c.priors.tps, observed?.tps, DEFAULT_TPS))
    // Switching on-device models re-initialises the engine, so a model that is not loaded pays its load time.
    if (c.target === "onDevice" && loadedId !== c.id) ttft += c.priors.loadMs ?? DEFAULT_LOAD_MS
    const latencyMs = ttft + (policy.expectedOutputTokens / tps) * 1000
    const costUsd = c.price
        ? (policy.expectedInputTokens / 1e6) * c.price.input + (policy.expectedOutputTokens / 1e6) * c.price.output
        : 0
    const source: Estimate["source"] = observed && observed.n > 0 ? "observed" : c.priors.ttftMs !== undefined || c.priors.tps !== undefined ? "config" : "default"
    return { latencyMs, tps, costUsd, source }
}

/** Min-max across the survivors so cost ($), latency (ms) and tps are comparable; lower score is better. */
function scoreAll(rows: { c: Candidate; e: Estimate }[], policy: Policy) {
    const span = (f: (e: Estimate) => number) => {
        const v = rows.map((r) => f(r.e))
        const lo = Math.min(...v), hi = Math.max(...v)
        return (x: number) => (hi === lo ? 0 : (x - lo) / (hi - lo))
    }
    const cost = span((e) => e.costUsd), lat = span((e) => e.latencyMs), speed = span((e) => -e.tps)
    const { weights: w } = policy
    const total = w.cost + w.latency + w.tps || 1
    return rows
        .map(({ c, e }) => ({ id: c.id, estimate: e, score: (w.cost * cost(e.costUsd) + w.latency * lat(e.latencyMs) + w.tps * speed(-e.tps)) / total }))
        .sort((a, b) => a.score - b.score)
}

/** Position of each candidate in the default order: named ids/groups first, the rest in config order. */
export function rankCandidates(candidates: Candidate[], order: string[]): Map<string, number> {
    const rank = new Map<string, number>()
    const add = (c: Candidate) => { if (!rank.has(c.id)) rank.set(c.id, rank.size) }
    for (const entry of order) for (const c of candidates) if (c.id === entry || c.target === entry) add(c)
    for (const c of candidates) add(c)
    return rank
}

export function chooseCandidate(
    modalities: Modality[],
    candidates: Candidate[],
    signals: Signals,
    policy: Policy,
    observed: Record<string, Observed> = {},
    consent: Consent = {}
): RouteDecision {
    const skipped: Skipped[] = []
    const media = modalities.some((m) => m !== "text")
    const cloudPolicy: CloudPolicy = media && STRICT[policy.cloudMedia] >= STRICT[policy.cloud] ? policy.cloudMedia : policy.cloud
    const askCloud: Candidate[] = []
    const askDownload: Candidate[] = []
    const viable: { c: Candidate; e: Estimate }[] = []

    for (const c of candidates) {
        const miss = modalities.find((m) => !c.modalities.includes(m))
        if (miss) { skipped.push({ id: c.id, why: `no ${miss} support` }); continue }
        if (c.mode === "native" && !signals.nativeAvailable) { skipped.push({ id: c.id, why: "native bridge unavailable" }); continue }
        if (c.mode === "local") {
            if (!signals.webgpu) { skipped.push({ id: c.id, why: "WebGPU unavailable" }); continue }
            if (!signals.webModelLoaded && !policy.autoDownload && !consent.download) { askDownload.push(c); skipped.push({ id: c.id, why: "model not downloaded" }); continue }
        }
        if (c.mode === "cloud") {
            if (!signals.online) { skipped.push({ id: c.id, why: "offline" }); continue }
            if (signals.cloudProviders && !signals.cloudProviders.includes(c.provider as string)) { skipped.push({ id: c.id, why: `provider "${c.provider}" not configured` }); continue }
            if (cloudPolicy === "deny") { skipped.push({ id: c.id, why: media ? "cloud denied for media" : "cloud denied" }); continue }
            if (cloudPolicy === "ask" && !consent.cloud) { askCloud.push(c); skipped.push({ id: c.id, why: "needs consent" }); continue }
        }
        const e = estimate(c, policy, observed[c.id], signals.loadedId)
        const k = policy.constraints
        if (k.maxLatencyMs !== undefined && e.latencyMs > k.maxLatencyMs) { skipped.push({ id: c.id, why: `latency ~${Math.round(e.latencyMs)}ms over limit` }); continue }
        if (k.minTps !== undefined && e.tps < k.minTps) { skipped.push({ id: c.id, why: `${e.tps.toFixed(1)} tps under limit` }); continue }
        if (k.maxCostUsd !== undefined && e.costUsd > k.maxCostUsd) { skipped.push({ id: c.id, why: "cost over limit" }); continue }
        viable.push({ c, e })
    }

    if (viable.length) {
        const rank = rankCandidates(candidates, policy.order)
        const est = new Map(viable.map((v) => [v.c.id, v]))
        const byOrder = (a: string, b: string) => {
            for (const key of policy.order) {
                const x = est.get(a)!, y = est.get(b)!
                const d = ORDER_METRICS.includes(key)
                    ? key === "cost" ? x.e.costUsd - y.e.costUsd : key === "latency" ? x.e.latencyMs - y.e.latencyMs : y.e.tps - x.e.tps
                    : Number(x.c.id !== key && x.c.target !== key) - Number(y.c.id !== key && y.c.target !== key)
                if (d !== 0) return d
            }
            return (rank.get(a) as number) - (rank.get(b) as number)
        }
        const scores = scoreAll(viable, policy)
        // Within a hair of each other the default order decides (on-device first unless the config says otherwise).
        const top = scores[0].score
        const near = scores.filter((s) => s.score - top < 0.02).sort((a, b) => byOrder(a.id, b.id))
        const pick = policy.objective === "order" ? [...scores].sort((a, b) => byOrder(a.id, b.id))[0] : near[0]
        const chosen = viable.find((v) => v.c.id === pick.id)!
        const reason = policy.objective === "order" ? "first available in the configured order" : `best ${policy.objective} score among ${viable.length} available`
        return { action: "run", candidate: chosen.c, reason, estimate: chosen.e, scores, skipped }
    }
    // Nothing can run. Never silently send data out or start a big download: say what would unblock the call.
    if (askCloud.length) return { action: "ask", candidate: askCloud[0], reason: "only the cloud can serve this call and it needs consent", scores: [], skipped }
    if (askDownload.length) return { action: "ask", candidate: askDownload[0], reason: "the in-browser model must be downloaded first", scores: [], skipped }
    return { action: "deny", candidate: null, reason: "no model can serve this call", scores: [], skipped }
}
