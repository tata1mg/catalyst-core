// On-device providers. "native" lets the platform pick (iOS: LiteRT-LM if its model is downloaded, else
// Apple Foundation Models, else LiteRT-LM); "litert" and "foundation-models" pin an engine. They can be set
// per call (useAI({ provider })) or app-wide in AI_CONFIG.browser.provider, optionally with
// AI_CONFIG.browser.engine instead of an alias.
const NATIVE_ENGINE_BY_PROVIDER: Record<string, string | undefined> = {
    native: undefined,
    litert: "litert",
    "foundation-models": "foundation-models",
}

export function resolveMode(provider: string | undefined): "local" | "native" | "cloud" {
    if (provider === "transformers") return "local"
    if (provider !== undefined && Object.prototype.hasOwnProperty.call(NATIVE_ENGINE_BY_PROVIDER, provider)) return "native"
    return "cloud"
}

/** Engine to pin for the native provider: an explicit option wins, then the provider alias, then config. */
export function resolveNativeEngine(
    provider: string | undefined,
    explicitEngine: string | undefined,
    config: { engine?: string } | null | undefined
): string | undefined {
    const aliasEngine =
        provider !== undefined && Object.prototype.hasOwnProperty.call(NATIVE_ENGINE_BY_PROVIDER, provider)
        ? NATIVE_ENGINE_BY_PROVIDER[provider]
        : undefined
    return explicitEngine ?? aliasEngine ?? config?.engine
}

/**
 * Image/audio may go to a cloud provider only when the caller picked cloud explicitly. When native or web was
 * requested but is unavailable, useAI falls back to the cloud hook; that fallback must refuse media.
 */
export function allowCloudMedia(mode: "local" | "native" | "cloud"): boolean {
    return mode === "cloud"
}

// ─── auto routing ───────────────────────────────────────────────────────────
// provider: "auto" picks an engine per call: availability first, then privacy, then preference.
// Defaults live in AI_CONFIG.routing; a per-call `routing` option overrides them.

export type RouteMode = "local" | "native" | "cloud"
export type CloudPolicy = "allow" | "ask" | "deny"
export type Modality = "text" | "image" | "audio"

export interface RoutingConfig {
    /** Order of engines to try when several can serve the call. Default: native, local, cloud. */
    prefer?: RouteMode[]
    /** Whether a call may leave the device. "ask" returns a decision for the app to confirm. Default: "ask". */
    cloud?: CloudPolicy
    /** Same, for calls carrying image or audio. Default: "deny" unless `cloud` is stricter. */
    cloudMedia?: CloudPolicy
    /** Whether the web engine may start its large model download without the app confirming. Default: false. */
    autoDownload?: boolean
}

export interface RouteSignals {
    /** Native bridge present and AI enabled. */
    native: boolean
    /** WebGPU present (the web engine needs it). */
    webgpu: boolean
    online: boolean
    /** Web model already downloaded; if false, using it starts a ~3.4 GB download. */
    webModelCached?: boolean
    /** Modalities each engine can take. */
    caps: Partial<Record<RouteMode, Partial<Record<Modality, boolean>>>>
    /** A cloud provider is configured (server route reachable). */
    cloudConfigured?: boolean
}

export interface RouteDecision {
    mode: RouteMode | null
    /** "ask" means the app must get consent and call again with `consent`. */
    action: "run" | "ask" | "deny"
    reason: string
    /** Engines considered and why each was skipped. */
    skipped: { mode: RouteMode; why: string }[]
}

const DEFAULT_PREFER: RouteMode[] = ["native", "local", "cloud"]
const STRICTNESS: Record<CloudPolicy, number> = { allow: 0, ask: 1, deny: 2 }

export function mergeRouting(base?: RoutingConfig | null, override?: RoutingConfig | null): Required<RoutingConfig> {
    const m = { ...(base || {}), ...(override || {}) }
    const prefer = Array.isArray(m.prefer) ? m.prefer.filter((x) => DEFAULT_PREFER.includes(x)) : []
    return {
        prefer: prefer.length ? prefer : DEFAULT_PREFER,
        cloud: m.cloud && m.cloud in STRICTNESS ? m.cloud : "ask",
        cloudMedia: m.cloudMedia && m.cloudMedia in STRICTNESS ? m.cloudMedia : "deny",
        autoDownload: m.autoDownload === true,
    }
}

/**
 * Pick the engine for one call. Pure: all inputs are passed in so it can be tested without a device.
 * `consent` is what the user already granted for this call (set after an "ask" decision).
 */
export function resolveRoute(
    modalities: Modality[],
    signals: RouteSignals,
    routing: Required<RoutingConfig>,
    consent: { cloud?: boolean; download?: boolean } = {}
): RouteDecision {
    const skipped: RouteDecision["skipped"] = []
    const hasMedia = modalities.some((m) => m === "image" || m === "audio")
    // Media follows the stricter of the two cloud policies.
    const cloudPolicy: CloudPolicy = hasMedia
        ? (STRICTNESS[routing.cloudMedia] >= STRICTNESS[routing.cloud] ? routing.cloudMedia : routing.cloud)
        : routing.cloud
    let pendingCloud = false
    let pendingDownload: RouteMode | null = null

    for (const mode of routing.prefer) {
        const caps = signals.caps[mode] || {}
        const missing = modalities.find((m) => !caps[m])
        if (missing) {
            skipped.push({ mode, why: `no ${missing} support` })
            continue
        }
        if (mode === "native") {
            if (!signals.native) { skipped.push({ mode, why: "native bridge unavailable" }); continue }
            return { mode, action: "run", reason: "on-device engine available", skipped }
        }
        if (mode === "local") {
            if (!signals.webgpu) { skipped.push({ mode, why: "WebGPU unavailable" }); continue }
            if (signals.webModelCached === false && !routing.autoDownload && !consent.download) {
                skipped.push({ mode, why: "model not downloaded" })
                pendingDownload = pendingDownload || mode
                continue
            }
            return { mode, action: "run", reason: "in-browser engine available", skipped }
        }
        // cloud
        if (!signals.online) { skipped.push({ mode, why: "offline" }); continue }
        if (signals.cloudConfigured === false) { skipped.push({ mode, why: "no cloud provider configured" }); continue }
        if (cloudPolicy === "deny") { skipped.push({ mode, why: hasMedia ? "cloud denied for media" : "cloud denied" }); continue }
        if (cloudPolicy === "ask" && !consent.cloud) {
            skipped.push({ mode, why: "needs consent" })
            pendingCloud = true
            continue
        }
        return { mode, action: "run", reason: "no on-device engine could serve this call", skipped }
    }

    // Nothing could run. Never silently send data out: surface what would unblock the call.
    if (pendingCloud) return { mode: "cloud", action: "ask", reason: "only the cloud can serve this call and it needs consent", skipped }
    if (pendingDownload) return { mode: pendingDownload, action: "ask", reason: "the in-browser model must be downloaded first", skipped }
    return { mode: null, action: "deny", reason: "no engine can serve this call", skipped }
}
