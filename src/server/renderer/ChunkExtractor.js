/**
 * PPR Asset Phase - used to track which phase an asset belongs to
 */
export const PPR_ASSET_PHASE = {
    STATIC_SHELL: "static_shell", // Assets for initial prerender (critical path)
    DYNAMIC: "dynamic", // Assets for resume phase (deferred loading)
}

/**
 * ChunkExtractor class for tracking and extracting chunks during SSR
 * Compatible with Vite's manifest and chunk splitting system
 * Enhanced with CSS registry support for deduplication
 * Extended with PPR support for static shell vs dynamic asset categorization
 */
export class ChunkExtractor {
    constructor(options = {}) {
        this.manifest = options.manifest || {}
        this.components = new Set()
        this.assetManifest = options.assetManifest || {}
        this.essentialAssets = {
            js: new Set(),
            css: new Set(),
        }
        this.nonEssentialAssets = {
            js: new Set(),
            css: new Set(),
        }

        // PPR-specific tracking: categorize assets by render phase
        this.pprAssets = {
            staticShell: { js: new Set(), css: new Set() },
            dynamic: { js: new Set(), css: new Set() },
        }

        // Track essential entry points for the app to function
        this.addEssentialEntrypoints()

        // Set global reference for Split component to use
        if (typeof global !== "undefined") {
            global.__CHUNK_EXTRACTOR__ = this
        }
    }

    /**
     * Add critical assets that should always be included
     */
    addEssentialEntrypoints() {
        // Critical entrypoints that must be loaded
        Object.entries(this.assetManifest.essential || {}).forEach(([key, manifestEntry]) => {
            this.addEssentialAssets(manifestEntry, "essential", key)
        })
    }

    /**
     * Add critical assets directly (always included regardless of ssr flag)
     */
    addEssentialAssets(manifestEntry, category = "unknown") {
        if (manifestEntry.file) {
            if (this.essentialAssets.js.has(manifestEntry.file)) {
                return
            }
            if (category === "essential") {
                this.essentialAssets.js.add(manifestEntry.file)
            }
            if (manifestEntry.css && Array.isArray(manifestEntry.css)) {
                manifestEntry.css.forEach((cssFile) => {
                    this.essentialAssets.css.add(cssFile)
                })
            }
        }
    }
    /**
     * Add ssrTrue assets directly
     */
    addNonEssentialAssets(manifestEntry, category = "unknown") {
        if (manifestEntry.file) {
            if (this.nonEssentialAssets.js.has(manifestEntry.file)) {
                return
            }
            if (category === "ssrTrue") {
                this.nonEssentialAssets.js.add(manifestEntry.file)
            }
            if (manifestEntry.css && Array.isArray(manifestEntry.css)) {
                manifestEntry.css.forEach((cssFile) => {
                    this.nonEssentialAssets.css.add(cssFile)
                })
            }
        }
    }

    /**
     * Generate chunk ID for CSS file
     */

    /**
     * Add a component for tracking
     * @param {Function} componentImportFn - Component import function
     */
    addComponent(cacheKey) {
        if (this.manifest[cacheKey]) {
            // Determine category based on asset manifest
            let category = "unknown"
            if (this.assetManifest.ssrTrue && this.assetManifest.ssrTrue[cacheKey]) {
                category = "ssrTrue"
            } else if (this.assetManifest.ssrFalse && this.assetManifest.ssrFalse[cacheKey]) {
                category = "ssrFalse"
            } else if (this.assetManifest.essential && this.assetManifest.essential[cacheKey]) {
                category = "essential"
            }

            this.addNonEssentialAssets(this.manifest[cacheKey], category, cacheKey)
        }
    }

    /**
     * Get all extracted essential assets
     * @returns {Object} - Object with js and css arrays
     */
    getEssentialAssets() {
        const assets = {
            js: Array.from(this.essentialAssets.js),
            css: Array.from(this.essentialAssets.css),
        }
        return assets
    }

    /**
     * Get all extracted essential assets
     * @returns {Object} - Object with js and css arrays
     */
    getNonEssentialAssets() {
        const assets = {
            js: Array.from(this.nonEssentialAssets.js),
            css: Array.from(this.nonEssentialAssets.css),
        }
        return assets
    }

    /**
     * Get assets for PPR static shell (critical path for initial render)
     * These are essential assets that must be in the prelude
     * @returns {Object} - Object with js and css arrays
     */
    getStaticShellAssets() {
        // Static shell assets = essential assets
        // These are needed for the initial render before any Suspense boundaries resolve
        return {
            js: Array.from(this.essentialAssets.js),
            css: Array.from(this.essentialAssets.css),
        }
    }

    /**
     * Get assets for PPR dynamic phase (loaded during resume)
     * These are non-essential assets that can be deferred
     * @returns {Object} - Object with js and css arrays
     */
    getDynamicAssets() {
        // Dynamic assets = non-essential assets
        // These are loaded after the static shell is rendered
        return {
            js: Array.from(this.nonEssentialAssets.js),
            css: Array.from(this.nonEssentialAssets.css),
        }
    }

    /**
     * Get all assets categorized for PPR
     * @returns {Object} - { staticShell: { js, css }, dynamic: { js, css } }
     */
    getPPRAssets() {
        return {
            staticShell: this.getStaticShellAssets(),
            dynamic: this.getDynamicAssets(),
        }
    }

    /**
     * Check if PPR is enabled
     * @returns {boolean}
     */
    isPPREnabled() {
        return process.env.ENABLE_PPR === "true"
    }
}

export default ChunkExtractor
