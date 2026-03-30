import React from "react"
import path from "path"
import fs from "fs"

// ── CSS: read from disk and inline as <style> ──────────────────────────

// Process-level cache — survives across requests, reset on deploy.
if (!process.cssFileCache) process.cssFileCache = {}

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

        const filePath = path.isAbsolute(asset)
            ? asset
            : path.join(basePath, asset.replace(/^\/+/, ""))

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
    [...new Set(cssUrls)]
        .map((url) => `<link rel="stylesheet" href="${url}">`)
        .join("")

/**
 * <link rel="modulepreload"> + <script type="module"> HTML strings.
 */
export const generateScriptStrings = (jsUrls = []) =>
    [...new Set(jsUrls)]
        .map(
            (url) =>
                `<link rel="modulepreload" href="${url}" as="script"><script type="module" src="${url}"></script>`
        )
        .join("")
