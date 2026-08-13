import fs from "fs"
import path from "path"
import util from "node:util"
import { pathToFileURL } from "url"
import pkg from "picocolors"
const { gray, cyan } = pkg

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

/**
 * Propagate a spawnSync result to this process's exit code.
 *
 * Without this the wrapper always exits 0, so a server that failed to boot
 * still reads as a successful run to CI and to shell `&&` chains.
 *
 * @param {import('child_process').SpawnSyncReturns<Buffer>} result
 * @param {string} label - what was being started, for the error message
 */

/**
 * A `--import` argument that registers a module loader.
 *
 * `--loader` is deprecated and makes Node print a four-line
 * ExperimentalWarning to stderr for every process that uses it -- which meant
 * 18 lines of warnings in a single `catalyst build`, since the flag is passed
 * to both bundles and the manifest step. register() is the supported form and
 * is silent.
 *
 * @param {string} loaderPath - absolute path to the loader module
 */
export function loaderImportArg(loaderPath) {
    const url = pathToFileURL(loaderPath).href
    return (
        `data:text/javascript,` +
        encodeURIComponent(
            `import { register } from "node:module";` +
                `import { pathToFileURL } from "node:url";` +
                `register(${JSON.stringify(url)}, pathToFileURL("./"));`
        )
    )
}

export function arrayToObject(array) {
    const obj = {}
    array.forEach((item) => {
        const [key, value] = item.split("=")
        if (value) obj[key] = value
    })
    return obj
}
