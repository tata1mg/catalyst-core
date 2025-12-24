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
        } catch (error) {
            logger.error("Error in filtering preloaded JS:" + error)
        }
    }

    process.preloadJSLinkCache[key] = preloadJSLinks
}

/**
 * stores css and js in cache
 * @param {object} res - response object
 * @param {string} route - route path
 */

function extractCss(cssArray) {
    if (!cssArray || cssArray.length === 0) {
        return ""
    }
    // Use Array.join() for better performance than string concatenation
    const cssContents = cssArray.map((css) => process.cssCache[css]).filter(Boolean)
    if (cssContents.length === 0) {
        return ""
    }
    return cssContents.join("")
}

/**
 * returns cached css
 * @param {string} key - router path
 * @return {Array} - array of CSS asset names
 */
function fetchRouteCSSAssets(key) {
    if (process.routeCssCache && process.routeCssCache[key]) {
        // Convert Set to Array for compatibility - Set doesn't have .map() method
        return Array.from(process.routeCssCache[key]).reverse()
    }
    return []
}

function fetchPreloadJSLinkCache(key) {
    return process.preloadJSLinkCache && process.preloadJSLinkCache[key]
        ? process.preloadJSLinkCache[key]
        : null
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

    if (!process.routeCssCache) {
        process.routeCssCache = {}
    }
    if (!process.routeCssCache[key]) {
        process.routeCssCache[key] = new Set()
    }
    let pageCss = ""

    if (Array.isArray(data)) {
        try {
            if (process.env.NODE_ENV === "production") {
                data.map((assetChunk) => {
                    const assetPathArr = assetChunk.key.split("/")
                    const assetName = assetPathArr[assetPathArr.length - 1]
                    const ext = path.extname(assetName)

                    if (ext === ".css") {
                        // if css file has not already been cached, add the content of this CSS file in pageCSS
                        if (!process.cssCache[assetName]) {
                            const css = fs.readFileSync(
                                path.resolve(
                                    process.env.src_path,
                                    `${process.env.BUILD_OUTPUT_PATH}/public`,
                                    assetName
                                )
                            )
                            process.cssCache[assetName] = css
                            const memoryUsage = process.memoryUsage()
                            const availableMemory = memoryUsage?.heapTotal - memoryUsage?.heapUsed
                            logger.error(
                                `Last Cached CSS - Asset: ${assetName}, ` +
                                    `RSS: ${memoryUsage?.rss}, ` +
                                    `Heap Total: ${memoryUsage?.heapTotal}, ` +
                                    `Heap Used: ${memoryUsage?.heapUsed}, ` +
                                    `External: ${memoryUsage?.external}, ` +
                                    `Array Buffers: ${memoryUsage?.arrayBuffers}, ` +
                                    `Available Memory: ${availableMemory}, ` +
                                    `Timestamp: ${new Date().toISOString()}`
                            )
                        }
                        // Use Set for O(1) lookup instead of Array.includes() O(N)
                        // if css file has not already been cached for this route, add the content of this CSS file in pageCSS
                        if (!process.routeCssCache[key].has(assetName)) {
                            process.routeCssCache[key].add(assetName)
                            pageCss = process.cssCache[assetName] + pageCss
                        }
                    }
                })
            }
        } catch (error) {
            logger.error("Error in caching CSS:" + error)
        }
    }

    return pageCss === "" ? "" : pageCss
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
        firstFoldJS = !isBot ? webExtractor.getScriptTags() : ""
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

export default function extract(res, route) {
    try {
        const requestPath = route.path
        const cssAssets = fetchRouteCSSAssets(requestPath)
        const cachedCss = extractCss(cssAssets)
        const cachedPreloadJSLinks = fetchPreloadJSLinkCache(requestPath)

        if (cachedCss || cachedPreloadJSLinks) {
            res.locals.pageCss = cachedCss
            res.locals.preloadJSLinks = cachedPreloadJSLinks
            return
        }

        logger.info({
            message: "Cache Missed",
            uri: requestPath,
        })
    } catch (error) {
        logger.error("Error in extracting assets:" + error)
    }
}
