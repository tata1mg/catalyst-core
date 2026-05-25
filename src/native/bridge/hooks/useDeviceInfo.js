/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useState } from "react"
import nativeBridge from "../utils/NativeBridge.js"

export const useDeviceInfo = ({ webFallback } = {}) => {
    const [deviceInfo, setDeviceInfo] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const isNative = nativeBridge.isAvailable()
    const [webFallbackState, setWebFallback] = useState(true)
    const webFallbackResolved = webFallback !== undefined ? webFallback !== false : webFallbackState
    const webFallbackActive = !isNative && webFallbackResolved
    const webFallbackDisabled = !isNative && !webFallbackResolved

    useEffect(() => {
        if (typeof window === "undefined") {
            setLoading(false)
            return
        }

        if (!nativeBridge.isAvailable()) {
            if (webFallbackDisabled) {
                setLoading(false)
                return
            }
            // Web fallback: derive info from browser APIs
            const ua = navigator.userAgent || ""
            setDeviceInfo({
                model: ua,
                manufacturer: "browser",
                platform: "web",
                screenWidth: screen.width * (window.devicePixelRatio || 1),
                screenHeight: screen.height * (window.devicePixelRatio || 1),
                screenDensity: window.devicePixelRatio || 1,
                appInfo: null,
            })
            setLoading(false)
            return
        }

        if (!window.WebBridge) {
            setError("WebBridge not initialized")
            setLoading(false)
            return
        }

        window.WebBridge.getDeviceInfo()
            .then((info) => {
                setDeviceInfo(info)
                setLoading(false)
            })
            .catch((err) => {
                setError(err.message || "Failed to get device info")
                setLoading(false)
            })
    }, [webFallbackDisabled])

    return { deviceInfo, loading, error, isNative, isWeb: !isNative, webFallbackActive, webFallbackDisabled, setWebFallback }
}
