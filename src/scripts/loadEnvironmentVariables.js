const appConfig = require("@catalyst/template/config/config.json")
const { validateConfigFile } = require("@catalyst/scripts/validator.js")

/**
 * @description stores all config.json key value into process.env before server starts.
 */
const loadEnvironmentVariables = () => {
    if (validateConfigFile(appConfig)) {
        for (let k in appConfig) {
            // below code provides support for object handling present in config.
            // However, for usage on client the client logic in define plugin needs to be checked and updated
            process.env[k] = typeof appConfig[k] === "object" ? JSON.stringify(appConfig[k]) : appConfig[k]
        }
    }

    // Load Sentry configuration if it exists
    try {
        const sentryConfig = require("@catalyst/template/config/sentry.config.json")
        process.env.SENTRY_CONFIG = JSON.stringify(sentryConfig)
    } catch (error) {
        console.warn("Warning: Failed to load sentry.config.json")
    }
}

export default loadEnvironmentVariables
