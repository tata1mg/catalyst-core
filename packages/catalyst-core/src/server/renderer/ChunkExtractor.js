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

        // JS URLs reached only as a static import of another tracked chunk. They still
        // need a <link rel="modulepreload"> (so the browser fetches them in parallel
        // instead of discovering them after the importer parses), but they must NOT get
        // their own <script type="module"> — the importer pulls them in.
        this.depsOnly = new Set()

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
    /**
     * @param {object} manifestEntry - Vite manifest / asset-categories entry.
     * @param {{js: Set<string>, css: Set<string>}} bucket
     * @param {boolean} isRoot - false when reached by walking another chunk's static imports.
     */
    _addAssets(manifestEntry, bucket, isRoot = true) {
        if (!manifestEntry?.file) return

        const jsUrl = this._toUrl(manifestEntry.file)

        // Skip if already tracked in either bucket — its own static closure was
        // walked at the same time, so there is nothing left to discover here.
        if (this.critical.js.has(jsUrl) || this.deferred.js.has(jsUrl)) {
            // A chunk first seen as a dependency can later be requested directly
            // (e.g. a shared chunk that is also a route's split target) — it then
            // needs a real <script> tag.
            if (isRoot) this.depsOnly.delete(jsUrl)
            return
        }

        bucket.js.add(jsUrl)
        if (!isRoot) this.depsOnly.add(jsUrl)

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

        // Walk the STATIC import closure. These chunks execute the moment this one
        // does, so the browser is certain to request them — announcing them now is
        // what keeps them off a second waterfall level (and puts them in reach of
        // Early Hints). Dynamic imports are intentionally not followed: they are
        // lazy by design and are picked up by addComponent() when actually rendered.
        for (const importKey of manifestEntry.imports || []) {
            const imported = this.manifest[importKey]
            if (imported) this._addAssets(imported, bucket, false)
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
    /** JS URLs that need their own <script type="module"> (roots, not static deps). */
    _rootScripts(jsUrls) {
        return jsUrls.filter((url) => !this.depsOnly.has(url))
    }

    /**
     * Critical: CSS as relative file paths (for inlining from disk), JS as URLs.
     * `js` is every URL (preload all of them); `scripts` is the subset that needs a
     * <script type="module"> tag.
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
