import pc from "ansis"
import { createError, formatError, ERROR_CODES } from "../../errors/index.js"
import { resolveOutputMode, getDebugEnvInfo } from "../../scripts/scriptUtils.js"

// Resolved once at module load — this module runs inside expressServer.js,
// spawned by serve.js/start.js which forward the mode via
// CATALYST_OUTPUT_MODE. Passed an empty argv on purpose: this process never
// sees the parent's CLI flags, so only CATALYST_OUTPUT_MODE is real input.
const outputMode = resolveOutputMode([], process.env)

// The validate* functions are PURE: they return `null` when the input is
// valid and a `CatalystError` (never thrown, never logged) when it isn't.
// This lets two very different callers share one definition:
//   - scripts/preflight.js (parent CLI process) collects the errors from
//     several validators and prints them all, then exits non-zero.
//   - the in-server call sites (expressServer.js, handler.jsx) log the
//     single error and fall back, keeping the request alive.
// `handleError` below is the shared "log it, in whatever output mode" helper
// those in-server sites use.
const handleError = (e) => {
    const debugEnv = outputMode === "debug" ? getDebugEnvInfo() : undefined
    if (outputMode === "default") {
        console.log(pc.red("Failed to start server: "), formatError(e, outputMode))
    } else {
        console.log(formatError(e, outputMode, debugEnv))
    }
}

const validatePreInitServer = (fn) => {
    if (!fn) return createError(ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_MISSING)
    if (typeof fn !== "function") return createError(ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_NOT_FUNCTION)
    return null
}

const validateMiddleware = (fn) => {
    if (!fn) return createError(ERROR_CODES.PREFLIGHT_MIDDLEWARE_MISSING)
    if (typeof fn !== "function") return createError(ERROR_CODES.PREFLIGHT_MIDDLEWARE_NOT_FUNCTION)
    return null
}

const validateReducerFunction = (fn) => {
    if (!fn) return createError(ERROR_CODES.PREFLIGHT_REDUCER_MISSING)
    if (typeof fn !== "function") return createError(ERROR_CODES.PREFLIGHT_REDUCER_NOT_FUNCTION)
    return null
}

const validateConfigFile = (obj) => {
    if (!obj) return createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
    if (typeof obj !== "object") return createError(ERROR_CODES.PREFLIGHT_CONFIG_NOT_OBJECT)
    const requiredConfigKeys = [
        "NODE_SERVER_HOSTNAME",
        "NODE_SERVER_PORT",
        "WEBPACK_DEV_SERVER_HOSTNAME",
        "WEBPACK_DEV_SERVER_PORT",
        "BUILD_OUTPUT_PATH",
        "PUBLIC_STATIC_ASSET_PATH",
        "PUBLIC_STATIC_ASSET_URL",
        "CLIENT_ENV_VARIABLES",
        "ANALYZE_BUNDLE",
    ]
    for (const key of requiredConfigKeys) {
        if (!(key in obj))
            return createError(ERROR_CODES.PREFLIGHT_CONFIG_KEY_MISSING, {
                details: `${key} key not found inside config.json`,
            })
    }
    return null
}

const validatePackageJson = (obj) => {
    if (!obj) return createError(ERROR_CODES.PREFLIGHT_PACKAGE_JSON_MISSING)
    if (typeof obj !== "object") return createError(ERROR_CODES.PREFLIGHT_PACKAGE_JSON_INVALID)
    return null
}

const validateModuleAlias = (obj) => {
    if (!obj) return createError(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_MISSING)
    if (typeof obj !== "object") return createError(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_NOT_OBJECT)
    // A consumer app must not shadow the framework's own "@catalyst*" aliases
    // (both "@catalyst/…" and "@catalyst-…" are reserved) with its own
    // moduleAliases entries — check the INPUT's keys, not the required list
    // (that check was previously on the wrong side and could never fire;
    // PREFLIGHT-008). Anchored to the start and case-insensitive: a bare
    // `.includes("catalyst")` also (wrongly) rejected unrelated names like
    // "@my-catalyst-helpers", which don't shadow anything.
    if (Object.keys(obj).some((key) => /^@catalyst($|[/-])/i.test(key)))
        return createError(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_RESTRICTED)
    const requiredModuleAliases = ["@api", "@containers", "@server", "@config", "@css", "@routes"]
    for (const key of requiredModuleAliases) {
        if (!(key in obj))
            return createError(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_KEY_MISSING, {
                details: `${key} module alias not defined inside package.json`,
            })
    }
    return null
}

const validateConfigureStore = (fn) => {
    if (!fn) return createError(ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_MISSING)
    if (typeof fn !== "function") return createError(ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_NOT_FUNCTION)
    return null
}

const validateGetRoutes = (fn) => {
    if (!fn) return createError(ERROR_CODES.PREFLIGHT_GET_ROUTES_MISSING)
    if (typeof fn !== "function") return createError(ERROR_CODES.PREFLIGHT_GET_ROUTES_NOT_FUNCTION)
    return null
}

const validateCustomDocument = (fn) => {
    if (!fn) return createError(ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_MISSING)
    if (typeof fn !== "function") return createError(ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_NOT_FUNCTION)
    return null
}

/**
 * Safely call a function, catching and logging any errors — including a
 * rejected promise if `fn` is async. Used for user-defined hooks
 * (preServerInit, onRouteMatch, onFetcherError, onServerError, etc.) that
 * should never crash the SSR pipeline.
 *
 * Async by necessity: awaiting `fn`'s return value is the only way to catch
 * a rejection in the same try/catch as a synchronous throw. Existing call
 * sites that don't await safeCall(...) are unaffected — they already
 * treated its return value as fire-and-forget — but the rejection now
 * reaches the same structured-error path a sync throw does, instead of
 * surfacing as an unhandled promise rejection.
 */
const safeCall = async (fn, ...args) => {
    if (typeof fn !== "function") return
    try {
        return await fn(...args)
    } catch (e) {
        const wrapped = createError(ERROR_CODES.PROCESS_USER_HOOK_FAILED, { cause: e })
        const debugEnv = outputMode === "debug" ? getDebugEnvInfo() : undefined
        console.error(formatError(wrapped, outputMode, debugEnv))
    }
}

/**
 * Same as safeCall, but names the specific hook (e.g. "preServerInit") in the
 * error so it's identifiable rather than generic. Used at call sites that know
 * which hook they're invoking.
 */
const safeCallNamed = async (hookName, fn, ...args) => {
    if (typeof fn !== "function") return
    try {
        return await fn(...args)
    } catch (e) {
        const code = hookName === "preServerInit" ? ERROR_CODES.PROCESS_SERVER_INIT_FAILED : ERROR_CODES.PROCESS_USER_HOOK_FAILED
        const wrapped = createError(code, {
            details: `The "${hookName}" hook threw. See the cause below.`,
            cause: e,
        })
        const debugEnv = outputMode === "debug" ? getDebugEnvInfo() : undefined
        console.error(formatError(wrapped, outputMode, debugEnv))
    }
}

export {
    handleError,
    validateConfigFile,
    validateConfigureStore,
    validateCustomDocument,
    validateGetRoutes,
    validatePackageJson,
    validateReducerFunction,
    validateModuleAlias,
    validatePreInitServer,
    validateMiddleware,
    safeCall,
    safeCallNamed,
}
