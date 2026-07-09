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
    return allMatches?.length ? (allMatches[allMatches.length - 1]?.route?.path ?? null) : null
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
 */
export const generateModulePreloadLinkElements = (jsUrls = [], keyPrefix = "modulepreload") =>
    [...new Set(jsUrls)].map((url, i) =>
        React.createElement("link", {
            key: `${keyPrefix}-${i}`,
            rel: "modulepreload",
            href: url,
            fetchPriority: "high",
        })
    )

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
 */
export const generateScriptElements = (jsUrls = []) =>
    [...new Set(jsUrls)].map((url, i) =>
        React.createElement("script", { key: `js-${i}`, type: "module", src: url })
    )

// ── HTML strings (for streaming injection after body via res.write) ────

/**
 * <link rel="stylesheet"> HTML strings for deferred CSS (non-blocking, after body).
 */
export const generateCssLinkStrings = (cssUrls = []) =>
    [...new Set(cssUrls)].map((url) => `<link rel="stylesheet" href="${url}">`).join("")

/**
 * <link rel="modulepreload"> + <script type="module"> HTML strings.
 */
export const generateScriptStrings = (jsUrls = []) =>
    [...new Set(jsUrls)]
        .map((url) => {
            return `<script type="module" src="${url}"></script>`
        })
        .join("")
