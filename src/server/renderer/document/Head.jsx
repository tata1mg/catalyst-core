import React from "react"
import PropTypes from "prop-types"
import FastRefresh from "../../../vite/FastRefresh.jsx"

/**
 * Head component which will be used in page rendering
 * @param {boolean} isBot - checks if request is made by bot
 * @param {array} pageCss - includes all stylesheet link elements for page css
 * @param {object} pageJS - async scripts for loading chunks
 * @param {array} metaTags - user defined function which returns meta tags in array
 * @param {string} publicAssetPath - public asset path for assets
 * @param {object} children - contains any child elements defined within the component
 */
export function Head(props) {
    const { pageCss, pageJS, metaTags, isBot, publicAssetPath, children, cssRegistry, cssLoadingStrategies } =
        props

    return (
        <head>
            <meta charSet="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            {process.env.NODE_ENV === "development" && <FastRefresh />}

            {publicAssetPath && <link rel="preconnect" href={publicAssetPath} />}
            {publicAssetPath && <link rel="dns-prefetch" href={publicAssetPath} />}
            {metaTags && metaTags}
            {/* Render stylesheet link elements */}
            {!isBot && pageCss && Array.isArray(pageCss) && pageCss}

            {!isBot && pageJS}

            {children}
        </head>
    )
}

Head.propTypes = {
    isBot: PropTypes.bool,
    pageJS: PropTypes.object,
    pageCss: PropTypes.array, // Changed from string to array for stylesheet links
    metaTags: PropTypes.array,
    publicAssetPath: PropTypes.string,
    children: PropTypes.node,
    cssRegistry: PropTypes.object,
    cssLoadingStrategies: PropTypes.object,
}
