import path from "path"
import fs from "fs"

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
    if (Array.isArray(data)) {
        try {
            data.map((assetChunk) => {
                const assetPathArr = assetChunk.key.split("/")
                const assetName = assetPathArr[assetPathArr.length - 1]
                const ext = path.extname(assetName)

                if (ext === ".css")
                    pageCss += fs.readFileSync(
                        path.resolve(
                            process.env.src_path,
                            `${process.env.BUILD_OUTPUT_PATH}/public`,
                            assetName
                        )
                    )
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
    process.cssCache[key] = pageCss
}

/**
 * Stores javascript into cache
 * @param {string} key - router path
 * @param {object} data - js elements array extracted through loadable chunk extracter
 */
export function cacheJS(key, data) {
    if (!process.jsCache) {
        process.jsCache = {}
    }
    process.jsCache[key] = data
}

/**
 * returns cached css
 * @param {string} key - router path
 * @return {string} - cached css
 */
function fetchCachedCSS(key) {
    return process.cssCache && process.cssCache[key] ? process.cssCache[key] : null
}

/**
 * returns cached js
 * @param {string} key - router path
 * @return {string} - cached js
 */
function fetchCachedJS(key) {
    return process.jsCache && process.jsCache[key] ? process.jsCache[key] : null
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
        const cachedJS = fetchCachedJS(requestPath)

        if (cachedCss || cachedJS) {
            res.locals.pageJS = cachedJS
            res.locals.pageCss = cachedCss
            return
        }
    } catch (error) {
        console.log("Error while caching your assets.")
    }
}
