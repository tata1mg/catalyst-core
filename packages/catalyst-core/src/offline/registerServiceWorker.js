let registered = false

function isNativeWebView() {
    if (typeof window === "undefined") return false
    return !!(window.NativeBridge || window.webkit?.messageHandlers?.NativeBridge)
}

export function registerCatalystServiceWorker() {
    if (registered) return
    if (typeof window === "undefined" || typeof navigator === "undefined") return
    if (process.env.NODE_ENV !== "production") return
    // Replaced at build time from config.json (see getClientEnvVariables).
    if (process.env.OFFLINE_SNAPSHOTS_ENABLE === false) return
    if (isNativeWebView()) return
    if (!("serviceWorker" in navigator)) return

    registered = true

    const register = () => {
        navigator.serviceWorker
            .register("/catalyst-sw.js", {
                scope: "/",
                updateViaCache: "none",
            })
            .catch(() => {
                registered = false
            })
    }

    if (document.readyState === "complete") {
        register()
    } else {
        window.addEventListener("load", register, { once: true })
    }
}
