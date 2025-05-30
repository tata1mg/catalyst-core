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

    if (children) {
        return (
            <head>
                {children}
                {metaTags && metaTags}
                {/* eslint-disable */}
                {pageCss && <style dangerouslySetInnerHTML={{ __html: pageCss }} />}
                {!isBot && preloadJSLinks}
            </head>
        )
    }

    return (
        <head>
            <meta charSet="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            {publicAssetPath && <link rel="preconnect" href={publicAssetPath} />}
            {publicAssetPath && <link rel="dns-prefetch" href={publicAssetPath} />}
            {metaTags && metaTags}
            {/* eslint-disable */}
            {pageCss && <style dangerouslySetInnerHTML={{ __html: pageCss }} />}
            {!isBot && preloadJSLinks}
        </head>
    )
}

Head.propTypes = {
    isBot: PropTypes.bool,
    preloadJSLinks: PropTypes.array,
    pageCss: PropTypes.string,
    metaTags: PropTypes.array,
    publicAssetPath: PropTypes.string,
    children: PropTypes.node,
}
