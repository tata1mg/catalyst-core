import path from "path"
import fs from "fs"

/**
 * @description stores all config.json key value into process.env before server starts.
 */
const loadEnvironmentVariables = async () => {
    try {
        // Resolved at call time, not import time, so preServerInit.js can report a
        // missing src_path before any path is built from it.
        const appConfigPath = path.resolve(process.env.src_path, "config/config.json")
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
        // Merge config.json + filterKeys into the existing process.env instead of
        // replacing it outright. start.js/serve.js forward the full parent
        // process.env into this process (spawnSync(..., { env: { ...process.env, ... } }))
        // specifically so arbitrary env vars (e.g. catalyst-ai's AI_CONFIG, or anything
        // else a consumer/package expects to read from process.env) survive into the
        // server process — a wholesale replace here silently discarded all of them
        // except the small filterKeys allowlist, before any request handler got a
        // chance to read them.
        //
        // Build the merge in a plain object and reassign process.env, rather than
        // Object.assign(process.env, newConfig) directly: writing through the real
        // process.env setter coerces every value to a string (process.env.X = true
        // becomes the string "true"), which would break consumers that compare a
        // config boolean strictly (e.g. expressServer.ts's
        // `process.env.OTEL_ENABLE === true` — see its own comment noting it relies
        // on process.env holding a real boolean here). Reassigning a plain object
        // preserves the primitive types newConfig already carries, same as the
        // original wholesale-replace behavior did for config.json values, while
        // still keeping every pre-existing process.env entry via the spread.
        process.env = { ...process.env, ...newConfig }
    } catch (error) {
        console.error("Error loading environment variables:", error)
        throw error
    }
}

export default loadEnvironmentVariables
