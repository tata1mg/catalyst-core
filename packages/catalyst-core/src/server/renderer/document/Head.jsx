import React from "react"
import PropTypes from "prop-types"
import FastRefresh from "../../../vite/FastRefresh.jsx"

/**
 * Head component — inlines critical CSS as <style> and renders JS as <script type="module">.
 * Critical CSS is small (~15-25KB) thanks to natural Vite code-splitting.
 * Route-cached deferred CSS is inlined here on repeat visits; new deferred CSS still appends after body.
 */
export function Head(props) {
    const {
        inlineCss,
        deferredRouteInlineCss,
        jsScripts,
        criticalPreloadLinks,
        deferredPreloadLinks,
        metaTags,
        isBot,
        publicAssetPath,
        children,
    } = props

    return (
        <head>
            <meta charSet="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            {process.env.NODE_ENV === "development" && <FastRefresh />}

            {publicAssetPath && <link rel="preconnect" href={publicAssetPath} />}
            {publicAssetPath && <link rel="dns-prefetch" href={publicAssetPath} />}
            {!isBot && criticalPreloadLinks}
            {/* Warm-cache modulepreloads from prior SSRs (URLs not in critical scripts) */}
            {!isBot && deferredPreloadLinks}
            {metaTags && metaTags}

            {/* Inline critical CSS — prevents FOUC/CLS */}
            {inlineCss && <style dangerouslySetInnerHTML={{ __html: inlineCss }} />}

            {/* Deferred CSS from prior SSRs on this route — avoids late layout from post-body <style> */}
            {deferredRouteInlineCss && <style dangerouslySetInnerHTML={{ __html: deferredRouteInlineCss }} />}

            {/* JS modules */}
            {!isBot && jsScripts}

            {children}
        </head>
    )
}

Head.propTypes = {
    isBot: PropTypes.bool,
    inlineCss: PropTypes.string,
    deferredRouteInlineCss: PropTypes.string,
    jsScripts: PropTypes.array,
    criticalPreloadLinks: PropTypes.array,
    deferredPreloadLinks: PropTypes.array,
    metaTags: PropTypes.array,
    publicAssetPath: PropTypes.string,
    children: PropTypes.node,
}
