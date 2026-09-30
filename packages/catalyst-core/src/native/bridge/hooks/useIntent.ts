/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS } from "../constants/NativeInterfaces.js"
import { useBaseHook } from "../useBaseHook.js"
import type { HookProgress, HookState } from "../useBaseHook.js"

/** What {@link useIntent} returns. Wraps one operation: opening a file externally. */
export interface UseIntentResult extends HookState {
    /** Progress of the in-flight intent, or null under SSR. */
    progress: HookProgress | null
    /** Open a file with an external app. The canonical action. */
    openFile: (fileUrl: string, mimeType?: string | null) => void
    /** Alias of `openFile`, named to match the shared hook contract. */
    execute: (fileUrl: string, mimeType?: string | null) => void
    /** Drop the current result and error. */
    clear: () => void
    /** Drop the current error, keeping any data. */
    clearError: () => void
    /** The current phase of the intent, or null when idle. */
    processingState: string | null
    /** True once the intent completed successfully, else null. */
    success: boolean | null
    /**
     * True while the intent is in flight.
     *
     * @deprecated Use `loading` instead. `isLoading` is a deprecated alias kept
     * for backward compatibility and will be removed at 2.0.
     */
    isLoading: boolean
    /**
     * Drop the current result and error.
     *
     * @deprecated Use `clear` instead. `reset` is a deprecated alias kept for
     * backward compatibility and will be removed at 2.0.
     */
    reset: () => void
}

export const useIntent = (): UseIntentResult => {
    const base = useBaseHook("useIntent")

    if (typeof window === "undefined") {
        return {
            data: null,
            loading: false,
            progress: null,
            error: null,
            isWeb: true,
            isNative: false,
            execute: () => {},
            clear: () => {},
            clearError: () => {},
            isLoading: false,
            processingState: null,
            openFile: () => {},
            success: null,
            reset: () => {},
        }
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.")
    }

    useEffect(() => {
        window.WebBridge.register(NATIVE_CALLBACKS.ON_INTENT_SUCCESS, (data) => {
            console.log("📄 Intent completed successfully:", data)
            base.setDataAndComplete({ result: data, success: true })
        })

        window.WebBridge.register(NATIVE_CALLBACKS.ON_INTENT_ERROR, (data) => {
            console.error("📄 Intent error:", data)
            base.handleNativeError(data)
        })

        window.WebBridge.register(NATIVE_CALLBACKS.ON_INTENT_CANCELLED, (data) => {
            console.log("📄 Intent cancelled:", data)
            base.setLoading(false)
            base.resetProgress()
        })

        return () => {
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_INTENT_SUCCESS)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_INTENT_ERROR)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_INTENT_CANCELLED)
        }
    }, [base.setDataAndComplete, base.handleNativeError, base.setLoading, base.resetProgress])

    const openFile = (fileUrl: string, mimeType: string | null = null) => {
        if (!fileUrl) {
            base.handleNativeError("File URL is required")
            return
        }

        console.log("📄 File open with intent requested:", { fileUrl, mimeType })

        base.executeOperation(() => {
            base.updateProgress({
                state: "opening_file",
                phase: "processing",
                message: "Opening file with external app...",
            })
            nativeBridge.file.openWithIntent(fileUrl, mimeType)
        }, "intent file open")
    }

    return {
        data: base.data,
        loading: base.loading,
        progress: base.progress,
        error: base.error,
        isWeb: base.isWeb,
        isNative: base.isNative,
        execute: openFile,
        clear: base.clear,
        clearError: base.clearError,
        isLoading: base.loading,
        processingState: base.progress?.phase || null,
        openFile,
        success: base.data?.success || null,
        reset: base.clear,
    }
}
