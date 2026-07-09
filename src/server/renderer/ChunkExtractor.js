/**
 * ChunkExtractor — collects JS and CSS assets needed for the current SSR render.
 *
 * Two buckets:
 *   critical  — loaded in <head> (inline CSS via <style>, entry + route JS)
 *   deferred  — injected after </body> via onAllReady (external <link> CSS)
 *
 * Critical CSS is inlined as <style> to avoid FOUC/CLS.
 * With natural Vite code-splitting (no mega "main" chunk), critical CSS stays small (~15-25KB).
 *
 * For PPR, `critical`/`deferred` double as the static-shell / dynamic-phase asset sets
 * (see getStaticShellAssets/getDynamicAssets below) — PPR doesn't need a separate tracking model.
 */
export const PPR_ASSET_PHASE = {
    STATIC_SHELL: "static_shell", // Assets for initial prerender (critical path)
    DYNAMIC: "dynamic", // Assets for resume phase (deferred loading)
}

/**
 * ChunkExtractor class for tracking and extracting chunks during SSR
 * Compatible with Vite's manifest and chunk splitting system
 */
export class ChunkExtractor {
    constructor({ manifest = {}, assetManifest = {} } = {}) {
        this.manifest = manifest
        this.assetManifest = assetManifest
        this.components = new Set()

        const baseUrl = `${process.env.PUBLIC_STATIC_ASSET_URL || ""}${process.env.PUBLIC_STATIC_ASSET_PATH || ""}`
        this.publicPath = `${baseUrl.replace(/\/+$/, "")}/`

        // JS tracked as full URLs, CSS tracked as relative file paths (for disk reading)
        this.critical = { js: new Set(), css: new Set() }
        this.deferred = { js: new Set(), css: new Set() }
        this._allCssPaths = new Set() // dedup across buckets

        this._loadEssentialEntrypoints()

        if (typeof global !== "undefined") {
            global.__CHUNK_EXTRACTOR__ = this
        }
    }

    // ── Build-time essential chunks (entry + static deps) ──────────────
    _loadEssentialEntrypoints() {
        for (const [, entry] of Object.entries(this.assetManifest.essential || {})) {
            this._addAssets(entry, this.critical)
        }
    }

    // ── Route-matched split chunks → critical (blocks first paint) ─────
    preloadRouteCss(allMatches = []) {
        const list = allMatches == null ? [] : Array.isArray(allMatches) ? allMatches : []
        for (const match of list) {
            const route = match?.route
            if (!route) continue

            const component = route.Component || route.component
            const cacheKey = component?.__cacheKey
            if (!cacheKey) continue

            const entry =
                this.assetManifest.ssrTrue?.[cacheKey] ||
                this.assetManifest.ssrFalse?.[cacheKey] ||
                this.manifest[cacheKey]

            if (entry) {
                this._addAssets(entry, this.critical)
            }
        }
    }

    // ── Components discovered during render → deferred ─────────────────
    addComponent(cacheKey) {
        this.components.add(cacheKey)

        // Try assetManifest first by raw cacheKey — addSourcePathAliases writes
        // source-path entries here even when the chunk is anonymous in manifest.json
        // (shared / multi-importer dynamic chunks). Falling back to manifest.json
        // last keeps the existing prefix-match behavior intact.
        let entry =
            this.assetManifest.ssrTrue?.[cacheKey] ||
            this.assetManifest.ssrFalse?.[cacheKey] ||
            this.manifest[cacheKey]

        if (!entry) {
            const resolvedKey = Object.keys(this.manifest).find((k) => k.startsWith(cacheKey + "."))
            if (resolvedKey) {
                entry =
                    this.assetManifest.ssrTrue?.[resolvedKey] ||
                    this.assetManifest.ssrFalse?.[resolvedKey] ||
                    this.manifest[resolvedKey]
            }
        }

        if (entry) {
            this._addAssets(entry, this.deferred)
        }
    }

    // ── Internal: add JS URLs + CSS file paths to a bucket ─────────────
    _addAssets(manifestEntry, bucket) {
        if (!manifestEntry?.file) return

        const jsUrl = this._toUrl(manifestEntry.file)

        // Skip if already tracked in either bucket
        if (this.critical.js.has(jsUrl) || this.deferred.js.has(jsUrl)) return

        bucket.js.add(jsUrl)

        // Collect direct + transitive CSS as relative file paths (not URLs)
        const cssPart = Array.isArray(manifestEntry.css) ? manifestEntry.css : []
        const allCssPart = Array.isArray(manifestEntry.allCss) ? manifestEntry.allCss : []
        const cssFiles = [...cssPart, ...allCssPart]
        for (const cssFile of cssFiles) {
            if (!this._allCssPaths.has(cssFile)) {
                this._allCssPaths.add(cssFile)
                bucket.css.add(cssFile)
            }
        }
    }

    _toUrl(filePath) {
        const cleaned = filePath.replace(/^\/+/, "")
        return `${this.publicPath}${cleaned}`
    }

    _toCssUrl(filePath) {
        const cleaned = filePath.replace(/^\/+/, "")
        return `${this.publicPath}${cleaned}`
    }

    // ── Public getters ─────────────────────────────────────────────────
    /** Critical: CSS as relative file paths (for inlining from disk), JS as URLs */
    getCriticalAssets() {
        return {
            js: Array.from(this.critical.js),
            css: Array.from(this.critical.css),
        }
    }

    /** Deferred: CSS as URLs (external <link>), JS as URLs */
    getDeferredAssets() {
        return {
            js: Array.from(this.deferred.js),
            css: Array.from(this.deferred.css),
        }
    }

    getRenderedComponentKeys() {
        return Array.from(this.components)
    }

    /**
     * Get assets for PPR static shell (critical path for initial render)
     * These are essential assets that must be in the prelude
     * @returns {Object} - Object with js and css arrays
     */
    getStaticShellAssets() {
        // Static shell assets = critical assets
        // These are needed for the initial render before any Suspense boundaries resolve
        return this.getCriticalAssets()
    }

    /**
     * Get assets for PPR dynamic phase (loaded during resume)
     * These are deferred assets that can be loaded after the shell
     * @returns {Object} - Object with js and css arrays
     */
    getDynamicAssets() {
        // Dynamic assets = deferred assets
        // These are loaded after the static shell is rendered
        return this.getDeferredAssets()
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
