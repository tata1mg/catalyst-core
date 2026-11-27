/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useState } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS } from "../constants/NativeInterfaces.js"
import { parseNativePayload } from "./utils.js"
import type { HookEnvironment, WebFallbackOptions, WebFallbackState } from "../useBaseHook.js"

/**
 * What {@link useNetworkStatus} returns: connectivity spread at the top level,
 * plus the runtime-context keys.
 *
 * Read-only, so it has no action functions.
 */
export interface UseNetworkStatusResult extends HookEnvironment, WebFallbackState {
    /** True when the device reports a usable connection. */
    online: boolean
    /** Connection type reported by native, or null when unknown. */
    type: string | null
    /**
     * The failure message, or null.
     *
     * Note this is a plain string rather than a standard error object. That is
     * a known inconsistency with the rest of the hook contract, and it stays a
     * string until 2.0.
     */
    error: string | null
}

// WebBridge keeps ONE handler per callback name, and unregister() removes it for everyone. Registering per hook
// instance meant a second instance (the app's own plus the one inside useAI) silently replaced the first, and
// unmounting either one stopped the other from hearing about the network. So the native registration is shared:
// made when the first instance mounts, dropped when the last unmounts, and every instance gets every update.
const nativeListeners = new Set<(payload: any) => void>()

function subscribeToNativeNetwork(listener: (payload: any) => void): () => void {
    if (nativeListeners.size === 0) {
        window.WebBridge.register(NATIVE_CALLBACKS.NETWORK_STATUS_CHANGED, (payload: any) => {
            nativeListeners.forEach((l) => l(payload))
        })
    }
    nativeListeners.add(listener)
    return () => {
        nativeListeners.delete(listener)
        if (nativeListeners.size === 0) window.WebBridge.unregister(NATIVE_CALLBACKS.NETWORK_STATUS_CHANGED)
    }
}

export const useNetworkStatus = ({ webFallback }: WebFallbackOptions = {}): UseNetworkStatusResult => {
    // navigator.onLine is unreliable in some dev/Electron environments — default true if undefined
    const initialOnline =
        typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : true
    const [status, setStatus] = useState<{ online: boolean; type: string | null }>({
        online: initialOnline,
        type: null,
    })
    const [error, setError] = useState<string | null>(null)
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

        const handleStatus = (payload: any) => {
            try {
                const parsed = parseNativePayload(payload) || {}
                setStatus({ online: Boolean(parsed.online), type: parsed.type || null })
                setError(null)
            } catch (e: any) {
                console.error("🌐 Error parsing network status:", e)
                setError(e.message)
            }
        }

        const unsubscribe = subscribeToNativeNetwork(handleStatus)

        try {
            nativeBridge.network.getStatus()
        } catch (e: any) {
            setError(e.message || "Network status unavailable")
        }

        return unsubscribe
    }, [isNative, webFallbackDisabled])

    return {
        ...status,
        error,
        isNative,
        isWeb: !isNative,
        webFallbackActive,
        webFallbackDisabled,
        setWebFallback,
    }
}
