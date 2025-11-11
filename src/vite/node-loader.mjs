import { fileURLToPath, pathToFileURL } from "url"
import { dirname, resolve as resolvePath, join } from "path"
import { readFileSync, existsSync } from "fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Cache for loaded aliases
let aliasCache = null

/**
 * Load and resolve module aliases from package.json files
 */
function loadAliases() {
    if (aliasCache) {
        return aliasCache
    }

    const catalystPackageJsonConfig = resolvePath(__dirname, "../../package.json")

    let catalyst_moduleAliases = {}

    try {
        const catalystPackageJsonContent = readFileSync(catalystPackageJsonConfig, "utf8")
        const catalystPackageJson = JSON.parse(catalystPackageJsonContent)
        catalyst_moduleAliases = catalystPackageJson._moduleAliases || {}
    } catch (error) {
        // Silently fail if catalyst package.json doesn't exist
    }

    // Filter to only include @catalyst aliases
    const catalystAliases = {}
    for (const [alias, aliasPath] of Object.entries(catalyst_moduleAliases)) {
        if (alias.startsWith("@catalyst")) {
            catalystAliases[alias] = aliasPath
        }
    }

    // Convert aliases to resolved paths
    aliasCache = {}
    for (const [alias, aliasPath] of Object.entries(catalystAliases)) {
        if (aliasPath && typeof aliasPath === "string") {
            try {
                // All aliases resolve relative to consuming project root (src_path)
                const resolvedPath = resolvePath(
                    process.env.src_path || process.cwd(),
                    ...aliasPath.split("/")
                )
                aliasCache[alias] = resolvedPath
            } catch (error) {
                console.warn(`Failed to resolve alias ${alias}:`, error.message)
            }
        }
    }

    return aliasCache
}

/**
 * Resolve an import specifier using aliases
 */
function resolveAlias(specifier, parentURL) {
    const aliases = loadAliases()

    // Check if specifier starts with any alias
    for (const [alias, aliasPath] of Object.entries(aliases)) {
        if (specifier.startsWith(alias + "/") || specifier === alias) {
            const remainingPath = specifier === alias ? "" : specifier.slice(alias.length + 1)
            let resolvedPath = join(aliasPath, remainingPath)

            return resolvePath(resolvedPath)
        }
    }

    return null
}

/**
 * Node.js loader hook for resolving modules
 */
export async function resolve(specifier, context, defaultResolve) {
    // Write to stderr IMMEDIATELY and flush
    // Log IMMEDIATELY before any processing
    try {
        if (specifier.startsWith("@catalyst")) {
            const resolvedPath = resolveAlias(specifier, context.parentURL)
            if (resolvedPath) {
                const fileURL = pathToFileURL(resolvedPath).href
                return defaultResolve(fileURL, context)
            }
        }
        return defaultResolve(specifier, context)
    } catch (error) {
        throw error
    }
}
