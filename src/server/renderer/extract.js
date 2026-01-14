import React from "react"
import path from "path"
import fs from "fs"

// Generate script tags as HTML strings
export const generateScriptTagsAsStrings = (jsAssets, req) => {
    const scriptStrings = []

    // Get the correct base URL for assets
    const getAssetUrl = (asset) => {
        if (asset.startsWith("http")) {
            return asset
        }

        // Construct proper URL with host and port
        const protocol = (req && req.protocol) || "http"
        const host = (req && req.get && req.get("host")) || "localhost:3005"

        // Ensure asset path starts with /
        const assetPath = asset.startsWith("/") ? asset : `/${asset}`

        // For client assets, ensure /client/ prefix
        if (!assetPath.startsWith("/client/")) {
            return `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/${asset}`
        }

        return `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/${assetPath}`
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
        // }
    })

    return scriptStrings.join("")
}

// Generate link elements for CSS stylesheets as HTML strings
export const generateStylesheetLinksAsStrings = (cssAssets, req) => {
    const linkStrings = []

    // Get the correct base URL for assets
    const getAssetUrl = (asset) => {
        if (asset.startsWith("http")) {
            return asset
        }

        // Construct proper URL with host and port
        const protocol = (req && req.protocol) || "http"
        const host = (req && req.get && req.get("host")) || "localhost:3005"

        // Ensure asset path starts with /
        const assetPath = asset.startsWith("/") ? asset : `/${asset}`

        // For client assets, ensure /client/ prefix
        if (!assetPath.startsWith("/client/")) {
            return `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/client/assets/css/${path.basename(asset)}`
        }

        return `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/${asset}`
    }

    // Deduplicate assets by URL to prevent duplicates
    const uniqueAssets = [...new Set(cssAssets)]

    uniqueAssets.forEach((asset) => {
        const assetUrl = getAssetUrl(asset)

        linkStrings.push(`<link rel="preload" as="style" crossorigin="" href="${assetUrl}">`)
    })

    return linkStrings.join("")
}

export const generateScriptTags = (jsAssets, req) => {
    const scriptElements = []

    // Get the correct base URL for assets
    const getAssetUrl = (asset) => {
        if (asset.startsWith("http")) {
            return asset
        }

        // Construct proper URL with host and port
        const protocol = (req && req.protocol) || "http"
        const host = (req && req.get && req.get("host")) || "localhost:3005"

        // Ensure asset path starts with /
        const assetPath = asset.startsWith("/") ? asset : `/${asset}`

        // For client assets, ensure /client/ prefix
        if (!assetPath.startsWith("/client/")) {
            return `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/client/assets/${asset}`
        }

        return `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/${asset}`
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

// Generate link elements for CSS stylesheets
export const generateStylesheetLinks = (cssAssets, req) => {
    const linkElements = []
    const processedAssets = []

    // Get the correct base URL for assets
    const getAssetUrl = (asset) => {
        if (asset.startsWith("http")) {
            return asset
        }

        // Construct proper URL with host and port
        const protocol = (req && req.protocol) || "http"
        const host = (req && req.get && req.get("host")) || "localhost:3005"

        // Ensure asset path starts with /
        const assetPath = asset.startsWith("/") ? asset : `/${asset}`

        // For client assets, ensure /client/ prefix
        if (!assetPath.startsWith("/client/")) {
            return `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/client/assets/css/${path.basename(asset)}`
        }

        return `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/${asset}`
    }

    // Deduplicate assets by URL to prevent duplicates
    const uniqueAssets = [...new Set(cssAssets)]

    uniqueAssets.forEach((asset, index) => {
        const assetUrl = getAssetUrl(asset)

        linkElements.push(
            React.createElement("link", {
                rel: "stylesheet",
                crossorigin: "",
                href: assetUrl,
                preload: true,
            })
        )

        processedAssets.push(asset)
    })

    return linkElements
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
            const fileContent = fs.readFileSync(filePath, "utf8")
            if (fileContent) {
                cssChunks.push(fileContent)
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
