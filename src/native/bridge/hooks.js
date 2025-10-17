/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useState, useCallback, useRef, useMemo } from "react"
import nativeBridge from "./utils/NativeBridge.js"
import { NATIVE_CALLBACKS, PERMISSION_STATUS, RESPONSE_STATUS } from "./constants/NativeInterfaces.js"
import { useBaseHook } from "./useBaseHook.js"
import { ERROR_CODES, createStandardError } from "./errors.js"
import {
    base64ToFile,
    urlToFile,
    canCreateFileObject,
    getUnsupportedTransportMessage,
} from "./utils/FileObjectConverter.js"

const noop = () => {}
const createSSRUnavailable = (methodName) => async () => {
    throw new Error(`${methodName} is not available in SSR environment`)
}

const SSR_FILE_PICKER_STUB = {
    data: null,
    loading: false,
    progress: null,
    error: null,
    isWeb: true,
    isNative: false,
    execute: noop,
    clear: noop,
    clearError: noop,
    getFileObject: createSSRUnavailable("getFileObject"),
    getAllFileObjects: createSSRUnavailable("getAllFileObjects"),
    canCreateFileObject: false,
    canCreateFileObjects: [],
    selectedFile: null,
    selectedFiles: [],
    pickFile: noop,
    isLoading: false,
    processingState: null,
    clearFile: noop,
}

const parseNativePayload = (payload) => (typeof payload === "string" ? JSON.parse(payload) : payload)

const filesFromPayload = (payload) => {
    if (!payload) return []
    if (Array.isArray(payload)) return payload.filter(Boolean)

    if (Array.isArray(payload.files)) {
        return payload.files.filter(Boolean)
    }

    if (payload.files) {
        return [payload.files].filter(Boolean)
    }

    return [payload].filter(Boolean)
}

const defaultFileMeta = (file) => ({
    fileName: file?.fileName ?? file?.name ?? null,
    fileSrc: file?.fileSrc ?? null,
    filePath: file?.filePath ?? null,
    size: file?.size ?? null,
    mimeType: file?.mimeType ?? null,
    transport: file?.transport ?? null,
})

const normalizeFilePayload = (payload) => {
    if (!payload) return null

    const files = filesFromPayload(payload)
    if (!files.length) return null

    const firstFileMeta = defaultFileMeta(files[0])
    const totalSize = files.reduce((sum, file) => sum + (file?.size || 0), 0)
    const override = Array.isArray(payload) ? {} : payload
    const count = override.count ?? files.length

    return {
        ...override,
        files,
        multiple: override.multiple ?? files.length > 1,
        count,
        totalSize: override.totalSize ?? totalSize,
        fileName: override.fileName ?? firstFileMeta.fileName,
        fileSrc: override.fileSrc ?? firstFileMeta.fileSrc,
        filePath: override.filePath ?? firstFileMeta.filePath,
        size: override.size ?? firstFileMeta.size,
        mimeType: override.mimeType ?? firstFileMeta.mimeType,
        transport: override.transport ?? firstFileMeta.transport,
    }
}

const updateProgressFromNormalizedData = (updateProgress, normalizedData) => {
    if (!normalizedData) return

    const transport = normalizedData.transport ?? normalizedData.files?.[0]?.transport ?? null
    const bytesTotal =
        normalizedData.totalSize ?? normalizedData.size ?? normalizedData.files?.[0]?.size ?? null

    if (transport) {
        updateProgress({
            transport,
            bytesTotal,
        })
    }
}

const mapStateToProgress = (state) => {
    if (state == null) {
        return {
            state: "starting",
            phase: null,
            message: "File picker: starting...",
        }
    }

    const rawState = String(state)
    const normalized = rawState.toLowerCase()
    const allowedStates = new Set(["opening", "processing", "routing"])
    const progressState = allowedStates.has(normalized) ? normalized : "starting"

    return {
        state: progressState,
        phase: rawState,
        message: `File picker: ${rawState}...`,
    }
}

const resolvePickRequest = (input) => {
    if (input == null) {
        return {
            payload: "*/*",
            mimeType: "*/*",
        }
    }

    if (typeof input === "string") {
        return {
            payload: input || "*/*",
            mimeType: input || "*/*",
        }
    }

    const normalized = { ...input }
    const mimeType =
        typeof normalized.mimeType === "string" && normalized.mimeType.trim().length > 0
            ? normalized.mimeType
            : "*/*"

    normalized.mimeType = mimeType

    return {
        payload: normalized,
        mimeType,
    }
}

const registerNativeHandlers = (handlers) => {
    handlers.forEach(([event, handler]) => window.WebBridge.register(event, handler))
    return () => {
        handlers.forEach(([event]) => window.WebBridge.unregister(event))
    }
}

/**
 * React hook for camera functionality using standardized interface
 * Handles camera permissions, photo capture, and error states
 */
export const useCamera = () => {
    // Use standardized base hook
    const base = useBaseHook("useCamera")

    // Camera-specific state
    const [permission, setPermission] = useState(null)

    // Server-side rendering safety
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
            permission: null,
            // Legacy aliases
            photo: null,
            takePhoto: () => {},
            isLoading: false,
            clearPhoto: () => {},
        }
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.")
    }

    useEffect(() => {
        // Register callback handlers
        window.WebBridge.register(NATIVE_CALLBACKS.ON_CAMERA_CAPTURE, (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                console.log("📷 Camera capture result:", result)

                // Handle new tri-transport format or legacy format
                const photoData = result.fileSrc
                    ? {
                          // New tri-transport format
                          fileSrc: result.fileSrc,
                          fileName: result.fileName,
                          size: result.size,
                          mimeType: result.mimeType,
                          transport: result.transport,
                          source: result.source,
                      }
                    : {
                          // Legacy format (fallback)
                          fileSrc: result.imageUrl,
                          fileName: "camera_photo.jpg",
                          size: 0,
                          mimeType: "image/jpeg",
                          transport: "LEGACY",
                          source: "camera",
                      }

                base.setDataAndComplete(photoData)

                // Update progress with transport info if available
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
            // Cleanup: unregister all handlers
            window.WebBridge.unregister(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_CAMERA_CAPTURE)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_CAMERA_ERROR)
        }
    }, [base.setDataAndComplete, base.handleNativeError, base.updateProgress])

    const takePhoto = () => {
        console.log("📷 Camera open requested")

        base.executeOperation(() => {
            // Update progress to show capturing state
            base.updateProgress({
                state: "capturing",
                phase: "requesting",
                message: "Opening camera...",
            })
            nativeBridge.camera.open()
        }, "camera capture")
    }

    // Standardized execute function (new interface)
    const execute = takePhoto

    return {
        // Standardized interface
        data: base.data,
        loading: base.loading,
        progress: base.progress,
        error: base.error,
        isWeb: base.isWeb,
        isNative: base.isNative,
        execute,
        clear: base.clear,
        clearError: base.clearError,

        // Camera-specific extras
        permission,

        // Legacy aliases for backward compatibility
        photo: base.data,
        takePhoto,
        isLoading: base.loading,
        clearPhoto: base.clear,
    }
}

/**
 * React hook for intent handling using standardized interface
 * Manages file opening operations with external apps
 */
export const useIntent = () => {
    // Use standardized base hook
    const base = useBaseHook("useIntent")

    // Server-side rendering safety
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
            // Legacy aliases
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
        // Register callback handlers
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
            // Keep data as is when cancelled
        })

        return () => {
            // Cleanup: unregister all handlers
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
            // Update progress to show opening state
            base.updateProgress({
                state: "opening_file",
                phase: "processing",
                message: "Opening file with external app...",
            })
            nativeBridge.file.openWithIntent(fileUrl, mimeType)
        }, "intent file open")
    }

    // Standardized execute function (new interface)
    const execute = openFile

    return {
        // Standardized interface
        data: base.data,
        loading: base.loading,
        progress: base.progress,
        error: base.error,
        isWeb: base.isWeb,
        isNative: base.isNative,
        execute,
        clear: base.clear,
        clearError: base.clearError,

        // Legacy aliases for backward compatibility
        isLoading: base.loading,
        processingState: base.progress?.phase || null,
        openFile,
        success: base.data?.success || null,
        reset: base.clear,
    }
}

/**
 * React hook for file picker functionality
 * Manages file selection operations using standardized interface
 */
export const useFilePicker = () => {
    // Use standardized base hook
    const base = useBaseHook("useFilePicker")

    // Cache for converted File objects to prevent redundant conversions
    const fileObjectCache = useRef(new Map())

    // Server-side rendering safety
    if (typeof window === "undefined") {
        return SSR_FILE_PICKER_STUB
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.")
    }

    const {
        data,
        loading,
        progress,
        error,
        isWeb,
        isNative,
        clear: baseClear,
        clearError,
        updateProgress,
        resetProgress,
        setDataAndComplete,
        handleNativeError,
        executeOperation,
        setLoading,
    } = base

    useEffect(() => {
        const handleFilePicked = (data) => {
            try {
                const fileData = parseNativePayload(data)
                console.log("📁 File picked:", fileData)

                fileObjectCache.current.clear()

                const normalizedData = normalizeFilePayload(fileData)
                if (!normalizedData) {
                    throw new Error("No file data received from native file picker")
                }

                setDataAndComplete(normalizedData)
                updateProgressFromNormalizedData(updateProgress, normalizedData)
            } catch (parseError) {
                console.error("📁 Error parsing file data:", parseError)
                handleNativeError("Error processing selected file")
            }
        }

        const handleFilePickError = (nativeError) => {
            console.error("📁 File pick error:", nativeError)
            handleNativeError(nativeError)
        }

        const handleFilePickCancelled = (data) => {
            console.log("📁 File pick cancelled:", data)
            setLoading(false)
            resetProgress()
        }

        const handleFilePickStateUpdate = (stateData) => {
            try {
                const parsedState = parseNativePayload(stateData)
                console.log("📁 File picker state:", parsedState?.state)

                const progressUpdate = mapStateToProgress(parsedState?.state)
                updateProgress(progressUpdate)

                if (parsedState?.state) {
                    setLoading(true)
                }
            } catch (parseError) {
                console.error("📁 Error parsing state data:", parseError)
            }
        }

        return registerNativeHandlers([
            [NATIVE_CALLBACKS.ON_FILE_PICKED, handleFilePicked],
            [NATIVE_CALLBACKS.ON_FILE_PICK_ERROR, handleFilePickError],
            [NATIVE_CALLBACKS.ON_FILE_PICK_CANCELLED, handleFilePickCancelled],
            [NATIVE_CALLBACKS.ON_FILE_PICK_STATE_UPDATE, handleFilePickStateUpdate],
        ])
    }, [handleNativeError, resetProgress, setDataAndComplete, setLoading, updateProgress])

    const pickFile = useCallback(
        (input = null) => {
            const { payload, mimeType } = resolvePickRequest(input)
            if (typeof payload === "string") {
                console.log("📁 Picking file with MIME type:", mimeType)
            } else {
                console.log("📁 Picking file with options:", payload)
            }

            executeOperation(() => {
                nativeBridge.file.pick(payload)
            }, "file pick")
        },
        [executeOperation]
    )

    // Standardized execute function (new interface)
    const execute = pickFile

    /**
     * Get File object from current file data
     * Supports accessing specific file by index when multiple files are selected
     * @param {number} index - Index of the file (default: 0)
     * @returns {Promise<File>} JavaScript File object for FormData/POST API
     * @throws {Error} If file data is unavailable or transport is unsupported
     */
    const getFileObject = useCallback(
        async (index = 0) => {
            if (!data || !data.files || !data.files.length) {
                throw new Error("No file data available. Please pick a file first.")
            }

            const targetIndex = Number(index)
            const fileEntry = data.files[targetIndex]

            if (!fileEntry) {
                throw new Error(`No file data available at index ${targetIndex}.`)
            }

            if (fileObjectCache.current.has(targetIndex)) {
                console.log("📁 Returning cached File object", { index: targetIndex })
                return fileObjectCache.current.get(targetIndex)
            }

            const { fileSrc, fileName, mimeType, transport } = fileEntry

            // Check if transport supports File object creation
            if (!canCreateFileObject(transport)) {
                const errorMessage = getUnsupportedTransportMessage(transport)
                console.error("❌", errorMessage)
                throw new Error(errorMessage)
            }

            console.log("📁 Converting to File object", {
                index: targetIndex,
                transport,
                fileName,
                mimeType,
            })

            try {
                let fileObject

                if (transport === "BRIDGE_BASE64") {
                    // Synchronous conversion for base64
                    fileObject = base64ToFile(fileSrc, fileName, mimeType)
                } else if (transport === "FRAMEWORK_SERVER") {
                    // Asynchronous fetch and conversion for URL
                    fileObject = await urlToFile(fileSrc, fileName, mimeType)
                }

                // Cache the result per index
                fileObjectCache.current.set(targetIndex, fileObject)
                console.log("✅ File object created successfully", {
                    index: targetIndex,
                    name: fileObject.name,
                    size: fileObject.size,
                    type: fileObject.type,
                })

                return fileObject
            } catch (error) {
                console.error("❌ Failed to create File object:", error)
                throw new Error(`Failed to create File object: ${error.message}`)
            }
        },
        [data]
    )

    const getAllFileObjects = useCallback(async () => {
        if (!data || !data.files || !data.files.length) {
            throw new Error("No file data available. Please pick a file first.")
        }

        const indices = data.files.map((_, index) => index)
        return Promise.all(indices.map((index) => getFileObject(index)))
    }, [data, getFileObject])

    const files = useMemo(() => (data?.files ? data.files : data ? [data] : []), [data])
    const canCreateFileObjectForCurrentFile = useMemo(
        () => (files.length > 0 ? canCreateFileObject(files[0].transport) : false),
        [files]
    )
    const canCreateFileObjectsList = useMemo(
        () => files.map((file) => canCreateFileObject(file.transport)),
        [files]
    )

    const clear = useCallback(() => {
        fileObjectCache.current.clear()
        baseClear()
    }, [baseClear])

    return {
        // Standardized interface
        data,
        loading,
        progress,
        error,
        isWeb,
        isNative,
        execute,
        clear,
        clearError,

        // File object conversion helpers
        getFileObject,
        getAllFileObjects,
        canCreateFileObject: canCreateFileObjectForCurrentFile,
        canCreateFileObjects: canCreateFileObjectsList,

        // Legacy aliases for backward compatibility
        selectedFile: files[0] || null,
        selectedFiles: files,
        pickFile,
        isLoading: loading,
        processingState: progress?.phase || null,
        clearFile: clear,
    }
}

/**
 * Promise-based camera permission request
 * @returns {Promise<string>} Promise that resolves with permission status
 */
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

            // Set up one-time listener
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

/**
 * React hook for camera permission status
 * Automatically requests permission on mount
 */
export const useCameraPermission = () => {
    if (typeof window === "undefined") {
        return { permission: null, isLoading: false }
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.")
    }

    const [permission, setPermission] = useState(null)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
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
            window.WebBridge.unregister(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS)
        }
    }, [])

    return { permission, isLoading }
}

/**
 * Promise-based haptic feedback request
 * @param {string} feedbackType - Type of haptic feedback (from HAPTIC_FEEDBACK_TYPES)
 * @returns {Promise<string>} Promise that resolves with success status
 */
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

            // Set up one-time listener
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

/**
 * React hook for haptic feedback
 * Provides a function to trigger haptic feedback
 */
export const useHapticFeedback = () => {
    const base = useBaseHook("useHapticFeedback")
    const [capabilities, setCapabilities] = useState({
        isSupported: false,
        availableTypes: ["light", "medium", "heavy"],
        platform: "unknown",
    })

    // Haptic types
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
        // Initialize capabilities
        const userAgent = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : ""
        let platform = "unknown"
        let isSupported = false
        let availableTypes = []

        if (base.isNative) {
            isSupported = true
            if (userAgent.includes("android")) {
                platform = "android"
                availableTypes = [HAPTIC_TYPES.LIGHT, HAPTIC_TYPES.MEDIUM, HAPTIC_TYPES.HEAVY]
            } else if (userAgent.includes("iphone") || userAgent.includes("ipad")) {
                platform = "ios"
                availableTypes = Object.values(HAPTIC_TYPES)
            }
        } else {
            platform = "web"
            isSupported = typeof navigator !== "undefined" && "vibrate" in navigator
            if (isSupported) {
                availableTypes = [HAPTIC_TYPES.LIGHT, HAPTIC_TYPES.MEDIUM, HAPTIC_TYPES.HEAVY]
            }
        }

        setCapabilities({ isSupported, availableTypes, platform })
    }, [base.isNative])

    // Main execute function for haptic superhook
    const executeHaptic = (type = "light", options = {}) => {
        if (!capabilities.isSupported) {
            const error = createStandardError(
                ERROR_CODES.FEATURE_UNSUPPORTED,
                "Haptic feedback not supported",
                null,
                "Device does not support haptic feedback"
            )
            base.handleNativeError(error)
            return
        }

        return handleHapticTrigger(type, options)
    }

    // Haptic trigger handler
    const handleHapticTrigger = async (type, options = {}) => {
        try {
            base.setLoading(true)
            base.updateProgress({
                state: "active",
                phase: "triggering",
                message: `Triggering ${type} haptic feedback...`,
            })

            let success = false

            if (base.isNative) {
                // Use existing native implementation
                success = await requestHapticFeedback(type)
            } else {
                // Web fallback
                success = handleWebHaptic(type, options)
            }

            const hapticData = {
                lastType: type,
                lastOptions: options,
                timestamp: new Date().toISOString(),
                success: success,
                capabilities: capabilities,
                lastOperation: "trigger",
                operationSuccess: success,
            }

            base.setDataAndComplete(hapticData)
            return success
        } catch (error) {
            console.error("📳 Haptic feedback failed:", error)
            base.handleNativeError(error)
            return false
        }
    }

    // Web haptic fallback
    const handleWebHaptic = (type) => {
        if (!navigator.vibrate) {
            return false
        }

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

        const pattern = vibrationPatterns[type] || [100]
        navigator.vibrate(pattern)
        return true
    }

    // Return standardized superhook interface
    return {
        // Standard interface (from useBaseHook)
        data: base.data,
        loading: base.loading,
        progress: base.progress,
        error: base.error,
        isWeb: base.isWeb,
        isNative: base.isNative,
        clear: base.clear,
        clearError: base.clearError,

        // Main execute function
        execute: executeHaptic,

        // Semantic aliases for execute
        triggerHaptic: executeHaptic, // Legacy compatibility
        trigger: executeHaptic,
        light: () => executeHaptic(HAPTIC_TYPES.LIGHT),
        medium: () => executeHaptic(HAPTIC_TYPES.MEDIUM),
        heavy: () => executeHaptic(HAPTIC_TYPES.HEAVY),
        success: () => executeHaptic(HAPTIC_TYPES.SUCCESS),
        warning: () => executeHaptic(HAPTIC_TYPES.WARNING),
        errorHaptic: () => executeHaptic(HAPTIC_TYPES.ERROR),
        selection: () => executeHaptic(HAPTIC_TYPES.SELECTION),
        impact: () => executeHaptic(HAPTIC_TYPES.IMPACT),

        // Capability info
        capabilities: capabilities,
        isSupported: capabilities.isSupported,
        isAvailable: capabilities.isSupported, // Legacy compatibility
        availableTypes: capabilities.availableTypes,

        // Haptic types constant
        HAPTIC_TYPES,
    }
}
