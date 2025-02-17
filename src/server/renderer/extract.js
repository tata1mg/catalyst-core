import path from "path"
import fs from "fs"

export function cachePreloadJSLinks(key, data) {
    if (!process.preloadJSLinkCache) {
        process.preloadJSLinkCache = {}
    }
    let preloadJSLinks = []
    if (Array.isArray(data)) {
        try {
            preloadJSLinks = data.filter((asset) => asset?.props?.as === "script")
        } catch (error) {}
    }

    process.preloadJSLinkCache[key] = preloadJSLinks
}

/**
 * Stores css chunks styles into cache in string format
 * @param {string} key - router path
 * @param {object} data - css elements array extracted through loadable chunk extracter
 */
export function cacheCSS(key, data) {
    if (!process.cssCache) {
        process.cssCache = {}
    }
    let pageCss = ""
    let listOfCachedAssets = {}
    if (Array.isArray(data)) {
        try {
            if (process.env.NODE_ENV === "production") {
                data.map((assetChunk) => {
                    const assetPathArr = assetChunk.key.split("/")
                    const assetName = assetPathArr[assetPathArr.length - 1]
                    const ext = path.extname(assetName)

                    if (ext === ".css") {
                        // if css file has not already been cached, add the content of this CSS file in pageCSS
                        if (
                            !listOfCachedAssets[assetName] &&
                            !process.cssCache?.[key]?.listOfCachedAssets?.[assetName]
                        ) {
                            pageCss += fs.readFileSync(
                                path.resolve(
                                    process.env.src_path,
                                    `${process.env.BUILD_OUTPUT_PATH}/public`,
                                    assetName
                                )
                            )
                            listOfCachedAssets[assetName] = true
                        }
                    }
                })
            }
        } catch (error) {}
    }
    // if css cache exists for a route and there are some uncached css, add that css to the cache
    // this will run on subsequent hits and will add css of uncached widgets to the cache
    if (process.cssCache[key]) {
        if (pageCss !== "") {
            let existingListOfCachedAssets = process.cssCache[key].listOfCachedAssets
            const newPageCSS = process.cssCache[key].pageCss + pageCss
            let newListOfCachedAssets = { ...existingListOfCachedAssets, ...listOfCachedAssets }
            process.cssCache[key] = { pageCss: newPageCSS, listOfCachedAssets: newListOfCachedAssets }
        }
    } else {
        // create css cache for a page. This will run on the first hit.
        process.cssCache[key] = { pageCss, listOfCachedAssets }
    }

    return pageCss
}

/**
 * returns cached css
 * @param {string} key - router path
 * @return {string} - cached css
 */
function fetchCachedCSS(key) {
    return process.cssCache && process.cssCache[key] ? process.cssCache[key].pageCss : ""
}

function fetchPreloadJSLinkCache(key) {
    return process.preloadJSLinkCache && process.preloadJSLinkCache[key]
        ? process.preloadJSLinkCache[key]
        : null
}

/**
 * stores css and js in cache
 * @param {object} res - response object
 * @param {string} route - route path
 */
export default function (res, route) {
    try {
        const requestPath = route.path
        const cachedCss = fetchCachedCSS(requestPath)
        const cachedPreloadJSLinks = fetchPreloadJSLinkCache(requestPath)

        if (cachedCss || cachedPreloadJSLinks) {
            res.locals.pageCss = cachedCss
            res.locals.preloadJSLinks = cachedPreloadJSLinks
            return
        }
    } catch (error) {}
}

export const cacheAndFetchAssets = ({ webExtractor, res, isBot }) => {
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
        if (isProd) {
            firstFoldCss = cacheCSS(routePath, linkElements)
            if (firstFoldCss?.length) firstFoldCss = `<style>${firstFoldCss}</style>`
        } else {
            cacheCSS(routePath, linkElements)
            firstFoldCss = webExtractor.getStyleTags()
        }
        // firstFoldJS = webExtractor.getScriptTags({ nonce: cspNonce })
        firstFoldJS = webExtractor.getScriptTags()
    }

    // This block will run for the first time and cache preloaded JS Links for second render
    // firstFoldJS ->scripts gets inject in body
    // firstFoldCss -> Inline css gets injected in body only for the first render
    if (!isProd || isBot || (routePath && !preloadJSLinks)) {
        // For production, we inject link tags with preload/prefetch using getLinkElements and inlining them via file reads
        // For local, given we have assets in memory we dont read from file rather directly inject via link elements returned without preload/prefetch
        !isBot && cachePreloadJSLinks(routePath, linkElements)
    }

    return { firstFoldCss, firstFoldJS }
}
