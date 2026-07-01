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

const _pkg = __CATALYST_PACKAGES__.cloudAI
    ? require(/* webpackIgnore: true */ "@catalyst/cloud-ai")
    : null

// provider: "transformers" → useWebAI   (@catalyst/cloud-ai)
//           "native"       → useNativeAI (@catalyst/cloud-ai, falls back to useCloudAI if bridge unavailable)
//           anything else  → useCloudAI  (@catalyst/cloud-ai, default)
export function useAI(options = {}) {
    const { provider } = options
    const config = getBrowserConfig()
    const resolvedProvider = provider || config?.provider
    const mode = resolveMode(resolvedProvider)

    const cloudResult = _pkg ? _pkg.useCloudAI(options) : emptyHook()
    const webResult = _pkg ? _pkg.useWebAI(options) : emptyHook()
    const nativeResult = _pkg ? _pkg.useNativeAI(options) : emptyHook()

    if (typeof window === "undefined") return emptyHook()

    if (!_pkg) {
        console.error(
            "\n[catalyst-core] useAI requires @catalyst/cloud-ai.\n" +
            "Run: npm install @catalyst/cloud-ai\n"
        )
        return emptyHook()
    }

    if (mode === "local") return webResult
    if (mode === "native" && isNativeAIAvailable()) return nativeResult
    return cloudResult
}

// Returned when @catalyst/cloud-ai is missing — keeps hook shape stable so callers don't crash
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
    }
}
