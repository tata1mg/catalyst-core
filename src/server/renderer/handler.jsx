import React from "react"
import { renderStart, renderEnd } from "./render.js"
import { Provider } from "react-redux"
import { Body } from "./document/Body.jsx"
import { Head } from "./document/Head.jsx"

import { StaticRouter } from "react-router-dom/server"
import ServerRouter from "../../router/ServerRouter.js"
import { renderToPipeableStream, resumeToPipeableStream } from "react-dom/server"
import { prerenderToNodeStream } from "react-dom/static"
import { getUserAgentDetails } from "../utils/userAgentUtil.js"
import { serverDataFetcher, matchRoutes as NestedMatchRoutes, getMetaData } from "../../index.jsx"
import { validateConfigureStore, validateGetRoutes, safeCall } from "../utils/validator.js"
import { ChunkExtractor } from "./ChunkExtractor.js"
import {
    readCssFromDisk,
    generateScriptElements,
    generateCssLinkStrings,
    generateScriptStrings,
    getDeferredRouteKey,
    getCachedDeferredCssPathsForRoute,
    registerDeferredAssetsForRoute,
    getDeferredPreloadScriptUrls,
    generateModulePreloadLinkElements,
} from "./extract.js"
import path from "path"

import CustomDocument from "@catalyst/template/server/document"

import App from "@catalyst/template/src/js/containers/App/index"
import { getRoutes } from "@catalyst/template/src/js/routes/utils"
import createStore from "@catalyst/template/src/js/store/index.js"
import { SsrRequestProvider } from "../../web-router/components/SsrRequestContext.jsx"
import { getManifest, getAssetManifest } from "../manifestCache.js"
import { PPRDataProvider, getCachedData, clearPPRCache } from "../../web-router/components/DataFetcher.jsx"

// Routes are static for the lifetime of the server — resolve once and reuse
// the same instance per request to avoid per-request allocation.
let _cachedRoutes
const getCachedRoutes = () => {
    if (_cachedRoutes === undefined) {
        _cachedRoutes = validateGetRoutes(getRoutes) ? getRoutes() : null
    }
    return _cachedRoutes
}

// Try to import user-defined hooks. These are optional — apps that don't export them
// will get undefined, and safeCall is a no-op for non-functions.
let _onRouteMatch,
    _onFetcherSuccess,
    _onFetcherError,
    _onAppServerSideSuccess,
    _onAppServerSideError,
    _onRenderError,
    _onRequestError
try {
    const hooks = await import("@catalyst/template/server/index.js")
    _onRouteMatch = hooks.onRouteMatch
    _onFetcherSuccess = hooks.onFetcherSuccess
    _onFetcherError = hooks.onFetcherError
    _onAppServerSideSuccess = hooks.onAppServerSideSuccess
    _onAppServerSideError = hooks.onAppServerSideError
    _onRenderError = hooks.onRenderError
    _onRequestError = hooks.onRequestError
} catch {
    // No hooks file — all hooks remain undefined, safeCall will skip them
}

// Passthrough no-ops used when OTEL_ENABLE is not set; replaced below if enabled.
let withObservability = (_service, fn) => fn
let withSyncObservability = (_service, fn) => fn

if (process.env.OTEL_ENABLE === true) {
    try {
        const otel = await import("../../otel.js")
        withObservability = otel.withObservability
        withSyncObservability = otel.withSyncObservability
    } catch {
        // otel packages not installed — continue without tracing
    }
}

const SSR_SERVICE = process.env.SERVICE_NAME || `pwa-${process.env.APPLICATION}-node-server`

const traceHook = (fn, spanName) =>
    typeof fn === "function" ? withSyncObservability(SSR_SERVICE, fn, spanName) : fn

const onRouteMatch = traceHook(_onRouteMatch, "onRouteMatch")
const onFetcherSuccess = traceHook(_onFetcherSuccess, "onFetcherSuccess")
const onFetcherError = traceHook(_onFetcherError, "onFetcherError")
const onAppServerSideSuccess = traceHook(_onAppServerSideSuccess, "onAppServerSideSuccess")
const onAppServerSideError = traceHook(_onAppServerSideError, "onAppServerSideError")
const onRenderError = traceHook(_onRenderError, "onRenderError")
const onRequestError = traceHook(_onRequestError, "onRequestError")

// ── PPR (Partial Prerendering) ───────────────────────────────────────────
// Prerendered-shell cache, keyed by pathname. Only the static shell (parts
// that don't suspend) ends up in the cached prelude — anything reading data
// via usePPRRouteData() suspends and is postponed, so it's always resolved
// fresh per request on resume. That's what makes caching the prelude across
// different users' requests to the same route safe.
const prerenderCache = new Map()
export const clearPrerenderCache = () => prerenderCache.clear()

const isPPREnabled = () => process.env.ENABLE_PPR === "true"

function collectStream(stream) {
    return new Promise((resolve, reject) => {
        const chunks = []
        stream.on("data", (chunk) => chunks.push(chunk))
        stream.on("end", () => resolve(Buffer.concat(chunks)))
        stream.on("error", reject)
    })
}

// ── Asset collection ───────────────────────────────────────────────────
const _collectAssets = (req, allMatches) => {
    const chunkExtractor = new ChunkExtractor({
        manifest: getManifest() || {},
        assetManifest: getAssetManifest() || {},
    })

    // Add route-matched CSS/JS to critical bucket (loaded in <head>)
    chunkExtractor.preloadRouteCss(allMatches)

    return chunkExtractor
}

const collectAssets = withSyncObservability(SSR_SERVICE, _collectAssets, "collectAssets")

// ── JSX tree (classic, fully pre-fetched render) ────────────────────────
const getComponent = (store, context, req, fetcherData, isBot) => (
    <div id="app">
        <SsrRequestProvider value={{ isBot }}>
            <Provider store={store}>
                <StaticRouter context={context} location={req.originalUrl}>
                    <ServerRouter store={store} intialData={fetcherData} />
                </StaticRouter>
            </Provider>
        </SsrRequestProvider>
    </div>
)

// ── JSX tree (PPR — data resolved lazily via usePPRRouteData/use()) ─────
const getPPRComponent = (store, req, isBot, phase, controller, cacheKey) => (
    <div id="app">
        <SsrRequestProvider value={{ isBot }}>
            <PPRDataProvider phase={phase} controller={controller} cacheKey={cacheKey}>
                <Provider store={store}>
                    <StaticRouter context={{}} location={req.originalUrl}>
                        <ServerRouter store={store} intialData={{}} />
                    </StaticRouter>
                </Provider>
            </PPRDataProvider>
        </SsrRequestProvider>
    </div>
)

// Shared <head>/<body> props derived from a ChunkExtractor + route, used by both render paths.
const buildShellStart = (req, allMatches, chunkExtractor, metaTags, isBot, fetcherData) => {
    const criticalAssets = chunkExtractor ? chunkExtractor.getCriticalAssets() : { js: [], css: [] }

    const buildDir = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build")
    const inlineCss = readCssFromDisk(criticalAssets.css, buildDir)

    const deferredRouteKey = getDeferredRouteKey(req, allMatches)
    const deferredRouteInlineCss = readCssFromDisk(
        getCachedDeferredCssPathsForRoute(deferredRouteKey),
        buildDir
    )

    const jsScripts = generateScriptElements(criticalAssets.js)
    const criticalPreloadLinks = generateModulePreloadLinkElements(criticalAssets.js, "critical-js")
    const deferredPreloadUrls = getDeferredPreloadScriptUrls(deferredRouteKey, criticalAssets.js)
    const deferredPreloadLinks = generateModulePreloadLinkElements(deferredPreloadUrls, "deferred-js")

    return {
        deferredRouteKey,
        buildDir,
        shellStart: renderStart({
            inlineCss,
            deferredRouteInlineCss,
            jsScripts,
            criticalPreloadLinks,
            deferredPreloadLinks,
            metaTags,
            isBot,
            fetcherData,
        }),
    }
}

const renderDocument = (finalProps) => {
    if (CustomDocument) {
        return CustomDocument(finalProps)
    }
    return (
        <html lang={finalProps.lang}>
            <Head
                isBot={finalProps.isBot}
                inlineCss={finalProps.inlineCss}
                deferredRouteInlineCss={finalProps.deferredRouteInlineCss}
                jsScripts={finalProps.jsScripts}
                criticalPreloadLinks={finalProps.criticalPreloadLinks}
                deferredPreloadLinks={finalProps.deferredPreloadLinks}
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

// ── Render and stream (classic — fully pre-fetched, single pass) ────────
const _renderMarkUp = async (
    errorCode,
    req,
    res,
    metaTags,
    fetcherData,
    store,
    allMatches,
    context,
    chunkExtractor
) => {
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    // Match mweb's wider definition: synthetic monitors (StatusCake) and AI crawlers
    // also need the bot code path — no JS, and split(... ssr: false ...) widgets that
    // previously read state.shellReducer.isBot now read this via SsrRequestContext.
    const isBot = !!(deviceDetails.googleBot || deviceDetails.aiBot || deviceDetails.statusCakeBot)

    const { deferredRouteKey, buildDir, shellStart } = buildShellStart(
        req,
        allMatches,
        chunkExtractor,
        metaTags,
        isBot,
        fetcherData
    )

    const state = store.getState()
    const jsx = getComponent(store, context, req, fetcherData, isBot)
    const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)

    const finalProps = { ...shellStart, ...shellEnd, jsx, req, res }

    const CompleteDocument = () => renderDocument(finalProps)

    try {
        const status = errorCode || (allMatches.length && allMatches[0]?.route?.path === "*" ? 404 : 200)
        res.set({ "content-type": "text/html; charset=utf-8" })
        res.status(status)

        return new Promise((resolve, reject) => {
            const { pipe } = renderToPipeableStream(<CompleteDocument />, {
                onShellReady() {
                    res.setHeader("content-type", "text/html")
                    pipe(res)
                },

                onAllReady() {
                    // Deferred assets — injected after body (non-blocking)
                    const deferredAssets = chunkExtractor
                        ? chunkExtractor.getDeferredAssets()
                        : { js: [], css: [] }

                    // Tell client which components were SSR'd so split() can
                    // eagerly import them (prevents Suspense fallback flash)
                    res.write(`<script>window.__CATALYST_IS_BOT__=${isBot ? "true" : "false"};</script>`)
                    if (chunkExtractor) {
                        const renderedKeys = chunkExtractor.getRenderedComponentKeys()
                        res.write(
                            `<script>window.__SSR_RENDERED_COMPONENTS__=new Set(${JSON.stringify(renderedKeys)})</script>`
                        )
                    }

                    const { newCssPaths } = registerDeferredAssetsForRoute(
                        deferredRouteKey,
                        deferredAssets,
                        isBot
                    )
                    if (newCssPaths.length) {
                        res.write(`<style>${readCssFromDisk(newCssPaths, buildDir)}</style>`)
                    }
                    if (!isBot) {
                        res.write(generateScriptStrings(deferredAssets.js))
                    }

                    res.end()
                    resolve()
                },

                onError(error) {
                    console.error("Error in renderToPipeableStream:", error)
                    safeCall(onRenderError, { req, res, store, error })
                    reject(error)
                },
            })
        })
    } catch (error) {
        console.error("Error in rendering document on server:", error)
        safeCall(onRenderError, { req, res, store, error })
        return Promise.reject(error)
    }
}

// ── Render and stream (PPR — prerender + cache shell, resume per request) ─
const _renderMarkUpPPR = async (req, res, metaTags, store, allMatches, chunkExtractor) => {
    const url = req.originalUrl
    const cacheKey = new URL(url, `http://${req.headers.host}`).pathname
    const isBot = false // PPR path is only ever taken for non-bot requests (see _handler)

    const { shellStart } = buildShellStart(req, allMatches, chunkExtractor, metaTags, isBot, {})

    const AppDocument = ({ phase, controller }) => {
        const jsx = getPPRComponent(store, req, isBot, phase, controller, cacheKey)
        const state = store.getState()
        const shellEnd = renderEnd(state, res, jsx, null, {})
        const finalProps = { ...shellStart, ...shellEnd, jsx, req, res }
        return renderDocument(finalProps)
    }

    const status = allMatches.length && allMatches[0]?.route?.path === "*" ? 404 : 200
    res.status(status)
    res.setHeader("content-type", "text/html; charset=utf-8")

    const writeStreamTrailers = () => {
        const cachedData = getCachedData(cacheKey)
        if (cachedData && Object.keys(cachedData).length > 0) {
            res.write(`<script>window.cachedData=${JSON.stringify({ [cacheKey]: cachedData })}</script>`)
        }

        const deferredAssets = chunkExtractor ? chunkExtractor.getDeferredAssets() : { js: [], css: [] }
        res.write(`<script>window.__NON_ESSENTIAL_CHUNKS__=${JSON.stringify(deferredAssets)}</script>`)
        if (chunkExtractor) {
            const renderedKeys = chunkExtractor.getRenderedComponentKeys()
            res.write(
                `<script>window.__SSR_RENDERED_COMPONENTS__=new Set(${JSON.stringify(renderedKeys)})</script>`
            )
        }
    }

    const resumeAndStream = (element, postponedState, renderingMode, prelude) =>
        new Promise((resolve, reject) => {
            try {
                const { pipe } = resumeToPipeableStream(element, postponedState, {
                    onShellReady() {
                        res.setHeader("x-rendering-mode", renderingMode)
                        if (prelude) {
                            res.write(prelude)
                            // Flush immediately — compression middleware buffers otherwise
                            if (typeof res.flush === "function") res.flush()
                        }
                    },
                    onShellError(error) {
                        console.error(`[PPR] Shell error for ${url}:`, error)
                        safeCall(onRenderError, { req, res, store, error })
                        reject(error)
                    },
                    onAllReady() {
                        writeStreamTrailers()
                        pipe(res)
                        clearPPRCache()
                        res.end()
                        resolve()
                    },
                    onError(error) {
                        clearPPRCache()
                        console.error(`[PPR] Streaming error for ${url}:`, error)
                        safeCall(onRenderError, { req, res, store, error })
                        reject(error)
                    },
                })
            } catch (error) {
                console.warn(`[PPR] Resume failed for ${url}:`, error.message)
                safeCall(onRenderError, { req, res, store, error })
                res.end()
                resolve()
            }
        })

    const cached = prerenderCache.get(cacheKey)

    if (cached) {
        return resumeAndStream(
            <AppDocument phase="resume" />,
            JSON.parse(cached.postponeBuffer),
            "resumeToPipeableStream",
            cached.preludeBuffer
        )
    }

    // Cache miss — prerender the shell once, cache it, then resume immediately for this request
    try {
        const controller = new AbortController()
        const result = await prerenderToNodeStream(<AppDocument controller={controller} phase="prerender" />, {
            signal: controller.signal,
        })

        const preludeBuffer = result.prelude ? await collectStream(result.prelude) : null
        const postponeBuffer = result.postponed ? JSON.stringify(result.postponed) : null
        prerenderCache.set(cacheKey, { preludeBuffer, postponeBuffer })

        return resumeAndStream(<AppDocument phase="1st Req" />, JSON.parse(postponeBuffer), "1st Req", preludeBuffer)
    } catch (error) {
        console.warn(`[PPR] Prerender failed for ${url}:`, error.message)
        safeCall(onRenderError, { req, res, store, error })
        if (!res.headersSent) {
            res.status(500).send("Internal Server Error")
        } else {
            res.end()
        }
    }
}

const tracedRenderMarkUp = withObservability(SSR_SERVICE, _renderMarkUp, "renderMarkUp")
const tracedRenderMarkUpPPR = withObservability(SSR_SERVICE, _renderMarkUpPPR, "renderMarkUpPPR")
const tracedAppServerSideFunction = withObservability(
    SSR_SERVICE,
    (args) => App.serverSideFunction(args),
    "App.serverSideFunction"
)
const tracedServerDataFetcher = withObservability(SSR_SERVICE, serverDataFetcher, "serverDataFetcher")
const tracedGetMetaData = withSyncObservability(SSR_SERVICE, getMetaData, "getMetaData")

// ── Express middleware ──────────────────────────────────────────────────
/**
 * SSR request handler. Execution pipeline per request:
 *   1. Match route → collect assets
 *   2. App.serverSideFunction (app-level server hook)
 *   3a. PPR path (non-bot, ENABLE_PPR=true): skip upfront data fetch — render via
 *       prerenderToNodeStream/resumeToPipeableStream, data is resolved lazily inside
 *       the tree via usePPRRouteData()/use(). The static shell is cached per-route;
 *       postponed (dynamic/personalized) content is always resolved fresh per request.
 *   3b. Classic path (bots, or PPR disabled): serverDataFetcher pre-fetches all route
 *       data, then renderToPipeableStream renders the fully-resolved tree in one pass.
 *
 * res.headersSent is checked after each async step: if a user hook
 * (onRouteMatch, onFetcherSuccess, etc.) has already sent a response
 * (e.g. a redirect), we bail out early without attempting another render.
 */
async function _handler(req, res) {
    try {
        let context = {}
        let fetcherData = {}
        const store = validateConfigureStore(createStore) ? await createStore({}, req, res) : null

        const cachedRoutes = getCachedRoutes()
        const allMatches = cachedRoutes ? NestedMatchRoutes(cachedRoutes, req.baseUrl) : []
        let allTags = []

        safeCall(onRouteMatch, { req, res, matches: allMatches, store })

        if (res.headersSent) return

        try {
            await tracedAppServerSideFunction({ store, req, res })
            safeCall(onAppServerSideSuccess, { req, res, store })

            if (res.headersSent) return

            const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
            const isBot = !!(deviceDetails.googleBot || deviceDetails.aiBot || deviceDetails.statusCakeBot)
            const chunkExtractor = collectAssets(req, allMatches)

            if (!isBot && isPPREnabled()) {
                allTags = tracedGetMetaData(allMatches, {})
                await tracedRenderMarkUpPPR(req, res, allTags, store, allMatches, chunkExtractor)
                return
            }

            try {
                fetcherData = await tracedServerDataFetcher(
                    { routes: cachedRoutes, req, res, url: req.originalUrl },
                    { store }
                )

                if (res.headersSent) return

                const err = fetcherData?.[req.originalUrl]?.error
                allTags = tracedGetMetaData(allMatches, fetcherData)

                if (err) {
                    safeCall(onFetcherError, { req, res, store, error: err })

                    if (res.headersSent) return

                    const statusCode = err.status_code || 404
                    await tracedRenderMarkUp(
                        statusCode,
                        req,
                        res,
                        allTags,
                        fetcherData,
                        store,
                        allMatches,
                        context,
                        chunkExtractor
                    )
                } else {
                    safeCall(onFetcherSuccess, { req, res, store })

                    if (res.headersSent) return

                    await tracedRenderMarkUp(
                        null,
                        req,
                        res,
                        allTags,
                        fetcherData,
                        store,
                        allMatches,
                        context,
                        chunkExtractor
                    )
                }
            } catch (error) {
                console.error("Error in executing serverFetcher functions:", error)
                safeCall(onFetcherError, { req, res, store, error })

                if (res.headersSent) return

                await tracedRenderMarkUp(
                    404,
                    req,
                    res,
                    allTags,
                    fetcherData,
                    store,
                    allMatches,
                    context,
                    chunkExtractor
                )
            }
        } catch (error) {
            console.error("Error in executing serverSideFunction inside App:", error)
            safeCall(onAppServerSideError, { req, res, store, error })

            if (res.headersSent) return

            const chunkExtractor = collectAssets(req, allMatches)
            await tracedRenderMarkUp(
                error.status_code,
                req,
                res,
                allTags,
                fetcherData,
                store,
                allMatches,
                context,
                chunkExtractor
            )
        }
    } catch (error) {
        console.error("Error in handling document request:", error)
        safeCall(onRequestError, { req, res, error })
    }
}

const handler = withObservability(SSR_SERVICE, _handler, "handler")

export default handler
