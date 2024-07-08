import { cacheCSS, cacheJS } from "./extract"

/**
 * returns data which will be used in Head component for page rendering
 * @param {string} pageCss - cached styles for page
 * @param {string} pageJS - cached javscript elements for page
 * @param {function} metaTagFunction - user defined function which returns meta tags in array
 * @param {boolean} isBot - checks if request is made by bot
 * @param {object} fetcherData - router fetched data
 */
const renderStart = (pageCss, pageJS, metaTags, isBot, fetcherData) => {
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
const renderEnd = (webExtractor, initialState = {}, res, jsx, errorCode, fetcherData) => {
    // For bot first fold css and js would become complete page css and js
    let firstFoldCss = ""
    let firstFoldJS = ""
    const isProd = process.env.NODE_ENV === "production"

    const { routePath, pageCss, pageJS } = res.locals

    // Development: Extracts styles and javascript elements for injecting in Body Component.
    // NOTE: Caching of styles and javascript is not enabled in development.
    if (!isProd) {
        firstFoldCss = webExtractor.getStyleElements()
        firstFoldJS = webExtractor.getScriptElements()
    }

    // Production: Extract styles and javscript elements if they are not found in cache and stores them in cache.
    firstFoldJS = webExtractor.getScriptElements()
    if (isProd && routePath && !pageCss) {
        firstFoldCss = webExtractor.getStyleElements()

        cacheCSS(routePath, webExtractor.getLinkElements())
        //     cacheJS(routePath, webExtractor.getScriptElements())
    }

    return {
        initialState,
        firstFoldCss,
        firstFoldJS,
        jsx,
        errorCode,
        fetcherData,
    }
}
export default { renderStart, renderEnd }
