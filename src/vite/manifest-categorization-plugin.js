/**
 * Vite Plugin for Categorizing Assets by SSR Split Configuration
 *
 * This plugin categorizes build assets into four groups:
 * - essential: Entry chunks + their transitive STATIC import closure (not dynamic)
 * - ssrTrue: Assets loaded via split with ssr: true
 * - ssrFalse: Assets loaded via split with ssr: false
 * - orphan: Non-entry chunks with zero static importers (not split targets)
 **/
import path from "path"
import fs from "fs"

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

export function manifestCategorizationPlugin(options = {}) {
    const { outputFile = "asset-categories.json", publicPath = "/client/assets/" } = options

    // Collected during transform, resolved asynchronously in buildEnd
    const pendingSplitPaths = [] // { importPath, importer, ssrValue }
    const splitModules = new Map() // resolvedId -> { ssr: boolean, originalPath: string }

    const moduleToChunk = new Map() // moduleId -> chunkFileName
    const chunkDependencies = new Map() // chunkFileName -> Set<chunkFileName> (static imports only)

    let processedManifest = null

    function processBundle(bundle) {
        // Pass 1: Build module → chunk mapping
        for (const [fileName, chunk] of Object.entries(bundle)) {
            if (chunk.type !== "chunk") continue
            if (chunk.facadeModuleId) {
                moduleToChunk.set(chunk.facadeModuleId, fileName)
            }
            if (chunk.modules) {
                for (const moduleId of Object.keys(chunk.modules)) {
                    moduleToChunk.set(moduleId, fileName)
                }
            }
        }

        // Pass 2: Build static-only dependency graph (excludes dynamicImports intentionally)
        for (const [fileName, chunk] of Object.entries(bundle)) {
            if (chunk.type !== "chunk") continue
            chunkDependencies.set(fileName, new Set(chunk.imports || []))
        }

        // Identify which chunks are split targets
        const splitChunkNames = new Set()
        for (const moduleId of splitModules.keys()) {
            const chunkName = moduleToChunk.get(moduleId)
            if (chunkName && bundle[chunkName]) splitChunkNames.add(chunkName)
        }

        // Build reverse adjacency map once — O(n) instead of O(n²) per lookup
        const importedBy = new Map() // chunkFileName -> Set<chunkFileNames that statically import it>
        for (const [chunk, deps] of chunkDependencies.entries()) {
            for (const dep of deps) {
                if (!importedBy.has(dep)) importedBy.set(dep, new Set())
                importedBy.get(dep).add(chunk)
            }
        }

        const isChunkOnlyUsedBySplits = (chunkName) => {
            const importers = importedBy.get(chunkName)
            if (!importers || importers.size === 0) return false
            return [...importers].every((imp) => splitChunkNames.has(imp))
        }

        // Orphan chunks: no static importers, not an entry chunk, and not a split target.
        // Split targets have zero static importers (they're dynamically imported) but
        // are already categorized as ssrTrue/ssrFalse — they're not true orphans.
        const orphanChunkNames = new Set()
        for (const [fileName, chunk] of Object.entries(bundle)) {
            if (chunk.type !== "chunk") continue
            if (chunk.isEntry) continue
            if (splitChunkNames.has(fileName)) continue
            const importers = importedBy.get(fileName)
            if (!importers || importers.size === 0) {
                orphanChunkNames.add(fileName)
            }
        }

        // BFS over STATIC imports from entry chunks only.
        // Dynamic imports (dynamicImports) are intentionally excluded — they are lazy by design.
        const entryChunks = Object.entries(bundle)
            .filter(([_, c]) => c.type === "chunk" && c.isEntry)
            .map(([fileName]) => fileName)

        const essentialChunkNames = new Set(entryChunks)
        const queue = [...entryChunks]

        while (queue.length > 0) {
            const current = queue.shift()
            for (const dep of chunkDependencies.get(current) || []) {
                if (
                    !essentialChunkNames.has(dep) &&
                    !splitChunkNames.has(dep) &&
                    !isChunkOnlyUsedBySplits(dep) &&
                    !orphanChunkNames.has(dep)
                ) {
                    essentialChunkNames.add(dep)
                    queue.push(dep)
                }
            }
        }

        const toEntry = (fileName, chunk) => ({
            file: fileName,
            src: chunk.facadeModuleId || "",
            isEntry: chunk.isEntry || false,
            css: chunk.css || [],
            imports: chunk.imports || [],
            dynamicImports: chunk.dynamicImports || [],
        })

        const categorizedChunks = { essential: {}, ssrTrue: {}, ssrFalse: {}, orphan: {} }

        for (const fileName of essentialChunkNames) {
            if (bundle[fileName]?.type === "chunk") {
                categorizedChunks.essential[fileName] = toEntry(fileName, bundle[fileName])
            }
        }

        const seen = new Set()
        for (const [moduleId, splitInfo] of splitModules.entries()) {
            const chunkName = moduleToChunk.get(moduleId)
            if (chunkName && bundle[chunkName] && !seen.has(chunkName)) {
                const category = splitInfo.ssr ? "ssrTrue" : "ssrFalse"
                categorizedChunks[category][chunkName] = toEntry(chunkName, bundle[chunkName])
                seen.add(chunkName)
            }
        }

        for (const fileName of orphanChunkNames) {
            if (bundle[fileName]?.type === "chunk") {
                categorizedChunks.orphan[fileName] = toEntry(fileName, bundle[fileName])
            }
        }

        processedManifest = {
            ...categorizedChunks,
            metadata: {
                generatedAt: new Date().toISOString(),
                totalAssets: Object.keys(bundle).filter((k) => bundle[k].type === "chunk").length,
                dependencyStats: {
                    ssrTrueModules: Object.keys(categorizedChunks.ssrTrue).length,
                    ssrFalseModules: Object.keys(categorizedChunks.ssrFalse).length,
                    essentialModules: Object.keys(categorizedChunks.essential).length,
                    orphanModules: Object.keys(categorizedChunks.orphan).length,
                },
            },
        }

        return processedManifest
    }

    // Apply Vite manifest structure to categorized chunks
    function applyViteManifestStructure(categorizedManifest, viteManifest) {
        const newCategorizedChunks = {
            essential: {},
            ssrTrue: {},
            ssrFalse: {},
            orphan: {},
        }

        for (const category of ["essential", "ssrTrue", "ssrFalse", "orphan"]) {
            for (const [chunkName, chunkData] of Object.entries(categorizedManifest[category])) {
                let matchedViteKey = null
                let matchedViteEntry = null

                for (const [viteKey, viteEntry] of Object.entries(viteManifest)) {
                    if (viteEntry.file === chunkName) {
                        matchedViteKey = viteKey
                        matchedViteEntry = viteEntry
                        break
                    }
                }

                if (matchedViteEntry && matchedViteKey) {
                    newCategorizedChunks[category][matchedViteKey] = { ...matchedViteEntry }
                } else {
                    console.log(`❌ No manifest match found for ${chunkName}, keeping original structure`)
                    newCategorizedChunks[category][chunkName] = chunkData
                }
            }
        }

        // Ensure entry points are always in essential
        for (const [viteKey, viteEntry] of Object.entries(viteManifest)) {
            if (
                viteEntry.isEntry &&
                !newCategorizedChunks.essential[viteKey] &&
                !newCategorizedChunks.ssrTrue[viteKey] &&
                !newCategorizedChunks.ssrFalse[viteKey] &&
                !newCategorizedChunks.orphan[viteKey]
            ) {
                newCategorizedChunks.essential[viteKey] = { ...viteEntry }
            }
        }

        Object.keys(categorizedManifest).forEach((category) => {
            if (category !== "metadata") {
                categorizedManifest[category] = newCategorizedChunks[category]
            }
        })
    }

    // Recursively collect all CSS files reachable from a manifest key
    function collectTransitiveCss(viteKey, viteManifest, visited = new Set()) {
        if (visited.has(viteKey)) return []
        visited.add(viteKey)

        const entry = viteManifest[viteKey]
        if (!entry) return []

        const css = [...(entry.css || [])]
        for (const imp of entry.imports || []) {
            css.push(...collectTransitiveCss(imp, viteManifest, visited))
        }
        return css
    }

    // Attach allCss (transitive) to every chunk in all categories
    function enrichWithTransitiveCss(categorizedManifest, viteManifest) {
        for (const category of ["essential", "ssrTrue", "ssrFalse", "orphan"]) {
            for (const [key, chunk] of Object.entries(categorizedManifest[category])) {
                const transitiveCss = collectTransitiveCss(key, viteManifest)
                chunk.allCss = [...new Set(transitiveCss)]
            }
        }
    }

    return {
        name: "manifest-categorization",

        resolveId(id, importer, options) {
            return null
        },

        // Scan source files to identify split calls, collect for async resolution in buildEnd
        transform(code, id) {
            if (id.includes("node_modules")) return null
            if (!code.includes("split")) return null

            let ast
            try {
                ast = this.parse(code)
            } catch {
                return null
            }

            walk(ast, (node) => {
                if (node.type !== "CallExpression") return
                if (node.callee.type !== "Identifier" || node.callee.name !== "split") return

                const args = node.arguments
                if (args.length === 0) return

                // First arg must be a function that returns import("...")
                const loader = args[0]
                let importExpr

                if (loader.type === "ArrowFunctionExpression") {
                    importExpr = loader.body
                } else if (loader.type === "FunctionExpression") {
                    const stmts = loader.body.body
                    if (stmts.length !== 1 || stmts[0].type !== "ReturnStatement") return
                    importExpr = stmts[0].argument
                } else {
                    return
                }

                if (!importExpr || importExpr.type !== "ImportExpression") return
                if (importExpr.source.type !== "Literal" || typeof importExpr.source.value !== "string") return

                const importPath = importExpr.source.value

                // Extract ssr value from options object (second arg) if present
                let ssrValue = true // default
                if (args.length >= 2 && args[1].type === "ObjectExpression") {
                    const ssrProp = args[1].properties.find(
                        (p) =>
                            p.type === "Property" &&
                            p.key.type === "Identifier" &&
                            p.key.name === "ssr" &&
                            p.value.type === "Literal"
                    )
                    if (ssrProp) {
                        ssrValue = ssrProp.value.value === true
                    }
                }

                pendingSplitPaths.push({ importPath, importer: id, ssrValue })
            })

            return null
        },

        // Resolve all split paths here — buildEnd is async-safe, unlike transform
        async buildEnd() {
            await Promise.all(
                pendingSplitPaths.map(async ({ importPath, importer, ssrValue }) => {
                    try {
                        const resolved = await this.resolve(importPath, importer)
                        if (resolved) {
                            splitModules.set(resolved.id, {
                                ssr: ssrValue,
                                originalPath: importPath,
                            })
                        }
                    } catch (err) {
                        console.log(`❌ Error resolving ${importPath}:`, err.message)
                    }
                })
            )
        },

        generateBundle(options, bundle) {
            processedManifest = processBundle(bundle)
        },

        // Write the file after all files are written (manifest.json is available)
        closeBundle() {
            let viteManifest = null

            try {
                const manifestPath = path.join(
                    process.env.src_path,
                    process.env.BUILD_OUTPUT_PATH || "build",
                    ".vite",
                    "manifest.json"
                )
                if (fs.existsSync(manifestPath)) {
                    const manifestContent = fs.readFileSync(manifestPath, "utf8")
                    viteManifest = JSON.parse(manifestContent)
                } else {
                    console.log("❌ Could not find manifest.json at expected path:", manifestPath)
                    return
                }
            } catch (e) {
                console.log("❌ Could not read manifest from file system:", e.message)
                return
            }

            if (!processedManifest) {
                console.log("❌ No processed manifest available")
                return
            }

            applyViteManifestStructure(processedManifest, viteManifest)
            enrichWithTransitiveCss(processedManifest, viteManifest)

            const outputPath = path.join(
                process.env.src_path,
                process.env.BUILD_OUTPUT_PATH || "build",
                ".vite",
                outputFile
            )
            fs.writeFileSync(outputPath, JSON.stringify(processedManifest, null, 2))
        },
    }
}
