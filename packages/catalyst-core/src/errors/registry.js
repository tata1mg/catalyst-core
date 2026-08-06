const REPO_BLOB_BASE = "https://github.com/tata1mg/catalyst-core/blob/main/errors"

function docUrl(category, code) {
    return `${REPO_BLOB_BASE}/${category}/${code}.md`
}

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

    RUNTIME_NATIVE_BRIDGE_INVALID_CALLBACK: "RUNTIME-NATIVE-018",
    RUNTIME_NATIVE_BRIDGE_HANDLER_NOT_REGISTERED: "RUNTIME-NATIVE-019",
    RUNTIME_NATIVE_BRIDGE_HANDLER_THREW: "RUNTIME-NATIVE-020",
    RUNTIME_NATIVE_BRIDGE_INVALID_REGISTRATION: "RUNTIME-NATIVE-021",
    RUNTIME_NATIVE_BRIDGE_INIT_FAILED: "RUNTIME-NATIVE-022",

    RUNTIME_WEB_RENDER_FAILED: "RUNTIME-WEB-001",
    RUNTIME_WEB_FETCHER_FAILED: "RUNTIME-WEB-002",
    RUNTIME_WEB_SERVER_SIDE_FUNCTION_FAILED: "RUNTIME-WEB-003",
    RUNTIME_WEB_REQUEST_HANDLING_FAILED: "RUNTIME-WEB-004",

    AI_UPSTREAM_ERROR: "AI-000",
    AI_DISABLED: "AI-001",
    AI_PROVIDER_NOT_CONFIGURED: "AI-002",
    AI_INVALID_REQUEST_BODY: "AI-003",
    AI_NATIVE_BRIDGE_UNAVAILABLE: "AI-004",
    AI_NATIVE_STREAM_NOT_READY: "AI-005",
    AI_NATIVE_REQUEST_FAILED: "AI-006",
    AI_NATIVE_CALLBACK_ERROR: "AI-007",
    AI_WEB_WORKER_UNAVAILABLE: "AI-008",
    AI_WEB_WORKER_CRASHED: "AI-009",
}

// One entry per catalyst-owned code. Foreign/wrapped errors (see wrapForeignError)
// intentionally do not get an entry here beyond their per-stage wrapper code —
// we don't author docs or specific meanings for errors we don't originate.
export const ERROR_DEFINITIONS = {
    [ERROR_CODES.PREFLIGHT_CONFIG_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "config not found in config folder",
        defaultDetails: "A config object must be exported from the config folder in your project root.",
        recoverable: true,
        suggestedAction: "Create config/config.json (or config/index.js) exporting the required config object.",
    },
    [ERROR_CODES.PREFLIGHT_CONFIG_NOT_OBJECT]: {
        category: "PREFLIGHT",
        defaultMessage: "config export is not an object",
        defaultDetails: "The config folder must export a plain object.",
        recoverable: true,
        suggestedAction: "Ensure config/config.json exports an object, not a string, array, or function.",
    },
    [ERROR_CODES.PREFLIGHT_CONFIG_KEY_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "required key missing inside config.json",
        defaultDetails: "config.json is missing one or more required keys.",
        recoverable: true,
        suggestedAction:
            "Add the missing key to config.json. See the config.json reference in the framework docs.",
    },
    [ERROR_CODES.PREFLIGHT_PACKAGE_JSON_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "package.json not found in the project",
        defaultDetails: "A package.json must exist in the project root directory.",
        recoverable: false,
        suggestedAction: "Run this command from the project root, or restore package.json.",
    },
    [ERROR_CODES.PREFLIGHT_PACKAGE_JSON_INVALID]: {
        category: "PREFLIGHT",
        defaultMessage: "package.json should be defined in project root directory",
        defaultDetails: "package.json exists but could not be parsed as an object.",
        recoverable: true,
        suggestedAction: "Check package.json for valid JSON syntax.",
    },
    [ERROR_CODES.PREFLIGHT_MODULE_ALIAS_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "moduleAliases not found in package.json",
        defaultDetails: "package.json must export a moduleAliases object.",
        recoverable: true,
        suggestedAction: "Add a moduleAliases object to package.json.",
    },
    [ERROR_CODES.PREFLIGHT_MODULE_ALIAS_NOT_OBJECT]: {
        category: "PREFLIGHT",
        defaultMessage: "moduleAliases named object should be exported from package.json",
        defaultDetails: "moduleAliases was found in package.json but is not an object.",
        recoverable: true,
        suggestedAction: "Ensure moduleAliases is exported as an object in package.json.",
    },
    [ERROR_CODES.PREFLIGHT_MODULE_ALIAS_RESTRICTED]: {
        category: "PREFLIGHT",
        defaultMessage: "catalyst keyword is restricted for defining aliases",
        defaultDetails: "Module alias keys containing 'catalyst' are reserved by the framework.",
        recoverable: true,
        suggestedAction: "Rename the alias to something that does not contain 'catalyst'.",
    },
    [ERROR_CODES.PREFLIGHT_MODULE_ALIAS_KEY_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "required module alias not defined inside package.json",
        defaultDetails: "One or more required module aliases are missing from moduleAliases.",
        recoverable: true,
        suggestedAction: "Add the missing alias to the moduleAliases object in package.json.",
    },
    [ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "preServerInit named function should be defined in server/index.js",
        defaultDetails: "server/index.js must export a preServerInit function.",
        recoverable: true,
        suggestedAction: "Export a preServerInit function from server/index.js, or remove the reference to it.",
    },
    [ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "preServerInit should be a function present in server/index.js",
        defaultDetails: "preServerInit was found but is not a function.",
        recoverable: true,
        suggestedAction: "Ensure preServerInit is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_MIDDLEWARE_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "addMiddlewares named function not found in server/server.js",
        defaultDetails: "server/server.js must export an addMiddlewares function.",
        recoverable: true,
        suggestedAction: "Export an addMiddlewares function from server/server.js.",
    },
    [ERROR_CODES.PREFLIGHT_MIDDLEWARE_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "addMiddlewares should be a function present in server/server.js",
        defaultDetails: "addMiddlewares was found but is not a function.",
        recoverable: true,
        suggestedAction: "Ensure addMiddlewares is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_REDUCER_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "reducer not found in src/js/containers/App/reducer",
        defaultDetails: "A reducer must be exported from src/js/containers/App/reducer.",
        recoverable: true,
        suggestedAction: "Export a reducer from src/js/containers/App/reducer.",
    },
    [ERROR_CODES.PREFLIGHT_REDUCER_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "reducer should be present in src/js/containers/App/reducer",
        defaultDetails: "The reducer export was found but is not a function.",
        recoverable: true,
        suggestedAction: "Ensure the reducer is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "configureStore not found in file src/js/store/index.js",
        defaultDetails: "src/js/store/index.js must export a configureStore function.",
        recoverable: true,
        suggestedAction: "Export a configureStore function from src/js/store/index.js.",
    },
    [ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "configureStore should be a function exported from src/js/store/index.js",
        defaultDetails: "configureStore was found but is not a function.",
        recoverable: true,
        suggestedAction: "Ensure configureStore is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_GET_ROUTES_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "getRoutes not found in file src/js/routes/utils.js",
        defaultDetails: "src/js/routes/utils.js must export a getRoutes function.",
        recoverable: true,
        suggestedAction: "Export a getRoutes function from src/js/routes/utils.js.",
    },
    [ERROR_CODES.PREFLIGHT_GET_ROUTES_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "getRoutes should be a function exported from src/js/routers/index.js",
        defaultDetails: "getRoutes was found but is not a function.",
        recoverable: true,
        suggestedAction: "Ensure getRoutes is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "document not found in file server/document.js",
        defaultDetails: "server/document.js must export a document component.",
        recoverable: true,
        suggestedAction: "Export a document React component from server/document.js.",
    },
    [ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "document should be a react component exported from server/document.js",
        defaultDetails: "document was found but is not a function/component.",
        recoverable: true,
        suggestedAction: "Ensure document is exported as a React component (function).",
    },

    [ERROR_CODES.PROCESS_SERVER_INIT_FAILED]: {
        category: "PROCESS",
        defaultMessage: "preServerInit threw an error during server startup",
        defaultDetails:
            "The preServerInit hook failed. Note: server startup currently continues despite this error (tracked separately as a fix — see issue #298); this code only identifies which hook failed.",
        recoverable: true,
        suggestedAction: "Fix the error thrown inside your preServerInit hook (see the cause above).",
    },
    [ERROR_CODES.PROCESS_USER_HOOK_FAILED]: {
        category: "PROCESS",
        defaultMessage: "A user-defined hook threw an error",
        defaultDetails:
            "A user-defined hook (e.g. onRouteMatch, onFetcherError, onServerError) threw. It was caught so the SSR pipeline keeps running; see the cause above for which hook and why.",
        recoverable: true,
        suggestedAction: "Fix the error thrown inside the hook (see the cause above).",
    },

    [ERROR_CODES.BUNDLE_UPSTREAM_ERROR]: {
        category: "BUNDLE",
        defaultMessage: "Build failed in an upstream bundler step",
        defaultDetails:
            "This is a wrapper around an error from Vite/Rollup or another upstream build tool. See the printed upstream code/message for the actual cause — catalyst-core does not reinterpret it.",
        recoverable: true,
        suggestedAction: "Read the upstream error message/code printed above and fix the underlying issue.",
    },
    [ERROR_CODES.IOS_UPSTREAM_ERROR]: {
        category: "IOS",
        defaultMessage: "iOS build failed in an upstream toolchain step",
        defaultDetails: "This wraps an error from Xcode/CocoaPods. See the printed upstream output for the cause.",
        recoverable: true,
        suggestedAction: "Read the upstream Xcode/CocoaPods error printed above and fix the underlying issue.",
    },
    [ERROR_CODES.ANDROID_UPSTREAM_ERROR]: {
        category: "ANDROID",
        defaultMessage: "Android build failed in an upstream toolchain step",
        defaultDetails: "This wraps an error from Gradle. See the printed upstream output for the cause.",
        recoverable: true,
        suggestedAction: "Read the upstream Gradle error printed above and fix the underlying issue.",
    },

    [ERROR_CODES.RUNTIME_NATIVE_PERMISSION_DENIED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Permission denied",
        defaultDetails: "Required permission was not granted by the user",
        recoverable: true,
        suggestedAction: "Grant permission in device settings and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_PERMISSION_REQUIRED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Permission required",
        defaultDetails: "This operation requires additional permissions",
        recoverable: true,
        suggestedAction: "Grant the required permission to continue",
    },
    [ERROR_CODES.RUNTIME_NATIVE_NETWORK_UNAVAILABLE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "No internet connection",
        defaultDetails: "Network connection is required for this operation",
        recoverable: true,
        suggestedAction: "Check your internet connection and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_DOWNLOAD_FAILED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Download failed",
        defaultDetails: "The download could not be completed",
        recoverable: true,
        suggestedAction: "Check your connection and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_FILE_NOT_FOUND]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "File not found",
        defaultDetails: "The requested file could not be located",
        recoverable: false,
        suggestedAction: "The file may have been moved or deleted",
    },
    [ERROR_CODES.RUNTIME_NATIVE_FILE_TOO_LARGE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "File too large",
        defaultDetails: "File exceeds the maximum size limit",
        recoverable: true,
        suggestedAction: "Choose a smaller file or compress the current file",
    },
    [ERROR_CODES.RUNTIME_NATIVE_STORAGE_FULL]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Storage full",
        defaultDetails: "Device storage is full and cannot save the file",
        recoverable: true,
        suggestedAction: "Free up some storage space and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_FILE_CORRUPTED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "File corrupted",
        defaultDetails: "The file could not be read or is corrupted",
        recoverable: false,
        suggestedAction: "Try selecting a different file",
    },
    [ERROR_CODES.RUNTIME_NATIVE_OPERATION_CANCELLED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Operation cancelled",
        defaultDetails: "The operation was cancelled by the user",
        recoverable: true,
        suggestedAction: "Try again if you want to complete the operation",
    },
    [ERROR_CODES.RUNTIME_NATIVE_NO_FILE_SELECTED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "No file selected",
        defaultDetails: "No file was selected by the user",
        recoverable: true,
        suggestedAction: "Select a file and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_INVALID_FILE_TYPE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Invalid file type",
        defaultDetails: "The selected file type is not supported",
        recoverable: true,
        suggestedAction: "Choose a file with a supported format",
    },
    [ERROR_CODES.RUNTIME_NATIVE_INVALID_PARAMETERS]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Invalid parameters",
        defaultDetails: "One or more parameters passed to the native call were invalid",
        recoverable: true,
        suggestedAction: "Check the parameters passed to the native API call",
    },
    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_UNAVAILABLE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Native feature unavailable",
        defaultDetails: "The native bridge is not available or not initialized",
        recoverable: false,
        suggestedAction: "Use web fallback if available",
    },
    [ERROR_CODES.RUNTIME_NATIVE_FEATURE_UNSUPPORTED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Feature not supported",
        defaultDetails: "This feature is not supported on the current platform",
        recoverable: false,
        suggestedAction: "Try using an alternative method or device",
    },
    [ERROR_CODES.RUNTIME_NATIVE_INTERNAL_ERROR]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "An unexpected error occurred",
        defaultDetails: "An internal error occurred while processing the request",
        recoverable: true,
        suggestedAction: "Try again or contact support if the problem persists",
    },
    [ERROR_CODES.RUNTIME_NATIVE_CAMERA_UNAVAILABLE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Camera unavailable",
        defaultDetails: "Camera hardware is not available or accessible",
        recoverable: false,
        suggestedAction: "Check if your device has a camera and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_CAMERA_IN_USE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Camera in use",
        defaultDetails: "Camera is being used by another application",
        recoverable: true,
        suggestedAction: "Close other camera apps and try again",
    },

    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_INVALID_CALLBACK]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Invalid callback interface",
        defaultDetails: "The native platform invoked WebBridge.callback() with an interface name that isn't recognized.",
        recoverable: false,
        suggestedAction: "Check the interface name against the registered NATIVE_CALLBACKS list; this usually indicates a native/JS version mismatch.",
    },
    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_HANDLER_NOT_REGISTERED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "No handler registered for this bridge interface",
        defaultDetails: "The native platform called back on an interface that has no JS-side handler registered yet.",
        recoverable: true,
        suggestedAction: "Ensure WebBridge.register() is called for this interface before the native call arrives.",
    },
    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_HANDLER_THREW]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "A registered bridge callback handler threw",
        defaultDetails: "The JS handler registered for this native callback interface threw an error while processing the callback.",
        recoverable: true,
        suggestedAction: "Fix the error thrown inside the registered handler (see the cause above).",
    },
    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_INVALID_REGISTRATION]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Invalid bridge callback registration",
        defaultDetails: "WebBridge.register() was called with a non-function callback or an unrecognized interface name.",
        recoverable: true,
        suggestedAction: "Pass a function as the callback and a valid interface name from NATIVE_CALLBACKS.",
    },
    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_INIT_FAILED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "WebBridge could not be initialized",
        defaultDetails: "WebBridge.init() was called outside a browser environment (no `window` available).",
        recoverable: false,
        suggestedAction: "Call WebBridge.init() in a browser environment, before using bridge features.",
    },

    [ERROR_CODES.AI_UPSTREAM_ERROR]: {
        category: "AI",
        defaultMessage: "AI provider request failed",
        defaultDetails:
            "This is a wrapper around a non-2xx response or thrown error from the upstream AI provider (OpenAI/Gemini). See the printed upstream status/message for the actual cause — catalyst-ai does not reinterpret it.",
        recoverable: true,
        suggestedAction: "Read the upstream provider error printed above and fix the underlying issue (auth, rate limit, invalid request).",
    },
    [ERROR_CODES.AI_DISABLED]: {
        category: "AI",
        defaultMessage: "AI is disabled",
        defaultDetails: "AI_CONFIG.enabled is not set to true.",
        recoverable: true,
        suggestedAction: "Set AI_CONFIG.enabled=true in your environment configuration.",
    },
    [ERROR_CODES.AI_PROVIDER_NOT_CONFIGURED]: {
        category: "AI",
        defaultMessage: "AI provider not configured",
        defaultDetails: "The requested provider is unknown, or has no apiKey configured in AI_CONFIG.providers.",
        recoverable: true,
        suggestedAction: "Add the provider's apiKey to AI_CONFIG.providers, or use a configured provider.",
    },
    [ERROR_CODES.AI_INVALID_REQUEST_BODY]: {
        category: "AI",
        defaultMessage: "Invalid AI request body",
        defaultDetails: "The request body is missing a non-empty messages array, or no model could be resolved.",
        recoverable: true,
        suggestedAction: "Pass a non-empty messages array, and either a model or a provider defaultModel.",
    },
    [ERROR_CODES.AI_NATIVE_BRIDGE_UNAVAILABLE]: {
        category: "AI",
        defaultMessage: "Native AI bridge unavailable",
        defaultDetails: "window.NativeBridge.initAI or window.WebBridge was not found when useNativeAI mounted.",
        recoverable: false,
        suggestedAction: "Update catalyst-core to >=0.2.0, add the native AI module, and call WebBridge.init() before mounting useNativeAI.",
    },
    [ERROR_CODES.AI_NATIVE_STREAM_NOT_READY]: {
        category: "AI",
        defaultMessage: "Native AI stream not ready",
        defaultDetails: "generate() was called before the native side reported a ready stream URL (initAI has not fired ON_AI_READY yet).",
        recoverable: true,
        suggestedAction: "Wait for modelReady to become true before calling generate().",
    },
    [ERROR_CODES.AI_NATIVE_REQUEST_FAILED]: {
        category: "AI",
        defaultMessage: "Native AI request failed",
        defaultDetails: "The native AI HTTP endpoint returned a non-ok status or reported an error in its response body.",
        recoverable: true,
        suggestedAction: "See the cause above for the native-reported status/message.",
    },
    [ERROR_CODES.AI_NATIVE_CALLBACK_ERROR]: {
        category: "AI",
        defaultMessage: "Native AI reported an error",
        defaultDetails:
            "The native platform invoked ON_AI_ERROR — a failure during model load, init, or inference on the native side, not an HTTP request made by this JS code.",
        recoverable: true,
        suggestedAction: "See the cause above for the native-reported message.",
    },
    [ERROR_CODES.AI_WEB_WORKER_UNAVAILABLE]: {
        category: "AI",
        defaultMessage: "Web AI worker unavailable",
        defaultDetails: "Constructing the module Worker for in-browser AI failed — module workers may be unsupported in this browser.",
        recoverable: false,
        suggestedAction: "Use a browser with module Worker support, or fall back to useCloudAI/useNativeAI.",
    },
    [ERROR_CODES.AI_WEB_WORKER_CRASHED]: {
        category: "AI",
        defaultMessage: "Web AI worker crashed",
        defaultDetails:
            "The in-browser AI worker threw during model load or generation (e.g. all device backends failed, or an uncaught exception). See the cause above for the worker's reported message.",
        recoverable: true,
        suggestedAction: "Check that the model is compatible with this browser/device, or use useCloudAI/useNativeAI instead.",
    },

    [ERROR_CODES.RUNTIME_WEB_RENDER_FAILED]: {
        category: "RUNTIME-WEB",
        defaultMessage: "Rendering failed on the server",
        defaultDetails:
            "An error was thrown while streaming or rendering the document on the server. This may originate from app code, a third-party dependency, or catalyst-core itself — see the cause above for the actual error.",
        recoverable: true,
        suggestedAction: "See the cause above for the error thrown during rendering.",
    },
    [ERROR_CODES.RUNTIME_WEB_FETCHER_FAILED]: {
        category: "RUNTIME-WEB",
        defaultMessage: "serverFetcher failed",
        defaultDetails:
            "An error was thrown while executing a route's serverFetcher function(s). This may originate from app code, a third-party dependency, or catalyst-core itself — see the cause above for the actual error.",
        recoverable: true,
        suggestedAction: "See the cause above for the error thrown inside serverFetcher.",
    },
    [ERROR_CODES.RUNTIME_WEB_SERVER_SIDE_FUNCTION_FAILED]: {
        category: "RUNTIME-WEB",
        defaultMessage: "App.serverSideFunction failed",
        defaultDetails:
            "An error was thrown while executing the app-level serverSideFunction hook. This may originate from app code, a third-party dependency, or catalyst-core itself — see the cause above for the actual error.",
        recoverable: true,
        suggestedAction: "See the cause above for the error thrown inside serverSideFunction.",
    },
    [ERROR_CODES.RUNTIME_WEB_REQUEST_HANDLING_FAILED]: {
        category: "RUNTIME-WEB",
        defaultMessage: "Failed to handle document request",
        defaultDetails:
            "An unhandled error reached the top level of the SSR request handler. This may originate from app code, a third-party dependency, or catalyst-core itself — see the cause above for the actual error.",
        recoverable: false,
        suggestedAction: "See the cause above for the underlying error.",
    },
}

export function getDefinition(code) {
    return ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS[ERROR_CODES.RUNTIME_NATIVE_INTERNAL_ERROR]
}

export function getDocUrl(code) {
    const def = ERROR_DEFINITIONS[code]
    if (!def) return null
    return docUrl(def.category, code)
}
