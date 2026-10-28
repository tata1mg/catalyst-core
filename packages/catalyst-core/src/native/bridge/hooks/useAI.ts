/* global __CATALYST_PACKAGES__ */

import { useCallback, useRef, useState } from "react"
import { allowCloudMedia, mergeRouting, resolveMode, resolveNativeEngine, resolveRoute } from "./aiProviders.js"
import type { Modality, RouteDecision, RouteSignals } from "./aiProviders.js"

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
    const [routed, setRouted] = useState<RouteDecision | null>(null)
    const routedMode = useRef<"local" | "native" | "cloud" | null>(null)

    // allowMedia: image/audio go to a cloud provider only when the caller picked cloud explicitly. When native or web
    // was requested but is unavailable, the cloud hook is only a fallback and must refuse media.
    const cloudResult = _pkg ? _pkg.useCloudAI({ ...options, allowMedia: auto ? routedMode.current === "cloud" : allowCloudMedia(mode) }) : emptyHook()
    const webResult = _pkg ? _pkg.useWebAI(options) : emptyHook()
    const nativeResult = _pkg
        ? _pkg.useNativeAI({
              ...options,
              enabled: mode === "native" || auto,
              engine: resolveNativeEngine(resolvedProvider, options.engine, config),
          })
        : emptyHook()

    if (typeof window === "undefined") return emptyHook()

    if (!_pkg) {
        console.error("\n[catalyst-core] useAI requires catalyst-ai.\n" + "Run: npm install catalyst-ai\n")
        return emptyHook()
    }

    if (auto) {
        const pick = (m: "local" | "native" | "cloud" | null) =>
            m === "local" ? webResult : m === "native" ? nativeResult : cloudResult
        const active: any = pick(routedMode.current)
        const routing = mergeRouting(getRoutingConfig(), options.routing)
        const all = { text: true, image: true, audio: true }
        // Routing runs per call: the same hook can take text on-device and send nothing out, then refuse a photo.
        const generate = async (args: any, consent: { cloud?: boolean; download?: boolean } = {}) => {
            const online = typeof navigator === "undefined" || navigator.onLine !== false
            const signals: RouteSignals = {
                native: !!isNativeAIAvailable(),
                webgpu: typeof navigator !== "undefined" && !!(navigator as any).gpu,
                online,
                webModelCached: !!webResult.modelReady,
                caps: { native: all, local: all, cloud: all },
                cloudConfigured: true,
            }
            const decision = resolveRoute(modalitiesOf(args?.messages), signals, routing, consent)
            routedMode.current = decision.action === "run" ? decision.mode : null
            setRouted(decision)
            if (decision.action !== "run") return
            const target: any = pick(decision.mode)
            return target.generate(args)
        }
        return { ...active, generate, route: routed, generateWithConsent: generate }
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
