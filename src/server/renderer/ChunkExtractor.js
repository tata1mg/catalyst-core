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
        const baseUrl = `${process.env.PUBLIC_STATIC_ASSET_URL || ""}${process.env.PUBLIC_STATIC_ASSET_PATH || ""}`
        this.publicPath = options.publicPath || `${baseUrl.replace(/\/+$/, "")}/`
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
            const filePart = manifestEntry.file.replace(/^\/+/, "")
            const fileUrl = `${this.publicPath}${filePart}`
            if (this.essentialAssets.js.has(fileUrl)) {
                return
            }
            if (category === "essential") {
                this.essentialAssets.js.add(fileUrl)
            }
            // CSS paths stay relative — generateInlineCssFromAssets reads them from disk
            if (manifestEntry.css && Array.isArray(manifestEntry.css)) {
                manifestEntry.css.forEach((cssFile) => {
                    this.essentialAssets.css.add(cssFile.replace(/^\/+/, ""))
                })
            }
            if (manifestEntry.allCss && Array.isArray(manifestEntry.allCss)) {
                manifestEntry.allCss.forEach((cssFile) => {
                    this.essentialAssets.css.add(cssFile.replace(/^\/+/, ""))
                })
            }
        }
    }
    /**
     * Add ssrTrue assets directly
     */
    addNonEssentialAssets(manifestEntry) {
        if (manifestEntry.file) {
            const filePart = manifestEntry.file.replace(/^\/+/, "")
            const fileUrl = `${this.publicPath}${filePart}`
            if (this.nonEssentialAssets.js.has(fileUrl)) {
                return
            }
            this.nonEssentialAssets.js.add(fileUrl)
            // CSS paths stay relative — generateInlineCssFromAssets reads them from disk
            if (manifestEntry.css && Array.isArray(manifestEntry.css)) {
                manifestEntry.css.forEach((cssFile) => {
                    this.nonEssentialAssets.css.add(cssFile.replace(/^\/+/, ""))
                })
            }
        }
    }

    /**
     * Generate chunk ID for CSS file
     */

    /**
     * Add a component for tracking
     * @param {string} cacheKey - The manifest key for the component
     */
    addComponent(cacheKey) {
        this.components.add(cacheKey)

        const resolvedKey =
            this.manifest[cacheKey] != null
                ? cacheKey
                : Object.keys(this.manifest).find((k) => k.startsWith(cacheKey + "."))

        if (resolvedKey) {
            this.addNonEssentialAssets(this.manifest[resolvedKey])
        }
    }

    /**
     * Get the raw cacheKeys of all components actually rendered on the server
     * @returns {string[]}
     */
    getRenderedComponentKeys() {
        return Array.from(this.components)
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
