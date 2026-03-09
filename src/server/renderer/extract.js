import path from "path"
import fs from "fs"

// Use decimal megabytes (1 MB = 1,000,000 bytes) for all memory logs
const BYTES_PER_MB = 1_000_000
const toMB = (bytes) => (bytes / BYTES_PER_MB).toFixed(2)

// Cache for preload JS link elements per route (production only)
if (!process.preloadLinksCache) {
    process.preloadLinksCache = {}
}

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
 * Attempts to build inline CSS for a route from the in-memory caches.
 * Requires both process.extractorCache (ChunkExtractor) and process.cssCache (file contents)
 * to be populated — both are filled on the first request for a route.
 * Returns null on any cache miss, signalling that a Phase 1b dry-run is needed.
 * @param {string} routePath - Route path
 * @returns {{ css: string }|null} Inline CSS string, or null if any cache entry is missing
 */
function getAssetsFromCachedExtractor(routePath) {
    const isProd = process.env.NODE_ENV === "production"

    // Only use cached extractor in production
    if (!isProd || !process.extractorCache || !process.extractorCache[routePath]) {
        return null
    }

    const extractor = process.extractorCache[routePath]
    const linkElements = extractor.getLinkElements({ fetchpriority: "low" })

    // Extractor hasn't run renderToString yet — no chunks collected
    if (!linkElements || linkElements.length === 0) {
        return null
    }

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
            // CSS file not in cache yet — fall back to full render path
            return null
        }
    }

    return { css: cssContents.join("") }
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
 * Filters preload JS link elements from a ChunkExtractor's link list and caches them
 * per route in production so subsequent requests can skip the dry-run renderToString.
 * @param {object} webExtractor - ChunkExtractor instance
 * @param {string} routePath - Route path used as cache key
 * @returns {array} Filtered preload JS link elements
 */
export function cachePreloadJSLinks(webExtractor, routePath) {
    const isProd = process.env.NODE_ENV === "production"
    const linkElements = webExtractor.getLinkElements({ fetchpriority: "low" })
    const preloadJSLinks = linkElements.filter((asset) => asset?.props?.as === "script")
    if (isProd) {
        process.preloadLinksCache[routePath] = preloadJSLinks
    }
    return preloadJSLinks
}

/**
 * Phase 2: called from renderMarkUp's onAllReady after renderToPipeableStream finishes.
 * Builds the inline CSS (<style> block) and script tags that are appended to the stream.
 *
 * CSS injection is skipped when res.locals.pageCss is already set (Phase 1a cache hit),
 * since the CSS was already inlined in <head> by the Head component — injecting it again
 * here would cause duplication.
 *
 * In production, CSS is inlined from disk-cached files; in dev, style tags are used directly.
 * Bots receive no JS — only the fully rendered HTML is needed for crawling.
 */
export const cacheAndFetchAssets = ({ webExtractor, res, isBot }) => {
    let firstFoldCss = ""
    let firstFoldJS = ""
    const isProd = process.env.NODE_ENV === "production"
    const { routePath } = res.locals

    const linkElements = webExtractor.getLinkElements({ fetchpriority: "low" })

    if (routePath) {
        // Skip CSS injection if already inlined in <head> via res.locals.pageCss (cache hit)
        if (!res.locals.pageCss) {
            if (isProd) {
                firstFoldCss = buildInlineCSS(linkElements)
                if (firstFoldCss?.length) firstFoldCss = `<style>${firstFoldCss}</style>`
            } else {
                firstFoldCss = webExtractor.getStyleTags()
            }
        }
        firstFoldJS = !isBot ? webExtractor.getScriptTags({ fetchpriority: "low" }) : ""
    }

    return { firstFoldCss, firstFoldJS }
}

/**
 * Phase 1a: populates res.locals.pageCss and res.locals.preloadJSLinks from their
 * respective process-level caches. When both are restored, the Phase 1b dry-run
 * renderToString is skipped entirely for this request.
 * @param {object} res - Response object
 * @param {object} route - Route configuration
 */
export default function extractAssets(res, route) {
    try {
        const routePath = route.path
        const isProd = process.env.NODE_ENV === "production"

        const cached = getAssetsFromCachedExtractor(routePath)
        if (cached && cached.css) {
            res.locals.pageCss = cached.css
        }

        if (isProd && process.preloadLinksCache[routePath]) {
            res.locals.preloadJSLinks = process.preloadLinksCache[routePath]
        }

        if (!res.locals.pageCss && !res.locals.preloadJSLinks) {
            logger.info({
                message: "Cache Missed",
                uri: routePath,
            })
        }
    } catch (error) {
        logger.error("Error in extracting assets:" + error)
    }
}
