/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useState } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import type { HookEnvironment, WebFallbackOptions, WebFallbackState } from "../useBaseHook.js"

/** Device details reported by the native host, or derived from browser APIs on web. */
export interface DeviceInfo {
    model: string
    manufacturer: string
    platform: string
    screenWidth: number
    screenHeight: number
    screenDensity: number
    appInfo: any
}

/** What {@link useDeviceInfo} returns. Read-only: no action functions. */
export interface UseDeviceInfoResult extends HookEnvironment, WebFallbackState {
    /** The device details, or null until they resolve. */
    data: DeviceInfo | null
    /**
     * The device details.
     *
     * @deprecated Use `data` instead. `deviceInfo` is a deprecated alias kept
     * for backward compatibility and will be removed at 2.0.
     */
    deviceInfo: DeviceInfo | null
    /** True while the device details are being fetched. */
    loading: boolean
    /**
     * The failure message, or null.
     *
     * Note this is a plain string rather than a standard error object. That is
     * a known inconsistency with the rest of the hook contract, and it stays a
     * string until 2.0.
     */
    error: string | null
}

export const useDeviceInfo = ({ webFallback }: WebFallbackOptions = {}): UseDeviceInfoResult => {
    const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

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

    return {
        deviceInfo,
        data: deviceInfo,
        loading,
        error,
        isNative,
        isWeb: !isNative,
        webFallbackActive,
        webFallbackDisabled,
        setWebFallback,
    }
}
