import React from "react"
import path from "path"
import fs from "fs"

// ── CSS: read from disk and inline as <style> ──────────────────────────

// Process-level cache — survives across requests, reset on deploy.
if (!process.cssFileCache) process.cssFileCache = {}

// Per-route deferred asset paths/URLs learned from past SSRs — inlined in <head> on later visits
// so late <style> after </body> does not re-layout already-painted content. CSS file bodies use
// process.cssFileCache inside readCssFromDisk (no repeat disk read).
if (!process.deferredAssetsByRoute) process.deferredAssetsByRoute = new Map()

const routeRecord = (routeKey) => {
    let rec = process.deferredAssetsByRoute.get(routeKey)
    if (!rec) {
        rec = { css: new Set(), js: new Set() }
        process.deferredAssetsByRoute.set(routeKey, rec)
    }
    return rec
}

/** Stable key for caching deferred chunks — uses the matched route pattern (e.g. "/product/:name/:id")
 *  so all pages on the same route share one entry regardless of their actual URL parameters. */
export const getDeferredRouteKey = (req, allMatches = []) => {
    return allMatches?.length ? allMatches[allMatches.length - 1]?.route?.path ?? null : null
}

/** CSS paths (manifest-relative) previously deferred on this route — for <head> inlining. */
export const getCachedDeferredCssPathsForRoute = (routeKey) => {
    if (!routeKey) return []
    const rec = process.deferredAssetsByRoute.get(routeKey)
    return rec ? [...rec.css] : []
}

/**
 * Record deferred asset paths/URLs for this route. Returns CSS paths not yet on the route so they
 * can be inlined after </body> only once; on later visits those paths are inlined in <head> instead.
 * JS URLs are always emitted in HTML on every navigation — skipping "cached" scripts would omit modules.
 * @returns {{ newCssPaths: string[] }}
 */
export const registerDeferredAssetsForRoute = (routeKey, { css = [], js = [] } = {}, isBot = false) => {
    if (!routeKey) return { newCssPaths: [] }
    const rec = routeRecord(routeKey)
    const newCssPaths = []
    for (const p of css) {
        if (!p) continue
        if (!rec.css.has(p)) newCssPaths.push(p)
        rec.css.add(p)
    }
    if (!isBot) {
        for (const url of js) {
            if (url) rec.js.add(url)
        }
    }
    return { newCssPaths }
}

/**
 * Cached deferred script URLs for this route, excluding URLs already loaded as critical scripts.
 * @param {string|null} routeKey - Matched route pattern.
 * @param {Iterable<string>} excludeUrls - Critical / head script src URLs.
 * @returns {string[]}
 */
export const getDeferredPreloadScriptUrls = (routeKey, excludeUrls = []) => {
    if (!routeKey) return []
    const rec = process.deferredAssetsByRoute.get(routeKey)
    if (!rec) return []
    const exclude = new Set(excludeUrls)
    return [...rec.js].filter((url) => url && !exclude.has(url))
}

/**
 * React <link rel="modulepreload"> elements (deduped). Use before matching <script type="module">.
 * @param {string[]} jsUrls
 * @param {string} [keyPrefix] - Unique prefix for React keys when rendering multiple lists.
 * @param {string} [nonce] - CSP nonce, applied when nonce-based CSP is enabled (see CSP_NONCE_ENABLE).
 */
export const generateModulePreloadLinkElements = (jsUrls = [], keyPrefix = "modulepreload", nonce) =>
    [...new Set(jsUrls)].map((url, i) =>
        React.createElement("link", {
            key: `${keyPrefix}-${i}`,
            rel: "modulepreload",
            href: url,
            fetchPriority: "high",
            ...(nonce ? { nonce } : {}),
        })
    )

/**
 * HTTP `Link` header value for critical JS, so Cloudflare Early Hints (103)
 * can preload them before SSR finishes. `as=script; crossorigin` matches the
 * fetch mode of the `<script type="module">` tags these accompany, avoiding
 * a double download.
 * @param {string[]} jsUrls
 * @returns {string}
 */
export const generateLinkHeader = (jsUrls = []) =>
    [...new Set(jsUrls)].map((url) => `<${url}>; rel=preload; as=script; crossorigin`).join(", ")

/**
 * HTTP `Link` header value for app-supplied preconnect/preload entries — third-party analytics
 * origins, a static LCP image, fonts, etc. Never hardcoded here: the app declares exactly which
 * URLs it wants hinted (see EARLY_HINTS_LINKS in handler.jsx), and this only formats them.
 * @param {{url: string, rel: "preconnect"|"preload", as?: string, crossorigin?: boolean}[]} links
 * @returns {string}
 */
export const generateCustomLinkHeader = (links = []) =>
    links
        .filter((link) => link?.url && (link.rel === "preload" || link.rel === "preconnect"))
        .map((link) => {
            const parts = [`<${link.url}>`, `rel=${link.rel}`]
            if (link.as) parts.push(`as=${link.as}`)
            if (link.crossorigin) parts.push("crossorigin")
            return parts.join("; ")
        })
        .join(", ")

/**
 * Read CSS files from disk and return concatenated CSS string for inlining.
 * @param {string[]} cssPaths - Relative CSS paths (from manifest).
 * @param {string} basePath  - Build output directory on disk.
 * @returns {string} Concatenated CSS content.
 */
// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - asset paths come from the Vite build manifest generated at build time, never from a request, so there is no user-controlled input here.
const resolveCssFilePath = (asset, basePath) =>
    path.isAbsolute(asset) ? asset : path.join(basePath, asset.replace(/^\/+/, ""))

export const readCssFromDisk = (cssPaths = [], basePath) => {
    if (!cssPaths.length) return ""

    const seen = new Set()
    const chunks = []

    for (const asset of cssPaths) {
        if (!asset || seen.has(asset)) continue
        seen.add(asset)
        if (asset.startsWith("http")) continue

        const filePath = resolveCssFilePath(asset, basePath)

        try {
            if (!process.cssFileCache[filePath]) {
                process.cssFileCache[filePath] = fs.readFileSync(filePath, "utf8")
            }
            if (process.cssFileCache[filePath]) {
                chunks.push(process.cssFileCache[filePath])
            }
        } catch {
            // Silently skip unreadable assets in production
        }
    }

    return chunks.join("\n")
}

/**
 * Filters cssPaths down to those actually inlined by a prior readCssFromDisk call for the same
 * basePath (i.e. present and non-empty in process.cssFileCache). The client-side appendChild patch
 * (see generateInlinedCssUrlsBootstrapScript) must only be told about these — a URL for a path whose
 * CSS silently failed to read would suppress Vite's own fetch with nothing to fall back on.
 * @param {string[]} cssPaths - Relative CSS paths (from manifest).
 * @param {string} basePath  - Build output directory on disk.
 * @returns {string[]} The subset of cssPaths whose content is cached (deduped).
 */
export const getInlinedCssPaths = (cssPaths = [], basePath) => {
    const seen = new Set()
    const inlined = []
    for (const asset of cssPaths) {
        if (!asset || seen.has(asset) || asset.startsWith("http")) continue
        seen.add(asset)
        if (process.cssFileCache[resolveCssFilePath(asset, basePath)]) {
            inlined.push(asset)
        }
    }
    return inlined
}

// ── React elements (for SSR rendering inside <Head>) ───────────────────

/**
 * <script type="module"> React elements for JS assets.
 * @param {string[]} jsUrls
 * @param {string} [nonce] - CSP nonce, applied when nonce-based CSP is enabled (see CSP_NONCE_ENABLE).
 */
export const generateScriptElements = (jsUrls = [], nonce) =>
    [...new Set(jsUrls)].map((url, i) =>
        React.createElement("script", {
            key: `js-${i}`,
            type: "module",
            src: url,
            ...(nonce ? { nonce } : {}),
        })
    )

// ── HTML strings (for streaming injection after body via res.write) ────

/**
 * Inline bootstrap <script>. Records which CSS URLs were already inlined as <style> for this
 * response (window.__INLINED_CSS_URLS__) and patches document.head.appendChild so that if
 * hydration's dynamic-import prefetch (via Vite's own __vitePreload) tries to insert a
 * <link rel="stylesheet"> for one of those URLs, its href is swapped to an inert `data:` URI
 * before insertion — eliminating the redundant network fetch while `load` still fires
 * (from the browser resolving the data: URI), so Vite's own preload promise resolves normally.
 * The link is removed from the DOM once its own `load` fires, so it doesn't linger.
 *
 * The link is still genuinely inserted (not left detached) deliberately: Vite's __vitePreload
 * appears to dedupe/cache concurrent requests for the same dependency URL in a way that depends
 * on the link actually being connected — a detached node whose `load` is dispatched synthetically
 * resolves the widget that triggered it, but leaves any other widget concurrently awaiting the
 * same URL hanging forever (verified empirically: real hydration prefetches ~10 SSR'd widgets at
 * once, several sharing common CSS deps; a detached-node version left 9 of them stuck pending
 * indefinitely, with only the first resolving — no errors, just a silent hang).
 *
 * Removing on `load` — rather than never inserting — is safe for the same concurrent-widget case:
 * every widget's `__vitePreload` deps are enumerated synchronously (in the same tick split()s run
 * in), so any dedup check against this exact link has already happened by the time `load` fires
 * asynchronously and removal runs. A widget that somehow checks after removal just creates (and
 * this patch again neutralizes) a fresh link for the same URL — still zero network fetches, only
 * a harmless redundant no-op, never a hang. Verified under staggered/shared-dependency timing
 * before relying on this in the real app.
 *
 * The `rel` is also rewritten from `stylesheet` to `prefetch` (dropping any `as` hint) after the
 * href swap — purely cosmetic, moves DevTools' Network panel categorization from "CSS" to "Other"
 * so the harmless, zero-byte ghost entry doesn't clutter CSS-specific filtering. The dedup-sensitive
 * check above already happened before this rewrite, so it doesn't affect any of the above.
 *
 * CSS not in this set — e.g. reached only via later client-side navigation, never inlined for
 * this response — is left untouched and fetches exactly as Vite already does.
 * @param {string[]} cssUrls
 * @param {string} [nonce] - CSP nonce, applied when nonce-based CSP is enabled (see CSP_NONCE_ENABLE).
 */
export const generateInlinedCssUrlsBootstrapScript = (cssUrls = [], nonce) => {
    const urlsJson = JSON.stringify([...new Set(cssUrls)])
    const nonceAttr = nonce ? ` nonce="${nonce}"` : ""
    return (
        `<script${nonceAttr}>window.__INLINED_CSS_URLS__=new Set(${urlsJson});` +
        `(function(){var o=document.head.appendChild.bind(document.head);` +
        `document.head.appendChild=function(n){try{if(n&&n.tagName==="LINK"&&n.rel==="stylesheet"` +
        `&&window.__INLINED_CSS_URLS__&&window.__INLINED_CSS_URLS__.has(n.href)){n.href="data:text/css,";` +
        `n.rel="prefetch";n.removeAttribute("as");` +
        `n.addEventListener("load",function(){try{n.remove()}catch(e){}})}}` +
        `catch(e){}return o(n)}})()</script>`
    )
}

/**
 * Extends window.__INLINED_CSS_URLS__ (see generateInlinedCssUrlsBootstrapScript) with CSS URLs
 * inlined after the initial <head> — the first-ever deferred <style> streamed for a route.
 * @param {string[]} cssUrls
 * @param {string} [nonce] - CSP nonce, applied when nonce-based CSP is enabled (see CSP_NONCE_ENABLE).
 */
export const generateInlinedCssUrlsExtendScript = (cssUrls = [], nonce) => {
    if (!cssUrls.length) return ""
    const urlsJson = JSON.stringify([...new Set(cssUrls)])
    const nonceAttr = nonce ? ` nonce="${nonce}"` : ""
    return `<script${nonceAttr}>${urlsJson}.forEach(function(u){window.__INLINED_CSS_URLS__.add(u)})</script>`
}

/**
 * <link rel="modulepreload"> + <script type="module"> HTML strings.
 * @param {string[]} jsUrls
 * @param {string} [nonce] - CSP nonce, applied when nonce-based CSP is enabled (see CSP_NONCE_ENABLE).
 */
export const generateScriptStrings = (jsUrls = [], nonce) => {
    const nonceAttr = nonce ? ` nonce="${nonce}"` : ""
    return [...new Set(jsUrls)]
        .map((url) => {
            return `<script type="module"${nonceAttr} src="${url}"></script>`
        })
        .join("")
}
