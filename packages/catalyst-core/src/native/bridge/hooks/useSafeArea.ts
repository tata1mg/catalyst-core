/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useState } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { DEFAULT_INSETS, getSafeAreaFromGlobal, setSafeAreaGlobal } from "../safeArea.js"
import type { SafeAreaInsets } from "../safeArea.js"
import type { HookEnvironment, WebFallbackOptions, WebFallbackState } from "../useBaseHook.js"

/**
 * What {@link useSafeArea} returns: the four insets spread at the top level,
 * plus the runtime-context keys.
 *
 * Read-only, so it has no action functions, and it returns no `error` key —
 * insets always resolve to numeric defaults, so there is nothing to report.
 */
export interface UseSafeAreaResult extends SafeAreaInsets, HookEnvironment, WebFallbackState {}

export const useSafeArea = ({ webFallback }: WebFallbackOptions = {}): UseSafeAreaResult => {
    const fromGlobal = getSafeAreaFromGlobal()
    const initialValue = fromGlobal || { ...DEFAULT_INSETS }

    const [insets, setInsets] = useState(() => initialValue)

    const isNative = nativeBridge.isAvailable()
    const [webFallbackState, setWebFallback] = useState(true)
    const webFallbackResolved = webFallback !== undefined ? webFallback !== false : webFallbackState
    const webFallbackActive = !isNative && webFallbackResolved
    const webFallbackDisabled = !isNative && !webFallbackResolved

    useEffect(() => {
        if (typeof window === "undefined") return

        if (!nativeBridge.isAvailable()) {
            if (webFallbackDisabled) return

            // Web fallback: read CSS env() safe area insets (Safari notch support)
            const readCSSInsets = () => {
                const style = getComputedStyle(document.documentElement)
                const read = (prop: string) => {
                    const val = style.getPropertyValue(prop).trim()
                    return val ? parseFloat(val) || 0 : 0
                }
                const webInsets = {
                    top: read("--sat") || read("env(safe-area-inset-top)"),
                    right: read("--sar") || read("env(safe-area-inset-right)"),
                    bottom: read("--sab") || read("env(safe-area-inset-bottom)"),
                    left: read("--sal") || read("env(safe-area-inset-left)"),
                }
                setInsets(webInsets)
                setSafeAreaGlobal(webInsets)
            }
            const id = setTimeout(readCSSInsets, 0)
            return () => clearTimeout(id)
        }

        if (!window.WebBridge) return

        const handleInsetsUpdate = (data: any) => {
            try {
                const parsed = typeof data === "string" ? JSON.parse(data) : data
                const normalized = {
                    top: Number(parsed.top) || 0,
                    right: Number(parsed.right) || 0,
                    bottom: Number(parsed.bottom) || 0,
                    left: Number(parsed.left) || 0,
                }
                setInsets(normalized)
                setSafeAreaGlobal(normalized)
            } catch (error) {
                console.error("Error parsing safe area insets:", error)
                setInsets({ ...DEFAULT_INSETS })
            }
        }

        window.WebBridge.register("ON_SAFE_AREA_INSETS_UPDATED", handleInsetsUpdate)
        nativeBridge.safeArea.get()

        return () => {
            window.WebBridge.unregister("ON_SAFE_AREA_INSETS_UPDATED")
        }
    }, [webFallbackDisabled])

    return { ...insets, isNative, isWeb: !isNative, webFallbackActive, webFallbackDisabled, setWebFallback }
}
