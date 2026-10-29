// On-device providers. "native" lets the platform pick (iOS: LiteRT-LM if its model is downloaded, else
// Apple Foundation Models, else LiteRT-LM); "litert" and "foundation-models" pin an engine. They can be set
// per call (useAI({ provider })) or app-wide in AI_CONFIG.browser.provider, optionally with
// AI_CONFIG.browser.engine instead of an alias.
const NATIVE_ENGINE_BY_PROVIDER: Record<string, string | undefined> = {
    native: undefined,
    litert: "litert",
    "foundation-models": "foundation-models",
}

/**
 * Which on-device target this page runs on. A page inside a native app (a WebView build) is that app's platform and is
 * never "web", whatever its user agent says; a phone browser (Safari, Chrome) has no native module and is "web".
 */
export function resolvePlatform(shell: { android: boolean; ios: boolean }): "ios" | "android" | "web" {
    if (shell.android) return "android"
    if (shell.ios) return "ios"
    return "web"
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

