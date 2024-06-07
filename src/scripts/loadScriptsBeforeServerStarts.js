/* eslint-disable */
import _registerAliases from "./registerAliases.js"
import csshook from "@dr.pogodin/css-modules-require-hook"
import path from "path"
import moduleAlias from "module-alias"
import loadEnvironmentVariables from "./loadEnvironmentVariables"

const { _moduleAliases } = require("@template/package.json")
const { cssModulesIdentifierDev } = require("@catalyst/root/config.json")

import { configureLogger } from "@catalyst/logger.js"
import { validateModuleAlias } from "@catalyst/scripts/validator.js"

// stores your config keys in enviorments variables
loadEnvironmentVariables()

// creates logger instance with provided config and stores them at global level.
configureLogger({
    enableDebugLogs: process.env.ENABLE_DEBUG_LOGS,
    enableFileLogging: process.env.ENABLE_FILE_LOGGING,
    enableConsoleLogging: process.env.ENABLE_CONSOLE_LOGGING,
})

// resolves module alias imports
if (validateModuleAlias(_moduleAliases)) {
    moduleAlias.addAliases(
        Object.keys(_moduleAliases || []).reduce((resultMap, aliasName) => {
            const aliasPath = _moduleAliases[aliasName]

            if (aliasPath.includes("server")) {
                if (process.env.NODE_ENV !== "production") {
                    resultMap[aliasName] = path.join(process.env.src_path, aliasPath)
                } else {
                    resultMap[aliasName] = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH)
                }
            } else resultMap[aliasName] = path.join(process.env.src_path, aliasPath)

            return resultMap
        }, {})
    )
}

// compile css-variables in realtime in dev mode.
if (process.env.NODE_ENV === "development")
    csshook({
        extensions: [".scss", ".css"],
        generateScopedName: cssModulesIdentifierDev,
        devMode: true,
        ignore: path.join(process.env.src_path, "/src/static/css/base/(?!.*.scss$).*"),
    })
