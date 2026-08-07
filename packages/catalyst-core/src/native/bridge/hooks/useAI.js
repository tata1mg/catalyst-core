/* global __CATALYST_PACKAGES__ */

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

function resolveMode(provider) {
    if (provider === "transformers") return "local"
    if (provider === "native") return "native"
    return "cloud"
}

function isNativeAIAvailable() {
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
//           "native"       → useNativeAI (catalyst-ai, falls back to useCloudAI if bridge unavailable)
//           anything else  → useCloudAI  (catalyst-ai, default)
export function useAI(options = {}) {
    const { provider } = options
    const config = getBrowserConfig()
    const resolvedProvider = provider || config?.provider
    const mode = resolveMode(resolvedProvider)

    const cloudResult = _pkg ? _pkg.useCloudAI(options) : emptyHook()
    const webResult = _pkg ? _pkg.useWebAI(options) : emptyHook()
    const nativeResult = _pkg ? _pkg.useNativeAI({ ...options, enabled: mode === "native" }) : emptyHook()

    if (typeof window === "undefined") return emptyHook()

    if (!_pkg) {
        console.error("\n[catalyst-core] useAI requires catalyst-ai.\n" + "Run: npm install catalyst-ai\n")
        return emptyHook()
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
        isWeb: false,
        generate: () => {},
        cancel: () => {},
        reset: () => {},
        clearError: () => {},
        conversationId: null,
        getSessionMetrics: () => null,
        resetSessionMetrics: () => {},
    }
}
