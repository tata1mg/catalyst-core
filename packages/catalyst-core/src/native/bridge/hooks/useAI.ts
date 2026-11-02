/* global __CATALYST_PACKAGES__ */

import { useEffect, useRef, useState } from "react"
import { allowCloudMedia, resolveMode, resolveNativeEngine, resolvePlatform } from "./aiProviders.js"
import nativeBridge from "../utils/NativeBridge.js"
import { useNetworkStatus } from "./useNetworkStatus.js"
import { chooseCandidate, normalizeRouting, recordObserved } from "./aiRouter.js"
import type { Candidate, Consent, Modality, Observed, Platform, RouteDecision, Signals } from "./aiRouter.js"

function getBrowserConfig() {
    try {
        const raw = process.env.AI_PUBLIC_CONFIG
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed?.browser || null
    } catch (_) {
        return null
    }
}

function getRoutingConfig() {
    try {
        const raw = process.env.AI_PUBLIC_CONFIG
        return raw ? JSON.parse(raw)?.routing || null : null
    } catch (_) {
        return null
    }
}

function modalitiesOf(messages: any): Modality[] {
    const set = new Set<Modality>(["text"])
    for (const m of Array.isArray(messages) ? messages : []) {
        if (!Array.isArray(m?.content)) continue
        for (const part of m.content) if (part?.type === "image" || part?.type === "audio") set.add(part.type)
    }
    return [...set]
}

// Live checks, not the user agent: an iPhone Safari tab is "web" (it has no native module), a WebView build is not.
function detectPlatform(): Platform {
    if (typeof window === "undefined") return "web"
    return resolvePlatform({ android: nativeBridge._detectAndroid(), ios: nativeBridge._detectIOS() })
}

// Observed ttft/tps per candidate, kept per device so routing improves with use. Best-effort: no storage, no memory.
const OBSERVED_KEY = "catalyst.ai.routing.observed"
function loadObserved(): Record<string, Observed> {
    try {
        return JSON.parse(localStorage.getItem(OBSERVED_KEY) || "{}") || {}
    } catch (_) {
        return {}
    }
}
function saveObserved(all: Record<string, Observed>) {
    try {
        localStorage.setItem(OBSERVED_KEY, JSON.stringify(all))
    } catch (_) {
        // ignore
    }
}

function isNativeAIAvailable() {
    // catalyst-ai knows both platforms (Android's NativeBridge, iOS's injected plugin manifest).
    // Older catalyst-ai versions don't export it, so fall back to the Android-only check.
    if (_pkg && typeof _pkg.isNativeAIAvailable === "function") return _pkg.isNativeAIAvailable()
    const nb = typeof window !== "undefined" && window.NativeBridge
    return nb && typeof nb.isAIAvailable === "function" && nb.isAIAvailable()
}

// __CATALYST_PACKAGES__ is substituted by webpack's DefinePlugin / Vite's `define` in
// client bundles only. catalyst-core is externalized (nodeExternals) from the SSR
// bundle, so on the server this file is loaded directly by Node — including via Vite's
// ssrLoadModule, which executes real ESM with no bundler transform and no `require`
// shim. useAI() always discards the SSR result anyway (returns emptyHook() when
// `window` is undefined), so only ever attempt the client-side `require` — a bare
// `require()` reached during SSR would throw ReferenceError rather than a catchable
// MODULE_NOT_FOUND, since this package is "type": "module".
const _pkg =
    typeof window !== "undefined" &&
    (typeof __CATALYST_PACKAGES__ === "undefined" || __CATALYST_PACKAGES__.ai)
        ? (() => {
              try {
                  return require(/* webpackIgnore: true */ "catalyst-ai")
              } catch (_) {
                  return null
              }
          })()
        : null

// provider: "transformers" → useWebAI   (catalyst-ai)
//           "native" | "litert" | "foundation-models"
//                          → useNativeAI (catalyst-ai, falls back to useCloudAI if bridge unavailable)
//           anything else  → useCloudAI  (catalyst-ai, default)
// The shape of this hook is owned by the catalyst-ai package and sits outside
// the native hook contract entirely, so its options and result stay loose here.
export function useAI(options: any = {}) {
    const { provider } = options
    const config = getBrowserConfig()
    const resolvedProvider = provider || config?.provider
    const auto = resolvedProvider === "auto"
    const mode = auto ? "cloud" : resolveMode(resolvedProvider)
    // The page's own view of the connection. It pauses a model download when the device goes offline and resumes it
    // when it returns; `download` (AI_CONFIG.browser.download) tunes what counts as a weak link.
    const network = useNetworkStatus()

    // Auto routing: the picked candidate drives which hook is configured. Nothing on-device is initialised (and so
    // nothing downloads) until a call is routed to it.
    const [selected, setSelected] = useState<Candidate | null>(null)
    const [route, setRoute] = useState<RouteDecision | null>(null)
    const pending = useRef<{ args: any; id: string; settle: (result: any) => void } | null>(null)
    const loadedId = useRef<string | null>(null)
    const observed = useRef<Record<string, Observed> | null>(null)
    const lastMetrics = useRef<any>(null)

    const nativeSel = auto && selected?.mode === "native" ? selected : null
    const webSel = auto && selected?.mode === "local" ? selected : null
    const cloudSel = auto && selected?.mode === "cloud" ? selected : null

    // allowMedia: image/audio go to a cloud provider only when the caller picked cloud explicitly (or auto routing
    // chose a cloud model under a policy that allowed it). A cloud hook that is only a fallback must refuse media.
    const cloudResult = _pkg
        ? _pkg.useCloudAI({
              ...options,
              ...(cloudSel && { provider: cloudSel.provider, model: cloudSel.model ?? options.model }),
              allowMedia: auto ? !!cloudSel : allowCloudMedia(mode),
          })
        : emptyHook()
    const webResult = _pkg
        ? _pkg.useWebAI({
              ...options,
              ...(webSel?.model && { model: webSel.model }),
              network: { online: network.online, type: network.type },
              ...(config?.download && { download: config.download }),
          })
        : emptyHook()
    const nativeResult = _pkg
        ? _pkg.useNativeAI({
              ...options,
              enabled: auto ? !!nativeSel : mode === "native",
              engine: auto ? nativeSel?.engine : resolveNativeEngine(resolvedProvider, options.engine, config),
              ...(nativeSel?.model !== undefined && { model: nativeSel.model }),
              ...(nativeSel?.modelPath !== undefined && { modelPath: nativeSel.modelPath }),
          })
        : emptyHook()

    const active: any = webSel ? webResult : nativeSel ? nativeResult : cloudResult

    // Run a call that was waiting for its model to be configured/initialised.
    const ready = nativeSel ? !!nativeResult.modelReady : true
    useEffect(() => {
        const p = pending.current
        if (!p || selected?.id !== p.id || !ready) return
        pending.current = null
        loadedId.current = selected.target === "onDevice" ? selected.id : loadedId.current
        Promise.resolve(active.generate(p.args)).then(p.settle, (error) => p.settle({ output: "", error }))
    })

    // Feed each finished call's metrics (the same ones useAI reports) back into the router.
    const metrics = active?.metrics
    useEffect(() => {
        if (!auto || !selected || !metrics || metrics === lastMetrics.current) return
        lastMetrics.current = metrics
        observed.current = observed.current || loadObserved()
        observed.current[selected.id] = recordObserved(observed.current[selected.id], metrics) as Observed
        saveObserved(observed.current)
    }, [metrics])

    if (typeof window === "undefined") return emptyHook()

    if (!_pkg) {
        console.error("\n[catalyst-core] useAI requires catalyst-ai.\n" + "Run: npm install catalyst-ai\n")
        return emptyHook()
    }

    if (auto) {
        // Routing runs per call, so the same hook can take text on-device and refuse to send a photo to the cloud.
        const generate = async (args: any, consent: Consent = {}) => {
            const platform = detectPlatform()
            const { policy, candidates } = normalizeRouting(getRoutingConfig(), platform, options.routing)
            const priced = candidates.map((c) => (c.target === "cloud" && !c.price && c.model && _pkg.PRICING?.[c.model] ? { ...c, price: _pkg.PRICING[c.model] } : c))
            const signals: Signals = {
                platform,
                nativeAvailable: !!isNativeAIAvailable(),
                webgpu: typeof navigator !== "undefined" && !!(navigator as any).gpu,
                online: typeof navigator === "undefined" || navigator.onLine !== false,
                webModelLoaded: !!webResult.modelReady,
                loadedId: loadedId.current,
            }
            observed.current = observed.current || loadObserved()
            const decision = chooseCandidate(modalitiesOf(args?.messages), priced, signals, policy, observed.current, consent)
            setRoute(decision)
            // Resolves with the underlying hook's { output, error } plus the routing decision. When nothing could run
            // ("ask" for consent, or "deny") it resolves at once with empty output and no error: read `route.action`.
            const withRoute = (result: any) => ({ ...(result || { output: "", error: null }), route: decision })
            if (decision.action !== "run" || !decision.candidate) return withRoute(null)
            const chosen = decision.candidate
            const same = selected?.id === chosen.id
            if (same && (chosen.mode !== "native" || nativeResult.modelReady)) {
                loadedId.current = chosen.target === "onDevice" ? chosen.id : loadedId.current
                return withRoute(await active.generate(args))
            }
            // The hooks are configured from `selected`; switch it and run once the new model is ready.
            // A call still waiting for an earlier switch is superseded, not left hanging.
            pending.current?.settle({ output: "", error: null })
            return new Promise((resolve) => {
                pending.current = { args, id: chosen.id, settle: (result) => resolve(withRoute(result)) }
                setSelected(chosen)
            })
        }
        return { ...active, generate, route, generateWithConsent: generate }
    }

    if (mode === "local") return webResult
    if (mode === "native" && isNativeAIAvailable()) return nativeResult
    return cloudResult
}

// Returned when catalyst-ai is missing — keeps hook shape stable so callers don't crash
function emptyHook() {
    return {
        output: "",
        streaming: false,
        loading: false,
        error: null,
        modelReady: false,
        downloadProgress: null,
        nativeDownloadProgress: null,
        nativeLogs: [],
        metrics: null,
        isLocal: false,
        isNative: false,
        isWeb: true,
        generate: () => {},
        cancel: () => {},
        reset: () => {},
        clearError: () => {},
        conversationId: null,
        getSessionMetrics: () => null,
        resetSessionMetrics: () => {},
    }
}
