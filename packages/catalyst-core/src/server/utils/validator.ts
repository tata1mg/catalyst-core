import pc from "ansis"
import { createError, formatError, ERROR_CODES } from "../../errors/index.js"
import { resolveOutputMode, getDebugEnvInfo } from "../../scripts/scriptUtils.js"

// Resolved once at module load — this module runs inside expressServer.js,
// spawned by serve.js/start.js which forward the mode via
// CATALYST_OUTPUT_MODE. Passed an empty argv on purpose: this process never
// sees the parent's CLI flags, so only CATALYST_OUTPUT_MODE is real input.
const outputMode = resolveOutputMode([], process.env)

/**
 * Log a contract violation and continue.
 *
 * Validation is log-and-continue, not throw-and-exit: a violation is reported
 * through the shared structured-error formatter and the validator returns
 * `undefined` to its caller. The startup sequence proceeds, and the first real
 * consequence of the missing/invalid app export surfaces where it is used.
 */
const handleError = (e: any) => {
    const debugEnv = outputMode === "debug" ? getDebugEnvInfo() : undefined
    if (outputMode === "default") {
        console.log(pc.red("Failed to start server: "), formatError(e, outputMode))
    } else {
        console.log(formatError(e, outputMode, debugEnv))
    }
}

const validatePreInitServer = (fn: any) => {
    try {
        if (!fn) throw createError(ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_MISSING)
        if (typeof fn !== "function") throw createError(ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_NOT_FUNCTION)
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateMiddleware = (fn: any) => {
    try {
        if (!fn) throw createError(ERROR_CODES.PREFLIGHT_MIDDLEWARE_MISSING)
        if (typeof fn !== "function") throw createError(ERROR_CODES.PREFLIGHT_MIDDLEWARE_NOT_FUNCTION)
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateReducerFunction = (fn: any) => {
    try {
        if (!fn) throw createError(ERROR_CODES.PREFLIGHT_REDUCER_MISSING)
        if (typeof fn !== "function") throw createError(ERROR_CODES.PREFLIGHT_REDUCER_NOT_FUNCTION)
        return true
    } catch (e) {
        handleError(e)
    }
}

const REQUIRED_CONFIG_KEYS = [
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

const REQUIRED_MODULE_ALIASES = ["@api", "@containers", "@server", "@config", "@css", "@routes"]

const validateConfigFile = (obj: any) => {
    try {
        if (!obj) throw createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
        if (typeof obj !== "object") throw createError(ERROR_CODES.PREFLIGHT_CONFIG_NOT_OBJECT)

        for (const key of REQUIRED_CONFIG_KEYS) {
            if (!(key in obj))
                throw createError(ERROR_CODES.PREFLIGHT_CONFIG_KEY_MISSING, {
                    details: `${key} key not found inside config.json`,
                })
        }
        return true
    } catch (e) {
        handleError(e)
    }
}

const validatePackageJson = (obj: any) => {
    try {
        if (!obj) throw createError(ERROR_CODES.PREFLIGHT_PACKAGE_JSON_MISSING)
        if (typeof obj !== "object") throw createError(ERROR_CODES.PREFLIGHT_PACKAGE_JSON_INVALID)
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateModuleAlias = (obj: any) => {
    try {
        if (!obj) throw createError(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_MISSING)
        if (typeof obj !== "object") throw createError(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_NOT_OBJECT)

        // Checked against the app's own alias keys. The reserved-keyword rule is
        // about what the app declares, so iterating the required-alias list here
        // (none of which contain "catalyst") could never fire.
        const reserved = Object.keys(obj).filter((key) => key.includes("catalyst"))
        if (reserved.length)
            throw createError(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_RESTRICTED, {
                details: `Restricted "catalyst" keyword used in module alias${reserved.length > 1 ? "es" : ""}: ${reserved.join(", ")}`,
            })

        for (const key of REQUIRED_MODULE_ALIASES) {
            if (!(key in obj))
                throw createError(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_KEY_MISSING, {
                    details: `${key} module alias not defined inside package.json`,
                })
        }
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateConfigureStore = (fn: any) => {
    try {
        if (!fn) throw createError(ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_MISSING)
        if (typeof fn !== "function") throw createError(ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_NOT_FUNCTION)
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateGetRoutes = (fn: any) => {
    try {
        if (!fn) throw createError(ERROR_CODES.PREFLIGHT_GET_ROUTES_MISSING)
        if (typeof fn !== "function") throw createError(ERROR_CODES.PREFLIGHT_GET_ROUTES_NOT_FUNCTION)
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateCustomDocument = (fn: any) => {
    try {
        if (!fn) throw createError(ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_MISSING)
        if (typeof fn !== "function") throw createError(ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_NOT_FUNCTION)
        return true
    } catch (e) {
        handleError(e)
    }
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
const safeCall = async (fn: any, ...args: any[]) => {
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
const safeCallNamed = async (hookName: string, fn: any, ...args: any[]) => {
    if (typeof fn !== "function") return
    try {
        return await fn(...args)
    } catch (e) {
        const code =
            hookName === "preServerInit"
                ? ERROR_CODES.PROCESS_SERVER_INIT_FAILED
                : ERROR_CODES.PROCESS_USER_HOOK_FAILED
        const wrapped = createError(code, {
            details: `The "${hookName}" hook threw. See the cause below.`,
            cause: e,
        })
        const debugEnv = outputMode === "debug" ? getDebugEnvInfo() : undefined
        console.error(formatError(wrapped, outputMode, debugEnv))
    }
}

export {
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
