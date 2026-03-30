import React from "react"
import PropTypes from "prop-types"
import FastRefresh from "../../../vite/FastRefresh.jsx"

/**
 * Head component — inlines critical CSS as <style> and renders JS as <script type="module">.
 * Critical CSS is small (~15-25KB) thanks to natural Vite code-splitting.
 * Deferred CSS is loaded via external <link> after body in onAllReady.
 */
export function Head(props) {
    const { inlineCss, jsScripts, metaTags, isBot, publicAssetPath, children } = props

    return (
        <head>
            <meta charSet="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            {process.env.NODE_ENV === "development" && <FastRefresh />}

            {publicAssetPath && <link rel="preconnect" href={publicAssetPath} />}
            {publicAssetPath && <link rel="dns-prefetch" href={publicAssetPath} />}
            {metaTags && metaTags}

            {/* Inline critical CSS — prevents FOUC/CLS */}
            {!isBot && inlineCss && (
                <style dangerouslySetInnerHTML={{ __html: inlineCss }} />
            )}

            {/* JS modules */}
            {!isBot && jsScripts}

            {children}
        </head>
    )
}

Head.propTypes = {
    isBot: PropTypes.bool,
    inlineCss: PropTypes.string,
    jsScripts: PropTypes.array,
    metaTags: PropTypes.array,
    publicAssetPath: PropTypes.string,
    children: PropTypes.node,
}
