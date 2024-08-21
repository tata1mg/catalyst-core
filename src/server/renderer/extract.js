import path from "path"
import fs from "fs"

function handleProps(asset, props) {
    return typeof props === "function" ? "" : props
}

function propsToString(asset, props) {
    return Object.entries(handleProps(asset, props)).reduce(
        (acc, [key, value]) => `${acc} ${key}="${value}"`,
        ""
    )
}

export function cachePreloadJSLinks(key, data) {
    if (!process.preloadJSLinkCache) {
        process.preloadJSLinkCache = {}
    }
    let preloadJSLinks = []
    if (Array.isArray(data)) {
        try {
            preloadJSLinks = data.filter((asset) => asset?.props?.as === "script")
            // data.map((asset) => {
            //     if (asset?.props?.as === "script") {
            //         preloadJSLinks.push(`<link ${propsToString(asset, asset.props)}>`)
            //     }
            // })
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
    console.dir({
        service_name: "pwa-node-server",
        loglevel: "info",
        version: "v2",
        message: `\n========= Cached For preloadJSLinkCache: ${key} ============\n`,
    })
    // process.preloadJSLinkCache[key] = preloadJSLinks.join("\n")
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
        } catch (error) {
            if (process.env.NODE_ENV == "development") {
                console.log(
                    "Error While Extracting The Chunk: ",
                    path.resolve(process.env.src_path, `${process.env.BUILD_OUTPUT_PATH}/public`)
                )
            }
        }
    }
    // if css cache exists for a route and there are some uncached css, add that css to the cache
    // this will run on subsequent hits and will add css of uncached widgets to the cache
    if (process.cssCache[key]) {
        if (pageCss !== "") {
            pageCss = "<style>" + pageCss + "</style>"
            let existingListOfCachedAssets = process.cssCache[key].listOfCachedAssets
            const newPageCSS = process.cssCache[key].pageCss + pageCss
            let newListOfCachedAssets = { ...existingListOfCachedAssets, ...listOfCachedAssets }
            process.cssCache[key] = { pageCss: newPageCSS, listOfCachedAssets: newListOfCachedAssets }
        }
    } else {
        // create css cache for a page. This will run on the first hit.
        pageCss = "<style>" + pageCss + "</style>"
        process.cssCache[key] = { pageCss, listOfCachedAssets }
    }
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
    } catch (error) {
        console.log("Error while caching your assets.")
    }
}