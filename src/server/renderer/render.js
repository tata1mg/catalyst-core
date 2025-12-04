import { cacheCSS, cacheJS } from "./extract"

/**
 * PPR Configuration utilities
 */
export const PPRConfig = {
    /**
     * Check if PPR is enabled
     * @returns {boolean}
     */
    isEnabled: () => process.env.ENABLE_PPR === "true",

    /**
     * Get PPR timeout in milliseconds
     * @returns {number}
     */
    getTimeout: () => parseInt(process.env.PPR_TIMEOUT_MS || "5000", 10),

    /**
     * Get PPR configuration object
     * @returns {object}
     */
    getConfig: () => ({
        enabled: process.env.ENABLE_PPR === "true",
        timeoutMs: parseInt(process.env.PPR_TIMEOUT_MS || "5000", 10),
    }),
}

/**
 * Serialize postponed state for client-side hydration
 * @param {object} postponed - The postponed state from prerender
 * @returns {string} - Serialized postponed state
 */
export const serializePostponedState = (postponed) => {
    if (!postponed) return null
    try {
        return JSON.stringify(postponed)
    } catch (error) {
        console.error("Error serializing postponed state:", error)
        return null
    }
}

/**
 * Generate script tag for postponed state injection
 * @param {object} postponed - The postponed state from prerender
 * @returns {string} - Script tag HTML string
 */
export const generatePostponedStateScript = (postponed) => {
    const serialized = serializePostponedState(postponed)
    if (!serialized) return ""
    return `<script>window.__PPR_POSTPONED__=${serialized}</script>`
}

/**
 * returns data which will be used in Head component for page rendering
 * @param {string} pageCss - cached styles for page
 * @param {string} pageJS - cached javscript elements for page
 * @param {function} metaTagFunction - user defined function which returns meta tags in array
 * @param {boolean} isBot - checks if request is made by bot
 * @param {object} fetcherData - router fetched data
 */
export const renderStart = (pageCss, pageJS, metaTags, isBot, fetcherData) => {
    const { IS_DEV_COMMAND, WEBPACK_DEV_SERVER_HOSTNAME, WEBPACK_DEV_SERVER_PORT } = process.env

    let publicAssetPath = `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}`

    // serves assets from localhost on running devBuild and devServe command
    if (JSON.parse(IS_DEV_COMMAND)) {
        publicAssetPath = `http://${WEBPACK_DEV_SERVER_HOSTNAME}:${WEBPACK_DEV_SERVER_PORT}/assets/`
    }

    return {
        pageCss,
        pageJS,
        metaTags,
        isBot,
        publicAssetPath,
        fetcherData,
    }
}

/**
 * returns data which will be used in body component for page rendering
 * @param {object} webExtractor - loadable object which holds chunking function
 * @param {string} initialState - reducer initial state
 * @param {function} res - response object
 * @param {boolean} jsx - jsx which needs to be render on server side
 * @param {string|number|null} errorCode - error code
 * @param {object} fetcherData - router fetched data
 */
export const renderEnd = (initialState = {}, res, jsx, errorCode, fetcherData) => {
    // For bot first fold css and js would become complete page css and js
    let firstFoldCss = ""
    let firstFoldJS = ""
    const isProd = process.env.NODE_ENV === "production"

    // const { routePath, pageCss, pageJS } = res.locals

    // Development: Extracts styles and javascript elements for injecting in Body Component.
    // NOTE: Caching of styles and javascript is not enabled in development.
    // if (!isProd) {
    //     firstFoldCss = webExtractor.getStyleElements()
    //     firstFoldJS = webExtractor.getScriptElements()
    // }

    // // Production: Extract styles and javscript elements if they are not found in cache and stores them in cache.
    // if (isProd && routePath && (!pageCss || !pageJS)) {
    //     firstFoldCss = webExtractor.getStyleElements()
    //     firstFoldJS = webExtractor.getScriptElements()

    //     cacheCSS(routePath, webExtractor.getLinkElements())
    //     cacheJS(routePath, webExtractor.getScriptElements())
    // }

    return {
        initialState,
        firstFoldCss,
        firstFoldJS,
        jsx,
        errorCode,
        fetcherData,
    }
}
