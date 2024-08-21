import fs from "fs"
import path from "path"
import { cacheCSS, cachePreloadJSLinks } from "./extract"

/**
 * returns data which will be used in Head component for page rendering
 * @param {string} pageCss - cached styles for page
 * @param {string} preloadJSLinks - cached javscript elements for page
 * @param {function} metaTagFunction - user defined function which returns meta tags in array
 * @param {boolean} isBot - checks if request is made by bot
 * @param {object} fetcherData - router fetched data
 */
const renderStart = (pageCss, preloadJSLinks, metaTags, isBot, fetcherData) => {
    const { IS_DEV_COMMAND, WEBPACK_DEV_SERVER_HOSTNAME, WEBPACK_DEV_SERVER_PORT } = process.env

    let publicAssetPath = `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}`

    // serves assets from localhost on running devBuild and devServe command
    if (JSON.parse(IS_DEV_COMMAND)) {
        publicAssetPath = `http://${WEBPACK_DEV_SERVER_HOSTNAME}:${WEBPACK_DEV_SERVER_PORT}/assets/`
    }

    return {
        pageCss,
        preloadJSLinks,
        metaTags,
        isBot,
        publicAssetPath,
        fetcherData,
    }
}

const extractCss = (data) => {
    let pageCss = "<style>"
    if (Array.isArray(data)) {
        try {
            data.map((assetChunk) => {
                const assetPathArr = assetChunk.key.split("/")
                const assetName = assetPathArr[assetPathArr.length - 1]
                const ext = path.extname(assetName)
                if (ext === ".css")
                    pageCss += fs.readFileSync(path.resolve(`${process.env.OUTPUT_PATH}/public/` + assetName))
            })
        } catch (error) {
            console.dir({
                service_name: `pwa-${process.env.APPLICATION}-node-server`,
                loglevel: "error",
                version: "v2",
                message: "\n \n =====> Error While Extracting The Chunk: \n ",
                traceback: error,
            })
        }
    }
    pageCss += "</style>"
    return pageCss
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
const renderEnd = (webExtractor, initialState = {}, res, jsx, errorCode, fetcherData, isBot, cspNonce) => {
    // For bot first fold css and js would become complete page css and js
    let firstFoldCss = ""
    let firstFoldJS = ""
    const isProd = process.env.NODE_ENV === "production"

    const { routePath, preloadJSLinks } = res.locals

    const linkElements = webExtractor.getLinkElements()

    // We want to cache/or check for update css on every call
    // We want to extract script tags for every call that will get added to body.
    // Their corresponding preloaded link script tags are already present in head.
    if (routePath) {
        !isBot && cacheCSS(routePath, linkElements)
        // firstFoldJS = webExtractor.getScriptTags({ nonce: cspNonce })
        firstFoldJS = webExtractor.getScriptElements()
    }

    // This block will run for the first time and cache preloaded JS Links for second render
    // firstFoldJS ->scripts gets inject in body
    // firstFoldCss -> Inline css gets injected in body only for the first render
    if (!isProd || isBot || (routePath && !preloadJSLinks)) {
        // For production, we inject link tags with preload/prefetch using getLinkElements and inlining them via file reads
        // For local, given we have assets in memory we dont read from file rather directly inject via link elements returned without preload/prefetch
        firstFoldCss = isProd ? extractCss(linkElements) : webExtractor.getStyleElements()
        !isBot && cachePreloadJSLinks(routePath, linkElements)
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
