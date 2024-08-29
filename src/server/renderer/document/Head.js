import React from "react"
import PropTypes from "prop-types"

/**
 * Head component which will be used in page rendering
 * @param {boolean} isBot - checks if request is made by bot
 * @param {string} pageCss - includes all styles for page css
 * @param {object} preloadJSLinks - async scripts for loading chunks
 * @param {array} metaTags - user defined function which returns meta tags in array
 * @param {string} publicAssetPath - public asset path for assets
 * @param {object} children - contains any child elements defined within the component
 */
export function Head(props) {
    const { pageCss, preloadJSLinks, metaTags, isBot, publicAssetPath, children } = props
    return (
        <head>
            <meta charSet="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />

            {publicAssetPath && <link rel="preconnect" href={publicAssetPath} />}
            {publicAssetPath && <link rel="dns-prefetch" href={publicAssetPath} />}

            {children}

            {metaTags && metaTags}

            {!isBot && preloadJSLinks}

            {/* eslint-disable */}
            {!isBot && pageCss && <style dangerouslySetInnerHTML={{ __html: pageCss }} />}
        </head>
    )
}

Head.propTypes = {
    isBot: PropTypes.bool,
    preloadJSLinks: PropTypes.object,
    pageCss: PropTypes.string,
    metaTags: PropTypes.array,
    publicAssetPath: PropTypes.string,
    children: PropTypes.node,
}
