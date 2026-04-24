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
 *
 * Input:
 *   node    - an AST node (object with a `type` string, e.g. { type: "CallExpression", ... })
 *   visitor - function(node) called once for every node in the tree
 *
 * Output:
 *   none (side-effect only; visitor is invoked for each node)
 *
 * Real example — user wrote this in src/client/routes.jsx:
 *     const HomePage = split(() => import("./pages/Home"), { ssr: true })
 *
 * After this.parse(code), the split(...) call becomes an AST subtree:
 *     {
 *       type: "CallExpression",
 *       callee: { type: "Identifier", name: "split" },
 *       arguments: [
 *         { type: "ArrowFunctionExpression",
 *           body: { type: "ImportExpression",
 *                   source: { type: "Literal", value: "./pages/Home" } } },
 *         { type: "ObjectExpression",
 *           properties: [ { type: "Property",
 *                           key:   { type: "Identifier", name: "ssr" },
 *                           value: { type: "Literal", value: true } } ] }
 *       ]
 *     }
 * walk() visits the CallExpression first, then recurses down into the Identifier
 * "split", the ArrowFunctionExpression, the ImportExpression, the "./pages/Home"
 * Literal, the ObjectExpression, each Property, and so on — visitor sees every one.
 * The transform hook below uses this to spot the split() calls.
 */
function walk(node, visitor) {
    if (!node || typeof node !== "object") return

    visitor(node)

    // AST nodes have two kinds of properties:
    //   - scalars (type: "CallExpression", name: "split", value: "./pages/Home")
    //   - children (single node OR array of nodes — e.g. callee, arguments, body)
    // We iterate over every key and recurse only into children. "Is it a child?"
    // is decided by: does the value look like an AST node (truthy object with a
    // string `type`) or an array of such things?
    //
    // For the CallExpression above, keys = ["type", "callee", "arguments"]:
    //   - "type"      -> string  "CallExpression"   → skipped
    //   - "callee"    -> node    (Identifier "split") → recurse
    //   - "arguments" -> array   [ArrowFn, ObjExpr]  → iterate and recurse into each
    for (const key of Object.keys(node)) {
        const child = node[key]
        if (Array.isArray(child)) {
            // Array child. For split(() => import("./pages/Home"), { ssr: true })
            // this covers arguments = [ArrowFunctionExpression, ObjectExpression] —
            // walk both so we also see the ssr option later.
            for (const item of child) {
                if (item && typeof item.type === "string") {
                    walk(item, visitor)
                }
            }
        } else if (child && typeof child.type === "string") {
            // Single nested node. E.g. node.callee → Identifier { name: "split" }.
            walk(child, visitor)
        }
    }
}

export function manifestCategorizationPlugin(options = {}) {
    const { outputFile = "asset-categories.json", publicPath = "/client/assets/" } = options

    // Plugin state, filled across different hooks.
    //
    // Imagine the app has this in src/client/routes.jsx:
    //     const HomePage    = split(() => import("./pages/Home"),     { ssr: true  })
    //     const DrugPage    = split(() => import("./pages/Drug"),     { ssr: true  })
    //     const ModalWidget = split(() => import("./widgets/Modal"),  { ssr: false })
    //
    // During transform() we haven't resolved the import strings yet, so we just
    // collect them. Later buildEnd() turns each relative path into an absolute id.
    //
    // pendingSplitPaths (populated in transform):
    //   [
    //     { importPath: "./pages/Home",    importer: "<src_path>/client/routes.jsx", ssrValue: true  },
    //     { importPath: "./pages/Drug",    importer: "<src_path>/client/routes.jsx", ssrValue: true  },
    //     { importPath: "./widgets/Modal", importer: "<src_path>/client/routes.jsx", ssrValue: false },
    //   ]
    //
    // splitModules (populated in buildEnd, keyed by resolved absolute id):
    //   Map {
    //     "<src_path>/client/pages/Home.jsx"    -> { ssr: true,  originalPath: "./pages/Home"    },
    //     "<src_path>/client/pages/Drug.jsx"    -> { ssr: true,  originalPath: "./pages/Drug"    },
    //     "<src_path>/client/widgets/Modal.jsx" -> { ssr: false, originalPath: "./widgets/Modal" },
    //   }
    const pendingSplitPaths = [] // { importPath, importer, ssrValue }
    const splitModules = new Map() // resolvedId -> { ssr: boolean, originalPath: string }

    // moduleToChunk: which Rollup output chunk each source module ended up inside,
    // after Rollup has applied manualChunks (vendor + natural splitting).
    //   Example after build:
    //     "<src_path>/client/index.js"          -> "client/assets/main-Ab12.js"
    //     "<src_path>/client/App.jsx"           -> "client/assets/main-Ab12.js"
    //     "<src_path>/client/pages/Home.jsx"    -> "client/assets/Home-Cd34.js"
    //     "<src_path>/client/pages/Drug.jsx"    -> "client/assets/Drug-Ef56.js"
    //     "<src_path>/client/widgets/Modal.jsx" -> "client/assets/Modal-Gh78.js"
    //     "node_modules/react/index.js"         -> "client/assets/vendor-Ij90.js"
    //     "node_modules/react-dom/index.js"     -> "client/assets/vendor-Ij90.js"
    //
    // chunkDependencies: static (non-dynamic) imports of each output chunk.
    //   "client/assets/main-Ab12.js" -> Set { "client/assets/vendor-Ij90.js" }
    //   "client/assets/Home-Cd34.js" -> Set { "client/assets/vendor-Ij90.js" }
    //   "client/assets/Drug-Ef56.js" -> Set { "client/assets/vendor-Ij90.js" }
    //   "client/assets/vendor-Ij90.js" -> Set { }
    // (Note: Home/Drug/Modal are reached from main via dynamic import(), so they
    // are NOT in main's chunk.imports; they'd be in main's chunk.dynamicImports.)
    const moduleToChunk = new Map() // moduleId -> chunkFileName
    const chunkDependencies = new Map() // chunkFileName -> Set<chunkFileName> (static imports only)

    let processedManifest = null

    /**
     * Categorize all chunks in a Rollup bundle into essential / ssrTrue / ssrFalse / orphan.
     *
     * Input:
     *   bundle - Rollup bundle object keyed by output fileName. Each value is either
     *            a chunk ({ type: "chunk", facadeModuleId, modules, imports, dynamicImports, isEntry, css })
     *            or an asset ({ type: "asset", ... }). Only chunks are categorized.
     *
     * Concrete bundle we'll use in examples below (matches this project's output layout —
     * entry configured as "main" in vite.config.client.js, vendor chunk from manualChunks):
     *
     *   bundle = {
     *     "client/assets/main-Ab12.js":   { type: "chunk", isEntry: true,
     *                                        facadeModuleId: "<src>/client/index.js",
     *                                        modules: { "<src>/client/index.js": {...},
     *                                                   "<src>/client/App.jsx":   {...},
     *                                                   "<src>/client/routes.jsx":{...} },
     *                                        imports: ["client/assets/vendor-Ij90.js"],
     *                                        dynamicImports: ["client/assets/Home-Cd34.js",
     *                                                         "client/assets/Drug-Ef56.js",
     *                                                         "client/assets/Modal-Gh78.js"],
     *                                        css: [] },
     *     "client/assets/vendor-Ij90.js": { type: "chunk", isEntry: false,
     *                                        facadeModuleId: null,
     *                                        modules: { "node_modules/react/...": {...},
     *                                                   "node_modules/react-dom/...": {...} },
     *                                        imports: [], dynamicImports: [], css: [] },
     *     "client/assets/Home-Cd34.js":   { type: "chunk", isEntry: false,
     *                                        facadeModuleId: "<src>/client/pages/Home.jsx",
     *                                        modules: { "<src>/client/pages/Home.jsx": {...} },
     *                                        imports: ["client/assets/vendor-Ij90.js"],
     *                                        dynamicImports: [],
     *                                        css: ["client/assets/css/Home-Cd34.css"] },
     *     "client/assets/Drug-Ef56.js":   { type: "chunk", isEntry: false,
     *                                        facadeModuleId: "<src>/client/pages/Drug.jsx",
     *                                        modules: { "<src>/client/pages/Drug.jsx": {...} },
     *                                        imports: ["client/assets/vendor-Ij90.js"],
     *                                        dynamicImports: [], css: [] },
     *     "client/assets/Modal-Gh78.js":  { type: "chunk", isEntry: false,
     *                                        facadeModuleId: "<src>/client/widgets/Modal.jsx",
     *                                        modules: { "<src>/client/widgets/Modal.jsx": {...} },
     *                                        imports: [], dynamicImports: [], css: [] }
     *   }
     *
     * Output (processedManifest) — at this point still keyed by output fileName;
     *   applyViteManifestStructure() will re-key by Vite source paths afterward:
     *   {
     *     essential: { "client/assets/main-Ab12.js": {...},
     *                  "client/assets/vendor-Ij90.js": {...} },
     *     ssrTrue:   { "client/assets/Home-Cd34.js": {...},
     *                  "client/assets/Drug-Ef56.js": {...} },
     *     ssrFalse:  { "client/assets/Modal-Gh78.js": {...} },
     *     orphan:    {},
     *     metadata:  { generatedAt, totalAssets: 5, dependencyStats: { essentialModules: 2,
     *                  ssrTrueModules: 2, ssrFalseModules: 1, orphanModules: 0 } }
     *   }
     */
    function processBundle(bundle) {
        // Pass 1: Build module → chunk mapping.
        //
        // Using the example bundle above, this loop produces moduleToChunk:
        //   "<src>/client/index.js"           -> "client/assets/main-Ab12.js"    (facadeModuleId of main)
        //   "<src>/client/App.jsx"            -> "client/assets/main-Ab12.js"    (from chunk.modules)
        //   "<src>/client/routes.jsx"         -> "client/assets/main-Ab12.js"    (from chunk.modules)
        //   "node_modules/react/..."          -> "client/assets/vendor-Ij90.js"
        //   "node_modules/react-dom/..."      -> "client/assets/vendor-Ij90.js"
        //   "<src>/client/pages/Home.jsx"     -> "client/assets/Home-Cd34.js"
        //   "<src>/client/pages/Drug.jsx"     -> "client/assets/Drug-Ef56.js"
        //   "<src>/client/widgets/Modal.jsx"  -> "client/assets/Modal-Gh78.js"
        for (const [fileName, chunk] of Object.entries(bundle)) {
            if (chunk.type !== "chunk") continue
            // facadeModuleId = the "main" source file this chunk was built from.
            // For main-Ab12.js that's "<src>/client/index.js". vendor-Ij90.js has no
            // facade (it's synthesized by manualChunks), so we fall through to chunk.modules.
            if (chunk.facadeModuleId) {
                moduleToChunk.set(chunk.facadeModuleId, fileName)
            }
            // chunk.modules = every source module that was rolled into this chunk.
            // For main-Ab12.js, this includes index.js, App.jsx, routes.jsx, etc.
            if (chunk.modules) {
                for (const moduleId of Object.keys(chunk.modules)) {
                    moduleToChunk.set(moduleId, fileName)
                }
            }
        }

        // Pass 2: Build static-only dependency graph (excludes dynamicImports intentionally).
        //
        // Using the example bundle, chunkDependencies becomes:
        //   "client/assets/main-Ab12.js"   -> Set { "client/assets/vendor-Ij90.js" }
        //   "client/assets/vendor-Ij90.js" -> Set { }
        //   "client/assets/Home-Cd34.js"   -> Set { "client/assets/vendor-Ij90.js" }
        //   "client/assets/Drug-Ef56.js"   -> Set { "client/assets/vendor-Ij90.js" }
        //   "client/assets/Modal-Gh78.js"  -> Set { }
        //
        // Note: main-Ab12.js has dynamicImports [Home, Drug, Modal] — those are NOT
        // included here. That's what keeps the Home/Drug/Modal chunks out of the
        // essential closure below even though main references them.
        for (const [fileName, chunk] of Object.entries(bundle)) {
            if (chunk.type !== "chunk") continue
            chunkDependencies.set(fileName, new Set(chunk.imports || []))
        }

        // Identify which output chunks are split() targets.
        //
        // splitModules (filled in buildEnd) has resolved source ids. We translate each
        // to the chunk it ended up in:
        //
        //   splitModules keys -> moduleToChunk -> splitChunkNames
        //   "<src>/client/pages/Home.jsx"    -> "client/assets/Home-Cd34.js"
        //   "<src>/client/pages/Drug.jsx"    -> "client/assets/Drug-Ef56.js"
        //   "<src>/client/widgets/Modal.jsx" -> "client/assets/Modal-Gh78.js"
        //
        //   splitChunkNames = Set { "client/assets/Home-Cd34.js",
        //                           "client/assets/Drug-Ef56.js",
        //                           "client/assets/Modal-Gh78.js" }
        const splitChunkNames = new Set()
        for (const moduleId of splitModules.keys()) {
            const chunkName = moduleToChunk.get(moduleId)
            if (chunkName && bundle[chunkName]) splitChunkNames.add(chunkName)
        }

        // Build reverse adjacency map once — O(n) instead of O(n²) per lookup.
        //
        // We already have chunkDependencies ("who does X import?"). importedBy answers
        // the reverse: "who imports X?". Used for orphan detection and the
        // isChunkOnlyUsedBySplits check below.
        //
        // Using our example chunkDependencies, this loop produces:
        //   importedBy = {
        //     "client/assets/vendor-Ij90.js": Set { "client/assets/main-Ab12.js",
        //                                           "client/assets/Home-Cd34.js",
        //                                           "client/assets/Drug-Ef56.js" }
        //   }
        //   (main/Home/Drug/vendor/Modal have no static importers and don't appear as keys)
        const importedBy = new Map() // chunkFileName -> Set<chunkFileNames that statically import it>
        for (const [chunk, deps] of chunkDependencies.entries()) {
            for (const dep of deps) {
                if (!importedBy.has(dep)) importedBy.set(dep, new Set())
                importedBy.get(dep).add(chunk)
            }
        }

        /**
         * Input:  chunkName - an output chunk file name.
         * Output: true iff the chunk has at least one static importer AND every static
         *         importer is itself a split() target. Such a chunk is lazy-only, so
         *         we keep it out of essentials.
         *
         * Example A — a "shared page logic" chunk imported only by lazy pages:
         *   Imagine HomePage and DrugPage both statically import "./pages/pageUtils.js"
         *   and pageUtils lands in its own chunk "client/assets/pageUtils-Kl00.js".
         *     splitChunkNames = { Home-Cd34.js, Drug-Ef56.js, Modal-Gh78.js }
         *     importedBy["pageUtils-Kl00.js"] = Set { "Home-Cd34.js", "Drug-Ef56.js" }
         *   Every importer is a split target → returns true → excluded from essentials,
         *   so it loads only when Home or Drug is actually requested.
         *
         * Example B — vendor (used by BOTH main and pages):
         *   importedBy["vendor-Ij90.js"] = Set { "main-Ab12.js", "Home-Cd34.js", "Drug-Ef56.js" }
         *   main-Ab12.js is an entry, not a split target → returns false → vendor stays essential.
         */
        const isChunkOnlyUsedBySplits = (chunkName) => {
            const importers = importedBy.get(chunkName)
            if (!importers || importers.size === 0) return false
            return [...importers].every((imp) => splitChunkNames.has(imp))
        }

        // Orphan chunks: no static importers, not an entry chunk, and not a split target.
        // Split targets ALSO have zero static importers (they're dynamically imported)
        // but they're already categorized as ssrTrue/ssrFalse — the `splitChunkNames.has`
        // guard prevents them from double-counting as orphans.
        //
        // With our example bundle, every chunk either is an entry (main), has a static
        // importer (vendor), or is a split target (Home/Drug/Modal):
        //   -> orphanChunkNames = Set {} (empty in the happy case)
        //
        // Orphans would appear if, say, a test-only or polyfill chunk got emitted with
        // no references left anywhere — usually a Vite/Rollup quirk worth investigating.
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
        //
        // Input: entry chunks (isEntry: true) act as BFS roots.
        //        For this project there's one entry: "main" → "client/assets/main-Ab12.js".
        // Output: essentialChunkNames = every chunk reachable from any entry via static imports,
        //         EXCLUDING split targets, chunks only used by split targets, and orphans.
        //
        // Walking the example:
        //   entryChunks   = ["client/assets/main-Ab12.js"]
        //   seed the set  = { main-Ab12.js }
        //   pop main-Ab12.js
        //     -> chunkDependencies → { vendor-Ij90.js }
        //        vendor is not yet in essential, not a split target, not split-only,
        //        not an orphan → add it.
        //   pop vendor-Ij90.js
        //     -> chunkDependencies → {} → nothing to add.
        //   queue empty.
        //
        //   Home/Drug/Modal never enter because main reaches them via dynamicImports,
        //   not imports — the whole reason we only look at imports here.
        //
        //   essentialChunkNames = Set { "client/assets/main-Ab12.js",
        //                               "client/assets/vendor-Ij90.js" }
        const entryChunks = Object.entries(bundle)
            .filter(([_, c]) => c.type === "chunk" && c.isEntry)
            .map(([fileName]) => fileName)

        const essentialChunkNames = new Set(entryChunks)
        const queue = [...entryChunks]

        // Classic BFS loop. Each iteration pops one chunk and enqueues any
        // not-yet-seen static dependency that qualifies as essential.
        while (queue.length > 0) {
            const current = queue.shift()
            // For every static import of `current`, decide whether it joins essentials.
            // Skip if we already have it, or it belongs to a different bucket
            // (split target, split-only, orphan).
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

        /**
         * Input:  fileName - chunk file name, chunk - the bundle entry for it.
         * Output: compact serializable entry object used in the categorized manifest.
         *
         * Example — toEntry for the Home page split() target:
         *   toEntry("client/assets/Home-Cd34.js", bundle["client/assets/Home-Cd34.js"]) =>
         *     {
         *       file:    "client/assets/Home-Cd34.js",
         *       src:     "<src>/client/pages/Home.jsx",
         *       isEntry: false,
         *       css:     ["client/assets/css/Home-Cd34.css"],
         *       imports: ["client/assets/vendor-Ij90.js"],
         *       dynamicImports: []
         *     }
         */
        const toEntry = (fileName, chunk) => ({
            file: fileName,
            src: chunk.facadeModuleId || "",
            isEntry: chunk.isEntry || false,
            css: chunk.css || [],
            imports: chunk.imports || [],
            dynamicImports: chunk.dynamicImports || [],
        })

        const categorizedChunks = { essential: {}, ssrTrue: {}, ssrFalse: {}, orphan: {} }

        // Fill the `essential` bucket from the BFS result above.
        // Result:
        //   categorizedChunks.essential = {
        //     "client/assets/main-Ab12.js":   { file, src: "<src>/client/index.js", isEntry: true,  ... },
        //     "client/assets/vendor-Ij90.js": { file, src: "",                       isEntry: false, ... }
        //   }
        for (const fileName of essentialChunkNames) {
            if (bundle[fileName]?.type === "chunk") {
                categorizedChunks.essential[fileName] = toEntry(fileName, bundle[fileName])
            }
        }

        // Fill `ssrTrue` / `ssrFalse` from split() calls.
        // `seen` dedupes when the same output chunk was targeted by multiple split() calls
        // (e.g. two routes that each split() the same page component).
        //
        // Walking splitModules entries from our running example:
        //   "<src>/client/pages/Home.jsx"   { ssr:true  } -> Home-Cd34.js  -> essential? no, seen? no
        //                                                 -> ssrTrue["client/assets/Home-Cd34.js"]  = toEntry(...)
        //   "<src>/client/pages/Drug.jsx"   { ssr:true  } -> Drug-Ef56.js  -> ssrTrue["client/assets/Drug-Ef56.js"]  = toEntry(...)
        //   "<src>/client/widgets/Modal.jsx"{ ssr:false } -> Modal-Gh78.js -> ssrFalse["client/assets/Modal-Gh78.js"] = toEntry(...)
        const seen = new Set()
        for (const [moduleId, splitInfo] of splitModules.entries()) {
            const chunkName = moduleToChunk.get(moduleId)
            if (chunkName && bundle[chunkName] && !seen.has(chunkName)) {
                const category = splitInfo.ssr ? "ssrTrue" : "ssrFalse"
                categorizedChunks[category][chunkName] = toEntry(chunkName, bundle[chunkName])
                seen.add(chunkName)
            }
        }

        // Fill `orphan` bucket — usually empty for healthy builds. Present purely for
        // observability when Vite emits a chunk that nothing references.
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

    /**
     * Re-key the categorized manifest so it uses the same keys Vite uses in its manifest.json,
     * and swap the per-chunk data for Vite's richer entries (so downstream code —
     * ChunkExtractor, SSR — can look chunks up by source path, not by output hash).
     *
     * Input:
     *   categorizedManifest - { essential, ssrTrue, ssrFalse, orphan, metadata } (mutated in place).
     *     Buckets are keyed by OUTPUT file name (e.g. "client/assets/Home-Cd34.js").
     *
     *   viteManifest - contents of build/.vite/manifest.json. Keyed by SOURCE path:
     *     {
     *       "client/index.js": {
     *         file: "client/assets/main-Ab12.js",
     *         src:  "client/index.js",
     *         isEntry: true,
     *         css: [],
     *         imports: ["_vendor-Ij90.js"]
     *       },
     *       "_vendor-Ij90.js": {            // underscored keys = internal chunks (no facade source)
     *         file: "client/assets/vendor-Ij90.js",
     *         css:  []
     *       },
     *       "client/pages/Home.jsx": {
     *         file: "client/assets/Home-Cd34.js",
     *         src:  "client/pages/Home.jsx",
     *         isEntry: false,
     *         css:    ["client/assets/css/Home-Cd34.css"],
     *         imports: ["_vendor-Ij90.js"]
     *       },
     *       "client/pages/Drug.jsx":    { file: "client/assets/Drug-Ef56.js",  ... },
     *       "client/widgets/Modal.jsx": { file: "client/assets/Modal-Gh78.js", ... }
     *     }
     *
     * Output:
     *   none (mutates categorizedManifest buckets to be keyed by the viteKey).
     *
     * Before → after for our running example:
     *   Before: ssrTrue = { "client/assets/Home-Cd34.js": {...}, "client/assets/Drug-Ef56.js": {...} }
     *   After:  ssrTrue = { "client/pages/Home.jsx":      {...}, "client/pages/Drug.jsx":      {...} }
     */
    function applyViteManifestStructure(categorizedManifest, viteManifest) {
        const newCategorizedChunks = {
            essential: {},
            ssrTrue: {},
            ssrFalse: {},
            orphan: {},
        }

        // Outer loop: visit each bucket (essential, ssrTrue, ssrFalse, orphan).
        // Inner loop: every chunk currently in that bucket — find its Vite manifest twin
        //             and re-key under the Vite source path.
        //
        // Walking our running example for ssrTrue bucket:
        //   chunkName = "client/assets/Home-Cd34.js"
        //     innermost for-loop scans viteManifest until it finds viteEntry.file ===
        //     "client/assets/Home-Cd34.js" → viteKey = "client/pages/Home.jsx".
        //     -> newCategorizedChunks.ssrTrue["client/pages/Home.jsx"] = { ...that vite entry }
        //   chunkName = "client/assets/Drug-Ef56.js"
        //     -> newCategorizedChunks.ssrTrue["client/pages/Drug.jsx"] = { ...that vite entry }
        for (const category of ["essential", "ssrTrue", "ssrFalse", "orphan"]) {
            for (const [chunkName, chunkData] of Object.entries(categorizedManifest[category])) {
                let matchedViteKey = null
                let matchedViteEntry = null

                // Linear search over the Vite manifest for an entry whose `.file`
                // equals the current chunk's output file name. We break on first hit
                // since each output file appears exactly once in Vite's manifest.
                //
                // Example iteration when chunkName = "client/assets/vendor-Ij90.js":
                //   viteKey = "client/index.js"          file "client/assets/main-Ab12.js"    ≠ skip
                //   viteKey = "_vendor-Ij90.js"          file "client/assets/vendor-Ij90.js"  ✓ match, break
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
                    // Rare: a chunk that exists in Rollup's bundle but not in Vite's manifest
                    // (e.g. a virtual/internal chunk Vite doesn't index). Keep it under its
                    // output file name so it still shows up downstream.
                    console.log(`❌ No manifest match found for ${chunkName}, keeping original structure`)
                    newCategorizedChunks[category][chunkName] = chunkData
                }
            }
        }

        // Safety net: every Vite manifest entry with isEntry: true MUST exist somewhere.
        // If our categorization missed an entry (shouldn't happen, but defensive), force
        // it into `essential` so the client at minimum boots.
        //
        // Example failure mode this protects against: someone adds a second entry to
        // rollupOptions.input in vite.config.client.js (say, an admin panel entry), and
        // for whatever reason our BFS didn't classify it. This loop guarantees
        // newCategorizedChunks.essential["client/admin.js"] gets populated anyway.
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

        // Replace each bucket on the original manifest in place (metadata preserved).
        Object.keys(categorizedManifest).forEach((category) => {
            if (category !== "metadata") {
                categorizedManifest[category] = newCategorizedChunks[category]
            }
        })
    }

    /**
     * Recursively collect all CSS files reachable from a manifest key — the node itself
     * plus everything it statically imports, transitively.
     *
     * Input:
     *   viteKey      - a key in Vite's manifest, e.g. "client/pages/Home.jsx"
     *   viteManifest - the full parsed manifest.json
     *   visited      - set of already-seen keys (used internally to prevent cycles)
     *
     * Output:
     *   Array<string> of CSS file paths. May contain duplicates across recursion paths;
     *   callers Set-dedupe. Returns [] if the key isn't found or already visited.
     *
     * Example with the Home page — imagine Home imports a shared Button chunk that
     * imports vendor-ish icons; each has their own CSS from cssCodeSplit:
     *
     *   viteManifest = {
     *     "client/pages/Home.jsx": { css: ["client/assets/css/Home-Cd34.css"],
     *                                 imports: ["_Button-Mn11.js"] },
     *     "_Button-Mn11.js":       { css: ["client/assets/css/Button-Mn11.css"],
     *                                 imports: ["_icons-Op22.js"] },
     *     "_icons-Op22.js":        { css: ["client/assets/css/icons-Op22.css"],
     *                                 imports: [] }
     *   }
     *   collectTransitiveCss("client/pages/Home.jsx", viteManifest)
     *     -> ["client/assets/css/Home-Cd34.css",
     *         "client/assets/css/Button-Mn11.css",
     *         "client/assets/css/icons-Op22.css"]
     *
     * This is what lets the server emit <link rel="stylesheet"> tags for all CSS the
     * Home page needs — direct AND transitive — in one shot.
     */
    function collectTransitiveCss(viteKey, viteManifest, visited = new Set()) {
        if (visited.has(viteKey)) return []
        visited.add(viteKey)

        const entry = viteManifest[viteKey]
        if (!entry) return []

        const css = [...(entry.css || [])]
        // Recurse into static imports. entry.imports is an array of other viteManifest keys.
        // For "client/pages/Home.jsx", that might be ["_Button-Mn11.js", "_vendor-Ij90.js"].
        for (const imp of entry.imports || []) {
            css.push(...collectTransitiveCss(imp, viteManifest, visited))
        }
        return css
    }

    /**
     * Attach an `allCss` array (transitive CSS) to every chunk in every bucket.
     *
     * Input:
     *   categorizedManifest - mutated in place. Each chunk entry gets a new `.allCss`.
     *   viteManifest        - Vite's manifest.json used for traversal.
     *
     * Output:
     *   none (side effect: each chunk now has .allCss = unique list of transitively reachable CSS).
     *
     * Running example — `ssrTrue["client/pages/Home.jsx"]` before/after:
     *   Before: {
     *     file: "client/assets/Home-Cd34.js",
     *     css:  ["client/assets/css/Home-Cd34.css"],    // Home's own CSS only
     *     imports: ["_Button-Mn11.js"]
     *   }
     *   After (same object with .allCss added): {
     *     file: "client/assets/Home-Cd34.js",
     *     css:  ["client/assets/css/Home-Cd34.css"],
     *     imports: ["_Button-Mn11.js"],
     *     allCss: [                                      // direct + transitive, deduped
     *       "client/assets/css/Home-Cd34.css",
     *       "client/assets/css/Button-Mn11.css",
     *       "client/assets/css/icons-Op22.css"
     *     ]
     *   }
     */
    function enrichWithTransitiveCss(categorizedManifest, viteManifest) {
        // Outer loop: each bucket.
        // Inner loop: each chunk within the bucket — compute its full transitive CSS closure.
        for (const category of ["essential", "ssrTrue", "ssrFalse", "orphan"]) {
            for (const [key, chunk] of Object.entries(categorizedManifest[category])) {
                const transitiveCss = collectTransitiveCss(key, viteManifest)
                // Dedupe: vendor CSS may be pulled in via multiple paths (e.g. both
                // "client/index.js" and "client/pages/Home.jsx" import vendor).
                chunk.allCss = [...new Set(transitiveCss)]
            }
        }
    }

    /**
     * Guard against silent CSS loss: every CSS file emitted to disk should be referenced
     * by at least one bucket's css or allCss. If enrichWithTransitiveCss ever misses a
     * branch of the import graph, the affected CSS would vanish from server responses
     * with no runtime error — this check surfaces that as a build-time warning.
     *
     * Input:
     *   categorizedManifest - the bucketized manifest (already enriched with allCss).
     *   buildDir            - absolute path to the build output directory (e.g. <src>/build).
     *
     * Output:
     *   none (prints a console.warn listing any CSS emitted on disk but not referenced
     *         by any bucket's css / allCss).
     *
     * Example scenario — say the build emitted three CSS files:
     *   build/client/assets/css/
     *     ├── Home-Cd34.css       ← referenced by ssrTrue["client/pages/Home.jsx"].allCss
     *     ├── Drug-Ef56.css       ← referenced by ssrTrue["client/pages/Drug.jsx"].allCss
     *     └── ForgottenWidget-Zz99.css   ← NOT referenced anywhere → warning
     *
     *   "ForgottenWidget" might be a chunk that got split off but whose entry somehow
     *   fell through the categorization (regression in the plugin, or a new Vite chunk
     *   shape). Without this check the file still exists on disk, but the ChunkExtractor
     *   never emits a <link> for it, so users hit the page and see unstyled content.
     */
    function validateCssCoverage(categorizedManifest, buildDir) {
        const cssDir = path.join(buildDir, "client", "assets", "css")
        if (!fs.existsSync(cssDir)) return

        // `emitted` = ground truth of CSS on disk.
        //   Example: Set { "client/assets/css/Home-Cd34.css",
        //                   "client/assets/css/Drug-Ef56.css",
        //                   "client/assets/css/ForgottenWidget-Zz99.css" }
        const emitted = new Set(
            fs
                .readdirSync(cssDir)
                .filter((f) => f.endsWith(".css"))
                .map((f) => `client/assets/css/${f}`)
        )

        // `covered` = union of every CSS path claimed by any bucket, via either
        // chunk.css (direct) or chunk.allCss (transitive, added by enrichWithTransitiveCss).
        //
        // Walking our running example:
        //   essential["client/index.js"]       .css=[]  .allCss=[]
        //   essential["_vendor-Ij90.js"]       .css=[]  .allCss=[]
        //   ssrTrue["client/pages/Home.jsx"]   .css=["...Home-Cd34.css"]
        //                                       .allCss=["...Home-Cd34.css", "...Button-Mn11.css", "...icons-Op22.css"]
        //   ssrTrue["client/pages/Drug.jsx"]   .css=["...Drug-Ef56.css"]  .allCss=["...Drug-Ef56.css", ...]
        //   ssrFalse["client/widgets/Modal.jsx"].css=[]                   .allCss=[]
        //   -> covered = { Home-Cd34.css, Button-Mn11.css, icons-Op22.css, Drug-Ef56.css, ... }
        //   (notably ForgottenWidget-Zz99.css is NOT in covered)
        const covered = new Set()
        for (const category of ["essential", "ssrTrue", "ssrFalse", "orphan"]) {
            for (const chunk of Object.values(categorizedManifest[category])) {
                for (const c of chunk.css || []) covered.add(c)
                for (const c of chunk.allCss || []) covered.add(c)
            }
        }

        // Set-difference: emitted \ covered = files on disk with no claim from any bucket.
        // For the example above: missing = ["client/assets/css/ForgottenWidget-Zz99.css"] → warn.
        const missing = [...emitted].filter((c) => !covered.has(c))
        if (missing.length > 0) {
            console.warn(
                `\n⚠️  [manifest-categorization] ${missing.length} emitted CSS file(s) are not ` +
                    `referenced by any bucket's css/allCss.\n` +
                    `At request time the ChunkExtractor may silently drop them, causing unstyled ` +
                    `content on affected routes. Likely cause: a regression in enrichWithTransitiveCss, ` +
                    `a new chunk shape Vite emits that the walker doesn't follow, or a categorization ` +
                    `gap that leaves some chunk unreachable from every bucket.\n\n` +
                    `Unreferenced files:\n${missing.map((m) => "  " + m).join("\n")}\n\n` +
                    `Please raise an issue at https://github.com/tata1mg/catalyst-core/issues so the ` +
                    `maintainers can investigate.\n`
            )
        }
    }

    return {
        name: "manifest-categorization",

        resolveId(id, importer, options) {
            return null
        },

        /**
         * Vite/Rollup transform hook. Called once per module during build.
         *
         * Input:
         *   code - the raw source of one module being processed.
         *   id   - the module's absolute file path, e.g. "<src>/client/routes.jsx".
         *
         * Output:
         *   null (we don't modify source; side-effect: entries pushed to pendingSplitPaths).
         *
         * Walkthrough with a real user-authored file, "<src>/client/routes.jsx":
         *
         *     import { split } from "catalyst-core"
         *     const HomePage    = split(() => import("./pages/Home"),     { ssr: true  })
         *     const DrugPage    = split(() => import("./pages/Drug"),     { ssr: true  })
         *     const ModalWidget = split(() => import("./widgets/Modal"),  { ssr: false })
         *
         *   - "node_modules" guard: id doesn't contain it, we keep going.
         *   - "split" substring guard: code includes "split", we keep going. (This is a
         *     cheap text-level prefilter; the real check is the AST walk below.)
         *   - this.parse(code) → AST.
         *   - walk() finds three CallExpression nodes where callee is Identifier "split".
         *   - For each, we pull out the import path and ssr flag and push:
         *       { importPath: "./pages/Home",    importer: "<src>/client/routes.jsx", ssrValue: true  }
         *       { importPath: "./pages/Drug",    importer: "<src>/client/routes.jsx", ssrValue: true  }
         *       { importPath: "./widgets/Modal", importer: "<src>/client/routes.jsx", ssrValue: false }
         *
         *   Path resolution happens later in buildEnd (needs async).
         */
        transform(code, id) {
            if (id.includes("node_modules")) return null
            if (!code.includes("split")) return null

            let ast
            try {
                ast = this.parse(code)
            } catch {
                return null
            }

            // Visit every AST node; filter down to CallExpression where callee name === "split".
            walk(ast, (node) => {
                if (node.type !== "CallExpression") return
                if (node.callee.type !== "Identifier" || node.callee.name !== "split") return

                const args = node.arguments
                if (args.length === 0) return

                // First arg must be a function that returns import("...").
                //
                // Supported shapes (both valid in user code):
                //   split(() => import("./pages/Home"), { ssr: true })
                //     -> loader is ArrowFunctionExpression whose body IS the ImportExpression.
                //   split(function () { return import("./pages/Home") }, { ssr: true })
                //     -> loader is FunctionExpression; body must be a single `return import(...)`.
                // Anything fancier (e.g. destructuring, try/catch, multiple statements)
                // is intentionally rejected — keep this detector simple and predictable.
                const loader = args[0]
                let importExpr

                if (loader.type === "ArrowFunctionExpression") {
                    // Arrow case: body is the import expression directly.
                    importExpr = loader.body
                } else if (loader.type === "FunctionExpression") {
                    // Function case: must be exactly `{ return import("X") }`.
                    const stmts = loader.body.body
                    if (stmts.length !== 1 || stmts[0].type !== "ReturnStatement") return
                    importExpr = stmts[0].argument
                } else {
                    return
                }

                if (!importExpr || importExpr.type !== "ImportExpression") return
                if (importExpr.source.type !== "Literal" || typeof importExpr.source.value !== "string") return

                const importPath = importExpr.source.value
                // Example: for the Home split, importPath = "./pages/Home".

                // Extract ssr value from options object (second arg) if present.
                //
                // For split(() => import("./widgets/Modal"), { ssr: false }) the options
                // argument AST looks like:
                //   { type: "ObjectExpression",
                //     properties: [ { type: "Property",
                //                     key:   { type: "Identifier", name: "ssr" },
                //                     value: { type: "Literal", value: false } } ] }
                // We find the `ssr` Property and read its Literal value.
                //
                // Important default — if user writes `split(() => import("./X"))` with
                // no options object, ssrValue stays true. That's why HomePage without an
                // explicit ssr still ends up in ssrTrue.
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

        /**
         * Vite/Rollup buildEnd hook — runs after all modules have been transformed.
         *
         * Input:  none (reads closure variable pendingSplitPaths).
         * Output: none (populates splitModules with resolvedId -> { ssr, originalPath }).
         *
         * Why here and not in transform(): transform can't be async in the way we need,
         * but buildEnd is — this.resolve() is awaitable here.
         *
         * Walking our running example:
         *   pendingSplitPaths = [
         *     { importPath: "./pages/Home",    importer: "<src>/client/routes.jsx", ssrValue: true  },
         *     { importPath: "./pages/Drug",    importer: "<src>/client/routes.jsx", ssrValue: true  },
         *     { importPath: "./widgets/Modal", importer: "<src>/client/routes.jsx", ssrValue: false }
         *   ]
         *   For each, this.resolve(importPath, importer) asks Vite to resolve the
         *   relative path against the importer's directory. Output:
         *     splitModules = Map {
         *       "<src>/client/pages/Home.jsx"    -> { ssr: true,  originalPath: "./pages/Home"    },
         *       "<src>/client/pages/Drug.jsx"    -> { ssr: true,  originalPath: "./pages/Drug"    },
         *       "<src>/client/widgets/Modal.jsx" -> { ssr: false, originalPath: "./widgets/Modal" }
         *     }
         */
        async buildEnd() {
            // Resolve all pending split() targets in parallel. Each .resolve() can hit
            // Vite's module resolver / fs, so doing them together keeps build time down.
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

        /**
         * Vite/Rollup generateBundle hook — bundle shape is finalized, not yet on disk.
         *
         * Input:
         *   options - output options (unused).
         *   bundle  - Rollup bundle, keyed by output fileName (see processBundle docs).
         *
         * Output:
         *   none (stores the categorized manifest into closure variable processedManifest).
         */
        generateBundle(options, bundle) {
            processedManifest = processBundle(bundle)
        },

        /**
         * Vite/Rollup closeBundle hook — runs after all files are on disk, so we can
         * read the freshly-emitted manifest.json.
         *
         * Input:  none (reads Vite's manifest.json from disk + closure processedManifest).
         * Output: none (writes asset-categories.json into build/.vite/).
         *
         * What downstream code (ChunkExtractor during SSR, server/renderer/handler.jsx)
         * reads from this file — abbreviated sample matching our running example:
         *
         *   {
         *     "essential": {
         *       "client/index.js":     { file: "client/assets/main-Ab12.js",   isEntry: true,
         *                                css: [], allCss: [ ...vendor css if any... ] },
         *       "_vendor-Ij90.js":     { file: "client/assets/vendor-Ij90.js", css: [], allCss: [] }
         *     },
         *     "ssrTrue": {
         *       "client/pages/Home.jsx": { file: "client/assets/Home-Cd34.js",
         *                                   css: ["client/assets/css/Home-Cd34.css"],
         *                                   allCss: [ ...Home + Button + icons + vendor css... ] },
         *       "client/pages/Drug.jsx": { file: "client/assets/Drug-Ef56.js",
         *                                   css: ["client/assets/css/Drug-Ef56.css"], allCss: [...] }
         *     },
         *     "ssrFalse": {
         *       "client/widgets/Modal.jsx": { file: "client/assets/Modal-Gh78.js",
         *                                      css: [], allCss: [] }
         *     },
         *     "orphan":   {},
         *     "metadata": { generatedAt: "2026-04-24T...", totalAssets: 5,
         *                   dependencyStats: { essentialModules: 2, ssrTrueModules: 2,
         *                                       ssrFalseModules: 1, orphanModules: 0 } }
         *   }
         */
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

            const buildDir = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build")
            validateCssCoverage(processedManifest, buildDir)

            const outputPath = path.join(buildDir, ".vite", outputFile)
            fs.writeFileSync(outputPath, JSON.stringify(processedManifest, null, 2))
        },
    }
}
