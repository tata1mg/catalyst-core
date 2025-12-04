import React from "react"
import { renderStart, renderEnd } from "./render.js"
import { Provider } from "react-redux"
import { Body } from "./document/Body.jsx"
import { Head } from "./document/Head.jsx"

import { StaticRouter } from "react-router-dom/server"
import ServerRouter from "../../router/ServerRouter.js"
import { renderToPipeableStream } from "react-dom/server"
import { getUserAgentDetails } from "../utils/userAgentUtil.js"
import { matchPath, serverDataFetcher, matchRoutes as NestedMatchRoutes, getMetaData } from "../../index.jsx"
import { validateConfigureStore, validateGetRoutes } from "../utils/validator.js"
import { ChunkExtractor } from "./ChunkExtractor.js"
import {
    generateScriptTags,
    generateStylesheetLinks,
    generateScriptTagsAsStrings,
    generateStylesheetLinksAsStrings,
} from "./extract.js"
import {
    PPRDataProvider,
    createPPRDataPromises,
    clearPPRCache,
} from "../../web-router/components/PPRDataProvider.jsx"

import CustomDocument from "@catalyst/template/server/document.jsx"

import App from "@catalyst/template/src/js/containers/App/index.jsx"
import { getRoutes } from "@catalyst/template/src/js/routes/utils.jsx"
import createStore from "@catalyst/template/src/js/store/index.js"

// matches request route with routes defined in the application.
const getMatchRoutes = (routes, req, res, store, context, fetcherData, basePath = "") => {
    return routes.reduce((matches, route) => {
        const { path } = route
        const match = matchPath(
            { path: `${basePath}/${path}`, caseSensitive: false, end: true },
            req.baseUrl || "/"
        )

        if (!match && route.children) {
            // recursively try to match nested routes
            const nested = getMatchRoutes(
                route.children,
                req,
                res,
                store,
                context,
                fetcherData,
                `${basePath}/${path}`
            )
            if (nested.length) {
                matches = matches.concat(nested)
            }
        }

        return matches
    }, [])
}

// Collects essential assets for the current route
const collectEssentialAssets = (ssrManifest, manifest, assetManifest) => {
    let discoveredAssets = { js: [], css: [] }
    let chunkExtractor = null

    try {
        // Create ChunkExtractor for this render
        chunkExtractor = new ChunkExtractor({
            manifest: manifest || {},
            ssrManifest: ssrManifest || {},
            assetManifest: assetManifest || {},
        })

        // Get extracted assets from ChunkExtractor
        discoveredAssets = chunkExtractor.getEssentialAssets()
    } catch (error) {
        console.warn("Error while collecting essential assets:", error)
    }

    return { discoveredAssets, chunkExtractor }
}

// Preloads chunks required for rendering document
const getComponent = (store, context, req, fetcherData, pprDataPromises = null) => {
    const content = (
        <div id="app">
            <Provider store={store}>
                <StaticRouter context={context} location={req.originalUrl}>
                    <ServerRouter store={store} intialData={fetcherData} />
                </StaticRouter>
            </Provider>
        </div>
    )

    // Wrap with PPR data provider for streaming
    if (isPPREnabled()) {
        return <PPRDataProvider dataPromises={pprDataPromises}>{content}</PPRDataProvider>
    }

    return content
}

// Check if PPR is enabled via environment variable
const isPPREnabled = () => {
    return true
}

/**
 * PPR Streaming Metrics
 * Tracks performance of progressive streaming rendering
 */
class PPRStreamingMetrics {
    constructor(url) {
        this.url = url
        this.startTime = Date.now()
        this.timestamps = {}
        this.mode = "streaming-ppr"
    }

    mark(label) {
        this.timestamps[label] = Date.now()
    }

    getDuration(from, to) {
        if (!this.timestamps[from] || !this.timestamps[to]) return null
        return this.timestamps[to] - this.timestamps[from]
    }

    getFromStart(label) {
        if (!this.timestamps[label]) return null
        return this.timestamps[label] - this.startTime
    }

    log() {
        const ttfb = this.getFromStart("shellReady")
        const totalTime = this.getFromStart("allReady")
        const streamingTime = this.getDuration("shellReady", "allReady")

        console.log("\n" + "═".repeat(50))
        console.log(`📊 PPR Streaming Metrics - ${this.url}`)
        console.log("═".repeat(50))
        console.log(`  🚀 TTFB (Shell Ready):    ${ttfb}ms`)
        console.log(`  📡 Streaming Duration:    ${streamingTime}ms`)
        console.log(`  ⏱️  Total Time:           ${totalTime}ms`)
        console.log("═".repeat(50) + "\n")

        return {
            url: this.url,
            mode: this.mode,
            ttfb,
            streamingTime,
            totalTime,
            timestamps: this.timestamps,
        }
    }
}

/**
 * Renders with Progressive Streaming PPR
 *
 * Flow:
 * 1. Send cached shell immediately (or render shell if not cached)
 * 2. Stream dynamic content progressively as Suspense boundaries resolve
 * 3. React's built-in streaming handles the DOM updates
 *
 * This gives immediate TTFB with the shell, then content appears progressively.
 */
const renderWithPPR = async (createJsx, res, chunkExtractor, req) => {
    const metrics = new PPRStreamingMetrics(req.originalUrl || req.url)

    return new Promise((resolve, reject) => {
        // Create the JSX for streaming
        const streamJsx = createJsx()
        let isAborted = false

        // Use streaming SSR - content flows as Suspense boundaries resolve
        const { pipe, abort } = renderToPipeableStream(streamJsx, {
            onShellReady() {
                // Shell is ready - send it immediately!
                if (isAborted) return

                metrics.mark("shellReady")
                res.setHeader("content-type", "text/html; charset=utf-8")
                res.write("<!DOCTYPE html>")

                // Start piping - React streams content as Suspense resolves
                pipe(res)
            },
            onShellError(error) {
                console.error("PPR shell error:", error)
                cleanup()
                reject(error)
            },
            onAllReady() {
                if (isAborted) return

                // All Suspense boundaries have resolved
                metrics.mark("allReady")

                if (chunkExtractor) {
                    import("./extract.js")
                        .then(({ generateScriptTagsAsStrings, generateStylesheetLinksAsStrings }) => {
                            if (isAborted) return resolve()

                            const discoveredAssets = chunkExtractor.getNonEssentialAssets()
                            const scriptElements = generateScriptTagsAsStrings(discoveredAssets.js, req)
                            const stylesheetLinks = generateStylesheetLinksAsStrings(
                                discoveredAssets.css,
                                req,
                                chunkExtractor
                            )
                            res.write(stylesheetLinks)
                            res.write(scriptElements)
                            metrics.log()
                            cleanup()
                            resolve()
                        })
                        .catch((err) => {
                            cleanup()
                            reject(err)
                        })
                } else {
                    metrics.log()
                    cleanup()
                    resolve()
                }
            },
            onError(error) {
                console.error("PPR streaming error:", error)
                // Don't reject - React will handle showing error boundaries
            },
        })

        // Cleanup function to remove listeners
        const cleanup = () => {
            req.off("close", handleAbort)
            res.off("close", handleAbort)
        }

        // Handle client disconnect - abort React rendering to free resources
        const handleAbort = () => {
            if (isAborted) return
            isAborted = true
            abort()
            cleanup()
            resolve() // Resolve to prevent hanging promises
        }

        req.on("close", handleAbort)
        res.on("close", handleAbort)
    })
}

// sends document after rendering
const renderMarkUp = async (
    errorCode,
    req,
    res,
    metaTags,
    fetcherData,
    store,
    matches,
    context,
    discoveredAssets = { js: [], css: [] },
    chunkExtractor = null,
    pprDataPromises = null
) => {
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    const isBot = deviceDetails.googleBot ? true : false

    // Process ChunkExtractor discovered assets
    const scriptElements = generateScriptTags(discoveredAssets.js, req)
    const stylesheetLinks = generateStylesheetLinks(discoveredAssets.css, req, chunkExtractor)

    // Use stylesheet links instead of inlined CSS
    res.locals.pageJS = scriptElements
    res.locals.pageCss = stylesheetLinks

    // Transforms Head Props with discovered assets
    const shellStart = await renderStart(res.locals.pageCss, res.locals.pageJS, metaTags, isBot, fetcherData)

    let state = store.getState()

    /**
     * Factory function to create document JSX
     */
    const createCompleteDocument = () => {
        // Create component tree
        const jsx = getComponent(store, context, req, fetcherData, pprDataPromises)

        // Transforms Body Props
        const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)

        const finalProps = {
            ...shellStart,
            ...shellEnd,
            jsx: jsx,
            req,
            res,
        }

        if (CustomDocument) {
            return CustomDocument(finalProps)
        } else {
            return (
                <html lang={finalProps.lang}>
                    <Head
                        isBot={finalProps.isBot}
                        pageJS={finalProps.pageJS}
                        pageCss={finalProps.pageCss}
                        fetcherData={finalProps.fetcherData}
                        metaTags={finalProps.metaTags}
                        publicAssetPath={finalProps.publicAssetPath}
                    />
                    <Body
                        initialState={finalProps.initialState}
                        jsx={finalProps.jsx}
                        statusCode={finalProps.statusCode}
                        fetcherData={finalProps.fetcherData}
                    />
                </html>
            )
        }
    }

    try {
        let status = matches.length && matches[0].match.path === "*" ? 404 : 200
        res.set({ "content-type": "text/html; charset=utf-8" })
        res.status(status)

        // Use PPR if enabled, otherwise fallback to streaming SSR
        if (isPPREnabled()) {
            try {
                await renderWithPPR(createCompleteDocument, res, chunkExtractor, req)
                return
            } catch (pprError) {
                // PPR failed, fallback to streaming SSR
                console.warn("PPR failed, falling back to streaming SSR:", pprError.message)
            }
        }

        // For streaming SSR, create document with default phase
        const CompleteDocument = () => createCompleteDocument()

        const { pipe } = renderToPipeableStream(<CompleteDocument />, {
            onShellReady() {
                res.setHeader("content-type", "text/html")
                res.write(`<!DOCTYPE html>`)
                pipe(res)
            },
            onAllReady() {
                const discoveredAssets = chunkExtractor.getNonEssentialAssets()
                const scriptElements = generateScriptTagsAsStrings(discoveredAssets.js, req)
                const stylesheetLinks = generateStylesheetLinksAsStrings(
                    discoveredAssets.css,
                    req,
                    chunkExtractor
                )
                res.write(stylesheetLinks)
                res.write(scriptElements)
            },
            onError(error) {
                console.error({ message: `\n Error while renderToPipeableStream : ${error.toString()}` })
            },
        })
    } catch (error) {
        console.error("Error in rendering document on server:" + error)
    }
}

/**
 * PPR Mode Handler - Starts render immediately with data promises
 * Data fetching happens lazily via React's use() hook and Suspense
 */
async function handlePPRRequest(req, res, store, routes, matches, allMatches) {
    let context = {}

    try {
        // Clear PPR cache for fresh request
        clearPPRCache()

        // Execute app server side function (non-blocking for static parts)
        await App.serverSideFunction({ store, req, res })

        // Create data promises but DON'T await them
        // These will be consumed lazily via use() hook in components
        const pprDataPromises = createPPRDataPromises({ routes, req, res, url: req.originalUrl }, { store })

        // Get meta tags (can work with empty data for static tags)
        const allTags = getMetaData(allMatches, {})

        // Collect assets immediately
        const { discoveredAssets, chunkExtractor } = collectEssentialAssets(
            req.ssrManifest,
            req.manifest,
            req.assetManifest
        )

        // Start rendering immediately with data promises (not resolved data)
        // Components will suspend when they try to read unresolved promises
        await renderMarkUp(
            null,
            req,
            res,
            allTags,
            {}, // Empty fetcherData - data comes from promises
            store,
            matches,
            context,
            discoveredAssets,
            chunkExtractor,
            pprDataPromises // Pass promises for lazy consumption
        )
    } catch (error) {
        console.error("PPR request handling failed:", error)
        throw error
    }
}

/**
 * SSR Metrics for traditional server-side rendering
 */
class SSRMetrics {
    constructor(url) {
        this.url = url
        this.startTime = Date.now()
        this.timestamps = {}
        this.mode = "traditional-ssr"
    }

    mark(label) {
        this.timestamps[label] = Date.now()
    }

    getFromStart(label) {
        if (!this.timestamps[label]) return null
        return this.timestamps[label] - this.startTime
    }

    log() {
        const dataFetchTime = this.getFromStart("dataFetched")
        const renderStartTime = this.getFromStart("renderStart")
        const totalTime = this.getFromStart("complete")

        console.log("\n" + "═".repeat(50))
        console.log(`📊 SSR Metrics - ${this.url}`)
        console.log("═".repeat(50))
        console.log(`  📦 Data Fetch Time:       ${dataFetchTime}ms`)
        console.log(`  🎨 Render Start:          ${renderStartTime}ms`)
        console.log(`  ⏱️  Total Time (TTFB):     ${totalTime}ms`)
        console.log("═".repeat(50) + "\n")

        return {
            url: this.url,
            mode: this.mode,
            dataFetchTime,
            renderStartTime,
            totalTime,
        }
    }
}

/**
 * Traditional SSR Mode Handler - Waits for data before rendering
 */
async function handleSSRRequest(req, res, store, routes, matches, allMatches) {
    const metrics = new SSRMetrics(req.originalUrl || req.url)
    let context = {}
    let fetcherData = {}

    try {
        // Execute app server side function
        await App.serverSideFunction({ store, req, res })

        // Fetch all data and WAIT for it
        fetcherData = await serverDataFetcher({ routes, req, res, url: req.originalUrl }, { store })
        metrics.mark("dataFetched")

        // Get meta tags with fetched data
        const allTags = getMetaData(allMatches, fetcherData)

        // Collect assets
        const { discoveredAssets, chunkExtractor } = collectEssentialAssets(
            req.ssrManifest,
            req.manifest,
            req.assetManifest
        )
        metrics.mark("renderStart")

        // Render with all data already resolved
        await renderMarkUp(
            null,
            req,
            res,
            allTags,
            fetcherData,
            store,
            matches,
            context,
            discoveredAssets,
            chunkExtractor,
            null // No PPR promises
        )
        metrics.mark("complete")
        metrics.log()
    } catch (error) {
        console.error("SSR request handling failed:", error)

        // Fallback render
        await renderMarkUp(
            error.status_code || 500,
            req,
            res,
            [],
            fetcherData,
            store,
            matches,
            context,
            { js: [], css: [] },
            null,
            null
        )
    }
}

/**
 * middleware for document handling
 * @param {object} req - request object
 * @param {object} res - response object
 */
export default async function (req, res) {
    try {
        // creates store
        const store = validateConfigureStore(createStore) ? await createStore({}, req, res) : null

        // user defined routes
        const routes = validateGetRoutes(getRoutes) ? getRoutes() : []

        // Matches req url with routes
        const matches = getMatchRoutes(routes, req, res, store, {}, {}, undefined)
        const allMatches = NestedMatchRoutes(getRoutes(), req.baseUrl)

        // Choose handler based on PPR mode
        if (isPPREnabled()) {
            console.log(`[Render] PPR mode - ${req.originalUrl}`)
            await handlePPRRequest(req, res, store, routes, matches, allMatches)
        } else {
            console.log(`[Render] Streaming SSR mode - ${req.originalUrl}`)
            await handleSSRRequest(req, res, store, routes, matches, allMatches)
        }
    } catch (error) {
        console.error("Error in handling document request: " + error.toString())
    }
}
