/* global __CATALYST_PACKAGES__ */

import { useEffect, useRef, useState } from "react"
import { allowCloudMedia, isMobileWeb, resolveMode, resolveNativeEngine, resolveRoutingPlatform } from "./aiProviders.js"
import nativeBridge from "../utils/NativeBridge.js"
import { useNetworkStatus } from "./useNetworkStatus.js"
import { ERROR_CODES, createError } from "../../../errors/index.js"
import { createPendingSlot } from "./aiPending.js"
import { chooseCandidate, GENERATE_TASKS, modalitiesOf, recordObserved, routingFor, taskOf } from "./aiRouter.js"
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

// The public config is fixed at build time, so it is parsed once per distinct value, not on every render of every useAI.
let pricingRaw: string | undefined | null = null
let pricingParsed: any = null
let pricingApplied: any = undefined
function getPricingConfig() {
    const raw = process.env.AI_PUBLIC_CONFIG
    if (raw === pricingRaw) return pricingParsed
    pricingRaw = raw
    try {
        pricingParsed = raw ? JSON.parse(raw)?.pricing || null : null
    } catch (_) {
        pricingParsed = null
    }
    return pricingParsed
}

// Live checks, not the user agent: an iPhone Safari tab is a web target (it has no native module), a WebView build is not.
// A plain browser is further split into desktop and mobile, which is the only place the user agent is consulted.
function detectPlatform(): Platform {
    if (typeof window === "undefined") return "web-desktop"
    const nav: any = typeof navigator !== "undefined" ? navigator : {}
    const mobileWeb = isMobileWeb({ uaMobile: nav.userAgentData?.mobile, userAgent: nav.userAgent, platform: nav.platform, maxTouchPoints: nav.maxTouchPoints })
    return resolveRoutingPlatform({ android: nativeBridge._detectAndroid(), ios: nativeBridge._detectIOS() }, mobileWeb)
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
    // Prices the developer set in AI_CONFIG.pricing win over catalyst-ai's built-in table (idempotent; older catalyst-ai ignores it).
    // Only when the prices changed: setPricingOverrides normalises and replaces the whole table.
    const pricing = getPricingConfig()
    if (pricing !== pricingApplied) {
        _pkg?.setPricingOverrides?.(pricing)
        pricingApplied = pricing
    }

    // Auto routing: the picked candidate drives which hook is configured. Nothing on-device is initialised (and so
    // nothing downloads) until a call is routed to it.
    const [selected, setSelected] = useState<Candidate | null>(null)
    const [route, setRoute] = useState<RouteDecision | null>(null)
    const pending = useRef(createPendingSlot())
    // The error the hooks already carried when a call was parked: only a NEW error means the model it waits for failed to start.
    const errorWhenParked = useRef<unknown>(null)
    const loadedId = useRef<string | null>(null)
    const observed = useRef<Record<string, Observed> | null>(null)
    // The last metrics seen per candidate: every provider hook keeps its previous completion, so one shared marker would record an old
    // completion again each time the selection switches back and forth.
    const lastMetrics = useRef<Record<string, any>>({})

    const nativeSel = auto && selected?.mode === "native" ? selected : null
    const webSel = auto && selected?.mode === "local" ? selected : null
    const cloudSel = auto && selected?.mode === "cloud" ? selected : null

    // allowMedia: image/audio go to a cloud provider only when the caller picked cloud explicitly (or auto routing
    // chose a cloud model under a policy that allowed it). A cloud hook that is only a fallback must refuse media.
    const cloudResult = _pkg
        ? _pkg.useCloudAI({
              ...options,
              ...(cloudSel && { provider: cloudSel.provider, model: cloudSel.model ?? options.model }),
              allowMedia: auto ? !!cloudSel : allowCloudMedia(mode, resolvedProvider !== undefined),
          })
        : emptyHook()
    const webResult = _pkg
        ? _pkg.useWebAI({
              ...options,
              ...(webSel?.model && { model: webSel.model }),
              // "prompt-api" (Chrome's built-in model) from routing or provider: "prompt-api"; otherwise Transformers.js.
              engine: webSel?.engine === "prompt-api" || resolvedProvider === "prompt-api" ? "prompt-api" : "transformers",
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
              network: { online: network.online, type: network.type },
              ...(config?.download && { download: config.download }),
          })
        : emptyHook()

    const active: any = webSel ? webResult : nativeSel ? nativeResult : cloudResult

    // Run a call that was waiting for its model to be configured/initialised.
    // The native model must be the one that was selected, not just any that is ready: after a switch the old one can still be ready for a render.
    const nativeKey = nativeSel ? `${nativeSel.engine ?? ""}|${nativeSel.model ?? ""}|${nativeSel.modelPath ?? ""}` : null
    const nativeReadyFor = (key: string | null) => !!nativeResult.modelReady && nativeResult.readyKey === key
    const ready = nativeSel ? nativeReadyFor(nativeKey) : true
    useEffect(() => {
        const p = pending.current.takeIfReady(selected?.id, ready)
        if (p) {
            loadedId.current = selected?.target === "onDevice" ? selected.id : loadedId.current
            Promise.resolve(active.generate(p.args)).then(p.settle, (error) => p.settle({ output: "", error }))
            return
        }
        // The model it waits for failed to start: the call ends with that error, not never.
        if (!ready && active?.error && active.error !== errorWhenParked.current) pending.current.fail(selected?.id, active.error)
    })
    // Unmounting must not leave a parked call (and the images it holds) waiting for a model that will never be asked for it.
    useEffect(() => () => pending.current.cancel(), [])

    // Feed each finished call's metrics (the same ones useAI reports) back into the router.
    const metrics = active?.metrics
    useEffect(() => {
        if (!auto || !selected || !metrics || metrics === lastMetrics.current[selected.id]) return
        lastMetrics.current[selected.id] = metrics
        observed.current = observed.current || loadObserved()
        observed.current[selected.id] = recordObserved(observed.current[selected.id], metrics) as Observed
        saveObserved(observed.current)
    }, [metrics])

    if (typeof window === "undefined") return emptyHook()

    if (!_pkg) return notInstalledHook()

    if (auto) {
        // The routing decision for one call: availability, privacy, preference. `live` is for a caller that listens to the
        // microphone itself (useTranscribe.listen): it may be given the phone's speech recogniser, which cannot take a
        // recorded clip, so generate() never sees it. `extra` lets that caller report what only it knows (the shell's speech
        // support), because this hook must not subscribe to the shell itself.
        const decideFor = async (args: any, consent: Consent, live: boolean, extra: Partial<Signals> = {}): Promise<RouteDecision> => {
            const platform = detectPlatform()
            const rawRouting = getRoutingConfig()
            const { policy, candidates } = routingFor(rawRouting, platform, options.routing, live)
            const priceOf = (model: string) => _pkg.lookupPricing?.(model) ?? _pkg.PRICING?.[model]
            const priced = candidates.map((c) => (c.target === "cloud" && !c.price && c.model && priceOf(c.model) ? { ...c, price: priceOf(c.model) } : c))
            const signals: Signals = {
                platform,
                nativeAvailable: !!isNativeAIAvailable(),
                webgpu: typeof navigator !== "undefined" && !!(navigator as any).gpu,
                online: typeof navigator === "undefined" || navigator.onLine !== false,
                webModelLoaded: !!webResult.modelReady,
                // Which model, so that candidate B is not treated as downloaded just because A is loaded.
                webLoadedModel: webResult.modelReady ? (webResult.loadedModel ?? undefined) : null,
                promptApi: priced.some((c) => c.engine === "prompt-api") ? await _pkg.getPromptApiAvailability?.() : undefined,
                loadedId: loadedId.current,
                ...extra,
            }
            observed.current = observed.current || loadObserved()
            const pool = consent.pin ? priced.filter((c) => c.id === consent.pin) : priced
            return chooseCandidate(modalitiesOf(args?.messages), pool.length ? pool : priced, signals, policy, observed.current, consent, taskOf(args, options))
        }

        // Which engine would serve this call, without running it. Reads and writes nothing (no route state, no switch).
        const decide = (args: any, consent: Consent = {}, extra: Partial<Signals> = {}) => decideFor(args, consent, true, extra)

        // Routing runs per call, so the same hook can take text on-device and refuse to send a photo to the cloud.
        const generate = async (args: any, consent: Consent = {}) => {
            const task = taskOf(args, options)
            if (!GENERATE_TASKS.includes(task)) {
                // Routing could pick a model for this task, but generate() would still send an ordinary text request to it.
                const error = createError(ERROR_CODES.AI_INVALID_REQUEST_BODY, {
                    message: `generate() cannot run the "${task}" task: it takes messages and returns text. Use the call made for it (requestImage, requestSpeech, ...).`,
                })
                return { output: "", error, route: null }
            }
            const decision = await decideFor(args, consent, false)
            setRoute(decision)
            // Resolves with the underlying hook's { output, error } plus the routing decision. When nothing could run
            // ("ask" for consent, or "deny") it resolves at once with empty output and no error: read `route.action`.
            const withRoute = (result: any) => ({ ...(result || { output: "", error: null }), route: decision })
            if (decision.action !== "run" || !decision.candidate) return withRoute(null)
            const chosen = decision.candidate
            const same = selected?.id === chosen.id
            const chosenKey = `${chosen.engine ?? ""}|${chosen.model ?? ""}|${chosen.modelPath ?? ""}`
            if (same && (chosen.mode !== "native" || nativeReadyFor(chosenKey))) {
                loadedId.current = chosen.target === "onDevice" ? chosen.id : loadedId.current
                return withRoute(await active.generate(args))
            }
            // The hooks are configured from `selected`; switch it and run once the new model is ready.
            // A call still waiting for an earlier switch is superseded, not left hanging.
            return new Promise((resolve) => {
                errorWhenParked.current = nativeResult.error ?? webResult.error ?? cloudResult.error ?? null
                pending.current.park({ args, id: chosen.id, settle: (result) => resolve(withRoute(result)) })
                setSelected(chosen)
            })
        }
        // cancel() also ends a call parked for a model switch: otherwise it would still run, with its media, once the model arrived.
        const cancel = () => {
            pending.current.cancel()
            active.cancel?.()
        }
        return { ...active, unload: active.unload ?? (() => {}), decide, generate, route, generateWithConsent: generate, cancel }
    }

    // unload() frees an in-browser model from GPU/RAM; the other engines hold nothing in the page, so it is a no-op there.
    const withUnload = (r: any) => ({ ...r, unload: r.unload ?? (() => {}) })
    if (mode === "local") return webResult
    if (mode === "native" && isNativeAIAvailable()) return withUnload(nativeResult)
    return withUnload(cloudResult)
}

// Returned when catalyst-ai is missing — keeps hook shape stable so callers don't crash
const NOT_INSTALLED = "useAI requires catalyst-ai, which is not installed. Run: npm install catalyst-ai"
let notInstalledLogged = false

/**
 * What useAI returns when catalyst-ai is not installed. Importing the hooks and using everything else in catalyst-core works without it;
 * only an AI call needs the package. The hook reports the problem through `error`, and generate() answers with the same error instead of
 * doing nothing, so the app sees what to install wherever it looks.
 */
function notInstalledHook() {
    if (!notInstalledLogged) {
        notInstalledLogged = true
        console.error(`\n[catalyst-core] ${NOT_INSTALLED}\n`)
    }
    const error = Object.assign(new Error(NOT_INSTALLED), { code: "CATALYST_AI_NOT_INSTALLED" })
    return { ...emptyHook(), error, generate: async () => ({ output: "", error }) }
}

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
        unload: () => {},
        clearError: () => {},
        conversationId: null,
        getSessionMetrics: () => null,
        resetSessionMetrics: () => {},
    }
}
