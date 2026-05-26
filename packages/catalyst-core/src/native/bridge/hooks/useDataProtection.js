/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useState, useCallback, useRef } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS } from "../constants/NativeInterfaces.js"
import { useBaseHook } from "../useBaseHook.js"
import { registerNativeHandlers } from "./utils.js"

export const useDataProtection = ({ webFallback } = {}) => {
    const base = useBaseHook("useDataProtection", { hasWebFallback: true, webFallback })
    const [screenSecure, setScreenSecureState] = useState(false)

    // Web fallback state — always declared (Rules of Hooks)
    const [screenSecureWeb, setScreenSecureWeb] = useState(false)
    const secureOverlayRef = useRef(null)

    useEffect(() => {
        if (!base.webFallbackActive || !screenSecureWeb) return

        const overlay = document.createElement("div")
        overlay.style.cssText =
            "position:fixed;inset:0;background:#000;z-index:2147483647;display:none"
        document.body.appendChild(overlay)
        secureOverlayRef.current = overlay

        const onVisibilityChange = () => {
            overlay.style.display = document.hidden ? "block" : "none"
        }
        document.addEventListener("visibilitychange", onVisibilityChange)

        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange)
            overlay.remove()
            secureOverlayRef.current = null
        }
    }, [base.webFallbackActive, screenSecureWeb])

    const webSetScreenSecure = useCallback((enable) => {
        setScreenSecureWeb(Boolean(enable))
    }, [])

    const webClearWebData = useCallback(async () => {
        try {
            localStorage.clear()
            sessionStorage.clear()
        } catch (_) { /* storage APIs unavailable */ }

        document.cookie.split(";").forEach((c) => {
            document.cookie = c.trim().split("=")[0] + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/"
        })

        if (window.indexedDB?.databases) {
            const dbs = await window.indexedDB.databases().catch(() => [])
            await Promise.all(dbs.map((db) => new Promise((res) => {
                const req = window.indexedDB.deleteDatabase(db.name)
                req.onsuccess = req.onerror = res
            })))
        }
    }, [])

    if (typeof window === "undefined") {
        return {
            screenSecure: false,
            setScreenSecure: () => {},
            clearWebData: () => {},
            data: null,
            loading: false,
            progress: null,
            error: null,
            isWeb: true,
            isNative: false,
            webFallbackActive: false,
            webFallbackDisabled: false,
            setWebFallback: () => {},
            clear: () => {},
            clearError: () => {},
        }
    }

    if (base.webFallbackDisabled) {
        return {
            screenSecure: false,
            setScreenSecure: () => {},
            clearWebData: () => {},
            data: null,
            loading: false,
            progress: null,
            error: null,
            isWeb: true,
            isNative: false,
            webFallbackActive: false,
            webFallbackDisabled: true,
            setWebFallback: base.setWebFallback,
            clear: () => {},
            clearError: () => {},
        }
    }

    if (base.webFallbackActive) {
        return {
            screenSecure: screenSecureWeb,
            setScreenSecure: webSetScreenSecure,
            clearWebData: webClearWebData,
            data: null,
            loading: false,
            progress: null,
            error: null,
            isWeb: true,
            isNative: false,
            webFallbackActive: true,
            webFallbackDisabled: false,
            setWebFallback: base.setWebFallback,
            clear: () => {},
            clearError: () => {},
        }
    }

    useEffect(() => {
        if (!nativeBridge.isAvailable()) return

        const handleScreenSecureSet = (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                if (result?.error) {
                    base.handleNativeError(result.error)
                    return
                }
                setScreenSecureState(Boolean(result?.secure))
                base.setDataAndComplete(result)
            } catch (error) {
                base.handleNativeError(error)
            }
        }

        const handleScreenSecureError = (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                base.handleNativeError(result?.error || "setScreenSecure failed")
            } catch (error) {
                base.handleNativeError(error)
            }
        }

        const handleWebDataCleared = (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                if (result?.error) {
                    base.handleNativeError(result.error)
                    return
                }
                base.setDataAndComplete(result)
            } catch (error) {
                base.handleNativeError(error)
            }
        }

        const handleWebDataClearError = (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                base.handleNativeError(result?.error || "clearWebData failed")
            } catch (error) {
                base.handleNativeError(error)
            }
        }

        const handleScreenSecureStatus = (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                if (result?.error) {
                    base.handleNativeError(result.error)
                    return
                }
                setScreenSecureState(Boolean(result?.secure))
            } catch (error) {
                base.handleNativeError(error)
            }
        }

        const cleanup = registerNativeHandlers([
            [NATIVE_CALLBACKS.ON_SCREEN_SECURE_SET, handleScreenSecureSet],
            [NATIVE_CALLBACKS.ON_SCREEN_SECURE_STATUS, handleScreenSecureStatus],
            [NATIVE_CALLBACKS.ON_SCREEN_SECURE_ERROR, handleScreenSecureError],
            [NATIVE_CALLBACKS.ON_WEB_DATA_CLEARED, handleWebDataCleared],
            [NATIVE_CALLBACKS.ON_WEB_DATA_CLEAR_ERROR, handleWebDataClearError],
        ])

        base.callNative(() => nativeBridge.security.getScreenSecure())

        return cleanup
    }, [base.setDataAndComplete, base.handleNativeError])

    const setScreenSecure = useCallback(
        (enable) => {
            base.callNative(() => nativeBridge.security.setScreenSecure(enable))
        },
        [base.callNative]
    )

    const clearWebData = useCallback(() => {
        base.callNative(() => nativeBridge.security.clearWebData())
    }, [base.callNative])

    return {
        data: base.data,
        loading: base.loading,
        progress: base.progress,
        error: base.error,
        isWeb: base.isWeb,
        isNative: base.isNative,
        webFallbackActive: false,
        webFallbackDisabled: false,
        setWebFallback: base.setWebFallback,
        clear: base.clear,
        clearError: base.clearError,
        screenSecure,
        setScreenSecure,
        clearWebData,
    }
}
