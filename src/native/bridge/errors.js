/**
 * Standardized Error System for Catalyst Framework
 * Translates native errors into web developer-friendly messages
 */

// Error categories for logical grouping
export const ERROR_CATEGORIES = {
    PERMISSION: "PERMISSION",
    NETWORK: "NETWORK",
    FILE_SYSTEM: "FILE_SYSTEM",
    USER_ACTION: "USER_ACTION",
    VALIDATION: "VALIDATION",
    SYSTEM: "SYSTEM",
    UNKNOWN: "UNKNOWN",
}

// Standardized error codes
export const ERROR_CODES = {
    // Permission errors
    PERMISSION_DENIED: "PERMISSION_DENIED",
    PERMISSION_REQUIRED: "PERMISSION_REQUIRED",

    // Network errors
    NETWORK_UNAVAILABLE: "NETWORK_UNAVAILABLE",
    DOWNLOAD_FAILED: "DOWNLOAD_FAILED",

    // File system errors
    FILE_NOT_FOUND: "FILE_NOT_FOUND",
    FILE_TOO_LARGE: "FILE_TOO_LARGE",
    STORAGE_FULL: "STORAGE_FULL",
    FILE_CORRUPTED: "FILE_CORRUPTED",

    // User action errors
    OPERATION_CANCELLED: "OPERATION_CANCELLED",
    NO_FILE_SELECTED: "NO_FILE_SELECTED",

    // Validation errors
    INVALID_FILE_TYPE: "INVALID_FILE_TYPE",
    INVALID_PARAMETERS: "INVALID_PARAMETERS",

    // System errors
    BRIDGE_UNAVAILABLE: "BRIDGE_UNAVAILABLE",
    FEATURE_UNSUPPORTED: "FEATURE_UNSUPPORTED",
    INTERNAL_ERROR: "INTERNAL_ERROR",

    // Camera specific errors
    CAMERA_UNAVAILABLE: "CAMERA_UNAVAILABLE",
    CAMERA_IN_USE: "CAMERA_IN_USE",
}

// Error definitions with user-friendly messages and recovery actions
export const ERROR_DEFINITIONS = {
    [ERROR_CODES.PERMISSION_DENIED]: {
        category: ERROR_CATEGORIES.PERMISSION,
        defaultMessage: "Permission denied",
        defaultDetails: "Required permission was not granted by the user",
        recoverable: true,
        suggestedAction: "Grant permission in device settings and try again",
    },

    [ERROR_CODES.PERMISSION_REQUIRED]: {
        category: ERROR_CATEGORIES.PERMISSION,
        defaultMessage: "Permission required",
        defaultDetails: "This operation requires additional permissions",
        recoverable: true,
        suggestedAction: "Grant the required permission to continue",
    },

    [ERROR_CODES.NETWORK_UNAVAILABLE]: {
        category: ERROR_CATEGORIES.NETWORK,
        defaultMessage: "No internet connection",
        defaultDetails: "Network connection is required for this operation",
        recoverable: true,
        suggestedAction: "Check your internet connection and try again",
    },

    [ERROR_CODES.FILE_NOT_FOUND]: {
        category: ERROR_CATEGORIES.FILE_SYSTEM,
        defaultMessage: "File not found",
        defaultDetails: "The requested file could not be located",
        recoverable: false,
        suggestedAction: "The file may have been moved or deleted",
    },

    [ERROR_CODES.FILE_TOO_LARGE]: {
        category: ERROR_CATEGORIES.VALIDATION,
        defaultMessage: "File too large",
        defaultDetails: "File exceeds the maximum size limit",
        recoverable: true,
        suggestedAction: "Choose a smaller file or compress the current file",
    },

    [ERROR_CODES.STORAGE_FULL]: {
        category: ERROR_CATEGORIES.FILE_SYSTEM,
        defaultMessage: "Storage full",
        defaultDetails: "Device storage is full and cannot save the file",
        recoverable: true,
        suggestedAction: "Free up some storage space and try again",
    },

    [ERROR_CODES.OPERATION_CANCELLED]: {
        category: ERROR_CATEGORIES.USER_ACTION,
        defaultMessage: "Operation cancelled",
        defaultDetails: "The operation was cancelled by the user",
        recoverable: true,
        suggestedAction: "Try again if you want to complete the operation",
    },

    [ERROR_CODES.INVALID_FILE_TYPE]: {
        category: ERROR_CATEGORIES.VALIDATION,
        defaultMessage: "Invalid file type",
        defaultDetails: "The selected file type is not supported",
        recoverable: true,
        suggestedAction: "Choose a file with a supported format",
    },

    [ERROR_CODES.BRIDGE_UNAVAILABLE]: {
        category: ERROR_CATEGORIES.SYSTEM,
        defaultMessage: "Native feature unavailable",
        defaultDetails: "The native bridge is not available or not initialized",
        recoverable: false,
        suggestedAction: "Use web fallback if available",
    },

    [ERROR_CODES.FEATURE_UNSUPPORTED]: {
        category: ERROR_CATEGORIES.SYSTEM,
        defaultMessage: "Feature not supported",
        defaultDetails: "This feature is not supported on the current platform",
        recoverable: false,
        suggestedAction: "Try using an alternative method or device",
    },

    [ERROR_CODES.CAMERA_UNAVAILABLE]: {
        category: ERROR_CATEGORIES.SYSTEM,
        defaultMessage: "Camera unavailable",
        defaultDetails: "Camera hardware is not available or accessible",
        recoverable: false,
        suggestedAction: "Check if your device has a camera and try again",
    },

    [ERROR_CODES.CAMERA_IN_USE]: {
        category: ERROR_CATEGORIES.SYSTEM,
        defaultMessage: "Camera in use",
        defaultDetails: "Camera is being used by another application",
        recoverable: true,
        suggestedAction: "Close other camera apps and try again",
    },

    [ERROR_CODES.INTERNAL_ERROR]: {
        category: ERROR_CATEGORIES.UNKNOWN,
        defaultMessage: "An unexpected error occurred",
        defaultDetails: "An internal error occurred while processing the request",
        recoverable: true,
        suggestedAction: "Try again or contact support if the problem persists",
    },
}

/**
 * Create a standardized error object
 * @param {string} code - Error code from ERROR_CODES
 * @param {string} userMessage - Custom user-friendly message (optional)
 * @param {any} nativeError - Original native error for debugging
 * @param {string} customDetails - Custom details (optional)
 * @returns {Object} Standardized error object
 */
export const createStandardError = (code, userMessage = null, nativeError = null, customDetails = null) => {
    const errorInfo = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS[ERROR_CODES.INTERNAL_ERROR]

    return {
        code,
        category: errorInfo.category,
        message: userMessage || errorInfo.defaultMessage,
        details: customDetails || errorInfo.defaultDetails,
        recoverable: errorInfo.recoverable,
        action: errorInfo.suggestedAction,
        nativeError: nativeError,
        timestamp: new Date().toISOString(),
    }
}

/**
 * Translate native error to standardized error
 * @param {any} nativeError - Native error from Android/iOS
 * @returns {Object} Standardized error object
 */
export const translateError = (nativeError) => {
    if (!nativeError) {
        return createStandardError(ERROR_CODES.INTERNAL_ERROR, null, nativeError)
    }

    const errorString = nativeError.toString().toLowerCase()

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
 * @returns {boolean} True if in development mode
 */
export const isDevelopment = () => {
    return typeof process !== "undefined" && process.env && process.env.NODE_ENV === "development"
}
