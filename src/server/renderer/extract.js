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
export const generateModulePreloadLinkElements = (
    jsUrls = [],
    keyPrefix = "modulepreload",
    nonce,
    integrityManifest = {}
) =>
    [...new Set(jsUrls)].map((url, i) => {
        const integrityData = integrityManifest[url]
        return React.createElement("link", {
            key: `${keyPrefix}-${i}`,
            rel: "modulepreload",
            href: url,
            fetchPriority: "high",
            ...(nonce ? { nonce } : {}),
            ...(integrityData?.integrity
                ? {
                      integrity: integrityData.integrity,
                      crossOrigin: integrityData.crossOrigin || "anonymous",
                  }
                : {}),
        })
    })

/**
 * `Link` header values (one per URL) preloading JS for Early Hints (103) and the CDN-learned
 * `Link` header. `as=script` + the same crossorigin/integrity as the `<script type="module">`
 * and `modulepreload` tags keeps the hinted response reusable, so it is not downloaded twice.
 * Chrome only honours `preload`/`preconnect` in a 103, hence not `modulepreload`.
 * @param {string[]} jsUrls
 * @param {"high"|"low"} [fetchPriority]
 * @param {Record<string, {integrity?: string, crossOrigin?: string}>} [integrityManifest]
 * @returns {string[]}
 */
export const generateLinkHeader = (jsUrls = [], fetchPriority, integrityManifest = {}) =>
    [...new Set(jsUrls)].map((url) => {
        const integrityData = integrityManifest[url]
        const parts = [`<${url}>`, "rel=preload", "as=script"]
        parts.push(
            integrityData?.crossOrigin === "use-credentials" ? "crossorigin=use-credentials" : "crossorigin"
        )
        if (integrityData?.integrity) parts.push(`integrity="${integrityData.integrity}"`)
        if (fetchPriority) parts.push(`fetchpriority=${fetchPriority}`)
        return parts.join("; ")
    })

/**
 * `Link` header values for app-supplied preconnect/preload entries — third-party origins, fonts,
 * a static LCP image. Never hardcoded here: the app declares them via EARLY_HINTS_LINKS or the
 * getEarlyHintLinks hook (see handler.jsx), and this only formats them.
 * @param {{url: string, rel: "preconnect"|"preload", as?: string, type?: string, crossorigin?: boolean, fetchPriority?: "high"|"low"}[]} links
 * @returns {string[]}
 */
export const generateCustomLinkHeader = (links = []) =>
    links
        .filter((link) => link?.url && (link.rel === "preload" || link.rel === "preconnect"))
        .map((link) => {
            const parts = [`<${link.url}>`, `rel=${link.rel}`]
            if (link.as) parts.push(`as=${link.as}`)
            if (link.type) parts.push(`type="${link.type}"`)
            if (link.crossorigin) parts.push("crossorigin")
            if (link.fetchPriority) parts.push(`fetchpriority=${link.fetchPriority}`)
            return parts.join("; ")
        })

/**
 * Read CSS files from disk and return concatenated CSS string for inlining.
 * @param {string[]} cssPaths - Relative CSS paths (from manifest).
 * @param {string} basePath  - Build output directory on disk.
 * @returns {string} Concatenated CSS content.
 */
export const readCssFromDisk = (cssPaths = [], basePath) => {
    if (!cssPaths.length) return ""

    const seen = new Set()
    const chunks = []

    for (const asset of cssPaths) {
        if (!asset || seen.has(asset)) continue
        seen.add(asset)
        if (asset.startsWith("http")) continue

        const filePath = path.isAbsolute(asset) ? asset : path.join(basePath, asset.replace(/^\/+/, ""))

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

// ── React elements (for SSR rendering inside <Head>) ───────────────────

/**
 * <script type="module"> React elements for JS assets.
 * @param {string[]} jsUrls
 * @param {string} [nonce] - CSP nonce, applied when nonce-based CSP is enabled (see CSP_NONCE_ENABLE).
 */
export const generateScriptElements = (jsUrls = [], nonce, integrityManifest = {}) => {
    return [...new Set(jsUrls)].map((url, i) => {
        const integrityData = integrityManifest[url]
        return React.createElement("script", {
            key: `js-${i}`,
            type: "module",
            src: url,
            ...(nonce ? { nonce } : {}),
            ...(integrityData?.integrity
                ? {
                      integrity: integrityData.integrity,
                      crossOrigin: integrityData.crossOrigin || "anonymous",
                  }
                : {}),
        })
    })
}

// ── HTML strings (for streaming injection after body via res.write) ────

/**
 * <link rel="stylesheet"> HTML strings for deferred CSS (non-blocking, after body).
 */
export const generateCssLinkStrings = (cssUrls = []) =>
    [...new Set(cssUrls)].map((url) => `<link rel="stylesheet" href="${url}">`).join("")

/**
 * <link rel="modulepreload"> + <script type="module"> HTML strings.
 * @param {string[]} jsUrls
 * @param {string} [nonce] - CSP nonce, applied when nonce-based CSP is enabled (see CSP_NONCE_ENABLE).
 */
export const generateScriptStrings = (jsUrls = [], nonce, integrityManifest = {}) => {
    const nonceAttr = nonce ? ` nonce="${nonce}"` : ""
    return [...new Set(jsUrls)]
        .map((url) => {
            const integrityData = integrityManifest[url]
            const integrityAttr = integrityData?.integrity ? ` integrity="${integrityData.integrity}"` : ""
            const crossOriginAttr = integrityData?.integrity
                ? ` crossorigin="${integrityData.crossOrigin || "anonymous"}"`
                : ""

            return `<script type="module"${nonceAttr}${integrityAttr}${crossOriginAttr} src="${url}"></script>`
        })
        .join("")
}
