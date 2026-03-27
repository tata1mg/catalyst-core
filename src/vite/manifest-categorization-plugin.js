/**
 * Vite Plugin for Categorizing Assets by SSR Split Configuration
 *
 * This plugin categorizes build assets into three groups:
 * - essential: Entry chunks + their transitive STATIC import closure (not dynamic)
 * - ssrTrue: Assets loaded via split with ssr: true
 * - ssrFalse: Assets loaded via split with ssr: false
 **/
import path from "path"
import fs from "fs"

// Compiled once at module load — not inside transform to avoid per-file recompilation
const SPLIT_REGEX =
    /split\s*\(\s*\(\)\s*=>\s*import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*(?:,\s*\{([^}]*)\})?\s*\)/g

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

        // Orphan chunks (no importers at all) are NOT split-only — they should be essential
        const isChunkOnlyUsedBySplits = (chunkName) => {
            const importers = importedBy.get(chunkName)
            if (!importers || importers.size === 0) return false
            return [...importers].every((imp) => splitChunkNames.has(imp))
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
                    !isChunkOnlyUsedBySplits(dep)
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

        const categorizedChunks = { essential: {}, ssrTrue: {}, ssrFalse: {} }

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

        processedManifest = {
            ...categorizedChunks,
            metadata: {
                generatedAt: new Date().toISOString(),
                totalAssets: Object.keys(bundle).filter((k) => bundle[k].type === "chunk").length,
                dependencyStats: {
                    ssrTrueModules: Object.keys(categorizedChunks.ssrTrue).length,
                    ssrFalseModules: Object.keys(categorizedChunks.ssrFalse).length,
                    essentialModules: Object.keys(categorizedChunks.essential).length,
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
        }

        for (const category of ["essential", "ssrTrue", "ssrFalse"]) {
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
                !newCategorizedChunks.ssrFalse[viteKey]
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
        for (const category of ["essential", "ssrTrue", "ssrFalse"]) {
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

            SPLIT_REGEX.lastIndex = 0 // reset /g flag since the regex is reused across files

            let match
            while ((match = SPLIT_REGEX.exec(code)) !== null) {
                const importPath = match[1]
                const optionsStr = match[2] || ""
                const ssrMatch = optionsStr.match(/ssr\s*:\s*(true|false)/)
                const ssrValue = ssrMatch ? ssrMatch[1] === "true" : true
                pendingSplitPaths.push({ importPath, importer: id, ssrValue })
            }

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
