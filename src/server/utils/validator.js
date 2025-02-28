const pc = require("picocolors")

const handleError = (e) => {
    console.log(pc.red("Failed to start server: "), e)
}

const safeCall = (fn, ...args) => {
    try {
        if (!fn) return
        if (typeof fn !== "function") {
            console.log(pc.red("Invalid lifecycle method defined in server/index.js"))
            return
        }
        fn(...args)
    } catch (e) {
        console.log(pc.red(`Failed to execute ${fn.name}: `), e)
    }
}

const validatePreInitServer = (fn) => {
    try {
        if (!fn) throw new Error("preServerInit named function should be defined in server/index.js")
        if (typeof fn !== "function")
            throw new Error("preServerInit should be function present in server/index.js")
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateMiddleware = (fn) => {
    try {
        if (!fn) throw new Error("addMiddlewares named function not found in server/server.js")
        if (typeof fn !== "function")
            throw new Error("addMiddlewares should be function present in server/server.js")
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateReducerFunction = (fn) => {
    try {
        if (!fn) throw new Error("reducer not found in src/js/containers/App/reducer")
        if (typeof fn !== "function")
            throw new Error("reducer should present in src/js/containers/App/reducer")
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateConfigFile = (obj) => {
    try {
        if (!obj) throw new Error("config not found in config folder")
        if (typeof obj !== "object")
            throw new Error(
                "config object should be exported from config folder inside your project root directory"
            )
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
                if (!(key in obj)) throw new Error(`${key} key not found inside config.json`)
            }
        }
        return true
    } catch (e) {
        handleError(e)
    }
}

const validatePackageJson = (obj) => {
    try {
        if (!obj) throw new Error("package.json not found in the project")
        if (typeof obj !== "object")
            throw new Error("package.json should be defined in project root directory")
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateModuleAlias = (obj) => {
    try {
        if (!obj) throw new Error("moduleAliases not found in package.json file present in root directory.")
        if (typeof obj !== "object")
            throw new Error("moduleAliases named object should be exported from package.json")
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
                if (key.includes("catalyst"))
                    throw new Error(`Catalyst keyword is restricted for defining aliases`)
                if (!(key in obj)) throw new Error(`${key} module alias not defined inside package.json`)
            }
        }
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateConfigureStore = (fn) => {
    try {
        if (!fn) throw new Error("configureStore not found in file src/js/store/index.js")
        if (typeof fn !== "function")
            throw new Error("configureStore should be function exported from src/js/store/index.js")
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateGetRoutes = (fn) => {
    try {
        if (!fn) throw new Error("getRoutes not found in file src/js/routes/utils.js")
        if (typeof fn !== "function")
            throw new Error("getRoutes should be function exported from src/js/routers/index.js")
        return true
    } catch (e) {
        handleError(e)
    }
}

const validateCustomDocument = (fn) => {
    try {
        if (!fn) throw new Error("document not found in file server/document.js")
        if (typeof fn !== "function")
            throw new Error("document should be a react component exported from server/document.js")
        return true
    } catch (e) {
        handleError(e)
    }
}

module.exports = {
    safeCall,
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
