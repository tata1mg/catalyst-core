/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useState, useCallback, useRef } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS } from "../constants/NativeInterfaces.js"
import { useBaseHook } from "../useBaseHook.js"

const STREAM_STATE_DEFAULT = {
    zoom: null,
    minZoom: null,
    maxZoom: null,
    torchOn: false,
    fpsMin: null,
    fpsMax: null,
}

export const useVideoStream = ({ onQRDetected, webFallback } = {}) => {
    const base = useBaseHook("useVideoStream", { hasWebFallback: true, webFallback })

    // Native stream state
    const [isStreaming, setIsStreaming] = useState(false)
    const [streamState, setStreamState] = useState(STREAM_STATE_DEFAULT)
    const onQRDetectedRef = useRef(onQRDetected)
    onQRDetectedRef.current = onQRDetected
    const viewfinderRef = useRef(null)

    // Web fallback stream state — always declared (Rules of Hooks)
    const [isStreamingWeb, setIsStreamingWeb] = useState(false)
    const [streamStateWeb, setStreamStateWeb] = useState(STREAM_STATE_DEFAULT)
    const mediaStreamRef = useRef(null)
    const facingModeRef = useRef("environment")

    // Web fallback: stop active stream when webFallbackActive toggles off
    useEffect(() => {
        if (!base.webFallbackActive && mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((t) => t.stop())
            mediaStreamRef.current = null
            setIsStreamingWeb(false)
            setStreamStateWeb(STREAM_STATE_DEFAULT)
        }
    }, [base.webFallbackActive])

    // Web fallback: cleanup on unmount
    useEffect(() => {
        return () => {
            if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach((t) => t.stop())
                mediaStreamRef.current = null
            }
        }
    }, [])

    const applyTrackConstraints = useCallback(
        async (constraints) => {
            const track = mediaStreamRef.current?.getVideoTracks()[0]
            if (!track) return
            try {
                await track.applyConstraints(constraints)
            } catch (e) {
                base.setError({ message: `applyConstraints failed: ${e.message}` })
            }
        },
        [base]
    )

    const webStart = useCallback(
        async (options = {}) => {
            if (!window.isSecureContext) {
                base.setError({ message: "getUserMedia requires a secure context (HTTPS or localhost)" })
                return
            }
            if (!navigator.mediaDevices?.getUserMedia) {
                base.setError({ message: "getUserMedia is not available in this browser" })
                return
            }
            try {
                if (mediaStreamRef.current) return
                base.setLoading(true)
                const constraints = {
                    video: {
                        facingMode: { ideal: facingModeRef.current },
                        ...(options.fps ? { frameRate: { ideal: options.fps } } : {}),
                    },
                    audio: false,
                }
                const stream = await navigator.mediaDevices.getUserMedia(constraints)
                mediaStreamRef.current = stream
                setIsStreamingWeb(true)
                base.setLoading(false)

                const track = stream.getVideoTracks()[0]
                const caps = track?.getCapabilities?.() || {}
                setStreamStateWeb((prev) => ({
                    ...prev,
                    minZoom: caps.zoom?.min ?? null,
                    maxZoom: caps.zoom?.max ?? null,
                    zoom: caps.zoom?.min ?? null,
                }))
            } catch (e) {
                base.setLoading(false)
                base.setError({ message: e.message || "getUserMedia failed" })
            }
        },
        [base]
    )

    const webStop = useCallback(() => {
        if (!mediaStreamRef.current) return
        mediaStreamRef.current.getTracks().forEach((t) => t.stop())
        mediaStreamRef.current = null
        setIsStreamingWeb(false)
        setStreamStateWeb(STREAM_STATE_DEFAULT)
    }, [])

    const webFlip = useCallback(async () => {
        facingModeRef.current = facingModeRef.current === "environment" ? "user" : "environment"
        if (mediaStreamRef.current) {
            webStop()
            await webStart()
        }
    }, [webStart, webStop])

    const webSendCommand = useCallback(
        async (type, value) => {
            if (!isStreamingWeb) {
                base.setError({ message: `sendCommand('${type}') called but stream is not active` })
                return
            }
            switch (type) {
                case "zoom": {
                    if (typeof value !== "number" || value < 1.0) {
                        base.setError({
                            message: `sendCommand zoom: value must be a multiplier >= 1.0, got ${value}`,
                        })
                        return
                    }
                    await applyTrackConstraints({ advanced: [{ zoom: value }] })
                    setStreamStateWeb((prev) => ({ ...prev, zoom: value }))
                    break
                }
                case "torch": {
                    if (typeof value !== "boolean") {
                        base.setError({ message: `sendCommand torch: value must be boolean, got ${value}` })
                        return
                    }
                    await applyTrackConstraints({ advanced: [{ torch: value }] })
                    setStreamStateWeb((prev) => ({ ...prev, torchOn: value }))
                    break
                }
                case "fps": {
                    if (typeof value !== "object" || value === null) {
                        base.setError({
                            message: `sendCommand fps: value must be { min, max }, got ${value}`,
                        })
                        return
                    }
                    const { min = null, max = null } = value
                    const frameRate = {}
                    if (min !== null) frameRate.min = min
                    if (max !== null) frameRate.max = max
                    await applyTrackConstraints({ frameRate })
                    setStreamStateWeb((prev) => ({ ...prev, fpsMin: min, fpsMax: max }))
                    break
                }
                default:
                    base.setError({ message: `sendCommand: unknown type '${type}'` })
            }
        },
        [isStreamingWeb, applyTrackConstraints, base]
    )

    // Native event registration — skipped on web (WebBridge absent or native bridge unavailable)
    useEffect(() => {
        if (typeof window === "undefined" || !window.WebBridge || !nativeBridge.isAvailable()) return

        window.WebBridge.register(NATIVE_CALLBACKS.ON_VIDEO_STREAM_READY, () => {
            console.log("📹 Video stream ready")
            setIsStreaming(true)
        })

        window.WebBridge.register(NATIVE_CALLBACKS.ON_VIDEO_STREAM_STOPPED, () => {
            console.log("📹 Video stream stopped")
            setIsStreaming(false)
        })

        window.WebBridge.register(NATIVE_CALLBACKS.ON_QR_DETECTED, (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                console.log("📹 QR detected:", result)
                onQRDetectedRef.current?.(result)
            } catch (e) {
                base.handleNativeError("Failed to parse QR data")
            }
        })

        window.WebBridge.register(NATIVE_CALLBACKS.ON_TORCH_CHANGED, (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                const enabled = result?.enabled ?? false
                console.log("📹 Torch changed:", enabled)
                setStreamState((prev) => ({ ...prev, torchOn: enabled }))
            } catch (e) {
                console.warn("[useVideoStream] Failed to parse ON_TORCH_CHANGED data:", e)
            }
        })

        window.WebBridge.register(NATIVE_CALLBACKS.ON_ZOOM_CHANGED, (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                const zoom = result?.zoomLevel ?? null
                const minZoom = result?.minZoom ?? null
                const maxZoom = result?.maxZoom ?? null
                console.log("📹 Zoom changed:", zoom, `(min=${minZoom} max=${maxZoom})`)
                setStreamState((prev) => ({ ...prev, zoom, minZoom, maxZoom }))
            } catch (e) {
                console.warn("[useVideoStream] Failed to parse ON_ZOOM_CHANGED data:", e)
            }
        })

        const handleBeforeUnload = () => {
            nativeBridge.videoStream.stop()
        }
        window.addEventListener("beforeunload", handleBeforeUnload)

        return () => {
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_VIDEO_STREAM_READY)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_VIDEO_STREAM_STOPPED)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_QR_DETECTED)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_TORCH_CHANGED)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_ZOOM_CHANGED)
            window.removeEventListener("beforeunload", handleBeforeUnload)
            nativeBridge.videoStream.stop()
        }
    }, [base.handleNativeError])

    const nativeStart = useCallback(
        (options = {}) => {
            base.executeOperation(() => {
                console.log("[useVideoStream] start() options:", JSON.stringify(options))
                nativeBridge.videoStream.start(options)
            }, "start video stream")
        },
        [base.executeOperation]
    )

    const nativeStop = useCallback(() => {
        console.log("[useVideoStream] stop()")
        nativeBridge.videoStream.stop()
        setIsStreaming(false)
    }, [])

    const nativeFlip = useCallback(() => {
        console.log("[useVideoStream] flip()")
        nativeBridge.videoStream.flip()
    }, [])

    const nativeSendCommand = useCallback(
        (type, value) => {
            if (!isStreaming) {
                base.setError({ message: `sendCommand('${type}') called but stream is not active` })
                return
            }
            console.log(`[useVideoStream] sendCommand(${type}, ${value})`)
            switch (type) {
                case "zoom": {
                    if (typeof value !== "number" || value < 1.0) {
                        base.setError({
                            message: `sendCommand zoom: value must be a multiplier >= 1.0 (e.g. 1.0=1x, 2.0=2x), got ${value}`,
                        })
                        return
                    }
                    nativeBridge.videoStream.setZoom(value)
                    break
                }
                case "torch": {
                    if (typeof value !== "boolean") {
                        base.setError({ message: `sendCommand torch: value must be boolean, got ${value}` })
                        return
                    }
                    nativeBridge.videoStream.setTorch(value)
                    break
                }
                case "fps": {
                    if (typeof value !== "object" || value === null) {
                        base.setError({
                            message: `sendCommand fps: value must be { min, max }, got ${value}`,
                        })
                        return
                    }
                    const { min = null, max = null } = value
                    if (min !== null && (typeof min !== "number" || min < 1)) {
                        base.setError({
                            message: `sendCommand fps: min must be a positive number, got ${min}`,
                        })
                        return
                    }
                    if (max !== null && (typeof max !== "number" || max < 1)) {
                        base.setError({
                            message: `sendCommand fps: max must be a positive number, got ${max}`,
                        })
                        return
                    }
                    if (min !== null && max !== null && min > max) {
                        base.setError({ message: `sendCommand fps: min (${min}) must be <= max (${max})` })
                        return
                    }
                    nativeBridge.videoStream.setFps(min, max)
                    setStreamState((prev) => ({ ...prev, fpsMin: min, fpsMax: max }))
                    break
                }
                default:
                    base.setError({ message: `sendCommand: unknown type '${type}'` })
            }
        },
        [isStreaming, base.setError]
    )

    if (typeof window === "undefined") {
        return {
            isStreaming: false,
            streamState: STREAM_STATE_DEFAULT,
            error: null,
            isNative: false,
            webFallbackActive: false,
            webFallbackDisabled: false,
            setWebFallback: () => {},
            start: () => {},
            stop: () => {},
            sendCommand: () => {},
            flip: () => {},
            clearError: () => {},
        }
    }

    if (base.webFallbackDisabled) {
        return {
            isStreaming: false,
            streamState: STREAM_STATE_DEFAULT,
            error: null,
            isNative: false,
            webFallbackActive: false,
            webFallbackDisabled: true,
            setWebFallback: base.setWebFallback,
            start: () => {},
            stop: () => {},
            sendCommand: () => {},
            flip: () => {},
            clearError: () => {},
        }
    }

    if (base.webFallbackActive) {
        return {
            isStreaming: isStreamingWeb,
            streamState: streamStateWeb,
            error: base.error,
            isNative: false,
            webFallbackActive: true,
            webFallbackDisabled: false,
            setWebFallback: base.setWebFallback,
            mediaStream: mediaStreamRef.current,
            viewfinderRef,
            start: webStart,
            stop: webStop,
            sendCommand: webSendCommand,
            flip: webFlip,
            clearError: base.clearError,
        }
    }

    return {
        isStreaming,
        streamState,
        error: base.error,
        isNative: base.isNative,
        webFallbackActive: false,
        webFallbackDisabled: false,
        setWebFallback: base.setWebFallback,
        viewfinderRef,
        start: nativeStart,
        stop: nativeStop,
        sendCommand: nativeSendCommand,
        flip: nativeFlip,
        clearError: base.clearError,
    }
}
