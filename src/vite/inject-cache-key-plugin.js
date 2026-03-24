import path from "path"
import { readFileSync, existsSync, statSync } from "fs"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Cache for loaded aliases
let aliasCache = null

/**
 * Load and resolve module aliases from both the consuming app and catalyst-core,
 * using the same algorithm as node-loader.mjs.
 */
function loadAliases() {
    if (aliasCache) {
        return aliasCache
    }

    const appRoot = process.env.src_path || process.cwd()
    const appPackageJsonConfig = path.resolve(appRoot, "package.json")
    const catalystPackageJsonConfig = path.resolve(__dirname, "../../package.json")

    let appModuleAliases = {}
    let catalystModuleAliases = {}

    try {
        const appPackageJson = JSON.parse(readFileSync(appPackageJsonConfig, "utf8"))
        appModuleAliases = appPackageJson._moduleAliases || {}
    } catch {
        // Silently fail if app package.json doesn't exist or is invalid
    }

    try {
        const catalystPackageJson = JSON.parse(readFileSync(catalystPackageJsonConfig, "utf8"))
        catalystModuleAliases = catalystPackageJson._moduleAliases || {}
    } catch {
        // Silently fail if catalyst package.json doesn't exist or is invalid
    }

    // Application aliases take precedence over catalyst-core aliases
    const allAliases = { ...catalystModuleAliases, ...appModuleAliases }

    aliasCache = {}
    for (const [alias, aliasPath] of Object.entries(allAliases)) {
        if (aliasPath && typeof aliasPath === "string") {
            try {
                const resolvedPath = path.resolve(appRoot, ...aliasPath.split("/"))
                aliasCache[alias] = resolvedPath
            } catch (error) {
                console.warn(`Failed to resolve alias ${alias}:`, error.message)
            }
        }
    }

    return aliasCache
}

/**
 * Try to resolve a path by applying common JS/TS/ESM extensions and index fallbacks,
 * matching the same resolution order as node-loader.mjs.
 */
function resolveWithExtensions(basePath) {
    if (existsSync(basePath) && statSync(basePath).isFile()) {
        return basePath
    }

    const extensions = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".scss"]

    for (const ext of extensions) {
        const candidate = `${basePath}${ext}`
        if (existsSync(candidate)) {
            return candidate
        }
    }

    const currentExt = path.extname(basePath)
    if (currentExt) {
        const withoutExt = basePath.slice(0, -currentExt.length)
        for (const ext of extensions) {
            if (ext === currentExt) continue
            const candidate = `${withoutExt}${ext}`
            if (existsSync(candidate)) {
                return candidate
            }
        }
    }

    for (const ext of extensions) {
        const candidate = path.join(basePath, `index${ext}`)
        if (existsSync(candidate)) {
            return candidate
        }
    }

    return null
}

/**
 * Resolve import path to an absolute file path using the same alias algorithm as node-loader.mjs.
 * Falls back to relative resolution when no alias matches.
 */
function resolveToAbsolutePath(importPath, importerId) {
    const aliases = loadAliases()

    // 1. Try alias resolution (same logic as node-loader resolveAlias)
    for (const [alias, aliasPath] of Object.entries(aliases)) {
        if (importPath === alias || importPath.startsWith(alias + "/")) {
            const remainingPath = importPath === alias ? "" : importPath.slice(alias.length + 1)
            const rawResolved = path.join(aliasPath, remainingPath)
            const finalResolved = resolveWithExtensions(rawResolved)
            if (finalResolved) {
                return path.resolve(finalResolved)
            }
        }
    }

    // 2. Relative imports — resolve from the importer's directory
    if (importPath.startsWith("./") || importPath.startsWith("../")) {
        const importerDir = path.dirname(importerId)
        const absolutePath = path.resolve(importerDir, importPath)
        const resolved = resolveWithExtensions(absolutePath)
        if (resolved) {
            return resolved
        }
        return absolutePath
    }

    return null
}

/**
 * Resolve import path to a manifest key
 * @param {string} importPath - The import path to resolve
 * @param {string} importerId - The file ID that imports this path
 * @returns {string} - The resolved manifest key (relative to manifest location: build/.vite/)
 */
function resolveImportPath(importPath, importerId) {
    try {
        const absolutePath = resolveToAbsolutePath(importPath, importerId)

        if (absolutePath && process.env.src_path) {
            // Manifest is located at: build/.vite/manifest.json
            const manifestDir = path.join(process.env.src_path, "build", ".vite")
            const relativePath = path.relative(manifestDir, absolutePath)
            return relativePath.replace(/\\/g, "/")
        }

        // Fallback: strip leading ./ and return as-is
        return importPath.replace(/^\.\//, "")
    } catch (error) {
        console.warn(`Error resolving import path ${importPath}:`, error.message)
        return importPath.replace(/^\.\//, "")
    }
}

/**
 * Vite plugin to add cacheKey to split calls with manifest keys
 */
export function injectCacheKeyPlugin() {
    return {
        name: "split-cache-key",

        async transform(code, id) {
            // Only process JS/JSX/TS/TSX files
            if (!/\.(js|jsx|ts|tsx)$/.test(id)) {
                return null
            }

            // Skip node_modules
            if (id.includes("node_modules")) {
                return null
            }

            // Skip if no split calls
            if (!code.includes("split")) {
                return null
            }

            let transformedCode = code
            let hasTransforms = false

            // Regex to match split calls with import path
            // Matches: split(() => import("path"), {options})
            // Also handles cases without options: split(() => import("path"))
            // Handles various whitespace/newline combinations
            const splitRegex = /split\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g

            let match
            const matches = []

            // Collect all matches first
            while ((match = splitRegex.exec(code)) !== null) {
                matches.push({
                    index: match.index,
                    importPath: match[1],
                    fullMatch: match[0],
                })
            }

            // Process matches in reverse order to preserve indices
            for (let i = matches.length - 1; i >= 0; i--) {
                const { index, importPath, fullMatch } = matches[i]

                try {
                    // Find the end of the function call
                    let pos = index + fullMatch.length
                    let braceCount = 0
                    let parenCount = 1 // We're already inside the split() call
                    let optionsStart = -1
                    let optionsEnd = -1
                    let callEnd = -1

                    // Skip whitespace and comma
                    while (pos < code.length && (/\s/.test(code[pos]) || code[pos] === ",")) {
                        pos++
                    }

                    // Check if there's an options object
                    if (code[pos] === "{") {
                        optionsStart = pos
                        braceCount = 1
                        pos++

                        // Find the closing brace
                        while (pos < code.length && braceCount > 0) {
                            if (code[pos] === "{") braceCount++
                            else if (code[pos] === "}") braceCount--
                            pos++
                        }
                        optionsEnd = pos - 1
                    }

                    // Find the closing parenthesis of the split call
                    while (pos < code.length && parenCount > 0) {
                        if (code[pos] === "(") parenCount++
                        else if (code[pos] === ")") {
                            parenCount--
                            if (parenCount === 0) {
                                callEnd = pos
                                break
                            }
                        }
                        pos++
                    }

                    if (callEnd !== -1) {
                        // Check if cacheKey is already present
                        // Count top-level commas after the options object (not inside it)
                        const afterOptions =
                            optionsEnd !== -1
                                ? code.slice(optionsEnd + 1, callEnd).trim()
                                : code.slice(index + fullMatch.length, callEnd).trim()

                        // If there's content after the options (besides whitespace and closing paren),
                        // it means there's already a third parameter (cacheKey)
                        const hasThirdParam = afterOptions.replace(/^,/, "").trim().length > 0

                        if (hasThirdParam) {
                            // Already has cacheKey, skip
                            continue
                        }

                        // Resolve the import path
                        let manifestKey = resolveImportPath(importPath, id)
                        if (manifestKey && !manifestKey.endsWith(".js")) {
                            manifestKey = manifestKey + ".js"
                        }

                        // Build the replacement
                        let replacement
                        if (optionsStart !== -1 && optionsEnd !== -1) {
                            // Has options object, add cacheKey as third parameter
                            const beforeCall = code.slice(index, optionsEnd + 1)
                            const afterOptions = code.slice(optionsEnd + 1, callEnd)
                            // Clean up any trailing whitespace/comma
                            const cleanedAfter = afterOptions.trim().replace(/^,/, "").trim()
                            replacement =
                                beforeCall +
                                (cleanedAfter ? `, ${cleanedAfter}, ` : `, `) +
                                `"${manifestKey}")`
                        } else {
                            // No options object, add empty options and cacheKey
                            const beforeCall = code.slice(index, callEnd)
                            replacement = beforeCall + `, {}, "${manifestKey}")`
                        }

                        // Replace in the code
                        transformedCode =
                            transformedCode.slice(0, index) + replacement + transformedCode.slice(callEnd + 1)
                        hasTransforms = true
                    }
                } catch (error) {
                    console.warn(
                        `Could not process split call with import path: ${importPath}`,
                        error.message
                    )
                }
            }

            return hasTransforms ? { code: transformedCode, map: null } : null
        },
    }
}
