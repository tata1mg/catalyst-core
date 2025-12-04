import path from "path"
import fs from "fs"

const appConfigPath = path.resolve(process.env.src_path, "config/config.json")
// import { validateConfigFile } from "../scripts/validator"

/**
 * Default PPR (Partial Pre-rendering) configuration
 * These can be overridden by user config or environment variables
 */
const PPR_DEFAULTS = {
    ENABLE_PPR: "true", // Enable PPR streaming by default
}

/**
 * @description stores all config.json key value into process.env before server starts.
 */
const loadEnvironmentVariables = async () => {
    try {
        const filterKeys = JSON.parse(process.env.filterKeys)
        const configContent = fs.readFileSync(appConfigPath, "utf8")
        const appConfig = JSON.parse(configContent)
        const newConfig = {}

        // Set PPR defaults first (can be overridden by user config)
        for (let k in PPR_DEFAULTS) {
            newConfig[k] = PPR_DEFAULTS[k]
        }

        // Set environment variables from config
        for (let k in appConfig) {
            // Handle both primitive values and objects
            newConfig[k] = typeof appConfig[k] === "object" ? JSON.stringify(appConfig[k]) : appConfig[k]
        }
        for (let i = 0; i < filterKeys.length; i++) {
            const key = filterKeys[i]
            // Handle both primitive values and objects
            newConfig[key] =
                typeof process.env[key] === "object" ? JSON.stringify(process.env[key]) : process.env[key]
        }
        process.env = newConfig
    } catch (error) {
        console.error("Error loading environment variables:", error)
        throw error
    }
}

export default loadEnvironmentVariables
