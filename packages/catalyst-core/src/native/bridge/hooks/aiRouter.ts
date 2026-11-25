// Auto routing for useAI ({ provider: "auto" }).
//
// Candidates come from AI_CONFIG.routing in config.json, split into on-device (per platform: ios, android, web-desktop, web-mobile, or web for both; each
// may list several models) and cloud (provider + model). Every call is decided in three steps:
//   1. availability: can this candidate run right now, does it do the call's task, and does it take its modalities?
//   2. privacy:      may this call leave the device? (cloud / cloudMedia policy, download consent)
//   3. preference:   score the survivors on cost, latency and tokens/sec and take the best.
// Config values are priors. Metrics observed from real calls (the same ones useAI reports) replace them as samples
// accumulate. Everything here is pure; useAI supplies the signals and stores the observed metrics.

/** "web" is accepted as "a plain browser, either kind"; the router itself resolves to web-desktop / web-mobile. */
export type Platform = "ios" | "android" | "web" | "web-desktop" | "web-mobile"
export type Target = "onDevice" | "cloud"
export type Modality = "text" | "image" | "audio"
/** What a call asks a model to do. Candidates declare the tasks they can serve; modalities say what goes in. */
export type Task = "text.generate" | "vision.read" | "speech.transcribe" | "speech.synthesize" | "image.generate" | "embed"
export const TASKS: Task[] = ["text.generate", "vision.read", "speech.transcribe", "speech.synthesize", "image.generate", "embed"]
export const DEFAULT_TASK: Task = "text.generate"
export const isTask = (v: unknown): v is Task => typeof v === "string" && (TASKS as string[]).includes(v)
export const isWebPlatform = (p: string) => p === "web" || p === "web-desktop" || p === "web-mobile"

/** A candidate that lists no tasks serves what its modalities imply, so configs written before tasks existed keep working. */
export function tasksFromModalities(modalities: Modality[]): Task[] {
    return [
        "text.generate",
        ...(modalities.includes("image") ? (["vision.read"] as Task[]) : []),
        ...(modalities.includes("audio") ? (["speech.transcribe"] as Task[]) : []),
    ]
}
/** Chrome's built-in model (Prompt API), as reported by LanguageModel.availability(). */
export type PromptApiState = "unavailable" | "downloadable" | "downloading" | "available"
export const PROMPT_API = "prompt-api"
/**
 * The phone's own speech recogniser (Android SpeechRecognizer, iOS SFSpeechRecognizer). It listens to the live microphone,
 * so it can only serve speech.transcribe for a caller that is listening (useTranscribe.listen), never a call that hands
 * over a recorded clip. generate() leaves it out; see withoutLiveEngines.
 */
export const PLATFORM_SPEECH = "platform-speech"
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
    /** On-device: native engine ("litert" | "foundation-models" | "platform-speech"); in a browser "prompt-api" (Chrome's built-in model) or omitted (Transformers.js). */
    engine?: string
    model?: string
    modelPath?: string
    /** Cloud only. */
    provider?: string
    modalities: Modality[]
    tasks: Task[]
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
    /** Which web model is loaded right now. When given it decides, per candidate; `webModelLoaded` alone says that some model is. */
    webLoadedModel?: string | null
    /** Candidate currently loaded on device (a different on-device pick pays loadMs). */
    loadedId?: string | null
    /** Chrome Prompt API availability (desktop Chrome). Undefined = not checked, treated as unavailable. */
    promptApi?: PromptApiState
    /**
     * The shell can recognise speech on the device (the support reply of the platform recogniser). Undefined = not known,
     * treated as unavailable. This is separate from nativeAvailable, which is about the native AI plugin.
     */
    platformSpeech?: boolean
    /** Providers the server has keys for. Undefined = unknown, assume all configured. */
    cloudProviders?: string[]
}

export interface Consent {
    cloud?: boolean
    download?: boolean
    /**
     * Candidate id to stay on. Routing normally re-ranks on every call (observed speed, which model is loaded), so a job
     * made of several calls, such as the chunks of one recording, pins the id its first call chose. The privacy policy
     * still applies to the pinned candidate. Ignored when the id is unknown.
     */
    pin?: string
}

export interface Estimate {
    latencyMs: number
    tps: number
    costUsd: number
    /** False for a cloud model with no price: its cost is unknown, not zero. On-device models are free, so theirs is always known. */
    costKnown: boolean
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

/** The recogniser loads no model and answers as you speak, so it is quick and has nothing to download or switch to. */
const PLATFORM_SPEECH_PRIORS = { ttftMs: 300, tps: 100 }

export const isLiveEngine = (c: Pick<Candidate, "engine">) => c.engine === PLATFORM_SPEECH

/** generate() hands a model a recorded clip; an engine that only listens live cannot take one, so it is never a choice there. */
export const withoutLiveEngines = (candidates: Candidate[]): Candidate[] => candidates.filter((c) => !isLiveEngine(c))

/**
 * The candidates for a caller that is listening live (useTranscribe.listen): the configured ones, plus the platform
 * recogniser first on iOS and Android unless the config lists its own entry (to place it) or turns it off with
 * `routing.platformSpeech: false`. It is never added in a browser. Opt out is one line, because it keeps voice on the phone.
 */
export function withPlatformSpeech(candidates: Candidate[], platform: Platform, raw: any = null): Candidate[] {
    if (isWebPlatform(platform)) return candidates
    // An explicit opt-out wins over everything, including a platform-speech entry the config lists itself.
    if (raw?.platformSpeech === false) return withoutLiveEngines(candidates)
    if (candidates.some(isLiveEngine)) return candidates
    return [
        {
            id: PLATFORM_SPEECH, target: "onDevice", mode: "native", engine: PLATFORM_SPEECH, modalities: ["audio"],
            tasks: ["speech.transcribe"], priors: { ...PLATFORM_SPEECH_PRIORS, loadMs: 0 },
        },
        ...candidates,
    ]
}

/**
 * Policy and candidates for one call. `live` is a caller that listens to the microphone itself (it may get the platform
 * recogniser); any other call, which hands a model a recorded clip, never sees a live-only engine, even if the config
 * lists one first.
 */
export function routingFor(raw: any, platform: Platform, override: any, live: boolean, warn?: (m: string) => void) {
    const normalized = normalizeRouting(raw, platform, override, warn)
    // The opt-out can be set in the config or for one call, so judge the two together (the call wins).
    const effective = { ...(raw && typeof raw === "object" ? raw : {}), ...(override && typeof override === "object" ? override : {}) }
    return { policy: normalized.policy, candidates: live ? withPlatformSpeech(normalized.candidates, platform, effective) : withoutLiveEngines(normalized.candidates) }
}

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
    let tasks = tasksFromModalities(modalities)
    if (raw.tasks !== undefined) {
        const listed = Array.isArray(raw.tasks) ? raw.tasks : []
        const valid = listed.filter(isTask)
        if (valid.length !== listed.length || !Array.isArray(raw.tasks)) {
            warn(`routing: "${raw.id}" has unknown tasks (use ${TASKS.join(", ")})${valid.length ? "" : "; using what its modalities imply"}`)
        }
        if (valid.length) tasks = valid
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
        return { id: raw.id, target, mode: "cloud", provider: raw.provider, model: raw.model, modalities, tasks, priors, price }
    }
    const web = isWebPlatform(platform)
    // The phone's recogniser exists only inside an app, and only for transcribing: whatever the entry lists is overridden.
    if (raw.engine === PLATFORM_SPEECH) {
        if (web) {
            warn(`routing: "${raw.id}" uses the platform speech recogniser, which only exists in the iOS and Android apps; dropped from ${platform}`)
            return null
        }
        return {
            id: raw.id, target, mode: "native", engine: PLATFORM_SPEECH, modalities: ["audio"], tasks: ["speech.transcribe"],
            priors: { ttftMs: priors.ttftMs ?? PLATFORM_SPEECH_PRIORS.ttftMs, tps: priors.tps ?? PLATFORM_SPEECH_PRIORS.tps, loadMs: 0 },
        }
    }
    // Chrome's built-in model is a desktop-only candidate: phones and tablets do not get it.
    if (web && raw.engine === PROMPT_API && platform === "web-mobile") {
        warn(`routing: "${raw.id}" uses the Chrome Prompt API, which is desktop-only; dropped from web-mobile`)
        return null
    }
    return {
        id: raw.id,
        target,
        mode: web ? "local" : "native",
        engine: web ? (raw.engine === PROMPT_API ? PROMPT_API : undefined) : raw.engine,
        model: raw.model,
        modelPath: raw.modelPath,
        modalities,
        tasks,
        priors,
    }
}

/** onDevice lists a page may use, most specific first: a phone browser reads web-mobile, then the shared "web". */
function onDeviceKeys(platform: Platform): string[] {
    return platform === "web-desktop" || platform === "web-mobile" ? [platform, "web"] : [platform]
}

/**
 * AI_CONFIG.routing -> policy + the candidates that apply to this platform. A per-call override is merged over the
 * policy only; candidates always come from config.json. Bad entries are dropped with a warning, never thrown.
 *
 *   routing: {
 *     policy: { objective, weights, constraints: { maxLatencyMs, minTps, maxCostUsd }, cloud, cloudMedia, autoDownload },
 *     onDevice: { ios: [...], android: [...], "web-desktop": [...], "web-mobile": [...], web: [...] },
 *     cloud: [{ id, provider, model, modalities, tasks, ttftMs, tps, price: { input, output } }]
 *
 * `tasks` (text.generate, vision.read, speech.transcribe, speech.synthesize, image.generate, embed) is optional; left
 * out, it follows from `modalities`. A browser reads onDevice["web-desktop"] or ["web-mobile"] and falls back to ["web"].
 *   }
 */
export function normalizeRouting(
    raw: any,
    platform: Platform,
    override: any = null,
    warn: (m: string) => void = (m) => console.warn(`[catalyst-core] ${m}`)
): { policy: Policy; candidates: Candidate[] } {
    // The override wins field by field. `constraints` and `weights` are objects of their own, so they are merged too: an override of
    // { constraints: { maxCostUsd } } must not drop the configured maxLatencyMs and minTps.
    const configured = raw?.policy || {}
    const base = {
        ...configured,
        ...(override || {}),
        constraints: { ...(configured.constraints || {}), ...(override?.constraints || {}) },
        weights: { ...(configured.weights || {}), ...(override?.weights || {}) },
    }
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
        // One list per target. Inside a native app (a WebView build) the on-device model is the native one, loaded by the
        // native module; the in-browser list is for plain browsers only and is never consulted there.
        ...list(raw?.onDevice?.[onDeviceKeys(platform).find((k) => Array.isArray(raw?.onDevice?.[k])) as string]).map((x: any) => normalizeCandidate(x, "onDevice", platform, warn)),
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
    if (c.target === "onDevice" && loadedId !== c.id) ttft += c.priors.loadMs ?? (isLiveEngine(c) ? 0 : DEFAULT_LOAD_MS)
    const latencyMs = ttft + (policy.expectedOutputTokens / tps) * 1000
    // A cloud model with no configured price is not free, it is unknown: counting it as 0 would let it pass any cost limit and win
    // a cost objective. On-device models cost nothing to run, so no price there is a known zero.
    const costKnown = c.price !== undefined || c.target !== "cloud"
    const costUsd = c.price
        ? (policy.expectedInputTokens / 1e6) * c.price.input + (policy.expectedOutputTokens / 1e6) * c.price.output
        : 0
    const source: Estimate["source"] = observed && observed.n > 0 ? "observed" : c.priors.ttftMs !== undefined || c.priors.tps !== undefined ? "config" : "default"
    return { latencyMs, tps, costUsd, costKnown, source }
}

/**
 * Why `e` breaks the policy's limits, or null. `waivedLoadMs` is a one-time model load the user has already agreed to
 * (download consent or autoDownload): it is part of the first call's wait, but not of how long a call takes, so the
 * latency limit does not count it. The estimate and the scoring still do.
 */
function limitViolation(e: Estimate, k: Policy["constraints"], waivedLoadMs = 0): string | null {
    const latencyMs = e.latencyMs - waivedLoadMs
    if (k.maxLatencyMs !== undefined && latencyMs > k.maxLatencyMs) return `latency ~${Math.round(latencyMs)}ms over limit`
    if (k.minTps !== undefined && e.tps < k.minTps) return `${e.tps.toFixed(1)} tps under limit`
    if (k.maxCostUsd !== undefined && !e.costKnown) return "cost unknown (no price set), so it cannot be checked against maxCostUsd"
    if (k.maxCostUsd !== undefined && e.costUsd > k.maxCostUsd) return "cost over limit"
    return null
}

/** Cheaper first; a cost that is unknown sorts after every known one. */
function compareCost(a: Estimate, b: Estimate): number {
    if (a.costKnown !== b.costKnown) return a.costKnown ? -1 : 1
    return a.costUsd - b.costUsd
}

/** Min-max across the survivors so cost ($), latency (ms) and tps are comparable; lower score is better. */
function scoreAll(rows: { c: Candidate; e: Estimate }[], policy: Policy) {
    const span = (f: (e: Estimate) => number) => {
        const v = rows.map((r) => f(r.e))
        const lo = Math.min(...v), hi = Math.max(...v)
        return (x: number) => (hi === lo ? 0 : (x - lo) / (hi - lo))
    }
    // Only models whose cost is known set the cost scale; an unknown cost scores as the worst, never as the cheapest.
    const known = rows.filter((r) => r.e.costKnown)
    const costSpan = (() => {
        const v = known.map((r) => r.e.costUsd)
        const lo = Math.min(...v), hi = Math.max(...v)
        return (e: Estimate) => (!e.costKnown ? (known.length ? 1 : 0) : hi === lo ? 0 : (e.costUsd - lo) / (hi - lo))
    })()
    const lat = span((e) => e.latencyMs), speed = span((e) => -e.tps)
    const { weights: w } = policy
    const total = w.cost + w.latency + w.tps || 1
    return rows
        .map(({ c, e }) => ({ id: c.id, estimate: e, score: (w.cost * costSpan(e) + w.latency * lat(e.latencyMs) + w.tps * speed(-e.tps)) / total }))
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

/** The load time estimate() adds for this candidate (0 when it is the model already loaded). */
function loadMsOf(c: Candidate, signals: Signals): number {
    return c.target === "onDevice" && signals.loadedId !== c.id ? (c.priors.loadMs ?? (isLiveEngine(c) ? 0 : DEFAULT_LOAD_MS)) : 0
}

export function chooseCandidate(
    modalities: Modality[],
    candidates: Candidate[],
    signals: Signals,
    policy: Policy,
    observed: Record<string, Observed> = {},
    consent: Consent = {},
    task: Task = DEFAULT_TASK
): RouteDecision {
    const skipped: Skipped[] = []
    const media = modalities.some((m) => m !== "text")
    const cloudPolicy: CloudPolicy = media && STRICT[policy.cloudMedia] >= STRICT[policy.cloud] ? policy.cloudMedia : policy.cloud
    const askCloud: Candidate[] = []
    const askDownload: Candidate[] = []
    const viable: { c: Candidate; e: Estimate }[] = []

    for (const c of candidates) {
        if (!c.tasks.includes(task)) { skipped.push({ id: c.id, why: `does not do ${task}` }); continue }
        const miss = modalities.find((m) => !c.modalities.includes(m))
        if (miss) { skipped.push({ id: c.id, why: `no ${miss} support` }); continue }
        if (isLiveEngine(c)) {
            // Its own availability: the shell's speech support reply, not the native AI plugin (nativeAvailable).
            if (signals.platformSpeech !== true) { skipped.push({ id: c.id, why: "platform speech recognition unavailable" }); continue }
        } else if (c.mode === "native" && !signals.nativeAvailable) { skipped.push({ id: c.id, why: "native bridge unavailable" }); continue }
        if (c.mode === "local" && c.engine === PROMPT_API) {
            // Chrome owns the model and its download; there is no WebGPU requirement.
            const state = signals.promptApi ?? "unavailable"
            if (state === "unavailable") { skipped.push({ id: c.id, why: "Chrome Prompt API unavailable" }); continue }
            if (state !== "available" && !policy.autoDownload && !consent.download) {
                // Same rule as for the Transformers.js model: do not ask to download what the limits would reject anyway.
                const why = limitViolation(estimate(c, policy, observed[c.id], signals.loadedId), policy.constraints, loadMsOf(c, signals))
                if (why) { skipped.push({ id: c.id, why }); continue }
                askDownload.push(c)
                skipped.push({ id: c.id, why: "model not downloaded" })
                continue
            }
        } else if (c.mode === "local") {
            if (!signals.webgpu) { skipped.push({ id: c.id, why: "WebGPU unavailable" }); continue }
            // Loaded means THIS candidate's model: another model being ready does not make this one free of a download.
            const loaded = signals.webLoadedModel !== undefined ? !!c.model && c.model === signals.webLoadedModel : signals.webModelLoaded
            if (!loaded && !policy.autoDownload && !consent.download) {
                // Never ask permission for a download of a model the limits would reject anyway (the user would agree to 3.4 GB and
                // then be told no). The load is waived here because that is exactly what they would be agreeing to.
                const why = limitViolation(estimate(c, policy, observed[c.id], signals.loadedId), policy.constraints, loadMsOf(c, signals))
                if (why) { skipped.push({ id: c.id, why }); continue }
                askDownload.push(c)
                skipped.push({ id: c.id, why: "model not downloaded" })
                continue
            }
        }
        if (c.mode === "cloud") {
            if (!signals.online) { skipped.push({ id: c.id, why: "offline" }); continue }
            if (signals.cloudProviders && !signals.cloudProviders.includes(c.provider as string)) { skipped.push({ id: c.id, why: `provider "${c.provider}" not configured` }); continue }
            if (cloudPolicy === "deny") { skipped.push({ id: c.id, why: media ? "cloud denied for media" : "cloud denied" }); continue }
            if (cloudPolicy === "ask" && !consent.cloud) { askCloud.push(c); skipped.push({ id: c.id, why: "needs consent" }); continue }
        }
        const e = estimate(c, policy, observed[c.id], signals.loadedId)
        // An in-browser model only gets here once its download was agreed to (or it is loaded), so its load is not held against the limit.
        const why = limitViolation(e, policy.constraints, c.mode === "local" ? loadMsOf(c, signals) : 0)
        if (why) { skipped.push({ id: c.id, why }); continue }
        viable.push({ c, e })
    }

    if (viable.length) {
        const rank = rankCandidates(candidates, policy.order)
        const est = new Map(viable.map((v) => [v.c.id, v]))
        const byOrder = (a: string, b: string) => {
            for (const key of policy.order) {
                const x = est.get(a)!, y = est.get(b)!
                const d = ORDER_METRICS.includes(key)
                    ? key === "cost" ? compareCost(x.e, y.e) : key === "latency" ? x.e.latencyMs - y.e.latencyMs : y.e.tps - x.e.tps
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
    if (askDownload.length) return { action: "ask", candidate: askDownload[0], reason: askDownload[0].engine === PROMPT_API ? "Chrome's built-in model must be downloaded first" : "the in-browser model must be downloaded first", scores: [], skipped }
    return { action: "deny", candidate: null, reason: "no model can serve this call", scores: [], skipped }
}

// What the request really contains: text for string content or a text part, image and audio only for those parts. An audio-only
// request is NOT also a text request, or a model that listens but does not read would be skipped as lacking text support.
// A request with nothing recognisable in it is plain text.
export function modalitiesOf(messages: any): Modality[] {
    const set = new Set<Modality>()
    for (const m of Array.isArray(messages) ? messages : []) {
        if (typeof m?.content === "string") { set.add("text"); continue }
        if (!Array.isArray(m?.content)) continue
        for (const part of m.content) {
            if (part?.type === "text") set.add("text")
            else if (part?.type === "image" || part?.type === "audio") set.add(part.type)
        }
    }
    return set.size ? [...set] : ["text"]
}

// What the call asks for: generate({ task }) wins over useAI({ task }); anything unrecognised is plain text generation.
export function taskOf(args: any, options: any) {
    // A task named on the call decides, even when it is not one we know: that is plain text generation, not the hook's own task.
    if (args && typeof args === "object" && "task" in args) return isTask(args.task) ? args.task : DEFAULT_TASK
    return isTask(options?.task) ? options.task : DEFAULT_TASK
}

// generate() takes messages and returns text. These tasks fit that; the rest (embeddings, images, speech out) have their own
// calls (requestImage, requestSpeech, ...) and cannot be run by a generate() request, whichever model routing picked for them.
export const GENERATE_TASKS = ["text.generate", "vision.read", "speech.transcribe"]
