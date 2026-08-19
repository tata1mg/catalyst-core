// Single source of truth for merging the consuming app's `_moduleAliases` with
// catalyst-core's own. Three call sites (vite.config.js, node-loader.mjs,
// inject-cache-key-plugin.js) previously each read both package.jsons and
// merged them inline, and their spread order had drifted apart. Path resolution
// deliberately stays with the callers — they resolve differently — so this owns
// only the reading and the precedence.

import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function readModuleAliases(packageJsonPath) {
    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
        return packageJson._moduleAliases || {}
    } catch {
        return {}
    }
}

/**
 * Raw (unresolved) alias map for an app root, with the app's own aliases taking
 * precedence over catalyst-core's on key collision.
 *
 * @param {string} appRoot - The consuming application's root directory.
 * @returns {Record<string, string>} Merged alias name -> raw alias path.
 */
export function getModuleAliases(appRoot) {
    const appModuleAliases = readModuleAliases(path.resolve(appRoot, "package.json"))
    const catalystModuleAliases = readModuleAliases(path.resolve(__dirname, "../../package.json"))

    return { ...catalystModuleAliases, ...appModuleAliases }
}
