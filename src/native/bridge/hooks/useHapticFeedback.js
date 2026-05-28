/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useState } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS, RESPONSE_STATUS } from "../constants/NativeInterfaces.js"
import { useBaseHook } from "../useBaseHook.js"
import { ERROR_CODES, createStandardError } from "../errors.js"

export const requestHapticFeedback = (feedbackType = "light") => {
    if (typeof window === "undefined") {
        return Promise.resolve(null)
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.")
    }

    return new Promise((resolve, reject) => {
        try {
            if (!nativeBridge.isAvailable()) {
                reject(new Error("Native bridge not available"))
                return
            }

            const handleHapticResponse = (data) => {
                window.WebBridge.unregister(NATIVE_CALLBACKS.HAPTIC_FEEDBACK)
                if (data === RESPONSE_STATUS.SUCCESS) {
                    resolve(data)
                } else {
                    reject(new Error(`Haptic feedback failed: ${data}`))
                }
            }

            window.WebBridge.register(NATIVE_CALLBACKS.HAPTIC_FEEDBACK, handleHapticResponse)
            nativeBridge.haptic.feedback(feedbackType)
            console.log("📳 Haptic feedback requested:", feedbackType)
        } catch (error) {
            reject(error)
        }
    })
}

const detectHapticCapabilities = (isNative) => {
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : ""
    if (isNative) {
        const platform = userAgent.includes("android")
            ? "android"
            : userAgent.includes("iphone") || userAgent.includes("ipad")
            ? "ios"
            : "native"
        const availableTypes =
            platform === "ios"
                ? ["light", "medium", "heavy", "success", "warning", "error", "selection", "impact"]
                : ["light", "medium", "heavy"]
        return { isSupported: true, availableTypes, platform }
    }
    const isSupported = typeof navigator !== "undefined" && "vibrate" in navigator
    return {
        isSupported,
        availableTypes: isSupported ? ["light", "medium", "heavy"] : [],
        platform: "web",
    }
}

export const useHapticFeedback = ({ webFallback } = {}) => {
    const base = useBaseHook("useHapticFeedback", { hasWebFallback: true, webFallback })
    const [capabilities, setCapabilities] = useState(() => detectHapticCapabilities(base.isNative))

    const HAPTIC_TYPES = {
        LIGHT: "light",
        MEDIUM: "medium",
        HEAVY: "heavy",
        SUCCESS: "success",
        WARNING: "warning",
        ERROR: "error",
        SELECTION: "selection",
        IMPACT: "impact",
    }

    useEffect(() => {
        setCapabilities(detectHapticCapabilities(base.isNative))
    }, [base.isNative])

    if (base.webFallbackDisabled) {
        return {
            data: null,
            loading: false,
            progress: null,
            error: null,
            isWeb: true,
            isNative: false,
            webFallbackActive: false,
            webFallbackDisabled: true,
            setWebFallback: base.setWebFallback,
            execute: () => {},
            clear: () => {},
            clearError: () => {},
            triggerHaptic: () => {},
            trigger: () => {},
            light: () => {},
            medium: () => {},
            heavy: () => {},
            success: () => {},
            warning: () => {},
            errorHaptic: () => {},
            selection: () => {},
            impact: () => {},
            capabilities: { isSupported: false, availableTypes: [], platform: "web" },
            isSupported: false,
            isAvailable: false,
            availableTypes: [],
            HAPTIC_TYPES: {},
        }
    }

    const handleWebHaptic = (type) => {
        if (!navigator.vibrate) return false

        const vibrationPatterns = {
            [HAPTIC_TYPES.LIGHT]: [50],
            [HAPTIC_TYPES.MEDIUM]: [100],
            [HAPTIC_TYPES.HEAVY]: [200],
            [HAPTIC_TYPES.SUCCESS]: [100, 50, 100],
            [HAPTIC_TYPES.WARNING]: [200, 100, 200],
            [HAPTIC_TYPES.ERROR]: [300, 100, 300, 100, 300],
            [HAPTIC_TYPES.SELECTION]: [25],
            [HAPTIC_TYPES.IMPACT]: [150],
        }

        navigator.vibrate(vibrationPatterns[type] || [100])
        return true
    }

    const handleHapticTrigger = async (type, options = {}) => {
        try {
            base.setLoading(true)
            base.updateProgress({
                state: "active",
                phase: "triggering",
                message: `Triggering ${type} haptic feedback...`,
            })

            const success = base.isNative
                ? await requestHapticFeedback(type)
                : handleWebHaptic(type, options)

            base.setDataAndComplete({
                lastType: type,
                lastOptions: options,
                timestamp: new Date().toISOString(),
                success,
                capabilities,
                lastOperation: "trigger",
                operationSuccess: success,
            })
            return success
        } catch (error) {
            console.error("📳 Haptic feedback failed:", error)
            base.handleNativeError(error)
            return false
        }
    }

    const executeHaptic = (type = "light", options = {}) => {
        if (!capabilities.isSupported) {
            base.handleNativeError(
                createStandardError(
                    ERROR_CODES.FEATURE_UNSUPPORTED,
                    "Haptic feedback not supported",
                    null,
                    "Device does not support haptic feedback"
                )
            )
            return
        }
        return handleHapticTrigger(type, options)
    }

    return {
        data: base.data,
        loading: base.loading,
        progress: base.progress,
        error: base.error,
        isWeb: base.isWeb,
        isNative: base.isNative,
        webFallbackActive: base.webFallbackActive,
        webFallbackDisabled: false,
        setWebFallback: base.setWebFallback,
        clear: base.clear,
        clearError: base.clearError,
        execute: executeHaptic,
        triggerHaptic: executeHaptic,
        trigger: executeHaptic,
        light: () => executeHaptic(HAPTIC_TYPES.LIGHT),
        medium: () => executeHaptic(HAPTIC_TYPES.MEDIUM),
        heavy: () => executeHaptic(HAPTIC_TYPES.HEAVY),
        success: () => executeHaptic(HAPTIC_TYPES.SUCCESS),
        warning: () => executeHaptic(HAPTIC_TYPES.WARNING),
        errorHaptic: () => executeHaptic(HAPTIC_TYPES.ERROR),
        selection: () => executeHaptic(HAPTIC_TYPES.SELECTION),
        impact: () => executeHaptic(HAPTIC_TYPES.IMPACT),
        capabilities,
        isSupported: capabilities.isSupported,
        isAvailable: capabilities.isSupported,
        availableTypes: capabilities.availableTypes,
        HAPTIC_TYPES,
    }
}
