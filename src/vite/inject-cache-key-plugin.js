import path from "path"

/**
 * Normalize import path using Vite aliases
 * @param {string} importPath - The import path to normalize
 * @param {object} viteConfig - The Vite configuration object
 * @returns {string} - The normalized path
 */
function normalizePath(importPath, viteConfig) {
    const aliases = viteConfig.resolve?.alias || {}
    let resolvedPath = importPath

    // Handle both object format { find: string, replacement: string } and simple object format
    if (Array.isArray(aliases)) {
        for (const alias of aliases) {
            if (alias.find && typeof alias.find === "string" && importPath.startsWith(alias.find)) {
                resolvedPath = importPath.replace(alias.find, alias.replacement)
                break
            }
        }
    } else if (typeof aliases === "object") {
        // Handle simple object format: { "@alias": "/path" }
        for (const [aliasKey, aliasPath] of Object.entries(aliases)) {
            if (importPath.startsWith(aliasKey)) {
                resolvedPath = importPath.replace(aliasKey, aliasPath)
                break
            }
        }
    }

    return resolvedPath.replace(/^\.\//, "")
}

/**
 * Resolve import path to a manifest key
 * @param {string} importPath - The import path to resolve
 * @param {string} importerId - The file ID that imports this path
 * @param {object} viteConfig - The Vite configuration object
 * @returns {string} - The resolved manifest key (relative to manifest location: build/.vite/)
 */
function resolveImportPath(importPath, importerId, viteConfig) {
    try {
        // Normalize the path using aliases
        const normalizedPath = normalizePath(importPath, viteConfig)

        // Resolve to absolute path relative to the importer
        const importerDir = path.dirname(importerId)
        const absolutePath = path.resolve(importerDir, normalizedPath)

        // Convert to manifest-style key
        // Vite manifest keys are relative to the manifest location (build/.vite/manifest.json)
        if (process.env.src_path) {
            // Manifest is located at: build/.vite/manifest.json
            const manifestDir = path.join(process.env.src_path, "build", ".vite")

            // Calculate relative path from manifest directory to the source file
            const relativePath = path.relative(manifestDir, absolutePath)
            return relativePath.replace(/\\/g, "/") // Normalize path separators
        }

        // If no src_path, return the normalized path
        return normalizedPath.replace(/^\.\//, "")
    } catch (error) {
        console.warn(`Error resolving import path ${importPath}:`, error.message)
        return importPath.replace(/^\.\//, "")
    }
}

/**
 * Vite plugin to add cacheKey to split calls with manifest keys
 */
export function injectCacheKeyPlugin() {
    let viteConfig

    return {
        name: "split-cache-key",

        configResolved(config) {
            // Store the resolved config so we can access aliases later
            viteConfig = config
        },

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
                        const manifestKey = resolveImportPath(importPath, id, viteConfig)

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
