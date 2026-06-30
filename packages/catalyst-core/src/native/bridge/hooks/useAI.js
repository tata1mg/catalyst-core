import { useState, useEffect } from "react"

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

// provider: "transformers" → useWebAI   (@catalyst/cloud-ai)
//           "native"       → useNativeAI (@catalyst/cloud-ai)
//           anything else  → useCloudAI  (@catalyst/cloud-ai, default)
export function useAI(options = {}) {
    if (typeof window === "undefined") return emptyHook()

    const { provider } = options
    const config = getBrowserConfig()
    const resolvedProvider = provider || config?.provider
    const mode = resolveMode(resolvedProvider)

    if (!__CATALYST_PACKAGES__.cloudAI) {
        console.error(
            "\n[catalyst-core] useAI requires @catalyst/cloud-ai.\n" +
            "Run: npm install @catalyst/cloud-ai\n"
        )
        return emptyHook()
    }

    if (mode === "local") {
        const { useWebAI } = require(/* webpackIgnore: true */ "@catalyst/cloud-ai")
        return useWebAI(options)
    }

    if (mode === "native") {
        const { useNativeAI } = require(/* webpackIgnore: true */ "@catalyst/cloud-ai")
        return useNativeAI(options)
    }

    const { useCloudAI } = require(/* webpackIgnore: true */ "@catalyst/cloud-ai")
    return useCloudAI(options)
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
