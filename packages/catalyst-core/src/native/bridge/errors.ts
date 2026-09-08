/**
 * Standardized Error System for Catalyst Framework
 * Translates native errors into web developer-friendly messages
 *
 * Codes/definitions now live in ../../errors/registry.js as RUNTIME-NATIVE-xxx
 * (shared taxonomy across CLI/build/server/native, see RFC #155). This module
 * keeps its own ERROR_CODES map for backwards-compatible imports, aliased to
 * the shared codes, plus the native-error string-sniffing logic in
 * translateError(), which is the one piece of real value here.
 */
import { ERROR_CODES as SHARED_ERROR_CODES, createError } from "../../errors/index.js"
import type { CatalystError } from "../../errors/index.js"

// Backwards-compatible local names, aliased to the shared RUNTIME-NATIVE-xxx codes.
export const ERROR_CODES = {
    PERMISSION_DENIED: SHARED_ERROR_CODES.RUNTIME_NATIVE_PERMISSION_DENIED,
    PERMISSION_REQUIRED: SHARED_ERROR_CODES.RUNTIME_NATIVE_PERMISSION_REQUIRED,
    NETWORK_UNAVAILABLE: SHARED_ERROR_CODES.RUNTIME_NATIVE_NETWORK_UNAVAILABLE,
    DOWNLOAD_FAILED: SHARED_ERROR_CODES.RUNTIME_NATIVE_DOWNLOAD_FAILED,
    FILE_NOT_FOUND: SHARED_ERROR_CODES.RUNTIME_NATIVE_FILE_NOT_FOUND,
    FILE_TOO_LARGE: SHARED_ERROR_CODES.RUNTIME_NATIVE_FILE_TOO_LARGE,
    STORAGE_FULL: SHARED_ERROR_CODES.RUNTIME_NATIVE_STORAGE_FULL,
    FILE_CORRUPTED: SHARED_ERROR_CODES.RUNTIME_NATIVE_FILE_CORRUPTED,
    OPERATION_CANCELLED: SHARED_ERROR_CODES.RUNTIME_NATIVE_OPERATION_CANCELLED,
    NO_FILE_SELECTED: SHARED_ERROR_CODES.RUNTIME_NATIVE_NO_FILE_SELECTED,
    INVALID_FILE_TYPE: SHARED_ERROR_CODES.RUNTIME_NATIVE_INVALID_FILE_TYPE,
    INVALID_PARAMETERS: SHARED_ERROR_CODES.RUNTIME_NATIVE_INVALID_PARAMETERS,
    BRIDGE_UNAVAILABLE: SHARED_ERROR_CODES.RUNTIME_NATIVE_BRIDGE_UNAVAILABLE,
    FEATURE_UNSUPPORTED: SHARED_ERROR_CODES.RUNTIME_NATIVE_FEATURE_UNSUPPORTED,
    INTERNAL_ERROR: SHARED_ERROR_CODES.RUNTIME_NATIVE_INTERNAL_ERROR,
    CAMERA_UNAVAILABLE: SHARED_ERROR_CODES.RUNTIME_NATIVE_CAMERA_UNAVAILABLE,
    CAMERA_IN_USE: SHARED_ERROR_CODES.RUNTIME_NATIVE_CAMERA_IN_USE,
}

/** One of the {@link ERROR_CODES} values — a shared `RUNTIME-NATIVE-xxx` code. */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/**
 * Broad grouping an error code belongs to.
 *
 * Categories are owned by the shared registry (`../../errors/registry.js`) and
 * are the code's prefix — every code this module aliases is `"RUNTIME-NATIVE"`.
 * `"UNKNOWN"` is what the registry substitutes for a code it does not own.
 */
export type ErrorCategory = string

/**
 * The error object every hook reports through its `error` key.
 *
 * Now an alias of the shared {@link CatalystError} (a real `Error` subclass)
 * rather than a plain object literal: the shared error system owns the shape.
 * Compared with the pre-merge local shape, `message`/`details`/`code` survive,
 * `category` is a registry category string, `action` is now `suggestedAction`,
 * `nativeError` is now the standard `cause`, and `recoverable`/`timestamp` are
 * gone — the registry does not track recoverability, and verbose/debug
 * formatting stamps its own timestamp at print time.
 *
 * Two hooks predate this contract and still report a plain string: `error` on
 * `useDeviceInfo` and `useNetworkStatus` stays a string until 2.0.
 */
export type StandardError = CatalystError

/**
 * Create a standardized error object (CatalystError instance) for a
 * RUNTIME-NATIVE-xxx code, with the native error attached as `cause`.
 *
 * @param code - Error code from ERROR_CODES
 * @param userMessage - Custom user-friendly message (optional)
 * @param nativeError - Original native error for debugging
 * @param customDetails - Custom details (optional)
 * @returns Standardized error object
 */
export const createStandardError = (
    code: ErrorCode,
    userMessage: string | null = null,
    nativeError: any = null,
    customDetails: string | null = null
): StandardError => {
    return createError(code, {
        message: userMessage,
        details: customDetails,
        cause: nativeError,
    })
}

/**
 * Translate native error to standardized error
 * @param nativeError - Native error from Android/iOS
 * @returns Standardized error object
 */
export const translateError = (nativeError: any): StandardError => {
    if (!nativeError) {
        return createStandardError(ERROR_CODES.INTERNAL_ERROR, null, nativeError)
    }

    const errorString = nativeError.toString().toLowerCase()

    if (errorString.includes("disabled") && errorString.includes("config")) {
        return createStandardError(ERROR_CODES.FEATURE_UNSUPPORTED, nativeError.toString(), nativeError)
    }

    // Permission errors
    if (errorString.includes("permission") && errorString.includes("denied")) {
        if (errorString.includes("camera")) {
            return createStandardError(ERROR_CODES.PERMISSION_DENIED, "Camera permission denied", nativeError)
        }
        if (errorString.includes("storage") || errorString.includes("external_storage")) {
            return createStandardError(
                ERROR_CODES.PERMISSION_DENIED,
                "Storage permission denied",
                nativeError
            )
        }
        return createStandardError(ERROR_CODES.PERMISSION_DENIED, null, nativeError)
    }

    // File system errors
    if (errorString.includes("filenotfound") || errorString.includes("file not found")) {
        return createStandardError(ERROR_CODES.FILE_NOT_FOUND, null, nativeError)
    }

    if (errorString.includes("storage") && errorString.includes("full")) {
        return createStandardError(ERROR_CODES.STORAGE_FULL, null, nativeError)
    }

    // Network errors
    if (
        errorString.includes("network") ||
        errorString.includes("connection") ||
        errorString.includes("internet")
    ) {
        return createStandardError(ERROR_CODES.NETWORK_UNAVAILABLE, null, nativeError)
    }

    // User cancellation
    if (errorString.includes("cancel") || errorString.includes("abort")) {
        return createStandardError(ERROR_CODES.OPERATION_CANCELLED, null, nativeError)
    }

    // Camera specific errors
    if (errorString.includes("camera")) {
        if (errorString.includes("unavailable") || errorString.includes("not available")) {
            return createStandardError(ERROR_CODES.CAMERA_UNAVAILABLE, null, nativeError)
        }
        if (errorString.includes("in use") || errorString.includes("busy")) {
            return createStandardError(ERROR_CODES.CAMERA_IN_USE, null, nativeError)
        }
    }

    // Activity/Intent errors (Android)
    if (errorString.includes("activitynotfound")) {
        return createStandardError(
            ERROR_CODES.FEATURE_UNSUPPORTED,
            "No app available to handle this request",
            nativeError
        )
    }

    // iOS specific error codes
    if (typeof nativeError === "object" && nativeError.code && nativeError.domain) {
        // Camera errors (iOS)
        if (nativeError.domain === "AVCaptureSessionErrorDomain") {
            if (nativeError.code === -11814) {
                return createStandardError(ERROR_CODES.PERMISSION_DENIED, "Camera access denied", nativeError)
            }
        }

        // Network errors (iOS)
        if (nativeError.domain === "NSURLErrorDomain") {
            if (nativeError.code === -1009) {
                return createStandardError(ERROR_CODES.NETWORK_UNAVAILABLE, null, nativeError)
            }
        }

        // File system errors (iOS)
        if (nativeError.domain === "NSCocoaErrorDomain") {
            if (nativeError.code === 260) {
                return createStandardError(ERROR_CODES.FILE_NOT_FOUND, null, nativeError)
            }
        }
    }

    // Default to internal error
    return createStandardError(ERROR_CODES.INTERNAL_ERROR, null, nativeError)
}

/**
 * Check if development mode is enabled
 * @returns True if in development mode
 */
export const isDevelopment = (): boolean => {
    return typeof process !== "undefined" && process.env && process.env.NODE_ENV === "development"
}
