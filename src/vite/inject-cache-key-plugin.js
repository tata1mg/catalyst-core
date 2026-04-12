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
 * Walk an AST node and invoke the visitor for every node.
 */
function walk(node, visitor) {
    if (!node || typeof node !== "object") return

    visitor(node)

    for (const key of Object.keys(node)) {
        const child = node[key]
        if (Array.isArray(child)) {
            for (const item of child) {
                if (item && typeof item.type === "string") {
                    walk(item, visitor)
                }
            }
        } else if (child && typeof child.type === "string") {
            walk(child, visitor)
        }
    }
}

/**
 * Vite plugin to add cacheKey to split calls with manifest keys.
 * Uses Rollup's this.parse() for robust AST-based detection instead of regex.
 */
export function injectCacheKeyPlugin() {
    return {
        name: "split-cache-key",

        async transform(code, id) {
            if (!/\.(js|jsx|ts|tsx)$/.test(id)) return null
            if (id.includes("node_modules")) return null
            if (!code.includes("split")) return null

            let ast
            try {
                ast = this.parse(code)
            } catch {
                return null
            }

            // Collect split() call sites that need a cacheKey injected.
            // Process in reverse source order so earlier indices stay valid after splicing.
            const sites = []

            walk(ast, (node) => {
                // Match: split(<arrow>, <options?>, <cacheKey?>)
                if (node.type !== "CallExpression") return
                if (node.callee.type !== "Identifier" || node.callee.name !== "split") return

                const args = node.arguments
                if (args.length === 0) return

                // First arg must be a function that returns import("...")
                // Supports both: () => import("...") and function() { return import("...") }
                const loader = args[0]
                let importExpr

                if (loader.type === "ArrowFunctionExpression") {
                    // () => import("...")
                    importExpr = loader.body
                } else if (loader.type === "FunctionExpression") {
                    // function() { return import("...") }
                    const stmts = loader.body.body
                    if (stmts.length !== 1 || stmts[0].type !== "ReturnStatement") return
                    importExpr = stmts[0].argument
                } else {
                    return
                }

                if (!importExpr || importExpr.type !== "ImportExpression") return
                if (importExpr.source.type !== "Literal" || typeof importExpr.source.value !== "string") return

                const importPath = importExpr.source.value

                // Already has a third argument (cacheKey) → skip
                if (args.length >= 3) return

                sites.push({
                    importPath,
                    callEnd: node.end, // position of the closing )
                    hasOptions: args.length === 2,
                })
            })

            if (sites.length === 0) return null

            // Sort descending by position so splicing doesn't shift earlier indices
            sites.sort((a, b) => b.callEnd - a.callEnd)

            let transformed = code
            for (const { importPath, callEnd, hasOptions } of sites) {
                let manifestKey = resolveImportPath(importPath, id)
                if (manifestKey && !manifestKey.endsWith(".js")) {
                    manifestKey = manifestKey + ".js"
                }

                // Insert just before the closing ) of the split() call
                const insertion = hasOptions ? `, "${manifestKey}"` : `, {}, "${manifestKey}"`

                transformed = transformed.slice(0, callEnd - 1) + insertion + transformed.slice(callEnd - 1)
            }

            return { code: transformed, map: null }
        },
    }
}
