import { fileURLToPath, pathToFileURL } from "url"
import { dirname, resolve as resolvePath, join, extname } from "path"
import { readFileSync, existsSync, statSync } from "fs"
import { createRequire } from "module"
import { transformSync } from "esbuild"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Cache for loaded aliases
let aliasCache = null

/**
 * Load and resolve module aliases from both the consuming app and catalyst-core
 */
function loadAliases() {
    if (aliasCache) {
        return aliasCache
    }

    const appRoot = process.env.src_path || process.cwd()

    const appPackageJsonConfig = resolvePath(appRoot, "package.json")
    const catalystPackageJsonConfig = resolvePath(__dirname, "../../package.json")

    let appModuleAliases = {}
    let catalystModuleAliases = {}

    // Read aliases from consuming application's package.json
    try {
        const appPackageJsonContent = readFileSync(appPackageJsonConfig, "utf8")
        const appPackageJson = JSON.parse(appPackageJsonContent)
        appModuleAliases = appPackageJson._moduleAliases || {}
    } catch (error) {
        // Silently fail if app package.json doesn't exist or is invalid
    }

    // Read aliases from catalyst-core's package.json
    try {
        const catalystPackageJsonContent = readFileSync(catalystPackageJsonConfig, "utf8")
        const catalystPackageJson = JSON.parse(catalystPackageJsonContent)
        catalystModuleAliases = catalystPackageJson._moduleAliases || {}
    } catch (error) {
        // Silently fail if catalyst package.json doesn't exist or is invalid
    }

    // Application aliases take precedence over catalyst-core aliases
    const allAliases = { ...catalystModuleAliases, ...appModuleAliases }

    // Convert aliases to resolved paths
    aliasCache = {}
    for (const [alias, aliasPath] of Object.entries(allAliases)) {
        if (aliasPath && typeof aliasPath === "string") {
            try {
                // All aliases resolve relative to consuming project root (src_path)
                const resolvedPath = resolvePath(appRoot, ...aliasPath.split("/"))
                aliasCache[alias] = resolvedPath
            } catch (error) {
                console.warn(`Failed to resolve alias ${alias}:`, error.message)
            }
        }
    }

    return aliasCache
}

/**
 * Try to resolve a path by applying common JS/TS/ESM extensions and index fallbacks.
 * This brings resolution closer to webpack-style behavior for extensionless imports.
 */
function resolveWithExtensions(basePath) {
    // Exact match — but only if it's a file, not a directory
    if (existsSync(basePath) && statSync(basePath).isFile()) {
        return basePath
    }

    const extensions = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]

    // Try with common extensions
    for (const ext of extensions) {
        const candidate = `${basePath}${ext}`
        if (existsSync(candidate)) {
            return candidate
        }
    }

    // Try index files inside a directory
    for (const ext of extensions) {
        const candidate = join(basePath, `index${ext}`)
        if (existsSync(candidate)) {
            return candidate
        }
    }

    return null
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
            const rawResolvedPath = join(aliasPath, remainingPath)
            const finalResolvedPath = resolveWithExtensions(rawResolvedPath)

            if (finalResolvedPath) {
                return resolvePath(finalResolvedPath)
            }
        }
    }

    return null
}

/**
 * Try to resolve a relative specifier by computing the absolute path from the
 * parent module and running it through extension / index resolution.
 */
function resolveRelative(specifier, parentURL) {
    if (!parentURL) return null
    try {
        const parentPath = fileURLToPath(parentURL)
        const parentDir = dirname(parentPath)
        const absolutePath = resolvePath(parentDir, specifier)
        return resolveWithExtensions(absolutePath)
    } catch {
        return null
    }
}

/**
 * Resolve a bare specifier (e.g. "@tata1mg/synapse/utils") using CJS resolution
 * rules via createRequire. CJS require.resolve handles extensionless imports,
 * directory/index resolution, and package.json "main" fields automatically.
 */
function resolveBareSpecifier(specifier, parentURL) {
    if (!parentURL) return null
    try {
        const req = createRequire(parentURL)
        const resolved = req.resolve(specifier)
        return resolved
    } catch {
        return null
    }
}

/**
 * Node.js loader hook for resolving modules
 */
export async function resolve(specifier, context, defaultResolve) {
    try {
        // 1. Try alias resolution first
        const aliasResolved = resolveAlias(specifier, context.parentURL)
        if (aliasResolved) {
            const fileURL = pathToFileURL(aliasResolved).href
            return await defaultResolve(fileURL, context)
        }

        // 2. For relative imports, try extension / directory index resolution
        //    before handing off to Node's strict ESM resolver.
        if (specifier.startsWith("./") || specifier.startsWith("../")) {
            const resolved = resolveRelative(specifier, context.parentURL)
            if (resolved) {
                return {
                    url: pathToFileURL(resolved).href,
                    shortCircuit: true,
                }
            }
        }

        // 3. Default resolver
        return await defaultResolve(specifier, context)
    } catch (error) {
        if (error.code === "ERR_UNSUPPORTED_DIR_IMPORT" || error.code === "ERR_MODULE_NOT_FOUND") {
            // 4a. For relative imports, retry with extension / directory resolution
            if (specifier.startsWith("./") || specifier.startsWith("../")) {
                const resolved = resolveRelative(specifier, context.parentURL)
                if (resolved) {
                    return {
                        url: pathToFileURL(resolved).href,
                        shortCircuit: true,
                    }
                }
            }

            // 4b. For bare specifiers (node_modules), fall back to CJS require.resolve
            const cjsResolved = resolveBareSpecifier(specifier, context.parentURL)
            if (cjsResolved) {
                return {
                    url: pathToFileURL(cjsResolved).href,
                    shortCircuit: true,
                }
            }
        }
        throw error
    }
}

/**
 * Walk up from a directory to find the nearest package.json and return its parsed content.
 */
function findNearestPackageType(dir) {
    while (dir !== dirname(dir)) {
        const pkgPath = join(dir, "package.json")
        if (existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
                return pkg.type || "commonjs"
            } catch {
                return "commonjs"
            }
        }
        dir = dirname(dir)
    }
    return "commonjs"
}

/**
 * Check if a file is a CJS module based on extension and nearest package.json.
 */
function isCjsModule(filePath) {
    const ext = extname(filePath)
    if (ext === ".mjs") return false
    if (ext === ".cjs") return true
    return findNearestPackageType(dirname(filePath)) !== "module"
}

const VALID_IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
const JS_RESERVED = new Set([
    "break", "case", "catch", "continue", "debugger", "default", "delete",
    "do", "else", "finally", "for", "function", "if", "in", "instanceof",
    "new", "return", "switch", "this", "throw", "try", "typeof", "var",
    "void", "while", "with", "class", "const", "enum", "export", "extends",
    "import", "super", "implements", "interface", "let", "package", "private",
    "protected", "public", "static", "yield",
])

function isValidExportName(name) {
    return VALID_IDENTIFIER_RE.test(name) && !JS_RESERVED.has(name) && name !== "default"
}

// Loader-scoped require for discovering CJS exports
const loaderRequire = createRequire(import.meta.url)

const CJS_PATTERN = /\b(module\.exports\b|exports\.\w+\s*=)/

// Shim __dirname and __filename for ESM app files (these globals only exist in CJS)
const DIRNAME_SHIM = [
    `import { fileURLToPath as __node_loader_fileURLToPath } from "url";`,
    `import { dirname as __node_loader_dirname } from "path";`,
    `const __filename = __node_loader_fileURLToPath(import.meta.url);`,
    `const __dirname = __node_loader_dirname(__filename);`,
].join("\n")

/**
 * Generate an ESM wrapper for a CJS file using createRequire.
 * Discovers named exports by executing the module via require().
 */
function generateCjsWrapper(filePath, url) {
    const mod = loaderRequire(filePath)
    const exportNames = Object.keys(mod).filter(isValidExportName)

    return [
        `import { createRequire as __createRequire } from "module";`,
        `const __require = __createRequire(${JSON.stringify(url)});`,
        `const __mod = __require(${JSON.stringify(filePath)});`,
        `export default __mod;`,
        ...exportNames.map((name) => `export const ${name} = __mod[${JSON.stringify(name)}];`),
    ].join("\n")
}

/**
 * Node.js loader hook for transforming source code.
 * - Wraps CJS modules (node_modules and app files) as ESM so named imports work.
 * - Transpiles JSX in .js/.jsx app files so Node can execute them.
 */
export async function load(url, context, defaultLoad) {
    // Only transform file:// URLs (skip node: builtins, data: urls, etc.)
    if (!url.startsWith("file://")) {
        return defaultLoad(url, context)
    }

    const filePath = fileURLToPath(url)
    const ext = extname(filePath)

    if (ext !== ".js" && ext !== ".jsx" && ext !== ".cjs") {
        return defaultLoad(url, context)
    }

    const isNodeModule = filePath.includes("/node_modules/")

    // --- CJS detection and wrapping ---
    // For node_modules: check via package.json "type" field
    // For app files: check source content (because package.json may say "module"
    //                but the file may still use CJS syntax during migration)
    if (ext === ".cjs" || (isNodeModule && isCjsModule(filePath))) {
        try {
            const source = generateCjsWrapper(filePath, url)
            return { format: "module", source, shortCircuit: true }
        } catch {
            return defaultLoad(url, context)
        }
    }

    // For non-node_modules .js/.jsx files, read source to detect CJS or JSX
    if (!isNodeModule) {
        const source = readFileSync(filePath, "utf8")

        // If source uses CJS module.exports/exports, wrap it in an ESM shim.
        // We can't use createRequire here because the file lives in a "type":"module"
        // package — Node's CJS require refuses to load it. Instead, we wrap the
        // source inline so that `module.exports` becomes the default export.
        if (CJS_PATTERN.test(source)) {
            const shimmed = [
                DIRNAME_SHIM,
                `var module = { exports: {} };`,
                `var exports = module.exports;`,
                source,
                `export default module.exports;`,
            ].join("\n")

            // Run through esbuild in case the CJS file also has JSX
            try {
                const result = transformSync(shimmed, {
                    loader: "jsx",
                    format: "esm",
                    sourcefile: filePath,
                    target: "node20",
                })
                return { format: "module", source: result.code, shortCircuit: true }
            } catch {
                // If esbuild fails, return the shimmed source as-is
                return { format: "module", source: shimmed, shortCircuit: true }
            }
        }

        // ESM app files: prepend __dirname/__filename shim + JSX transform
        {
            const transformed = `${DIRNAME_SHIM}\n${source}`
            try {
                const result = transformSync(transformed, {
                    loader: "jsx",
                    format: "esm",
                    sourcefile: filePath,
                    target: "node20",
                })
                return {
                    format: "module",
                    source: result.code,
                    shortCircuit: true,
                }
            } catch {
                // If esbuild fails, return with just the shim
                return { format: "module", source: transformed, shortCircuit: true }
            }
        }
    }

    return defaultLoad(url, context)
}
