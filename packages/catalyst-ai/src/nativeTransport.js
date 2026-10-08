// How the browser talks to the native AI module, per platform.
//
// Android: window.NativeBridge.initAI(json) (a JavascriptInterface) — availability is a sync call.
// iOS:     WKScriptMessage has no return value, so commands go to the PluginBridge message handler
//          and availability is read from window.CatalystPlugins, which catalyst-core's iOS shell
//          injects at document start from the plugins composed into the build.
// In both cases native answers through window.WebBridge (ON_AI_READY / PROGRESS / LOG / ERROR).

export const AI_PLUGIN_ID = "io.catalyst.ai"

let requestCount = 0

function iosPluginBridge() {
    return typeof window !== "undefined" ? window.webkit?.messageHandlers?.PluginBridge : undefined
}

function hasIosAIPlugin() {
    return !!iosPluginBridge() && Array.isArray(window.CatalystPlugins?.[AI_PLUGIN_ID])
}

function postToIosPlugin(command, data) {
    iosPluginBridge().postMessage({
        pluginId: AI_PLUGIN_ID,
        command,
        data,
        requestId: `catalyst_ai_${Date.now()}_${++requestCount}`,
    })
}

/** "android" | "ios" | null — null means no native AI module in this build/environment. */
export function getNativeAIPlatform() {
    if (typeof window === "undefined") return null
    if (window.NativeBridge?.initAI) return "android"
    if (hasIosAIPlugin()) return "ios"
    return null
}

export function isNativeAIAvailable() {
    if (typeof window === "undefined") return false
    const nb = window.NativeBridge
    if (nb && typeof nb.isAIAvailable === "function") return !!nb.isAIAvailable()
    return hasIosAIPlugin()
}

/** Why native AI cannot be used here, for the AI-004 error message. */
export function describeNativeAIUnavailable() {
    if (iosPluginBridge()) {
        return (
            "The native AI plugin is not part of this iOS build. Set ai.enabled to true in WEBVIEW_CONFIG, " +
            "install catalyst-ai in the app, and rebuild the iOS app."
        )
    }
    return (
        "window.NativeBridge.initAI not found. Update catalyst-core to >=0.2.0 and add the android module " +
        "to settings.gradle.kts."
    )
}

/** options: { attachmentComponents, systemPrompt, engine?, model?, modelPath? } */
export function initNativeAI(options) {
    const platform = getNativeAIPlatform()
    if (platform === "android") {
        window.NativeBridge.initAI(JSON.stringify(options))
        return true
    }
    if (platform === "ios") {
        postToIosPlugin("initAI", options)
        return true
    }
    return false
}

export function clearNativeConversation() {
    const platform = getNativeAIPlatform()
    if (platform === "android") {
        window.NativeBridge.clearNativeConversation?.()
    } else if (platform === "ios") {
        postToIosPlugin("clearConversation", null)
    }
}

/**
 * Native errors carry a registry code (e.g. AI-003 invalid request, AI-005 stream not ready). Use it when it is a
 * code the registry knows (`isKnownCode`), otherwise fall back, so apps can tell failures apart without trusting
 * arbitrary strings from the native side.
 */
export function pickNativeErrorCode(code, fallback, isKnownCode) {
    return typeof code === "string" && code.startsWith("AI-") && isKnownCode(code) ? code : fallback
}
