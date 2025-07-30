import path from "path"

/**
 * Resolve import path using Vite aliases
 * @param {string} importPath - The import path to resolve
 * @param {object} viteConfig - The Vite configuration object
 * @returns {string} - The resolved manifest key
 */
function resolveImportPath(importPath, viteConfig) {
    try {
        if (!viteConfig?.resolve?.alias) {
            // Fallback to original import path if no aliases
            return importPath
        }

        const aliases = viteConfig.resolve.alias
        let resolvedPath = importPath

        // Check if the import path starts with any of the configured aliases
        for (const { find: aliasKey, replacement: aliasPath } of Object.values(aliases)) {
            if (importPath.startsWith(aliasKey)) {
                // Replace the alias with the actual path
                resolvedPath = importPath.replace(aliasKey, aliasPath)
                break
            }
        }
        // Convert to manifest-style key (relative to src_path)
        if (process.env.src_path && resolvedPath !== importPath) {
            // If we resolved an alias, make it relative to the project source
            const outputPath = path.join(process.env.src_path, "build", "client")
            const relativePath = path.relative(outputPath, resolvedPath)
            return relativePath.replace(/\\/g, "/") // Normalize path separators
        }

        // If no alias was matched or no src_path, return the original import path
        // but clean it up (remove leading ./ if present)
        return importPath.replace(/^\.\//, "")
    } catch (error) {
        console.warn(`Error resolving import path ${importPath}:`, error.message)
        return importPath
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

            // Skip if no split calls
            if (!code.includes("split")) {
                return null
            }

            let transformedCode = code
            let hasTransforms = false

            // Regex to match split calls with import path
            // Matches: split(() => import("path"),
            const splitRegex = /(split\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*,\s*)/g

            let match
            while ((match = splitRegex.exec(code)) !== null) {
                const [fullMatch, beforeOptions, importPath] = match

                try {
                    // Find the options object with balanced brace counting
                    const startPos = match.index + fullMatch.length
                    let braceCount = 0
                    let pos = startPos
                    let optionsStart = -1
                    let optionsEnd = -1

                    // Find the opening brace
                    while (pos < code.length) {
                        if (code[pos] === "{") {
                            if (optionsStart === -1) optionsStart = pos
                            braceCount++
                        } else if (code[pos] === "}") {
                            braceCount--
                            if (braceCount === 0 && optionsStart !== -1) {
                                optionsEnd = pos
                                break
                            }
                        }
                        pos++
                    }

                    if (optionsStart !== -1 && optionsEnd !== -1) {
                        const optionsObject = code.slice(optionsStart, optionsEnd + 1)

                        // Resolve the import path using Vite aliases
                        let manifestKey = resolveImportPath(importPath, viteConfig)
                        // Find the closing parenthesis after the options
                        let closingParenPos = optionsEnd + 1
                        while (closingParenPos < code.length && /\s/.test(code[closingParenPos])) {
                            closingParenPos++
                        }

                        if (code[closingParenPos] === ")") {
                            // Create the new call with cacheKey as third parameter
                            const originalCall = code.slice(match.index, closingParenPos + 1)
                            const newCall = beforeOptions + optionsObject + `, "${manifestKey}")`

                            // Replace in the code
                            transformedCode = transformedCode.replace(originalCall, newCall)
                            hasTransforms = true
                        }
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
