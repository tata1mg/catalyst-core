/* eslint-disable */
import "./registerAliases.js"
import csshook from "@dr.pogodin/css-modules-require-hook"
import path from "path"
import loadEnvironmentVariables from "./loadEnvironmentVariables"
import postcssScssParser from "postcss-scss"

const { cssModulesIdentifierDev } = require("@catalyst/root/config.json")

import { configureLogger } from "@catalyst/logger.js"

// stores your config keys in enviorments variables
loadEnvironmentVariables()

// creates logger instance with provided config and stores them at global level.
configureLogger({
    enableDebugLogs: process.env.ENABLE_DEBUG_LOGS,
    enableFileLogging: process.env.ENABLE_FILE_LOGGING,
    enableConsoleLogging: process.env.ENABLE_CONSOLE_LOGGING,
})

// compile css-variables in realtime in dev mode.
if (process.env.NODE_ENV === "development")
    csshook({
        extensions: [".scss", ".css"],
        processorOpts: { parser: postcssScssParser.parse },
        generateScopedName: cssModulesIdentifierDev,
        devMode: true,
        ignore: path.posix.join(process.env.src_path, "/src/static/css/base/(?!.*.scss$).*"),
    })
