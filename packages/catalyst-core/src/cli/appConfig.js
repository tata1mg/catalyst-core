"use strict"

const fs = require("fs")
const path = require("path")

const { diagnostic } = require("./diagnostic.js")

/**
 * Read the app's config/config.json with an actionable error.
 *
 * The native entry points used to `require()` this at module load, so a missing
 * or malformed config threw a raw MODULE_NOT_FOUND / SyntaxError stack before
 * any of the build output appeared.
 *
 * Lives here because this layer is CJS and is consumed from both sides: the
 * native builds require() it directly, the ESM scripts via createRequire.
 *
 * @param {string} [cwd] - app root; defaults to the current working directory
 */
function loadAppConfig(cwd = process.cwd()) {
    const configPath = path.join(cwd, "config", "config.json")

    let raw
    try {
        raw = fs.readFileSync(configPath, "utf8")
    } catch (error) {
        process.stderr.write(
            diagnostic({
                message:
                    error.code === "ENOENT"
                        ? "Config file not found"
                        : `Could not read config file: ${error.message}`,
                file: configPath,
                hint: "Every Catalyst app needs a config/config.json at its root.",
            })
        )
        process.exit(1)
    }

    try {
        return JSON.parse(raw)
    } catch (error) {
        process.stderr.write(
            diagnostic({ message: `Config file is not valid JSON: ${error.message}`, file: configPath })
        )
        process.exit(1)
    }
}

module.exports = { loadAppConfig }
