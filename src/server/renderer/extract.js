import path from "path"
import fs from "fs"

const readFile = fs.promises.readFile

export function cachePreloadJSLinks(key, data) {
    if (!process.preloadJSLinkCache) {
        process.preloadJSLinkCache = {}
    }
    
    // Skip if already cached
    if (process.preloadJSLinkCache[key]) {
        return
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
 * Stores css chunks styles into cache in string format
 * @param {string} key - router path
 * @param {object} data - css elements array extracted through loadable chunk extracter
 * @param {boolean} skipIfCached - if true, skip processing if cache already exists
 * @returns {Promise<string>} - cached CSS content
 */
export async function cacheCSS(key, data, skipIfCached = false) {
    if (!process.cssCache) {
        process.cssCache = {}
    }
    
    // If cache exists and skipIfCached is true, just return cached CSS
    if (skipIfCached && process.cssCache[key]) {
        return process.cssCache[key].pageCss
    }
    
    let pageCss = ""
    let listOfCachedAssets = {}
    const existingCache = process.cssCache[key]
    const existingCachedAssets = existingCache?.listOfCachedAssets || {}
    
    if (Array.isArray(data)) {
        try {
            if (process.env.NODE_ENV === "production") {
                // Read all CSS files in parallel for better performance
                const readPromises = []
                const assetMap = new Map() // Track which assets we need to read
                
                for (const assetChunk of data) {
                    const assetPathArr = assetChunk.key.split("/")
                    const assetName = assetPathArr[assetPathArr.length - 1]
                    const ext = path.extname(assetName)

                    if (ext === ".css") {
                        // if css file has not already been cached, add the content of this CSS file in pageCSS
                        if (!listOfCachedAssets[assetName] && !existingCachedAssets[assetName]) {
                            const filePath = path.resolve(
                                process.env.src_path,
                                `${process.env.BUILD_OUTPUT_PATH}/public`,
                                assetName
                            )
                            assetMap.set(assetName, filePath)
                            listOfCachedAssets[assetName] = true
                        }
                    }
                }
                
                // Read all files in parallel (non-blocking)
                if (assetMap.size > 0) {
                    const readResults = await Promise.allSettled(
                        Array.from(assetMap.entries()).map(async ([assetName, filePath]) => {
                            try {
                                const cssContent = await readFile(filePath, "utf8")
                                return { assetName, cssContent }
                            } catch (fileError) {
                                logger.error(`Error reading CSS file ${assetName}: ${fileError.message}`)
                                return { assetName, cssContent: "" }
                            }
                        })
                    )
                    
                    // Combine all CSS content
                    for (const result of readResults) {
                        if (result.status === "fulfilled" && result.value.cssContent) {
                            pageCss += result.value.cssContent
                        }
                    }
                }
            }
        } catch (error) {
            logger.error("Error in caching CSS:" + error)
        }
    }
    
    // if css cache exists for a route and there are some uncached css, add that css to the cache
    // this will run on subsequent hits and will add css of uncached widgets to the cache
    if (existingCache) {
        if (pageCss !== "") {
            // Use array join instead of string concatenation for better memory efficiency
            const newPageCSS = existingCache.pageCss + pageCss
            const newListOfCachedAssets = { ...existingCachedAssets, ...listOfCachedAssets }
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
export default function extract(res, route) {
    try {
        const requestPath = route.path
        const cachedCss = fetchCachedCSS(requestPath)
        const cachedPreloadJSLinks = fetchPreloadJSLinkCache(requestPath)

        // Mark that we've checked the cache (regardless of hit/miss)
        res.locals.assetsExtracted = true

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

export const cacheAndFetchAssets = async ({ webExtractor, res, isBot }) => {
    // For bot first fold css and js would become complete page css and js
    let firstFoldCss = ""
    let firstFoldJS = ""
    const isProd = process.env.NODE_ENV === "production"

    const { routePath, preloadJSLinks, pageCss } = res.locals

    // If CSS is already cached and set in res.locals, use it directly to avoid unnecessary processing
    if (pageCss && isProd) {
        firstFoldCss = pageCss
        // Still need to get JS tags even if CSS is cached
        firstFoldJS = !isBot ? webExtractor.getScriptTags() : ""
    } else {
        const linkElements = webExtractor.getLinkElements()

        // We want to cache/or check for update css on every call
        // We want to extract script tags for every call that will get added to body.
        // Their corresponding preloaded link script tags are already present in head.
        if (routePath) {
            if (isProd) {
                // Skip file reads if cache already exists (pageCss would be set if cache hit)
                const skipIfCached = !!pageCss
                firstFoldCss = await cacheCSS(routePath, linkElements, skipIfCached)
                if (firstFoldCss?.length) firstFoldCss = `<style>${firstFoldCss}</style>`
            } else {
                await cacheCSS(routePath, linkElements)
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
    }

    return { firstFoldCss, firstFoldJS }
}
