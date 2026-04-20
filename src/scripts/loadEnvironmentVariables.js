const fs = require("fs")
const path = require("path")
const pc = require("picocolors")
const { validateConfigFile } = require("@catalyst/scripts/validator.js")

const CONFIG_PATH = path.join(process.cwd(), "config", "config.json")

const safeLoadJson = (filePath, { optional = false } = {}) => {
    try {
        const raw = fs.readFileSync(filePath, "utf-8")
        return JSON.parse(raw)
    } catch (err) {
        if (optional && err.code === "ENOENT") return null
        if (err.code === "ENOENT") {
            console.log(pc.red(`config file not found at ${filePath}`))
        } else if (err instanceof SyntaxError) {
            console.log(
                pc.red(
                    `Invalid JSON in ${filePath}\n  ${err.message}\n` +
                        `Check for trailing commas, unquoted keys, or missing brackets.`
                )
            )
        } else {
            console.log(pc.red(`Failed to load ${filePath}: ${err.message}`))
        }
        process.exit(1)
    }
}

/**
 * @description stores all config.json key value into process.env before server starts.
 */
const loadEnvironmentVariables = () => {
    const appConfig = safeLoadJson(CONFIG_PATH)
    if (validateConfigFile(appConfig)) {
        for (let k in appConfig) {
            // below code provides support for object handling present in config.
            // However, for usage on client the client logic in define plugin needs to be checked and updated
            process.env[k] = typeof appConfig[k] === "object" ? JSON.stringify(appConfig[k]) : appConfig[k]
        }
    }

    const sentryConfigPath = path.join(process.cwd(), "config", "sentry.config.json")
    const sentryConfig = safeLoadJson(sentryConfigPath, { optional: true })
    if (sentryConfig) {
        process.env.SENTRY_CONFIG = JSON.stringify(sentryConfig)
    }
}

export default loadEnvironmentVariables
