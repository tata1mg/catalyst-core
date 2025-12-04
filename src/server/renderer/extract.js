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
 * Helper to get the correct base URL for assets
 * @param {string} asset - Asset path
 * @param {object} req - Express request object
 * @returns {string} - Full asset URL
 */
const getAssetUrl = (asset, req) => {
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

/**
 * Helper to get CSS asset URL
 * @param {string} asset - Asset path
 * @param {object} req - Express request object
 * @returns {string} - Full asset URL
 */
const getCssAssetUrl = (asset, req) => {
    if (asset.startsWith("http")) {
        return asset
    }

    const assetPath = asset.startsWith("/") ? asset : `/${asset}`

    if (!assetPath.startsWith("/client/")) {
        return `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/client/assets/css/${path.basename(asset)}`
    }

    return `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/${asset}`
}

/**
 * Split assets into static shell (critical) and dynamic (deferred) categories
 * Used by PPR to determine which assets to load in prelude vs resume
 * @param {object} assets - Object containing js and css arrays
 * @param {object} chunkExtractor - ChunkExtractor instance
 * @returns {object} - { staticShell: { js, css }, dynamic: { js, css } }
 */
export const splitAssetsForPPR = (assets, chunkExtractor) => {
    const result = {
        staticShell: { js: [], css: [] },
        dynamic: { js: [], css: [] },
    }

    if (!assets) return result

    // Get essential assets for static shell
    const essentialAssets = chunkExtractor?.getEssentialAssets() || { js: [], css: [] }
    const essentialJsSet = new Set(essentialAssets.js)
    const essentialCssSet = new Set(essentialAssets.css)

    // Categorize JS assets
    if (assets.js) {
        assets.js.forEach((asset) => {
            if (essentialJsSet.has(asset)) {
                result.staticShell.js.push(asset)
            } else {
                result.dynamic.js.push(asset)
            }
        })
    }

    // Categorize CSS assets
    if (assets.css) {
        assets.css.forEach((asset) => {
            if (essentialCssSet.has(asset)) {
                result.staticShell.css.push(asset)
            } else {
                result.dynamic.css.push(asset)
            }
        })
    }

    return result
}

/**
 * Generate static shell assets (critical path for PPR prelude)
 * These assets are included in the initial HTML response
 * @param {object} assets - Object containing js and css arrays
 * @param {object} req - Express request object
 * @param {object} chunkExtractor - ChunkExtractor instance
 * @returns {object} - { scripts: React elements, stylesheets: React elements }
 */
export const generateStaticShellAssets = (assets, req, chunkExtractor) => {
    const { staticShell } = splitAssetsForPPR(assets, chunkExtractor)

    return {
        scripts: generateScriptTags(staticShell.js, req),
        stylesheets: generateStylesheetLinks(staticShell.css, req),
        scriptsAsStrings: generateScriptTagsAsStrings(staticShell.js, req),
        stylesheetsAsStrings: generateStylesheetLinksAsStrings(staticShell.css, req),
    }
}

/**
 * Generate dynamic assets (deferred for PPR resume phase)
 * These assets are streamed after the static shell
 * @param {object} assets - Object containing js and css arrays
 * @param {object} req - Express request object
 * @param {object} chunkExtractor - ChunkExtractor instance
 * @returns {object} - { scripts: string, stylesheets: string }
 */
export const generateDynamicAssets = (assets, req, chunkExtractor) => {
    const { dynamic } = splitAssetsForPPR(assets, chunkExtractor)

    return {
        scripts: generateScriptTagsAsStrings(dynamic.js, req),
        stylesheets: generateStylesheetLinksAsStrings(dynamic.css, req),
    }
}

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
            })
        )

        processedAssets.push(asset)
    })

    return linkElements
}
