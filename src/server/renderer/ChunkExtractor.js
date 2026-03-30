/**
 * ChunkExtractor — collects JS and CSS assets needed for the current SSR render.
 *
 * Two buckets:
 *   critical  — loaded in <head> (inline CSS via <style>, entry + route JS)
 *   deferred  — injected after </body> via onAllReady (external <link> CSS)
 *
 * Critical CSS is inlined as <style> to avoid FOUC/CLS.
 * With natural Vite code-splitting (no mega "main" chunk), critical CSS stays small (~15-25KB).
 */
export class ChunkExtractor {
    constructor({ manifest = {}, assetManifest = {}, ssrManifest = {} } = {}) {
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
        for (const match of allMatches) {
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

        const resolvedKey =
            this.manifest[cacheKey] != null
                ? cacheKey
                : Object.keys(this.manifest).find((k) => k.startsWith(cacheKey + "."))

        if (resolvedKey && this.manifest[resolvedKey]) {
            this._addAssets(this.manifest[resolvedKey], this.deferred)
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
        const cssFiles = [...(manifestEntry.css || []), ...(manifestEntry.allCss || [])]
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
}

export default ChunkExtractor
