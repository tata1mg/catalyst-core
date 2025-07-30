import React from "react"
import path from "path"

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
            return `${protocol}://${host}/client/assets/${asset}`
        }

        return `${protocol}://${host}${assetPath}`
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
            return `${protocol}://${host}/client/assets/css/${path.basename(asset)}`
        }

        return `${protocol}://${host}${assetPath}`
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
            return `${protocol}://${host}/client/assets/${asset}`
        }

        return `${protocol}://${host}${assetPath}`
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
            return `${protocol}://${host}/client/assets/css/${path.basename(asset)}`
        }

        return `${protocol}://${host}${assetPath}`
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
