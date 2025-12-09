import React from "react"
import path from "path"

/**
 * PPR Asset Types - used to categorize assets for static shell vs dynamic content
 */
export const PPR_ASSET_TYPE = {
    STATIC_SHELL: "static", // Critical assets for initial render (static shell)
    DYNAMIC: "dynamic", // Assets loaded during resume phase
}

/**
 * Extract non-essential chunk IDs from ChunkExtractor assets
 * Returns arrays of chunk filenames (unique IDs) for JS and CSS
 * @param {object} chunkExtractor - ChunkExtractor instance
 * @returns {object} - { js: [id1, id2], css: [id3, id4] }
 */
export const getNonEssentialChunkIds = (chunkExtractor) => {
    if (!chunkExtractor) {
        return { js: [], css: [] }
    }

    const nonEssentialAssets = chunkExtractor.getNonEssentialAssets()

    // Deduplicate and return chunk filenames as IDs
    return {
        js: [...new Set(nonEssentialAssets.js || [])],
        css: [...new Set(nonEssentialAssets.css || [])],
    }
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
        if (!assetPath.startsWith(process.env.PUBLIC_STATIC_ASSET_PATH)) {
            return `${process.env.PUBLIC_STATIC_ASSET_URL}/assets/${asset}`
        }

        return `${process.env.PUBLIC_STATIC_ASSET_URL}/${asset}`
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
        if (!assetPath.startsWith(process.env.PUBLIC_STATIC_ASSET_PATH)) {
            return `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/assets/css/${path.basename(asset)}`
        }

        return `${process.env.PUBLIC_STATIC_ASSET_URL}/${asset}`
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
            })
        )

        processedAssets.push(asset)
    })

    return linkElements
}
