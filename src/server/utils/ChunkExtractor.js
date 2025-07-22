import path from "path"
import fs from "fs"

/**
 * ChunkExtractor class for tracking and extracting chunks during SSR
 * Compatible with Vite's manifest and chunk splitting system
 */
export class ChunkExtractor {
    constructor(options = {}) {
        this.manifest = options.manifest || {}
        this.entrypoints = options.entrypoints || ["main"]
        this.components = new Set()
        this.assetManifest = options.assetManifest || {}
        this.assets = {
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
        Object.entries(this.assetManifest.essential).forEach(([key, manifestEntry]) => {
            this.addAssets(manifestEntry)
        })
    }

    /**
     * Add critical assets directly (always included regardless of ssr flag)
     */
    addAssets(manifestEntry) {
        if (manifestEntry.file) {
            if (this.assets.js.has(manifestEntry.file)) {
                return
            }
            this.assets.js.add(manifestEntry.file)
        }
        if (manifestEntry.css && Array.isArray(manifestEntry.css)) {
            manifestEntry.css.forEach((cssFile) => {
                this.assets.css.add(cssFile)
            })
        }
    }

    /**
     * Add a component for tracking
     * @param {Function} componentImportFn - Component import function
     */
    addComponent(cacheKey) {
        if (this.manifest[cacheKey]) {
            this.addAssets(this.manifest[cacheKey])
        }
    }

    /**
     * Get all extracted assets
     * @returns {Object} - Object with js and css arrays
     */
    getAssets() {
        const assets = {
            js: Array.from(this.assets.js),
            css: Array.from(this.assets.css),
        }
        return assets
    }

    /**
     * Get script tags for all tracked JS assets
     * @param {Object} options - Options for script generation
     * @returns {Array<Object>} - Array of script tag props
     */
    getScriptTags(options = {}) {
        const { publicPath = "/client/assets/", preload = true } = options
        const scripts = []

        this.assets.js.forEach((asset, index) => {
            const src = asset.startsWith("http") ? asset : `${publicPath}${asset}`

            // Add preload link if enabled
            if (preload) {
                scripts.push({
                    tag: "link",
                    props: {
                        key: `preload-${index}`,
                        rel: "preload",
                        href: src,
                        as: "script",
                    },
                })
            }

            // Add script tag
            scripts.push({
                tag: "script",
                props: {
                    key: `script-${index}`,
                    src,
                    type: "module",
                    defer: true,
                },
            })
        })

        return scripts
    }

    /**
     * Get link tags for all tracked CSS assets
     * @param {Object} options - Options for link generation
     * @returns {Array<Object>} - Array of link tag props
     */
    getLinkTags(options = {}) {
        const { publicPath = "/client/assets/" } = options
        const links = []

        this.assets.css.forEach((asset, index) => {
            const href = asset.startsWith("http") ? asset : `${publicPath}${asset}`

            links.push({
                tag: "link",
                props: {
                    key: `css-${index}`,
                    rel: "stylesheet",
                    href,
                },
            })
        })

        return links
    }
}

export default ChunkExtractor
