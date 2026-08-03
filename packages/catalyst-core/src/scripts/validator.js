import pc from "picocolors"
import { createError, formatError, ERROR_CODES } from "../errors/index.js"

const handleError = (e) => {
    console.log(pc.red("Failed to start server: "), formatError(e))
}

const validatePreInitServer = (fn) => {
    try {
        if (!fn) throw createError(ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_MISSING)
        if (typeof fn !== "function") throw createError(ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_NOT_FUNCTION)
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateMiddleware = (fn) => {
    try {
        if (!fn) throw createError(ERROR_CODES.PREFLIGHT_MIDDLEWARE_MISSING)
        if (typeof fn !== "function") throw createError(ERROR_CODES.PREFLIGHT_MIDDLEWARE_NOT_FUNCTION)
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateReducerFunction = (fn) => {
    try {
        if (!fn) throw createError(ERROR_CODES.PREFLIGHT_REDUCER_MISSING)
        if (typeof fn !== "function") throw createError(ERROR_CODES.PREFLIGHT_REDUCER_NOT_FUNCTION)
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateConfigFile = (obj) => {
    try {
        if (!obj) throw createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
        if (typeof obj !== "object") throw createError(ERROR_CODES.PREFLIGHT_CONFIG_NOT_OBJECT)
        if (typeof obj === "object") {
            const requiredConfigKeys = {
                NODE_SERVER_HOSTNAME: "",
                NODE_SERVER_PORT: "",
                WEBPACK_DEV_SERVER_HOSTNAME: "",
                WEBPACK_DEV_SERVER_PORT: "",
                BUILD_OUTPUT_PATH: "",
                PUBLIC_STATIC_ASSET_PATH: "",
                PUBLIC_STATIC_ASSET_URL: "",
                CLIENT_ENV_VARIABLES: [],
                ANALYZE_BUNDLE: "",
            }
            for (let key in requiredConfigKeys) {
                if (!(key in obj))
                    throw createError(ERROR_CODES.PREFLIGHT_CONFIG_KEY_MISSING, {
                        details: `${key} key not found inside config.json`,
                    })
            }
        }
        return true
    } catch (e) {
        handleError(e)
    }
}

const validatePackageJson = (obj) => {
    try {
        if (!obj) throw createError(ERROR_CODES.PREFLIGHT_PACKAGE_JSON_MISSING)
        if (typeof obj !== "object") throw createError(ERROR_CODES.PREFLIGHT_PACKAGE_JSON_INVALID)
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateModuleAlias = (obj) => {
    try {
        if (!obj) throw createError(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_MISSING)
        if (typeof obj !== "object") throw createError(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_NOT_OBJECT)
        if (typeof obj === "object") {
            const requiredModuleAliases = {
                "@api": "api.js",
                "@containers": "src/js/containers",
                "@server": "server",
                "@config": "config",
                "@css": "src/static/css",
                "@routes": "src/js/routes/",
            }
            for (let key in requiredModuleAliases) {
                if (key.includes("catalyst")) throw createError(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_RESTRICTED)
                if (!(key in obj))
                    throw createError(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_KEY_MISSING, {
                        details: `${key} module alias not defined inside package.json`,
                    })
            }
        }
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateConfigureStore = (fn) => {
    try {
        if (!fn) throw createError(ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_MISSING)
        if (typeof fn !== "function") throw createError(ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_NOT_FUNCTION)
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateGetRoutes = (fn) => {
    try {
        if (!fn) throw createError(ERROR_CODES.PREFLIGHT_GET_ROUTES_MISSING)
        if (typeof fn !== "function") throw createError(ERROR_CODES.PREFLIGHT_GET_ROUTES_NOT_FUNCTION)
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateCustomDocument = (fn) => {
    try {
        if (!fn) throw createError(ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_MISSING)
        if (typeof fn !== "function") throw createError(ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_NOT_FUNCTION)
        return true
    } catch (e) {
        handleError(e)
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
}
