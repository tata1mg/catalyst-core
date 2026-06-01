/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useState, useCallback, useRef, useMemo } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS } from "../constants/NativeInterfaces.js"
import { useBaseHook } from "../useBaseHook.js"
import {
    base64ToFile,
    urlToFile,
    canCreateFileObject,
    getUnsupportedTransportMessage,
} from "../utils/FileObjectConverter.js"
import { noop, createSSRUnavailable, parseNativePayload, registerNativeHandlers } from "./utils.js"

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

const extractFiles = (value) => {
    if (!value) return []
    if (Array.isArray(value)) return value.filter(Boolean)
    if (Array.isArray(value.files)) return value.files.filter(Boolean)
    if (value.files) return [value.files]
    return [value].filter(Boolean)
}

export const sanitizeFilePickerOptions = (input) => {
    const options = { ...input }
    const mime = typeof options.mimeType === "string" ? options.mimeType.trim() : ""
    options.mimeType = mime.length > 0 ? mime : "*/*"

    const coerceInteger = (value, min) => {
        if (value == null) return undefined
        const numeric = typeof value === "string" ? Number(value.trim()) : Number(value)
        if (!Number.isFinite(numeric)) {
            throw new Error("File picker numeric options must be valid numbers")
        }
        if (!Number.isInteger(numeric)) {
            throw new Error("File picker numeric options must be integers")
        }
        if (numeric < min) {
            throw new Error(`File picker numeric options must be ≥ ${min}`)
        }
        return numeric
    }

    const minFiles = coerceInteger(options.minFiles, 1)
    const maxFiles = coerceInteger(options.maxFiles, 1)
    const minFileSize = coerceInteger(options.minFileSize, 0)
    const maxFileSize = coerceInteger(options.maxFileSize, 0)

    if (minFiles !== undefined) options.minFiles = minFiles
    if (maxFiles !== undefined) options.maxFiles = maxFiles
    if (minFileSize !== undefined) options.minFileSize = minFileSize
    if (maxFileSize !== undefined) options.maxFileSize = maxFileSize

    if (minFiles !== undefined && maxFiles !== undefined && minFiles > maxFiles) {
        throw new Error("minFiles cannot be greater than maxFiles")
    }

    if (minFileSize !== undefined && maxFileSize !== undefined && minFileSize > maxFileSize) {
        throw new Error("minFileSize cannot be greater than maxFileSize")
    }

    const multiple = typeof options.multiple === "boolean" ? options.multiple : Boolean(options.multiple)
    options.multiple = multiple || (minFiles && minFiles > 1) || (maxFiles && maxFiles > 1)

    return options
}

const resolvePickPayload = (input) => {
    if (input == null) return "*/*"
    if (typeof input === "string") return input.trim() || "*/*"
    return sanitizeFilePickerOptions(input)
}

const normalizeFilePickResult = (payload) => {
    const parsed = parseNativePayload(payload)
    if (!parsed) return null

    const files = extractFiles(parsed)
    if (!files.length) return null

    const first = files[0]
    const rawOptions =
        !Array.isArray(parsed) && parsed && typeof parsed.options === "object" ? parsed.options : null
    let normalizedOptions = rawOptions || null

    if (rawOptions) {
        try {
            normalizedOptions = sanitizeFilePickerOptions(rawOptions)
        } catch (_error) {
            normalizedOptions = rawOptions
        }
    }

    const totalSize =
        parsed.totalSize ??
        files.reduce((sum, file) => {
            const size = typeof file?.size === "number" ? file.size : 0
            return sum + size
        }, 0)

    const base = Array.isArray(parsed) ? {} : parsed

    return {
        ...base,
        files,
        multiple: parsed.multiple ?? files.length > 1,
        count: parsed.count ?? files.length,
        totalSize,
        fileName: parsed.fileName ?? first?.fileName ?? first?.name ?? null,
        fileSrc: parsed.fileSrc ?? first?.fileSrc ?? first?.src ?? null,
        filePath: parsed.filePath ?? first?.filePath ?? null,
        size: parsed.size ?? first?.size ?? null,
        mimeType: parsed.mimeType ?? first?.mimeType ?? first?.type ?? null,
        transport: parsed.transport ?? first?.transport ?? null,
        options: normalizedOptions,
    }
}

const updateProgressFromResult = (updateProgress, result) => {
    if (!result) return

    const first = result.files?.[0]
    const transport = result.transport ?? first?.transport ?? null
    const bytesTotal =
        result.totalSize ?? result.size ?? (typeof first?.size === "number" ? first.size : null)

    if (transport || bytesTotal != null) {
        updateProgress({ transport: transport ?? null, bytesTotal })
    }
}

const mapStateToProgress = (state) => {
    if (state == null) {
        return { state: "starting", phase: null, message: "File picker: starting..." }
    }

    const rawState = String(state)
    const normalized = rawState.toLowerCase()
    const allowedStates = new Set(["opening", "processing", "routing"])
    const progressState = allowedStates.has(normalized) ? normalized : "starting"

    return { state: progressState, phase: rawState, message: `File picker: ${rawState}...` }
}

export const useFilePicker = ({ webFallback } = {}) => {
    const base = useBaseHook("useFilePicker", { hasWebFallback: true, webFallback })
    const fileObjectCache = useRef(new Map())

    // Web fallback callbacks — always declared (Rules of Hooks)
    const webPickFile = useCallback(
        (input = null) => {
            let accept = "*/*"
            let multiple = false
            if (typeof input === "string") {
                accept = input.trim() || "*/*"
            } else if (input && typeof input === "object") {
                try {
                    const opts = sanitizeFilePickerOptions(input)
                    accept = opts.mimeType || "*/*"
                    multiple = Boolean(opts.multiple)
                } catch (err) {
                    base.handleNativeError(err instanceof Error ? err.message : "Invalid file picker options")
                    return
                }
            }

            const el = document.createElement("input")
            el.type = "file"
            el.accept = accept
            el.multiple = multiple

            el.onchange = () => {
                const fileList = Array.from(el.files || [])
                if (!fileList.length) return

                const files = fileList.map((f) => ({
                    fileName: f.name,
                    fileSrc: URL.createObjectURL(f),
                    size: f.size,
                    mimeType: f.type,
                    transport: "OBJECT_URL",
                }))

                base.setDataAndComplete({
                    files,
                    multiple: files.length > 1,
                    count: files.length,
                    totalSize: files.reduce((sum, f) => sum + (f.size || 0), 0),
                    fileName: files[0].fileName,
                    fileSrc: files[0].fileSrc,
                    filePath: null,
                    size: files[0].size,
                    mimeType: files[0].mimeType,
                    transport: "OBJECT_URL",
                    options: null,
                })
            }

            el.click()
        },
        [base]
    )

    const webFiles = useMemo(() => extractFiles(base.data), [base.data])

    if (typeof window === "undefined") {
        return SSR_FILE_PICKER_STUB
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
    }

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
            execute: webPickFile,
            clear: base.clear,
            clearError: base.clearError,
            getFileObject: createSSRUnavailable("getFileObject"),
            getAllFileObjects: createSSRUnavailable("getAllFileObjects"),
            canCreateFileObject: false,
            canCreateFileObjects: [],
            selectedFile: webFiles[0] || null,
            selectedFiles: webFiles,
            pickFile: webPickFile,
            isLoading: base.loading,
            processingState: null,
            clearFile: base.clear,
        }
    }

    const {
        data,
        loading,
        progress,
        error,
        isWeb,
        isNative,
        setWebFallback,
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
        const handleFilePicked = (payload) => {
            try {
                fileObjectCache.current.clear()

                const normalizedData = normalizeFilePickResult(payload)
                console.log("📁 File picked:", normalizedData)

                if (!normalizedData) {
                    throw new Error("No file data received from native file picker")
                }

                setDataAndComplete(normalizedData)
                updateProgressFromResult(updateProgress, normalizedData)
            } catch (error) {
                console.error("📁 Error processing file data:", error)
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
            let payload
            try {
                payload = resolvePickPayload(input)
            } catch (error) {
                const message = error instanceof Error ? error.message : "Invalid file picker options"
                handleNativeError(message)
                return
            }

            if (typeof payload === "string") {
                console.log("📁 Picking file with MIME type:", payload)
            } else {
                console.log("📁 Picking file with options:", payload)
            }

            executeOperation(() => {
                nativeBridge.file.pick(payload)
            }, "file pick")
        },
        [executeOperation, handleNativeError]
    )

    const files = useMemo(() => extractFiles(data), [data])

    const getFileObject = useCallback(
        async (index = 0) => {
            if (!files.length) {
                throw new Error("No file data available. Please pick a file first.")
            }

            const targetIndex = Number(index)
            const fileEntry = files[targetIndex]

            if (!fileEntry) {
                throw new Error(`No file data available at index ${targetIndex}.`)
            }

            if (fileObjectCache.current.has(targetIndex)) {
                console.log("📁 Returning cached File object", { index: targetIndex })
                return fileObjectCache.current.get(targetIndex)
            }

            const { fileSrc, fileName, mimeType, transport } = fileEntry

            if (!canCreateFileObject(transport)) {
                const errorMessage = getUnsupportedTransportMessage(transport)
                console.error("❌", errorMessage)
                throw new Error(errorMessage)
            }

            console.log("📁 Converting to File object", { index: targetIndex, transport, fileName, mimeType })

            try {
                let fileObject

                if (transport === "BRIDGE_BASE64") {
                    fileObject = base64ToFile(fileSrc, fileName, mimeType)
                } else if (transport === "FRAMEWORK_SERVER") {
                    fileObject = await urlToFile(fileSrc, fileName, mimeType)
                }

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
        [files]
    )

    const getAllFileObjects = useCallback(async () => {
        if (!files.length) {
            throw new Error("No file data available. Please pick a file first.")
        }
        return Promise.all(files.map((_, index) => getFileObject(index)))
    }, [files, getFileObject])

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
        data,
        loading,
        progress,
        error,
        isWeb,
        isNative,
        webFallbackActive: false,
        webFallbackDisabled: false,
        setWebFallback,
        execute: pickFile,
        clear,
        clearError,
        getFileObject,
        getAllFileObjects,
        canCreateFileObject: canCreateFileObjectForCurrentFile,
        canCreateFileObjects: canCreateFileObjectsList,
        selectedFile: files[0] || null,
        selectedFiles: files,
        pickFile,
        isLoading: loading,
        processingState: progress?.phase || null,
        clearFile: clear,
    }
}
