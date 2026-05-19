/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useState } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS } from "../constants/NativeInterfaces.js"
import { parseNativePayload } from "./utils.js"

export const useNetworkStatus = ({ webFallback } = {}) => {
    // navigator.onLine is unreliable in some dev/Electron environments — default true if undefined
    const initialOnline = typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : true
    const [status, setStatus] = useState({ online: initialOnline, type: null })
    const [error, setError] = useState(null)
    const isNative = nativeBridge.isAvailable()

    const [webFallbackState, setWebFallback] = useState(true)
    const webFallbackResolved = webFallback !== undefined ? webFallback !== false : webFallbackState
    const webFallbackActive = !isNative && webFallbackResolved
    const webFallbackDisabled = !isNative && !webFallbackResolved

    useEffect(() => {
        if (typeof window === "undefined") return

        if (!isNative) {
            if (webFallbackDisabled) return

            // Web fallback: browser online/offline events
            const handleOnline = () => setStatus({ online: true, type: null })
            const handleOffline = () => setStatus({ online: false, type: null })
            window.addEventListener("online", handleOnline)
            window.addEventListener("offline", handleOffline)
            return () => {
                window.removeEventListener("online", handleOnline)
                window.removeEventListener("offline", handleOffline)
            }
        }

        if (!window.WebBridge) return

        const handleStatus = (payload) => {
            try {
                const parsed = parseNativePayload(payload) || {}
                setStatus({ online: Boolean(parsed.online), type: parsed.type || null })
                setError(null)
            } catch (e) {
                console.error("🌐 Error parsing network status:", e)
                setError(e.message)
            }
        }

        window.WebBridge.register(NATIVE_CALLBACKS.NETWORK_STATUS_CHANGED, handleStatus)

        try {
            nativeBridge.network.getStatus()
        } catch (e) {
            setError(e.message || "Network status unavailable")
        }

        return () => {
            window.WebBridge.unregister(NATIVE_CALLBACKS.NETWORK_STATUS_CHANGED)
        }
    }, [isNative, webFallbackDisabled])

    return { ...status, error, isNative, isWeb: !isNative, webFallbackActive, webFallbackDisabled, setWebFallback }
}
