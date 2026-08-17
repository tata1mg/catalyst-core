const REPO_BLOB_BASE = "https://github.com/tata1mg/catalyst-core/blob/main/errors"

export const ERROR_CODES = {
    PREFLIGHT_CONFIG_MISSING: "PREFLIGHT-001",
    PREFLIGHT_CONFIG_NOT_OBJECT: "PREFLIGHT-002",
    PREFLIGHT_CONFIG_KEY_MISSING: "PREFLIGHT-003",
    PREFLIGHT_PACKAGE_JSON_MISSING: "PREFLIGHT-004",
    PREFLIGHT_PACKAGE_JSON_INVALID: "PREFLIGHT-005",
    PREFLIGHT_MODULE_ALIAS_MISSING: "PREFLIGHT-006",
    PREFLIGHT_MODULE_ALIAS_NOT_OBJECT: "PREFLIGHT-007",
    PREFLIGHT_MODULE_ALIAS_RESTRICTED: "PREFLIGHT-008",
    PREFLIGHT_MODULE_ALIAS_KEY_MISSING: "PREFLIGHT-009",
    PREFLIGHT_PRE_SERVER_INIT_MISSING: "PREFLIGHT-010",
    PREFLIGHT_PRE_SERVER_INIT_NOT_FUNCTION: "PREFLIGHT-011",
    PREFLIGHT_MIDDLEWARE_MISSING: "PREFLIGHT-012",
    PREFLIGHT_MIDDLEWARE_NOT_FUNCTION: "PREFLIGHT-013",
    PREFLIGHT_REDUCER_MISSING: "PREFLIGHT-014",
    PREFLIGHT_REDUCER_NOT_FUNCTION: "PREFLIGHT-015",
    PREFLIGHT_CONFIGURE_STORE_MISSING: "PREFLIGHT-016",
    PREFLIGHT_CONFIGURE_STORE_NOT_FUNCTION: "PREFLIGHT-017",
    PREFLIGHT_GET_ROUTES_MISSING: "PREFLIGHT-018",
    PREFLIGHT_GET_ROUTES_NOT_FUNCTION: "PREFLIGHT-019",
    PREFLIGHT_CUSTOM_DOCUMENT_MISSING: "PREFLIGHT-020",
    PREFLIGHT_CUSTOM_DOCUMENT_NOT_FUNCTION: "PREFLIGHT-021",

    PROCESS_SERVER_INIT_FAILED: "PROCESS-001",
    PROCESS_USER_HOOK_FAILED: "PROCESS-002",

    BUNDLE_UPSTREAM_ERROR: "BUNDLE-000",
    IOS_UPSTREAM_ERROR: "IOS-000",
    ANDROID_UPSTREAM_ERROR: "ANDROID-000",

    RUNTIME_NATIVE_PERMISSION_DENIED: "RUNTIME-NATIVE-001",
    RUNTIME_NATIVE_PERMISSION_REQUIRED: "RUNTIME-NATIVE-002",
    RUNTIME_NATIVE_NETWORK_UNAVAILABLE: "RUNTIME-NATIVE-003",
    RUNTIME_NATIVE_DOWNLOAD_FAILED: "RUNTIME-NATIVE-004",
    RUNTIME_NATIVE_FILE_NOT_FOUND: "RUNTIME-NATIVE-005",
    RUNTIME_NATIVE_FILE_TOO_LARGE: "RUNTIME-NATIVE-006",
    RUNTIME_NATIVE_STORAGE_FULL: "RUNTIME-NATIVE-007",
    RUNTIME_NATIVE_FILE_CORRUPTED: "RUNTIME-NATIVE-008",
    RUNTIME_NATIVE_OPERATION_CANCELLED: "RUNTIME-NATIVE-009",
    RUNTIME_NATIVE_NO_FILE_SELECTED: "RUNTIME-NATIVE-010",
    RUNTIME_NATIVE_INVALID_FILE_TYPE: "RUNTIME-NATIVE-011",
    RUNTIME_NATIVE_INVALID_PARAMETERS: "RUNTIME-NATIVE-012",
    RUNTIME_NATIVE_BRIDGE_UNAVAILABLE: "RUNTIME-NATIVE-013",
    RUNTIME_NATIVE_FEATURE_UNSUPPORTED: "RUNTIME-NATIVE-014",
    RUNTIME_NATIVE_INTERNAL_ERROR: "RUNTIME-NATIVE-015",
    RUNTIME_NATIVE_CAMERA_UNAVAILABLE: "RUNTIME-NATIVE-016",
    RUNTIME_NATIVE_CAMERA_IN_USE: "RUNTIME-NATIVE-017",
}

// One entry per catalyst-owned code. Foreign/wrapped errors (see wrapForeignError)
// intentionally do not get an entry here beyond their per-stage wrapper code —
// we don't author docs or specific meanings for errors we don't originate.
export const ERROR_DEFINITIONS = {
    [ERROR_CODES.PREFLIGHT_CONFIG_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "config not found in config folder",
        defaultDetails: "A config object must be exported from the config folder in your project root.",
        suggestedAction: "Create config/config.json (or config/index.js) exporting the required config object.",
    },
    [ERROR_CODES.PREFLIGHT_CONFIG_NOT_OBJECT]: {
        category: "PREFLIGHT",
        defaultMessage: "config export is not an object",
        defaultDetails: "The config folder must export a plain object.",
        suggestedAction: "Ensure config/config.json exports an object, not a string, array, or function.",
    },
    [ERROR_CODES.PREFLIGHT_CONFIG_KEY_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "required key missing inside config.json",
        defaultDetails: "config.json is missing one or more required keys.",
        suggestedAction:
            "Add the missing key to config.json. See the config.json reference in the framework docs.",
    },
    [ERROR_CODES.PREFLIGHT_PACKAGE_JSON_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "package.json not found in the project",
        defaultDetails: "A package.json must exist in the project root directory.",
        suggestedAction: "Run this command from the project root, or restore package.json.",
    },
    [ERROR_CODES.PREFLIGHT_PACKAGE_JSON_INVALID]: {
        category: "PREFLIGHT",
        defaultMessage: "package.json should be defined in project root directory",
        defaultDetails: "package.json exists but could not be parsed as an object.",
        suggestedAction: "Check package.json for valid JSON syntax.",
    },
    [ERROR_CODES.PREFLIGHT_MODULE_ALIAS_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "moduleAliases not found in package.json",
        defaultDetails: "package.json must export a moduleAliases object.",
        suggestedAction: "Add a moduleAliases object to package.json.",
    },
    [ERROR_CODES.PREFLIGHT_MODULE_ALIAS_NOT_OBJECT]: {
        category: "PREFLIGHT",
        defaultMessage: "moduleAliases named object should be exported from package.json",
        defaultDetails: "moduleAliases was found in package.json but is not an object.",
        suggestedAction: "Ensure moduleAliases is exported as an object in package.json.",
    },
    [ERROR_CODES.PREFLIGHT_MODULE_ALIAS_RESTRICTED]: {
        category: "PREFLIGHT",
        defaultMessage: "catalyst keyword is restricted for defining aliases",
        defaultDetails: "Module alias keys containing 'catalyst' are reserved by the framework.",
        suggestedAction: "Rename the alias to something that does not contain 'catalyst'.",
    },
    [ERROR_CODES.PREFLIGHT_MODULE_ALIAS_KEY_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "required module alias not defined inside package.json",
        defaultDetails: "One or more required module aliases are missing from moduleAliases.",
        suggestedAction: "Add the missing alias to the moduleAliases object in package.json.",
    },
    [ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "preServerInit named function should be defined in server/index.js",
        defaultDetails: "server/index.js must export a preServerInit function.",
        suggestedAction: "Export a preServerInit function from server/index.js, or remove the reference to it.",
    },
    [ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "preServerInit should be a function present in server/index.js",
        defaultDetails: "preServerInit was found but is not a function.",
        suggestedAction: "Ensure preServerInit is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_MIDDLEWARE_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "addMiddlewares named function not found in server/server.js",
        defaultDetails: "server/server.js must export an addMiddlewares function.",
        suggestedAction: "Export an addMiddlewares function from server/server.js.",
    },
    [ERROR_CODES.PREFLIGHT_MIDDLEWARE_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "addMiddlewares should be a function present in server/server.js",
        defaultDetails: "addMiddlewares was found but is not a function.",
        suggestedAction: "Ensure addMiddlewares is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_REDUCER_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "reducer not found in src/js/containers/App/reducer",
        defaultDetails: "A reducer must be exported from src/js/containers/App/reducer.",
        suggestedAction: "Export a reducer from src/js/containers/App/reducer.",
    },
    [ERROR_CODES.PREFLIGHT_REDUCER_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "reducer should be present in src/js/containers/App/reducer",
        defaultDetails: "The reducer export was found but is not a function.",
        suggestedAction: "Ensure the reducer is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "configureStore not found in file src/js/store/index.js",
        defaultDetails: "src/js/store/index.js must export a configureStore function.",
        suggestedAction: "Export a configureStore function from src/js/store/index.js.",
    },
    [ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "configureStore should be a function exported from src/js/store/index.js",
        defaultDetails: "configureStore was found but is not a function.",
        suggestedAction: "Ensure configureStore is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_GET_ROUTES_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "getRoutes not found in file src/js/routes/utils.js",
        defaultDetails: "src/js/routes/utils.js must export a getRoutes function.",
        suggestedAction: "Export a getRoutes function from src/js/routes/utils.js.",
    },
    [ERROR_CODES.PREFLIGHT_GET_ROUTES_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "getRoutes should be a function exported from src/js/routers/index.js",
        defaultDetails: "getRoutes was found but is not a function.",
        suggestedAction: "Ensure getRoutes is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "document not found in file server/document.js",
        defaultDetails: "server/document.js must export a document component.",
        suggestedAction: "Export a document React component from server/document.js.",
    },
    [ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "document should be a react component exported from server/document.js",
        defaultDetails: "document was found but is not a function/component.",
        suggestedAction: "Ensure document is exported as a React component (function).",
    },

    [ERROR_CODES.PROCESS_SERVER_INIT_FAILED]: {
        category: "PROCESS",
        defaultMessage: "preServerInit threw an error during server startup",
        defaultDetails:
            "The preServerInit hook failed. Note: server startup currently continues despite this error (tracked separately as a fix — see issue #298); this code only identifies which hook failed.",
        suggestedAction: "Fix the error thrown inside your preServerInit hook (see the cause above).",
    },
    [ERROR_CODES.PROCESS_USER_HOOK_FAILED]: {
        category: "PROCESS",
        defaultMessage: "A user-defined hook threw an error",
        defaultDetails:
            "A user-defined hook (e.g. onRouteMatch, onFetcherError, onServerError) threw. It was caught so the SSR pipeline keeps running; see the cause above for which hook and why.",
        suggestedAction: "Fix the error thrown inside the hook (see the cause above).",
    },

    [ERROR_CODES.BUNDLE_UPSTREAM_ERROR]: {
        category: "BUNDLE",
        defaultMessage: "Build failed in an upstream bundler step",
        defaultDetails:
            "This is a wrapper around an error from Vite/Rollup or another upstream build tool. See the printed upstream code/message for the actual cause — catalyst-core does not reinterpret it.",
        suggestedAction: "Read the upstream error message/code printed above and fix the underlying issue.",
    },
    [ERROR_CODES.IOS_UPSTREAM_ERROR]: {
        category: "IOS",
        defaultMessage: "iOS build failed in an upstream toolchain step",
        defaultDetails: "This wraps an error from Xcode/CocoaPods. See the printed upstream output for the cause.",
        suggestedAction: "Read the upstream Xcode/CocoaPods error printed above and fix the underlying issue.",
    },
    [ERROR_CODES.ANDROID_UPSTREAM_ERROR]: {
        category: "ANDROID",
        defaultMessage: "Android build failed in an upstream toolchain step",
        defaultDetails: "This wraps an error from Gradle. See the printed upstream output for the cause.",
        suggestedAction: "Read the upstream Gradle error printed above and fix the underlying issue.",
    },

    [ERROR_CODES.RUNTIME_NATIVE_PERMISSION_DENIED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Permission denied",
        defaultDetails: "Required permission was not granted by the user",
        suggestedAction: "Grant permission in device settings and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_PERMISSION_REQUIRED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Permission required",
        defaultDetails: "This operation requires additional permissions",
        suggestedAction: "Grant the required permission to continue",
    },
    [ERROR_CODES.RUNTIME_NATIVE_NETWORK_UNAVAILABLE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "No internet connection",
        defaultDetails: "Network connection is required for this operation",
        suggestedAction: "Check your internet connection and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_DOWNLOAD_FAILED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Download failed",
        defaultDetails: "The download could not be completed",
        suggestedAction: "Check your connection and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_FILE_NOT_FOUND]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "File not found",
        defaultDetails: "The requested file could not be located",
        suggestedAction: "The file may have been moved or deleted",
    },
    [ERROR_CODES.RUNTIME_NATIVE_FILE_TOO_LARGE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "File too large",
        defaultDetails: "File exceeds the maximum size limit",
        suggestedAction: "Choose a smaller file or compress the current file",
    },
    [ERROR_CODES.RUNTIME_NATIVE_STORAGE_FULL]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Storage full",
        defaultDetails: "Device storage is full and cannot save the file",
        suggestedAction: "Free up some storage space and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_FILE_CORRUPTED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "File corrupted",
        defaultDetails: "The file could not be read or is corrupted",
        suggestedAction: "Try selecting a different file",
    },
    [ERROR_CODES.RUNTIME_NATIVE_OPERATION_CANCELLED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Operation cancelled",
        defaultDetails: "The operation was cancelled by the user",
        suggestedAction: "Try again if you want to complete the operation",
    },
    [ERROR_CODES.RUNTIME_NATIVE_NO_FILE_SELECTED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "No file selected",
        defaultDetails: "No file was selected by the user",
        suggestedAction: "Select a file and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_INVALID_FILE_TYPE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Invalid file type",
        defaultDetails: "The selected file type is not supported",
        suggestedAction: "Choose a file with a supported format",
    },
    [ERROR_CODES.RUNTIME_NATIVE_INVALID_PARAMETERS]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Invalid parameters",
        defaultDetails: "One or more parameters passed to the native call were invalid",
        suggestedAction: "Check the parameters passed to the native API call",
    },
    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_UNAVAILABLE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Native feature unavailable",
        defaultDetails: "The native bridge is not available or not initialized",
        suggestedAction: "Use web fallback if available",
    },
    [ERROR_CODES.RUNTIME_NATIVE_FEATURE_UNSUPPORTED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Feature not supported",
        defaultDetails: "This feature is not supported on the current platform",
        suggestedAction: "Try using an alternative method or device",
    },
    [ERROR_CODES.RUNTIME_NATIVE_INTERNAL_ERROR]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "An unexpected error occurred",
        defaultDetails: "An internal error occurred while processing the request",
        suggestedAction: "Try again or contact support if the problem persists",
    },
    [ERROR_CODES.RUNTIME_NATIVE_CAMERA_UNAVAILABLE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Camera unavailable",
        defaultDetails: "Camera hardware is not available or accessible",
        suggestedAction: "Check if your device has a camera and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_CAMERA_IN_USE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Camera in use",
        defaultDetails: "Camera is being used by another application",
        suggestedAction: "Close other camera apps and try again",
    },
}

export function getDefinition(code) {
    return ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS[ERROR_CODES.RUNTIME_NATIVE_INTERNAL_ERROR]
}

export function getDocUrl(code) {
    const def = ERROR_DEFINITIONS[code]
    if (!def) return null
    return `${REPO_BLOB_BASE}/${def.category}/${code}.md`
}
