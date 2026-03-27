import React from "react"
import path from "path"
import fs from "fs"

/**
 * Generates script and modulepreload link tags as a concatenated HTML string.
 *
 * Deduplicates the provided asset list and constructs both a `<link rel="modulepreload">`
 * and a `<script type="module">` tag for each unique JS asset. Asset URLs are resolved
 * using `PUBLIC_STATIC_ASSET_URL` and `PUBLIC_STATIC_ASSET_PATH` environment variables
 * when the asset path is not already an absolute URL.
 *
 * @param {string[]} jsAssets - Array of JS asset paths or absolute URLs.
 * @param {import('express').Request} [req] - Express request object (reserved for future use).
 * @returns {string} HTML string containing modulepreload and module script tags.
 */
export const generateScriptTagsAsStrings = (jsAssets, req) => {
    const scriptStrings = []

    // Get the correct base URL for assets
    const getAssetUrl = (asset) => {
        if (asset.startsWith("http")) {
            return asset
        }

        const base =
            `${process.env.PUBLIC_STATIC_ASSET_URL || ""}${process.env.PUBLIC_STATIC_ASSET_PATH || ""}`.replace(
                /\/+$/,
                ""
            )
        const assetPath = asset.startsWith("/") ? asset : `/${asset}`
        return `${base}${assetPath}`
    }

    // Deduplicate assets by URL to prevent duplicates
    const uniqueAssets = [...new Set(jsAssets)]

    uniqueAssets.forEach((asset) => {
        const assetUrl = getAssetUrl(asset)

        // All Vite-generated JS files should be ES modules
        const isModule = asset.endsWith(".js")

        // if (isModule) {
        //     scriptStrings.push(`<script type="module" src="${assetUrl}"></script>`)
        // } else {
        // Generate preload hint for non-JS assets
        scriptStrings.push(`<link rel="modulepreload" href="${assetUrl}" as="script">`)
        scriptStrings.push(`<script type="module" src="${assetUrl}"></script>`)
        // }
    })

    return scriptStrings.join("")
}

/**
 * Generates script and modulepreload link tags as an array of React elements.
 *
 * Deduplicates the provided asset list. For each unique JS asset it creates a
 * `<script type="module">` React element; for non-JS assets it creates a
 * `<link rel="modulepreload">` React element. Asset URLs are resolved using
 * `PUBLIC_STATIC_ASSET_URL` and `PUBLIC_STATIC_ASSET_PATH` environment variables
 * when the asset path is not already an absolute URL.
 *
 * @param {string[]} jsAssets - Array of JS asset paths or absolute URLs.
 * @param {import('express').Request} [req] - Express request object (reserved for future use).
 * @returns {React.ReactElement[]} Array of React elements representing script/link tags.
 */
export const generateScriptTags = (jsAssets, req) => {
    const scriptElements = []

    // Get the correct base URL for assets
    const getAssetUrl = (asset) => {
        if (asset.startsWith("http")) {
            return asset
        }

        const base =
            `${process.env.PUBLIC_STATIC_ASSET_URL || ""}${process.env.PUBLIC_STATIC_ASSET_PATH || ""}`.replace(
                /\/+$/,
                ""
            )
        const assetPath = asset.startsWith("/") ? asset : `/${asset}`
        return `${base}${assetPath}`
    }

    // Deduplicate assets by URL to prevent duplicates
    const uniqueAssets = [...new Set(jsAssets)]

    uniqueAssets.forEach((asset, index) => {
        const assetUrl = getAssetUrl(asset)

        // All Vite-generated JS files should be ES modules
        const isModule = asset.endsWith(".js")

        if (isModule) {
            scriptElements.push(
                React.createElement("script", {
                    type: "module",
                    src: assetUrl,
                })
            )
        } else {
            // Generate preload hint for non-JS assets
            scriptElements.push(
                React.createElement("link", {
                    key: `preload-${asset}-${index}`,
                    rel: "modulepreload",
                    href: assetUrl,
                    as: "script",
                })
            )
        }
    })
    return scriptElements
}

/**
 * Reads a list of CSS asset files from disk and returns a single inline CSS string.
 *
 * This is intended for cases where you want to inject critical CSS using:
 *   <style dangerouslySetInnerHTML={{ __html: pageCss }} />
 *
 * @param {string[]} cssAssets - List of CSS asset paths (relative or absolute).
 * @param {object} [options]
 * @param {string} [options.assetsBasePath] - Base directory on the filesystem where assets live.
 *                                           If not provided, falls back to process.cwd().
 * @returns {string} Concatenated CSS content from all readable assets.
 */
export const generateInlineCssFromAssets = (cssAssets = [], options = {}) => {
    const { assetsBasePath } = options

    if (!Array.isArray(cssAssets) || cssAssets.length === 0) {
        return ""
    }

    const baseDir = assetsBasePath || process.cwd()
    const seen = new Set()
    const cssChunks = []

    cssAssets.forEach((asset) => {
        if (!asset || typeof asset !== "string") {
            return
        }

        // Deduplicate by original asset value
        if (seen.has(asset)) {
            return
        }
        seen.add(asset)

        // If it's an http URL we can't read it from disk here, so skip.
        if (asset.startsWith("http://") || asset.startsWith("https://")) {
            return
        }

        // Resolve a filesystem path for the asset
        let filePath = asset

        // If it looks like a URL path (starts with /), strip the leading slash
        // and resolve it relative to the provided baseDir.
        if (!path.isAbsolute(filePath)) {
            const normalized = filePath.replace(/^\/+/, "")
            filePath = path.join(baseDir, normalized)
        }

        try {
            if (!process.cssFileCache) process.cssFileCache = {}

            if (!process.cssFileCache[filePath]) {
                process.cssFileCache[filePath] = fs.readFileSync(filePath, "utf8")
            }

            if (process.cssFileCache[filePath]) {
                cssChunks.push(process.cssFileCache[filePath])
            }
        } catch (error) {
            // In production we silently ignore missing/unreadable assets.
            // In development log a warning to aid debugging.
            if (process.env.NODE_ENV !== "production") {
                // eslint-disable-next-line no-console
                console.warn(
                    `[generateInlineCssFromAssets] Failed to read CSS asset "${asset}" from "${filePath}": ${error.message}`
                )
            }
        }
    })

    return cssChunks.join("\n")
}
