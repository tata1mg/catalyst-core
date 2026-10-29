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
    /**
     * @param {boolean} [registerGlobal] - false for extractors that never render (e.g. Early
     *   Hints), so they don't hijack global.__CHUNK_EXTRACTOR__ from an in-flight render.
     */
    constructor({ manifest = {}, assetManifest = {}, registerGlobal = true } = {}) {
        this.manifest = manifest
        this.assetManifest = assetManifest
        this.components = new Set()

        const baseUrl = `${process.env.PUBLIC_STATIC_ASSET_URL || ""}${process.env.PUBLIC_STATIC_ASSET_PATH || ""}`
        this.publicPath = `${baseUrl.replace(/\/+$/, "")}/`

        // JS tracked as full URLs, CSS tracked as relative file paths (for disk reading)
        this.critical = { js: new Set(), css: new Set() }
        this.deferred = { js: new Set(), css: new Set() }
        this._allCssPaths = new Set() // dedup across buckets

        // JS reached only as a static import of a tracked chunk: preloaded/hinted so it downloads
        // in parallel with its importer, but given no <script> of its own — the importer loads it.
        this.depsOnly = new Set()

        this._loadEssentialEntrypoints()

        if (registerGlobal && typeof global !== "undefined") {
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

        // A chunk first seen as a static dependency may later be requested directly (e.g. a shared
        // chunk that is also a split target) — it then needs its own <script> and CSS.
        const wasDepOnly = this.depsOnly.delete(jsUrl)

        // Skip if already tracked in either bucket
        if (!wasDepOnly && (this.critical.js.has(jsUrl) || this.deferred.js.has(jsUrl))) return

        if (!wasDepOnly) bucket.js.add(jsUrl)

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

        this._addStaticImports(manifestEntry, bucket)
    }

    // Static imports execute with their importer, so the browser always requests them; announcing
    // them up front keeps them off a second waterfall level. Dynamic imports stay lazy and are
    // picked up by addComponent() when rendered. CSS is already covered by the importer's allCss.
    _addStaticImports(manifestEntry, bucket) {
        for (const importKey of manifestEntry.imports || []) {
            const imported = this.manifest[importKey]
            if (!imported?.file) continue

            const jsUrl = this._toUrl(imported.file)
            if (this.critical.js.has(jsUrl) || this.deferred.js.has(jsUrl)) continue

            bucket.js.add(jsUrl)
            this.depsOnly.add(jsUrl)
            this._addStaticImports(imported, bucket)
        }
    }

    _toUrl(filePath) {
        const cleaned = filePath.replace(/^\/+/, "")
        return `${this.publicPath}${cleaned}`
    }

    /** Public URL for a manifest-relative CSS path (same form Vite's preload helper uses). */
    toCssUrl(filePath) {
        return this._toCssUrl(filePath)
    }

    _toCssUrl(filePath) {
        const cleaned = filePath.replace(/^\/+/, "")
        return `${this.publicPath}${cleaned}`
    }

    // ── Public getters ─────────────────────────────────────────────────
    _rootScripts(jsUrls) {
        return jsUrls.filter((url) => !this.depsOnly.has(url))
    }

    /**
     * Critical: CSS as relative file paths (for inlining from disk), JS as URLs.
     * `js` is every URL to preload/hint; `scripts` is the subset that needs a <script type="module">.
     */
    getCriticalAssets() {
        const js = Array.from(this.critical.js)
        return {
            js,
            scripts: this._rootScripts(js),
            css: Array.from(this.critical.css),
        }
    }

    /** Deferred: CSS as URLs (external <link>), JS as URLs. See getCriticalAssets for `scripts`. */
    getDeferredAssets() {
        const js = Array.from(this.deferred.js)
        return {
            js,
            scripts: this._rootScripts(js),
            css: Array.from(this.deferred.css),
        }
    }

    getRenderedComponentKeys() {
        return Array.from(this.components)
    }
}

export default ChunkExtractor
