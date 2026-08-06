import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import util from "node:util"
import pkg from "ansis"
const { gray, cyan } = pkg

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let cachedCatalystCoreVersion

// Function to get file size synchronously
function getFileSizeSync(filePath) {
    try {
        const stats = fs.statSync(filePath)
        return stats.size
    } catch (err) {
        console.error(`Error getting bundle information for file ${filePath}: ${err}`)
        return null
    }
}

export const printBundleInformation = () => {
    let bundleList = []
    const directoryPath = path.join(process.env.src_path, `build/public`)

    try {
        const files = fs.readdirSync(directoryPath)
        files.forEach((file) => {
            if (!file.includes("txt") && !file.includes("json")) {
                // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - file comes from fs.readdirSync(directoryPath), i.e. actual filenames already on disk in the build output, not request input.
                const filePath = path.join(directoryPath, file)
                const fileSize = getFileSizeSync(filePath)
                if (fileSize !== null) {
                    bundleList.push({ file, fileSize })
                }
            }
        })
    } catch (err) {
        console.error("Unable to scan build folder: " + err)
    }

    bundleList.sort((a, b) => b.fileSize - a.fileSize)
    bundleList.forEach(({ file, fileSize }) => {
        const fileName = `${gray(`build/public/`)}${cyan(file)}`
        const fileSizeInKb = (fileSize / 1024).toFixed(2)
        const size = `\t${fileSizeInKb} kB`.padEnd(16)

        console.log(util.format(size, fileName))
    })
}

export function arrayToObject(array) {
    const obj = {}
    array.forEach((item) => {
        const [key, value] = item.split("=")
        if (value) obj[key] = value
    })
    return obj
}

/**
 * Resolve the output mode for error formatting from a bare boolean CLI flag
 * (--debug/--verbose, matching the --inspect convention already used by
 * serve.js — not arrayToObject, which requires --key=value and silently
 * drops valueless flags) or an inherited CATALYST_OUTPUT_MODE env var, for
 * scripts spawned as a child process (see serve.js/start.js forwarding it
 * to expressServer.js). An explicit flag on argv wins over an inherited env
 * value, so e.g. `catalyst serve --debug` overrides a parent that set
 * CATALYST_OUTPUT_MODE=verbose.
 */
export function resolveOutputMode(argv = process.argv, env = process.env) {
    if (argv.includes("--debug")) return "debug"
    if (argv.includes("--verbose")) return "verbose"
    if (env.CATALYST_OUTPUT_MODE === "debug" || env.CATALYST_OUTPUT_MODE === "verbose") {
        return env.CATALYST_OUTPUT_MODE
    }
    return "default"
}

/**
 * Environment info for debug-mode error output: catalyst-core's own
 * installed version (read from this package's own package.json, not the
 * consuming app's — so it reflects what's actually running, not just what
 * the app's package.json range says), Node version, and platform.
 */
export function getDebugEnvInfo() {
    if (cachedCatalystCoreVersion === undefined) {
        try {
            const pkgPath = path.resolve(__dirname, "../../package.json")
            cachedCatalystCoreVersion = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version
        } catch {
            cachedCatalystCoreVersion = "unknown"
        }
    }
    return {
        node: process.version,
        platform: process.platform,
        catalystCore: cachedCatalystCoreVersion,
    }
}
