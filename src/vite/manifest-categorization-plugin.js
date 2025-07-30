/**
 * Vite Plugin for Categorizing Assets by SSR Split Configuration
 *
 * This plugin categorizes build assets into three groups:
 * - essential: Assets not using split or direct imports
 * - ssrTrue: Assets loaded via split with ssr: true
 * - ssrFalse: Assets loaded via split with ssr: false
 **/
import path from "path"
import fs from "fs"

export function manifestCategorizationPlugin(options = {}) {
    const { outputFile = "asset-categories.json", publicPath = "/client/assets/" } = options

    // Track split calls and their resolved module IDs
    const splitModules = new Map() // resolvedId -> { ssr: boolean, originalPath: string }

    // Track module ID to chunk mapping
    const moduleToChunk = new Map() // moduleId -> chunkFileName

    // Track chunk dependencies
    const chunkDependencies = new Map() // chunkFileName -> Set<chunkFileName>

    // Store processed manifest for later use
    let processedManifest = null

    // Process bundle and categorize chunks
    function processBundle(bundle) {
        // First pass: Build module to chunk mapping
        for (const [fileName, chunk] of Object.entries(bundle)) {
            if (chunk.type === "chunk") {
                // Map the main module
                if (chunk.facadeModuleId) {
                    moduleToChunk.set(chunk.facadeModuleId, fileName)
                }

                // Map all modules in this chunk
                if (chunk.modules) {
                    for (const moduleId of Object.keys(chunk.modules)) {
                        moduleToChunk.set(moduleId, fileName)
                    }
                }
            }
        }

        // Second pass: Build chunk dependency graph
        for (const [fileName, chunk] of Object.entries(bundle)) {
            if (chunk.type === "chunk") {
                const deps = new Set()

                // Add static imports
                if (chunk.imports) {
                    chunk.imports.forEach((imp) => deps.add(imp))
                }

                // Add dynamic imports
                if (chunk.dynamicImports) {
                    chunk.dynamicImports.forEach((imp) => deps.add(imp))
                }

                chunkDependencies.set(fileName, deps)
            }
        }

        // Third pass: Categorize chunks
        const categorizedChunks = {
            essential: {},
            ssrTrue: {},
            ssrFalse: {},
        }

        // Find entry chunks
        const entryChunks = Object.entries(bundle)
            .filter(([_, chunk]) => chunk.type === "chunk" && chunk.isEntry)
            .map(([fileName]) => fileName)

        // Get all split chunks and their dependencies
        const splitChunkNames = new Set()
        const splitDependencyChunks = new Set()

        for (const [moduleId, splitInfo] of splitModules.entries()) {
            const chunkName = moduleToChunk.get(moduleId)
            if (chunkName && bundle[chunkName]) {
                splitChunkNames.add(chunkName)

                // Add all dependencies of this split chunk to the split dependency set
                const deps = chunkDependencies.get(chunkName) || new Set()
                deps.forEach((dep) => {
                    splitDependencyChunks.add(dep)
                })
            }
        }

        // Helper function to check if a chunk is only used by split chunks
        const isChunkOnlyUsedBySplits = (chunkName) => {
            // Check all chunks that import this chunk
            for (const [otherChunk, deps] of chunkDependencies.entries()) {
                if (deps.has(chunkName)) {
                    // If this chunk is imported by a non-split chunk, it's not split-only
                    if (!splitChunkNames.has(otherChunk)) {
                        return false
                    }
                }
            }
            return true
        }

        // Define essential chunks more strictly
        const essentialChunkNames = new Set()

        // Start with entry chunks (always include entry chunks as essential)
        for (const entryChunk of entryChunks) {
            essentialChunkNames.add(entryChunk)
        }

        // Add dependencies that are:
        // 1. Not split chunks themselves
        // 2. Not used exclusively by split chunks (i.e., truly shared/core)
        for (const [chunkName, deps] of chunkDependencies.entries()) {
            if (essentialChunkNames.has(chunkName)) {
                for (const dep of deps) {
                    if (!splitChunkNames.has(dep)) {
                        // Check if this dependency is used by non-split chunks
                        if (!isChunkOnlyUsedBySplits(dep)) {
                            essentialChunkNames.add(dep)
                        }
                    }
                }
            }
        }
        // Categorize split chunks
        const categorizedChunkNames = new Set()

        for (const [moduleId, splitInfo] of splitModules.entries()) {
            const chunkName = moduleToChunk.get(moduleId)
            if (chunkName && bundle[chunkName]) {
                // Only categorize the specific chunk for the split module, not dependencies
                if (!categorizedChunkNames.has(chunkName)) {
                    const category = splitInfo.ssr ? "ssrTrue" : "ssrFalse"
                    categorizedChunks[category][chunkName] = {
                        file: chunkName,
                        src: bundle[chunkName].facadeModuleId || "",
                        isEntry: bundle[chunkName].isEntry || false,
                        css: bundle[chunkName].css || [],
                        imports: bundle[chunkName].imports || [],
                        dynamicImports: bundle[chunkName].dynamicImports || [],
                    }
                    categorizedChunkNames.add(chunkName)
                }
            }
        }

        // Add essential chunks
        for (const fileName of essentialChunkNames) {
            if (bundle[fileName] && bundle[fileName].type === "chunk") {
                categorizedChunks.essential[fileName] = {
                    file: fileName,
                    src: bundle[fileName].facadeModuleId || "",
                    isEntry: bundle[fileName].isEntry || false,
                    css: bundle[fileName].css || [],
                    imports: bundle[fileName].imports || [],
                    dynamicImports: bundle[fileName].dynamicImports || [],
                }
            }
        }

        // Log any remaining chunks and why they're not categorized
        for (const [fileName, chunk] of Object.entries(bundle)) {
            if (
                chunk.type === "chunk" &&
                !essentialChunkNames.has(fileName) &&
                !splitChunkNames.has(fileName)
            ) {
                categorizedChunks.essential[fileName] = {
                    file: fileName,
                    src: chunk.facadeModuleId || "",
                    isEntry: chunk.isEntry || false,
                    css: chunk.css || [],
                    imports: chunk.imports || [],
                    dynamicImports: chunk.dynamicImports || [],
                }
            }
        }

        // Process CSS files with hybrid loading strategy
        const initialCategorization = {
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

        // Store initial result for CSS processing
        processedManifest = initialCategorization

        // Return the enhanced categorization
        return processedManifest
    }

    // Apply Vite manifest structure to categorized chunks
    function applyViteManifestStructure(categorizedManifest, viteManifest) {
        // Create new categorized structure using manifest keys
        const newCategorizedChunks = {
            essential: {},
            ssrTrue: {},
            ssrFalse: {},
        }

        for (const category of ["essential", "ssrTrue", "ssrFalse"]) {
            for (const [chunkName, chunkData] of Object.entries(categorizedManifest[category])) {
                // Find the manifest entry where the 'file' property matches our chunk filename
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
                    // Use the original manifest key and entry structure
                    newCategorizedChunks[category][matchedViteKey] = {
                        ...matchedViteEntry,
                    }
                } else {
                    console.log(`❌ No manifest match found for ${chunkName}, keeping original structure`)
                    // Fallback to original structure if no manifest match
                    newCategorizedChunks[category][chunkName] = chunkData
                }
            }
        }

        // Ensure entry points are always in essential category
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

        // Replace categorized chunks with new structure
        Object.keys(categorizedManifest).forEach((category) => {
            if (category !== "metadata") {
                categorizedManifest[category] = newCategorizedChunks[category]
            }
        })
    }

    return {
        name: "manifest-categorization",

        // Use resolveId to track module resolution
        resolveId(id, importer, options) {
            // Let Vite handle the resolution first
            return null
        },

        // Scan source files to identify split calls
        transform(code, id) {
            if (id.includes("node_modules")) {
                return null
            }

            // Look for split calls
            if (code.includes("split")) {
                // Single comprehensive regex for split
                const splitRegex =
                    /split\s*\(\s*\(\)\s*=>\s*import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*(?:,\s*\{([^}]*)\})?\s*\)/g

                let match
                while ((match = splitRegex.exec(code)) !== null) {
                    const importPath = match[1]
                    const options = match[2] || ""

                    // Determine SSR value
                    let ssrValue = true // default
                    const ssrMatch = options.match(/ssr\s*:\s*(true|false)/)
                    if (ssrMatch) {
                        ssrValue = ssrMatch[1] === "true"
                    }

                    // Resolve the import path using Vite's resolver
                    this.resolve(importPath, id)
                        .then((resolved) => {
                            if (resolved) {
                                splitModules.set(resolved.id, {
                                    ssr: ssrValue,
                                    originalPath: importPath,
                                })
                            }
                        })
                        .catch((err) => {
                            console.log(`❌ Error resolving ${importPath}:`, err.message)
                        })
                }
            }

            return null
        },

        // Collect data during bundle generation (has access to full bundle data)
        generateBundle(options, bundle) {
            processedManifest = processBundle(bundle)
        },

        // Write the file after all files are written (manifest.json is available)
        closeBundle() {
            // Read Vite's manifest.json from disk (now guaranteed to exist)
            let viteManifest = null

            try {
                const manifestPath = path.join(process.env.src_path, "build", ".vite", "manifest.json")
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

            // Use processed manifest from generateBundle and apply Vite manifest structure
            if (!processedManifest) {
                console.log("❌ No processed manifest available")
                return
            }

            applyViteManifestStructure(processedManifest, viteManifest)

            // Write manifest file directly to filesystem
            const outputPath = path.join(process.env.src_path, "build", ".vite", outputFile)
            fs.writeFileSync(outputPath, JSON.stringify(processedManifest, null, 2))
        },
    }
}
