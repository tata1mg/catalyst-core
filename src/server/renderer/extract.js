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

// ── Critical (first-fold) CSS ──────────────────────────────────────────

// <build>/critical-css/manifest.json is written by `catalyst critical-css`. Read once per process;
// restart the server after (re)generating it.
let _criticalCssManifest
const getCriticalCssManifest = (buildDir) => {
    if (_criticalCssManifest === undefined) {
        try {
            _criticalCssManifest = JSON.parse(
                fs.readFileSync(path.join(buildDir, "critical-css", "manifest.json"), "utf8")
            )
        } catch {
            _criticalCssManifest = null
        }
    }
    return _criticalCssManifest
}

/**
 * Generated first-fold CSS for a route, or null when the route has none (or it is over budget, or
 * CRITICAL_CSS_DISABLE is set) — callers then keep inlining the full route CSS.
 * @param {string|null} routeKey - Matched route pattern, see getDeferredRouteKey.
 * @param {string} buildDir - Build output directory on disk.
 */
export const getCriticalCssForRoute = (routeKey, buildDir) => {
    if (!routeKey || String(process.env.CRITICAL_CSS_DISABLE) === "true") return null
    const entry = getCriticalCssManifest(buildDir)?.routes?.[routeKey]
    if (!entry?.file || entry.overBudget) return null
    const maxBytes = Number(process.env.CRITICAL_CSS_MAX_BYTES) || 0
    if (maxBytes && entry.bytes > maxBytes) return null
    return readCssFromDisk([path.join(buildDir, "critical-css", entry.file)], buildDir) || null
}

/**
 * Non-render-blocking stylesheets for the full route CSS, used together with inline critical CSS.
 * The links sit in <head> right after the critical <style>, so cascade order matches the inlined
 * version and stylesheets Vite injects later still come after them. media="print" keeps them off the
 * render-blocking path; a nonce-able inline script switches each to media="all" once it loads
 * (no inline event handlers, so it works under a nonce-based CSP). <noscript> covers no-JS clients.
 * Vite's preload helper skips CSS that already has a <link rel="stylesheet">, so nothing downloads twice.
 * @param {string[]} cssUrls
 * @param {string} [nonce]
 */
export const generateCssLinkElements = (cssUrls = [], nonce) => {
    const urls = [...new Set(cssUrls)]
    if (!urls.length) return []
    const links = urls.map((url, i) =>
        React.createElement("link", {
            key: `css-${i}`,
            rel: "stylesheet",
            href: url,
            media: "print",
            "data-catalyst-css": "",
        })
    )
    const swap =
        "document.querySelectorAll('link[data-catalyst-css][media=print]').forEach(function(l){" +
        "function on(){l.media='all'}l.sheet?on():l.addEventListener('load',on)})"
    return [
        ...links,
        React.createElement("script", {
            key: "css-swap",
            ...(nonce ? { nonce } : {}),
            dangerouslySetInnerHTML: { __html: swap },
        }),
        React.createElement("noscript", {
            key: "css-noscript",
            dangerouslySetInnerHTML: {
                __html: urls.map((url) => `<link rel="stylesheet" href="${url}" data-catalyst-css>`).join(""),
            },
        }),
    ]
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
 * <link rel="stylesheet"> HTML strings for deferred CSS (non-blocking, after body).
 */
export const generateCssLinkStrings = (cssUrls = []) =>
    [...new Set(cssUrls)].map((url) => `<link rel="stylesheet" href="${url}" data-catalyst-css>`).join("")

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
