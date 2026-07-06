/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useState, useCallback, useRef } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS, PERMISSION_STATUS } from "../constants/NativeInterfaces.js"
import { useBaseHook } from "../useBaseHook.js"

export const useCamera = ({ webFallback } = {}) => {
    const base = useBaseHook("useCamera", { hasWebFallback: true, webFallback })
    const [permission, setPermission] = useState(null)

    if (typeof window === "undefined") {
        return {
            data: null,
            loading: false,
            progress: null,
            error: null,
            isWeb: true,
            isNative: false,
            webFallbackActive: false,
            webFallbackDisabled: false,
            setWebFallback: () => {},
            execute: () => {},
            clear: () => {},
            clearError: () => {},
            permission: null,
            photo: null,
            takePhoto: () => {},
            isLoading: false,
            clearPhoto: () => {},
        }
    }

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
            permission: null,
            photo: null,
            takePhoto: () => {},
            isLoading: false,
            clearPhoto: () => {},
        }
    }

    // Web fallback callback — always declared (Rules of Hooks)
    const webTakePhoto = useCallback(() => {
        const input = document.createElement("input")
        input.type = "file"
        input.accept = "image/*"
        input.capture = "environment"

        input.onchange = () => {
            const file = input.files?.[0]
            if (!file) return
            const fileSrc = URL.createObjectURL(file)
            base.setDataAndComplete({
                fileSrc,
                fileName: file.name,
                size: file.size,
                mimeType: file.type,
                transport: "OBJECT_URL",
                source: "camera",
            })
        }

        input.click()
    }, [base])

    if (base.webFallbackActive) {
        return {
            data: base.data,
            loading: base.loading,
            progress: base.progress,
            error: base.error,
            isWeb: true,
            isNative: false,
            webFallbackActive: true,
            webFallbackDisabled: false,
            setWebFallback: base.setWebFallback,
            execute: webTakePhoto,
            clear: base.clear,
            clearError: base.clearError,
            permission: null,
            photo: base.data,
            takePhoto: webTakePhoto,
            isLoading: base.loading,
            clearPhoto: base.clear,
        }
    }

    useEffect(() => {
        window.WebBridge.register(NATIVE_CALLBACKS.ON_CAMERA_CAPTURE, (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                console.log("📷 Camera capture result:", result)

                const photoData = result.fileSrc
                    ? {
                          fileSrc: result.fileSrc,
                          fileName: result.fileName,
                          size: result.size,
                          mimeType: result.mimeType,
                          transport: result.transport,
                          source: result.source,
                      }
                    : {
                          fileSrc: result.imageUrl,
                          fileName: "camera_photo.jpg",
                          size: 0,
                          mimeType: "image/jpeg",
                          transport: "LEGACY",
                          source: "camera",
                      }

                base.setDataAndComplete(photoData)

                if (photoData.transport) {
                    base.updateProgress({
                        transport: photoData.transport,
                        bytesTotal: photoData.size || null,
                    })
                }

                console.log("📷 Photo captured successfully via transport:", photoData.transport)
            } catch (parseError) {
                console.error("📷 Error parsing camera capture data:", parseError)
                base.handleNativeError("Failed to process captured photo")
            }
        })

        window.WebBridge.register(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS, (data) => {
            setPermission(data)
            console.log("📷 Camera permission status:", data)
        })

        window.WebBridge.register(NATIVE_CALLBACKS.ON_CAMERA_ERROR, (data) => {
            console.error("📷 Camera error:", data)
            base.handleNativeError(data)
        })

        return () => {
            window.WebBridge.unregister(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_CAMERA_CAPTURE)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_CAMERA_ERROR)
        }
    }, [base.setDataAndComplete, base.handleNativeError, base.updateProgress])

    const takePhoto = () => {
        console.log("📷 Camera open requested")
        base.executeOperation(() => {
            base.updateProgress({
                state: "capturing",
                phase: "requesting",
                message: "Opening camera...",
            })
            nativeBridge.camera.open()
        }, "camera capture")
    }

    return {
        data: base.data,
        loading: base.loading,
        progress: base.progress,
        error: base.error,
        isWeb: base.isWeb,
        isNative: base.isNative,
        webFallbackActive: false,
        webFallbackDisabled: false,
        setWebFallback: base.setWebFallback,
        execute: takePhoto,
        clear: base.clear,
        clearError: base.clearError,
        permission,
        photo: base.data,
        takePhoto,
        isLoading: base.loading,
        clearPhoto: base.clear,
    }
}

export const requestCameraPermission = () => {
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

            const handlePermissionStatus = (data) => {
                window.WebBridge.unregister(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS)
                if (data === PERMISSION_STATUS.GRANTED) {
                    resolve(data)
                } else {
                    reject(new Error(`Camera permission ${data.toLowerCase()}`))
                }
            }

            window.WebBridge.register(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS, handlePermissionStatus)
            nativeBridge.camera.requestPermission()
            console.log("📷 Camera permission requested")
        } catch (error) {
            reject(error)
        }
    })
}

export const useCameraPermission = ({ webFallback } = {}) => {
    const isWeb = typeof window === "undefined" ? true : !nativeBridge.isAvailable()

    // All hooks unconditionally at top level (Rules of Hooks)
    const [webFallbackState, setWebFallback] = useState(true)
    const webFallbackResolved = webFallback !== undefined ? webFallback !== false : webFallbackState
    const webFallbackActive = isWeb && webFallbackResolved
    const webFallbackDisabled = isWeb && !webFallbackResolved
    const [permission, setPermission] = useState(null)
    const [isLoading, setIsLoading] = useState(true)
    const permResultRef = useRef(null)

    useEffect(() => {
        if (typeof window === "undefined") {
            setIsLoading(false)
            return
        }

        if (webFallbackDisabled) {
            setIsLoading(false)
            return
        }

        if (!window.WebBridge) {
            // Web fallback: navigator.permissions API (query only — never prompts)
            if (typeof navigator === "undefined" || !navigator.permissions) {
                setPermission(PERMISSION_STATUS.NOT_DETERMINED)
                setIsLoading(false)
                return
            }

            const PERM_MAP = {
                granted: PERMISSION_STATUS.GRANTED,
                denied: PERMISSION_STATUS.DENIED,
                prompt: PERMISSION_STATUS.NOT_DETERMINED,
            }

            navigator.permissions
                .query({ name: "camera" })
                .then((result) => {
                    permResultRef.current = result
                    setPermission(PERM_MAP[result.state] ?? PERMISSION_STATUS.NOT_DETERMINED)
                    setIsLoading(false)
                    result.onchange = () => {
                        setPermission(PERM_MAP[result.state] ?? PERMISSION_STATUS.NOT_DETERMINED)
                    }
                })
                .catch(() => {
                    setPermission(PERMISSION_STATUS.NOT_DETERMINED)
                    setIsLoading(false)
                })
            return
        }

        // Native path
        const requestPermission = async () => {
            try {
                if (!nativeBridge.isAvailable()) {
                    setPermission(PERMISSION_STATUS.NOT_DETERMINED)
                    setIsLoading(false)
                    return
                }

                window.WebBridge.register(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS, (data) => {
                    setPermission(data)
                    setIsLoading(false)
                    console.log("📷 Camera permission status updated:", data)
                })

                nativeBridge.camera.requestPermission()
            } catch (error) {
                console.error("📷 Error requesting camera permission:", error)
                setPermission(PERMISSION_STATUS.DENIED)
                setIsLoading(false)
            }
        }

        requestPermission()

        return () => {
            if (window.WebBridge && nativeBridge.isAvailable()) {
                window.WebBridge.unregister(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS)
            }
        }
    }, [webFallbackDisabled])

    // Web: navigator.permissions.query() never prompts. request() triggers getUserMedia
    // which causes the browser to show the permission dialog, then re-reads permission state.
    const request = useCallback(async () => {
        if (!isWeb || typeof window === "undefined") return
        if (!navigator.mediaDevices?.getUserMedia) return

        try {
            setIsLoading(true)
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
            stream.getTracks().forEach((t) => t.stop())
        } catch (_) {
            // Ignore — the permission state change fires via permResultRef.current.onchange
        }

        // Re-query to get the authoritative state after the prompt
        if (navigator.permissions) {
            try {
                const result = await navigator.permissions.query({ name: "camera" })
                const PERM_MAP = {
                    granted: PERMISSION_STATUS.GRANTED,
                    denied: PERMISSION_STATUS.DENIED,
                    prompt: PERMISSION_STATUS.NOT_DETERMINED,
                }
                setPermission(PERM_MAP[result.state] ?? PERMISSION_STATUS.NOT_DETERMINED)
            } catch (_) {
                /* permission query not supported */
            }
        }
        setIsLoading(false)
    }, [isWeb])

    if (typeof window === "undefined") {
        return {
            permission: null,
            isLoading: false,
            webFallbackActive: false,
            webFallbackDisabled: false,
            setWebFallback: () => {},
            request: () => {},
        }
    }

    return { permission, isLoading, webFallbackActive, webFallbackDisabled, setWebFallback, request }
}
