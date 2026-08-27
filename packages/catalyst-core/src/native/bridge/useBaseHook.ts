import { useState, useCallback } from "react"
import nativeBridge from "./utils/NativeBridge.js"
import { translateError, isDevelopment } from "./errors"
import type { StandardError } from "./errors"

/**
 * Progress of a long-running native operation, as reported through the
 * `progress` key that every operation-carrying hook returns.
 */
export interface HookProgress {
    /** Coarse lifecycle state — see {@link PROGRESS_STATES}. */
    state: string
    /** Completion from 0-100, or null when the operation cannot report it. */
    percentage: number | null
    /** Human-readable status message, or null. */
    message: string | null
    /** Operation-specific phase, or null. */
    phase: string | null
    /** Transport the native side chose for the payload, or null. */
    transport: string | null
    /** Bytes transferred so far, or null. */
    bytesLoaded: number | null
    /** Total bytes expected, or null. */
    bytesTotal: number | null
}

/**
 * The runtime-context keys every native hook returns, whatever else it adds.
 *
 * `isNative` and `isWeb` are always complementary booleans, resolved live at
 * render time rather than cached from SSR.
 */
export interface HookEnvironment {
    /** True when running inside a native WebView with the bridge available. */
    isNative: boolean
    /** True when running on the plain web. Always `!isNative`. */
    isWeb: boolean
}

/**
 * The state contract shared by every native hook: the data/loading/error triple
 * plus the runtime-context keys.
 *
 * Two hooks are exempt from the `error` half — `useNativeTransition` and
 * `useSafeArea` return no `error` key at all — and two carry it with the wrong
 * type: `error` on `useDeviceInfo` and `useNetworkStatus` is a plain string
 * rather than a {@link StandardError}, and stays a string until 2.0.
 *
 * @typeParam TData - what the hook's `data` key holds.
 */
export interface HookState<TData = any> extends HookEnvironment {
    /** The hook's payload, or null before it has one. */
    data: TData | null
    /** True while a native operation is in flight. */
    loading: boolean
    /** The last error, or null. */
    error: StandardError | null
}

/** Options accepted by hooks that can fall back to a web implementation. */
export interface WebFallbackOptions {
    /**
     * Opt out of the hook's web fallback by passing `false`. When omitted, the
     * fallback is controlled imperatively through `setWebFallback` instead.
     */
    webFallback?: boolean
}

/** The web-fallback control keys returned by hooks that declare a fallback. */
export interface WebFallbackState {
    /** True when the hook is serving its web fallback implementation. */
    webFallbackActive: boolean
    /** True when on web and the fallback has been turned off. */
    webFallbackDisabled: boolean
    /** Imperatively enable or disable the web fallback. */
    setWebFallback: (enabled: boolean) => void
}

/** Configuration passed by a hook to {@link useBaseHook}. */
interface UseBaseHookOptions extends WebFallbackOptions {
    /** Whether this hook implements a web fallback at all. */
    hasWebFallback?: boolean
}

/**
 * Base hook utility that provides standardized interface for all Catalyst hooks
 * Handles environment detection, error standardization, and common state management
 *
 * @param hookName - Name of the hook for debugging purposes
 * @returns Base hook interface with common functionality
 */
export const useBaseHook = (
    hookName: string,
    { hasWebFallback = false, webFallback }: UseBaseHookOptions = {}
) => {
    // Environment detection — live check at call time, never stale from SSR
    const isNative = useCallback(() => {
        if (typeof window === "undefined") return false
        return !!(window.WebBridge && nativeBridge.isAvailable())
    }, [])

    const isWeb = useCallback(() => {
        return !isNative()
    }, [isNative])

    // Web fallback state — only meaningful when isWeb() and hook declared hasWebFallback:true
    // State tracks imperative setWebFallback() calls. The prop is the synchronous source of truth
    // when provided — prop wins so there is no async gap between prop change and disabled state.
    const [webFallbackState, setWebFallback] = useState(true)

    // When prop is explicitly provided, use it directly (synchronous). When undefined, fall back to state.
    const webFallbackResolved = webFallback !== undefined ? !!webFallback : webFallbackState
    const webFallbackActive = isWeb() && hasWebFallback && webFallbackResolved
    const webFallbackDisabled = isWeb() && hasWebFallback && !webFallbackResolved

    // Common state management
    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<StandardError | null>(null)
    const [progress, setProgress] = useState<HookProgress>({
        state: "idle", // 'idle' | 'opening' | 'processing' | 'routing' | 'complete' | 'error'
        percentage: null, // 0-100 or null
        message: null, // Human readable message or null
        phase: null, // Operation specific phase or null
        transport: null, // Transport method being used
        bytesLoaded: null, // Bytes processed
        bytesTotal: null, // Total bytes
    })

    // Progress management utilities
    const updateProgress = useCallback((updates: Partial<HookProgress>) => {
        setProgress((prev) => ({
            ...prev,
            ...updates,
        }))
    }, [])

    const resetProgress = useCallback(() => {
        setProgress({
            state: "idle",
            percentage: null,
            message: null,
            phase: null,
            transport: null,
            bytesLoaded: null,
            bytesTotal: null,
        })
    }, [])

    const startProgress = useCallback(
        (phase: string | null = null, message: string | null = null) => {
            updateProgress({
                state: "active",
                phase,
                message,
                percentage: null,
            })
        },
        [updateProgress]
    )

    const completeProgress = useCallback(() => {
        updateProgress({
            state: "complete",
            percentage: 100,
        })
    }, [updateProgress])

    const errorProgress = useCallback(() => {
        updateProgress({
            state: "error",
        })
    }, [updateProgress])

    // Error handling utilities
    const handleNativeError = useCallback(
        (nativeError: any): StandardError => {
            const standardError = translateError(nativeError)
            setError(standardError)
            setLoading(false)
            errorProgress()

            // Development logging
            if (isDevelopment()) {
                console.group(`🚨 ${hookName} Error`)
                console.log("Standard Error:", standardError)
                console.log("Native Error:", nativeError)
                console.groupEnd()
            }

            return standardError
        },
        [hookName, errorProgress]
    )

    const clearError = useCallback(() => {
        setError(null)
        if (progress.state === "error") {
            resetProgress()
        }
    }, [progress.state, resetProgress])

    // Data management utilities
    const setDataAndComplete = useCallback(
        (newData: any) => {
            setData(newData)
            setLoading(false)
            completeProgress()
            setError(null)

            if (isDevelopment()) {
                console.log("✅ Native hook success:", hookName, newData)
            }
        },
        [hookName, completeProgress]
    )

    const clear = useCallback(() => {
        setData(null)
        setError(null)
        resetProgress()

        if (isDevelopment()) {
            console.log(`🗑️ ${hookName} Cleared`)
        }
    }, [hookName, resetProgress])

    // Fire-and-forget native call — no-ops silently on web, routes errors through handleNativeError on native
    const callNative = useCallback(
        (fn: () => void) => {
            if (!isNative()) {
                if (isDevelopment()) {
                    console.warn(`${hookName} callNative skipped — not in native environment`)
                }
                return
            }
            try {
                fn()
            } catch (err) {
                if (isDevelopment()) {
                    console.warn("Native hook call failed silently:", hookName, err)
                }
            }
        },
        [hookName, isNative]
    )

    // Operation wrapper that handles common patterns
    const executeOperation = useCallback(
        (operationCallback: () => void, operationName = "operation") => {
            try {
                if (isWeb()) {
                    console.warn(`${hookName} requires web fallback implementation (isWeb: true)`)
                    return
                }

                if (!isNative()) {
                    console.error(`${hookName} executeOperation: Native bridge not available`)
                    return
                }

                setLoading(true)
                setError(null)
                startProgress("starting", `Starting ${operationName}...`)

                if (isDevelopment()) {
                    console.log(`🚀 ${hookName} ${operationName} started`)
                }

                // Execute the actual operation
                operationCallback()
            } catch (err) {
                handleNativeError(err)
                console.error("❌ Native hook operation failed:", hookName, operationName, err)
            }
        },
        [hookName, isWeb, isNative, startProgress, handleNativeError]
    )

    // Environment flags (computed values, not functions)
    const environmentFlags = {
        isWeb: isWeb(),
        isNative: isNative(),
    }

    // Return standardized interface
    return {
        // Data state
        data,

        // Loading states
        loading,
        progress,

        // Error handling
        error,

        // Environment detection
        ...environmentFlags,

        // Web fallback control
        webFallbackActive,
        webFallbackDisabled,
        setWebFallback,

        // Actions
        clear,
        clearError,

        // Internal utilities for specific hooks
        setData,
        setLoading,
        setError,
        setProgress,
        updateProgress,
        resetProgress,
        startProgress,
        completeProgress,
        errorProgress,
        setDataAndComplete,
        handleNativeError,
        callNative,
        executeOperation,
    }
}

/**
 * Hook for development debugging and testing
 * @param hookName
 * @returns Environment information and utilities
 */
export const useEnvironmentInfo = (hookName: string) => {
    const isNativeAvailable = () => {
        if (typeof window === "undefined") return false
        return !!(window.WebBridge && nativeBridge.isAvailable())
    }

    const getEnvironmentDetails = () => {
        const details: any = {
            hasWindow: typeof window !== "undefined",
            hasWebBridge: typeof window !== "undefined" && !!window.WebBridge,
            nativeBridgeAvailable: false,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "SSR",
            timestamp: new Date().toISOString(),
        }

        if (details.hasWebBridge) {
            details.nativeBridgeAvailable = nativeBridge.isAvailable()
        }

        return details
    }

    if (isDevelopment()) {
        console.log("🔍 Native hook environment:", hookName, getEnvironmentDetails())
    }

    return {
        isNative: isNativeAvailable(),
        isWeb: !isNativeAvailable(),
        environmentDetails: getEnvironmentDetails(),
    }
}

/**
 * Progress state constants for consistency across hooks
 */
export const PROGRESS_STATES = {
    // Common states
    IDLE: "idle",
    STARTING: "starting",
    COMPLETE: "complete",
    ERROR: "error",

    // File Picker states
    OPENING: "opening",
    PROCESSING: "processing",
    ROUTING: "routing",

    // Camera states
    REQUESTING: "requesting",
    CAPTURING: "capturing",

    // Intent states
    DOWNLOADING: "downloading",
    OPENING_FILE: "opening_file",

    // Server states
    CONNECTING: "connecting",
    UPLOADING: "uploading",
    SERVING: "serving",
}
