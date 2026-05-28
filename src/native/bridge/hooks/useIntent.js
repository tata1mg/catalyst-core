/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS } from "../constants/NativeInterfaces.js"
import { useBaseHook } from "../useBaseHook.js"

export const useIntent = () => {
    const base = useBaseHook("useIntent")

    useEffect(() => {
        if (typeof window === "undefined" || !window.WebBridge) return

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

    const openFile = (fileUrl, mimeType = null) => {
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
