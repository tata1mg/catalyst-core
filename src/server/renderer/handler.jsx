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
import { validateConfigureStore, validateGetRoutes, safeCall } from "../utils/validator.js"
import { ChunkExtractor } from "./ChunkExtractor.js"
import { withObservability, withSyncObservability } from "../../otel.js"
import {
    readCssFromDisk,
    generateScriptElements,
    generateCssLinkStrings,
    generateScriptStrings,
    registerDeferredAssetUrls,
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

// ── Route matching ─────────────────────────────────────────────────────
const _getMatchRoutes = (routes, req, res, store, context, fetcherData, basePath = "") => {
    return routes.reduce((matches, route) => {
        const { path } = route
        const match = matchPath(
            { path: `${basePath}/${path}`, caseSensitive: false, end: true },
            req.baseUrl || "/"
        )

        if (!match && route.children) {
            const nested = _getMatchRoutes(
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

const getMatchRoutes = withSyncObservability(SSR_SERVICE, _getMatchRoutes, "getMatchRoutes")

// ── Asset collection ───────────────────────────────────────────────────
const _collectAssets = (req, allMatches) => {
    const chunkExtractor = new ChunkExtractor({
        manifest: req.manifest || {},
        ssrManifest: req.ssrManifest || {},
        assetManifest: req.assetManifest || {},
    })

    // Add route-matched CSS/JS to critical bucket (loaded in <head>)
    chunkExtractor.preloadRouteCss(allMatches)

    return chunkExtractor
}

const collectAssets = withSyncObservability(SSR_SERVICE, _collectAssets, "collectAssets")

// ── JSX tree ───────────────────────────────────────────────────────────
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

// ── Render and stream ──────────────────────────────────────────────────
const _renderMarkUp = async (
    errorCode,
    req,
    res,
    metaTags,
    fetcherData,
    store,
    matches,
    context,
    chunkExtractor
) => {
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    const isBot = !!deviceDetails.googleBot

    // Critical assets → <head>
    const criticalAssets = chunkExtractor ? chunkExtractor.getCriticalAssets() : { js: [], css: [] }

    // Inline critical CSS from disk (small thanks to natural code-splitting)
    const buildDir = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build")
    const inlineCss = readCssFromDisk(criticalAssets.css, buildDir)

    const deferredRouteKey = getDeferredRouteKey(req)
    const deferredRouteInlineCss = readCssFromDisk(
        getCachedDeferredCssPathsForRoute(deferredRouteKey),
        buildDir
    )

    const jsScripts = generateScriptElements(criticalAssets.js)
    const criticalPreloadLinks = generateModulePreloadLinkElements(criticalAssets.js, "critical-js")
    const deferredPreloadUrls = getDeferredPreloadScriptUrls(criticalAssets.js)
    const deferredPreloadLinks = generateModulePreloadLinkElements(deferredPreloadUrls, "deferred-js")

    // Build Head props
    const shellStart = renderStart({
        inlineCss,
        deferredRouteInlineCss,
        jsScripts,
        criticalPreloadLinks,
        deferredPreloadLinks,
        metaTags,
        isBot,
        fetcherData,
    })

    const state = store.getState()
    const jsx = getComponent(store, context, req, fetcherData, isBot)
    const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)

    const finalProps = { ...shellStart, ...shellEnd, jsx, req, res }

    const CompleteDocument = () => {
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

    try {
        const status = errorCode || (matches.length && matches[0].match.path === "*" ? 404 : 200)
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

                    const { newCssPaths } = registerDeferredAssetsForRoute(deferredRouteKey, deferredAssets)
                    registerDeferredAssetUrls({ js: deferredAssets.js })
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

const tracedRenderMarkUp = withObservability(SSR_SERVICE, _renderMarkUp, "renderMarkUp")
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
 *   3. serverDataFetcher (route-level data fetching)
 *   4. renderMarkUp → renderToPipeableStream (stream to client)
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
        const routes = validateGetRoutes(getRoutes) ? getRoutes() : []

        const matches = getMatchRoutes(routes, req, res, store, context, fetcherData, undefined)
        const allMatches = NestedMatchRoutes(getRoutes(), req.baseUrl)
        let allTags = []

        safeCall(onRouteMatch, { req, res, matches, store })

        if (res.headersSent) return

        try {
            await tracedAppServerSideFunction({ store, req, res })
            safeCall(onAppServerSideSuccess, { req, res, store })

            if (res.headersSent) return

            try {
                fetcherData = await tracedServerDataFetcher(
                    { routes, req, res, url: req.originalUrl },
                    { store }
                )

                if (res.headersSent) return

                const err = fetcherData?.[req.originalUrl]?.error
                allTags = tracedGetMetaData(allMatches, fetcherData)
                const chunkExtractor = collectAssets(req, allMatches)

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
                        matches,
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
                        matches,
                        context,
                        chunkExtractor
                    )
                }
            } catch (error) {
                console.error("Error in executing serverFetcher functions:", error)
                safeCall(onFetcherError, { req, res, store, error })

                if (res.headersSent) return

                const chunkExtractor = collectAssets(req, allMatches)
                await tracedRenderMarkUp(
                    404,
                    req,
                    res,
                    allTags,
                    fetcherData,
                    store,
                    matches,
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
                matches,
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
