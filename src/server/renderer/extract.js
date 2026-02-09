import path from "path"
import fs from "fs"

// Use decimal megabytes (1 MB = 1,000,000 bytes) for all memory logs
const BYTES_PER_MB = 1_000_000
const toMB = (bytes) => (bytes / BYTES_PER_MB).toFixed(2)

/**
 * Caches CSS file content (shared across all routes)
 * @param {string} assetName - CSS filename
 * @param {string} assetPath - Full path to CSS file
 */
function cacheCSS(assetName, assetPath) {
    if (!process.cssCache) {
        process.cssCache = {}
    }

    if (!process.cssCache[assetName]) {
        const css = fs.readFileSync(assetPath)
        process.cssCache[assetName] = css

        const cssCacheSize = Object.keys(process.cssCache).length
        const cssCacheTotalSizeBytes = Object.values(process.cssCache).reduce(
            (total, cssContent) => total + Buffer.byteLength(cssContent),
            0
        )

        const memoryUsage = process.memoryUsage()
        const availableMemoryBytes = (memoryUsage?.heapTotal ?? 0) - (memoryUsage?.heapUsed ?? 0)

        logger.info(
            `Last Cached CSS - Asset: ${assetName}, ` +
                `CSS Cache Entries: ${cssCacheSize}, ` +
                `CSS Cache Total Size: ${toMB(cssCacheTotalSizeBytes)} MB, ` +
                `RSS: ${toMB(memoryUsage?.rss ?? 0)} MB, ` +
                `Heap Total: ${toMB(memoryUsage?.heapTotal ?? 0)} MB, ` +
                `Heap Used: ${toMB(memoryUsage?.heapUsed ?? 0)} MB, ` +
                `External: ${toMB(memoryUsage?.external ?? 0)} MB, ` +
                `Array Buffers: ${toMB(memoryUsage?.arrayBuffers ?? 0)} MB, ` +
                `Available Memory: ${toMB(availableMemoryBytes)} MB, ` +
                `Timestamp: ${new Date().toISOString()}`
        )
    }

    return process.cssCache[assetName]
}

/**
 * Extracts CSS and preload links from cached ChunkExtractor
 * @param {string} routePath - Route path
 * @returns {object} { css: string, preloadJSLinks: array } or null if not cached
 */
function getAssetsFromCachedExtractor(routePath) {
    const isProd = process.env.NODE_ENV === "production"

    // Only use cached extractor in production
    if (!isProd || !process.extractorCache || !process.extractorCache[routePath]) {
        return null
    }

    const extractor = process.extractorCache[routePath]
    const linkElements = extractor.getLinkElements()

    // If no link elements, extractor hasn't been used yet
    if (!linkElements || linkElements.length === 0) {
        return null
    }

    // Get preload JS links
    const preloadJSLinks = linkElements.filter((asset) => asset?.props?.as === "script")

    // Get CSS assets
    const cssAssets = linkElements.filter((e) => {
        const href = e?.props?.href
        return href && href.endsWith(".css")
    })

    // Build inline CSS from cached CSS files
    const cssContents = []
    for (const cssElement of cssAssets) {
        const assetName = path.basename(cssElement.props.href)
        // Check if CSS content is cached
        if (process.cssCache && process.cssCache[assetName]) {
            cssContents.push(process.cssCache[assetName])
        } else {
            // CSS not cached yet, can't use cached extractor
            return null
        }
    }

    const cachedCss = cssContents.join("")

    return {
        css: cachedCss,
        preloadJSLinks: preloadJSLinks,
    }
}

/**
 * Builds inline CSS from link elements by reading and caching CSS files
 * @param {array} linkElements - Link elements from ChunkExtractor
 * @returns {string} Concatenated CSS content
 */
function buildInlineCSS(linkElements) {
    if (!Array.isArray(linkElements) || linkElements.length === 0) {
        return ""
    }

    const cssContents = []

    for (const element of linkElements) {
        const href = element?.props?.href
        if (href && href.endsWith(".css")) {
            const assetName = path.basename(href)
            const assetPath = path.resolve(
                process.env.src_path,
                `${process.env.BUILD_OUTPUT_PATH}/public`,
                assetName
            )

            // Read and cache CSS content
            const cssContent = cacheCSS(assetName, assetPath)
            cssContents.push(cssContent)
        }
    }

    return cssContents.join("")
}

/**
 * Main function called by handler to fetch or build assets
 * Phase 2: Called on every request after Phase 1 (renderToString)
 */
export const cacheAndFetchAssets = ({ webExtractor, res, isBot }) => {
    let firstFoldCss = ""
    let firstFoldJS = ""
    const isProd = process.env.NODE_ENV === "production"
    const { routePath } = res.locals

    const linkElements = webExtractor.getLinkElements()

    if (routePath) {
        if (isProd) {
            // Build inline CSS from cached extractor's link elements
            firstFoldCss = buildInlineCSS(linkElements)
            if (firstFoldCss?.length) firstFoldCss = `<style>${firstFoldCss}</style>`
        } else {
            // Development: Use style tags directly
            firstFoldCss = webExtractor.getStyleTags()
        }

        // Get script tags (Phase 2: injected in body)
        firstFoldJS = !isBot ? webExtractor.getScriptTags() : ""
    }

    return { firstFoldCss, firstFoldJS }
}

/**
 * Checks if we have cached assets for this route
 * Called during Phase 1 to determine if we can skip renderToString
 * @param {object} res - Response object
 * @param {object} route - Route configuration
 */
export default function extractAssets(res, route) {
    try {
        const routePath = route.path

        // Try to get assets from cached ChunkExtractor
        const cached = getAssetsFromCachedExtractor(routePath)

        if (cached && (cached.css || cached.preloadJSLinks)) {
            res.locals.pageCss = cached.css
            res.locals.preloadJSLinks = cached.preloadJSLinks
            return
        }

        logger.info({
            message: "Cache Missed",
            uri: routePath,
        })
    } catch (error) {
        logger.error("Error in extracting assets:" + error)
    }
}
