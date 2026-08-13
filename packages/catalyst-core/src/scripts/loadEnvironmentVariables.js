import path from "path"
import fs from "fs"
import { createRequire } from "module"

const { diagnostic } = createRequire(import.meta.url)("../cli/diagnostic.js")

const appConfigPath = path.resolve(process.env.src_path, "config/config.json")
/**
 * @description stores all config.json key value into process.env before server starts.
 */
const loadEnvironmentVariables = async () => {
    try {
        const filterKeys = JSON.parse(process.env.filterKeys)
        const configContent = fs.readFileSync(appConfigPath, "utf8")
        const appConfig = JSON.parse(configContent)
        const newConfig = {}
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
        // This runs before the server starts, for both `start` and `serve`, so
        // a missing or malformed config used to greet the user with a raw
        // ENOENT/SyntaxError stack trace as the very first thing they saw.
        process.stderr.write(
            diagnostic({
                message:
                    error.code === "ENOENT"
                        ? "Config file not found"
                        : error instanceof SyntaxError
                          ? `Config file is not valid JSON: ${error.message}`
                          : `Could not load configuration: ${error.message}`,
                file: appConfigPath,
                hint:
                    error.code === "ENOENT"
                        ? "Every Catalyst app needs a config/config.json at its root."
                        : undefined,
            })
        )
        throw error
    }
}

export default loadEnvironmentVariables
