/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useCallback } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS } from "../constants/NativeInterfaces.js"
import { useBaseHook } from "../useBaseHook.js"
import { ERROR_CODES, createStandardError } from "../errors.js"

export const useGoogleSignIn = (defaultOptions = {}) => {
    const base = useBaseHook("useGoogleSignIn")

    if (typeof window === "undefined") {
        return {
            data: null,
            loading: false,
            error: null,
            progress: null,
            isWeb: true,
            isNative: false,
            signIn: () => {},
            execute: () => {},
            clear: () => {},
            clearError: () => {},
        }
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.")
    }

    useEffect(() => {
        const handleSuccess = (payload) => {
            try {
                const parsed = typeof payload === "string" ? JSON.parse(payload) : payload
                base.setDataAndComplete(parsed)
            } catch (err) {
                base.handleNativeError(err)
            }
        }

        const handleError = (nativeError) => {
            base.handleNativeError(nativeError)
        }

        const handleCancelled = () => {
            const error = createStandardError(
                ERROR_CODES.OPERATION_CANCELLED,
                "Google sign-in cancelled",
                null,
                "User dismissed Google sign-in"
            )
            base.handleNativeError(error)
        }

        window.WebBridge.register(NATIVE_CALLBACKS.ON_GOOGLE_SIGN_IN_SUCCESS, handleSuccess)
        window.WebBridge.register(NATIVE_CALLBACKS.ON_GOOGLE_SIGN_IN_ERROR, handleError)
        window.WebBridge.register(NATIVE_CALLBACKS.ON_GOOGLE_SIGN_IN_CANCELLED, handleCancelled)

        return () => {
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_GOOGLE_SIGN_IN_SUCCESS)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_GOOGLE_SIGN_IN_ERROR)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_GOOGLE_SIGN_IN_CANCELLED)
        }
    }, [base])

    const signIn = useCallback(
        (options = {}) => {
            base.executeOperation(() => {
                const payload = { ...defaultOptions, ...options }
                nativeBridge.auth.googleSignIn(payload)
            }, "google sign-in")
        },
        [base, defaultOptions]
    )

    return {
        data: base.data,
        loading: base.loading,
        progress: base.progress,
        error: base.error,
        isWeb: base.isWeb,
        isNative: base.isNative,
        signIn,
        execute: signIn,
        clear: base.clear,
        clearError: base.clearError,
    }
}
