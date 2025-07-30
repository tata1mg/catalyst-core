/**
 * ChunkExtractor class for tracking and extracting chunks during SSR
 * Compatible with Vite's manifest and chunk splitting system
 * Enhanced with CSS registry support for deduplication
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
}

export default ChunkExtractor
