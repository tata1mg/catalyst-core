import fs from "fs"
import path from "path"
import React from "react"

import extractAssets, { cacheAndFetchAssets } from "./extract"
import { withObservability, withSyncObservability } from "../../otel"
import { Provider } from "react-redux"
import { Head, Body } from "./document"
import { StaticRouter } from "react-router-dom/server"
import ServerRouter from "@catalyst/router/ServerRouter.js"
import App from "@catalyst/template/src/js/containers/App/index.js"
import { ChunkExtractor, ChunkExtractorManager } from "@loadable/server"
import { renderToPipeableStream, renderToString } from "react-dom/server"
import { getUserAgentDetails } from "@catalyst/server/utils/userAgentUtil"
import { matchPath, serverDataFetcher, matchRoutes as NestedMatchRoutes, getMetaData } from "@tata1mg/router"
import {
    validateConfigureStore,
    validateCustomDocument,
    validateGetRoutes,
    safeCall,
} from "@catalyst/server/utils/validator"

import CustomDocument from "@catalyst/template/server/document.js"
import { getRoutes } from "@catalyst/template/src/js/routes/utils.js"
import {
    onRouteMatch as _onRouteMatch,
    onFetcherSuccess as _onFetcherSuccess,
    onFetcherError as _onFetcherError,
    onRenderError as _onRenderError,
    onRequestError as _onRequestError,
} from "@catalyst/template/server/index.js"

const SSR_SERVICE = process.env.SERVICE_NAME || `pwa-${process.env.APPLICATION}-node-server-otel`

const traceHandlerHook = (fn, spanName) =>
    typeof fn === "function" ? withSyncObservability(SSR_SERVICE, fn, spanName) : fn

const onRouteMatch = traceHandlerHook(_onRouteMatch, "onRouteMatch")
const onFetcherSuccess = traceHandlerHook(_onFetcherSuccess, "onFetcherSuccess")
const onFetcherError = traceHandlerHook(_onFetcherError, "onFetcherError")
const onRenderError = traceHandlerHook(_onRenderError, "onRenderError")
const onRequestError = traceHandlerHook(_onRequestError, "onRequestError")

const storePath = path.resolve(`${process.env.src_path}/src/js/store/index.js`)

let createStore

if (fs.existsSync(storePath)) {
    try {
        const { default: configureStore } = require(`${process.env.src_path}/src/js/store/index.js`)
        createStore = configureStore
    } catch (error) {
        createStore = () => {
            return {
                getState: () => {},
            }
        }
    }
} else {
    createStore = () => {
        return { getState: () => {} }
    }
}

const isProduction = process.env.NODE_ENV === "production"
const DEFAULT_SAFE_AREA_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

const parseSafeAreaFromHeaders = (req) => {
    const readEdge = (header) => {
        const raw = req.get(header) ?? req.headers[header.toLowerCase()]
        const value = Number(raw)
        return Number.isFinite(value) && value >= 0 ? value : null
    }

    const top = readEdge("X-Safe-Area-Top")
    const right = readEdge("X-Safe-Area-Right")
    const bottom = readEdge("X-Safe-Area-Bottom")
    const left = readEdge("X-Safe-Area-Left")

    const hasAny = [top, right, bottom, left].some((value) => value !== null)
    if (!hasAny) {
        return null
    }

    return {
        top: top ?? 0,
        right: right ?? 0,
        bottom: bottom ?? 0,
        left: left ?? 0,
    }
}

// Dry-run render wrapped separately so it appears as a distinct span within getMatchRoutes.
const renderToStringWithObservability = withSyncObservability(
    SSR_SERVICE,
    function dryRunRender(webExtractor, store, context, req, fetcherData) {
        renderToString(
            <ChunkExtractorManager extractor={webExtractor}>
                <Provider store={store}>
                    <StaticRouter context={context} location={req.originalUrl}>
                        <ServerRouter store={store} intialData={fetcherData} />
                    </StaticRouter>
                </Provider>
            </ChunkExtractorManager>
        )
    },
    "renderToString"
)

// Internal recursive implementation — called directly to avoid creating a new span per recursion.
const _getMatchRoutes = (routes, req, res, store, context, fetcherData, basePath = "", webExtractor) => {
    return routes.reduce((matches, route) => {
        const { path } = route
        const match = matchPath(
            { path: `${basePath}/${path}`, caseSensitive: false, end: true },
            req.baseUrl || "/"
        )

        if (match) {
            if (!res.locals.pageCss && !res.locals.preloadJSLinks && !res.locals.routePath) {
                res.locals.routePath = path
                extractAssets(res, route)
            }
            if (!res.locals.pageCss && !res.locals.preloadJSLinks) {
                //moving routing logic outside of the App and using ServerRoutes for creating routes on server instead
                renderToStringWithObservability(webExtractor, store, context, req, fetcherData)
            }
            const wc = route.component
            matches.push({
                route,
                match,
                serverSideFunction: (wc && wc.serverSideFunction) || (() => Promise.resolve()),
            })
        }
        if (!match && route.children) {
            // recursively try to match nested routes
            const nested = _getMatchRoutes(
                route.children,
                req,
                res,
                store,
                context,
                fetcherData,
                `${basePath}/${path}`,
                webExtractor
            )
            if (nested.length) {
                matches = matches.concat(nested)
            }
        }

        return matches
    }, [])
}

const getMatchRoutes = withSyncObservability(SSR_SERVICE, _getMatchRoutes, "getMatchRoutes")

const tracedResWriteFirstFoldCss = withSyncObservability(
    SSR_SERVICE,
    (res, chunk) => res.write(chunk),
    "res.write.firstFoldCss"
)
const tracedResWriteFirstFoldJS = withSyncObservability(
    SSR_SERVICE,
    (res, chunk) => res.write(chunk),
    "res.write.firstFoldJS"
)
const tracedResEnd = withSyncObservability(SSR_SERVICE, (res) => res.end(), "res.end")

// Preloads chunks required for rendering document
const getComponent = (store, context, req, fetcherData) => {
    return (
        <div id="app">
            <Provider store={store}>
                <StaticRouter context={context} location={req.originalUrl}>
                    <ServerRouter store={store} intialData={fetcherData} />
                </StaticRouter>
            </Provider>
        </div>
    )
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
    webExtractor
) => {
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    const isBot = deviceDetails.googleBot ? true : false

    const safeArea = parseSafeAreaFromHeaders(req) || { ...DEFAULT_SAFE_AREA_INSETS }

    // Set in globalThis for hooks to access during SSR
    /* eslint-disable no-undef */
    const previousSafeArea = globalThis.__SAFE_AREA_INITIAL__
    globalThis.__SAFE_AREA_INITIAL__ = safeArea
    /* eslint-enable no-undef */

    let state = store.getState()

    const jsx = webExtractor.collectChunks(getComponent(store, context, req, fetcherData))

    const { IS_DEV_COMMAND, WEBPACK_DEV_SERVER_HOSTNAME, WEBPACK_DEV_SERVER_PORT } = process.env
    let publicAssetPath = `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}`

    // serves assets from localhost on running devBuild and devServe command
    if (IS_DEV_COMMAND === "true") {
        publicAssetPath = `http://${WEBPACK_DEV_SERVER_HOSTNAME}:${WEBPACK_DEV_SERVER_PORT}/assets/`
    }

    const finalProps = {
        req,
        res,
        lang: "en",
        pageCss: res.locals.pageCss,
        preloadJSLinks: res.locals.preloadJSLinks,
        metaTags,
        isBot,
        publicAssetPath,
        jsx,
        initialState: state,
        fetcherData,
        safeArea,
    }

    let CompleteDocument = () => {
        if (validateCustomDocument(CustomDocument)) {
            return CustomDocument(finalProps)
        } else {
            return (
                <html lang={finalProps.lang}>
                    <Head
                        isBot={finalProps.isBot}
                        pageCss={finalProps.pageCss}
                        metaTags={finalProps.metaTags}
                        preloadJSLinks={finalProps.preloadJSLinks}
                        publicAssetPath={finalProps.publicAssetPath}
                    />
                    <Body
                        jsx={finalProps.jsx}
                        fetcherData={finalProps.fetcherData}
                        initialState={finalProps.initialState}
                        safeArea={finalProps.safeArea}
                    />
                </html>
            )
        }
    }

    // Helper to cleanup globalThis after rendering completes
    const cleanupGlobalThis = () => {
        /* eslint-disable no-undef */
        if (previousSafeArea === undefined) {
            delete globalThis.__SAFE_AREA_INITIAL__
        } else {
            globalThis.__SAFE_AREA_INITIAL__ = previousSafeArea
        }
        /* eslint-enable no-undef */
    }

    try {
        let status = matches.length && matches[0].match.path === "*" ? 404 : 200
        res.set({ "content-type": "text/html; charset=utf-8" })
        res.status(status)

        return new Promise((resolve, reject) => {
            const { pipe } = renderToPipeableStream(<CompleteDocument />, {
                onShellReady() {
                    res.setHeader("content-type", "text/html")
                    pipe(res)
                },
                onAllReady() {
                    const { firstFoldCss, firstFoldJS } = cacheAndFetchAssets({ webExtractor, res, isBot })
                    tracedResWriteFirstFoldCss(res, firstFoldCss)
                    tracedResWriteFirstFoldJS(res, firstFoldJS)
                    tracedResEnd(res)
                    cleanupGlobalThis()
                    resolve()
                },
                onError(error) {
                    logger.error({ message: `\n Error while renderToPipeableStream : ${error.toString()}` })
                    // function defined by user which needs to run if rendering fails
                    safeCall(onRenderError)
                    cleanupGlobalThis()
                    reject(error)
                },
            })
        })
    } catch (error) {
        logger.error({
            message: `Error in rendering document on server - ${error}`,
            trace: error.stack,
            url: req.originalUrl,
        })
        // function defined by user which needs to run if rendering fails
        safeCall(onRenderError)
        cleanupGlobalThis()
        return Promise.reject(error)
    }
}

const tracedAppServerSideFunction = withObservability(
    SSR_SERVICE,
    (args) => App.serverSideFunction(args),
    "App.serverSideFunction"
)
const tracedServerDataFetcher = withObservability(SSR_SERVICE, serverDataFetcher, "serverDataFetcher")
const tracedRenderMarkUp = withObservability(SSR_SERVICE, renderMarkUp, "renderMarkUp")
const tracedGetMetaData = withSyncObservability(SSR_SERVICE, getMetaData, "getMetaData")

/**
 * middleware for document handling
 * @param {object} req - request object
 * @param {object} res - response object
 */
async function _handler(req, res) {
    try {
        let context = {}
        let fetcherData = {}

        let webStats = path.join(__dirname, "../../..", `loadable-stats.json`)

        if (isProduction) {
            webStats = path.join(
                process.env.src_path,
                `${process.env.BUILD_OUTPUT_PATH}/public/loadable-stats.json`
            )
        }

        const webExtractor = new ChunkExtractor({
            statsFile: webStats,
            entrypoints: ["app"],
        })

        // creates store
        const store = validateConfigureStore(createStore) ? createStore({}, req, res) : null

        // user defined routes
        const routes = validateGetRoutes(getRoutes) ? getRoutes() : []

        // Matches req url with routes
        const matches = getMatchRoutes(routes, req, res, store, context, fetcherData, undefined, webExtractor)
        const allMatches = NestedMatchRoutes(getRoutes(), req.baseUrl)
        let allTags = []

        // function defined by user which needs to run after route is matched
        safeCall(onRouteMatch, { req, res, matches })

        if (res.headersSent) {
            return Promise.resolve(res)
        }

        try {
            // Executing app server side function
            await tracedAppServerSideFunction({ store, req, res })

            if (res.headersSent) {
                return Promise.resolve(res)
            }

            try {
                // Executing serverFetcher functions with serverDataFetcher provided by router and returning document
                fetcherData = await tracedServerDataFetcher(
                    { routes: routes, req, res, url: req.originalUrl },
                    { store }
                )

                if (res.headersSent) {
                    return Promise.resolve(res)
                }

                allTags = tracedGetMetaData(allMatches, fetcherData)

                // function defined by user which needs to run after SSR functions are executed
                safeCall(onFetcherSuccess, { req, res, fetcherData })

                if (res.headersSent) {
                    return Promise.resolve(res)
                }

                return new Promise((resolve, reject) => {
                    tracedRenderMarkUp(
                        null,
                        req,
                        res,
                        allTags,
                        fetcherData,
                        store,
                        matches,
                        context,
                        webExtractor
                    )
                        .then(resolve)
                        .catch(reject)
                })
            } catch (error) {
                // TODO: serverDataFetcher never throws any error
                logger.error("Error in executing serverFetcher functions: " + error)
                safeCall(onFetcherError, { req, res, error })

                if (res.headersSent) {
                    return Promise.reject(error)
                }

                return new Promise((resolve, reject) => {
                    tracedRenderMarkUp(
                        404,
                        req,
                        res,
                        allTags,
                        fetcherData,
                        store,
                        matches,
                        context,
                        webExtractor
                    )
                        .then(resolve)
                        .catch(reject)
                })
            }
        } catch (error) {
            logger.error("Error in executing serverSideFunction inside App: " + error)
            return new Promise((resolve, reject) => {
                tracedRenderMarkUp(
                    error.status_code,
                    req,
                    res,
                    allTags,
                    fetcherData,
                    store,
                    matches,
                    context,
                    webExtractor
                )
                    .then(resolve)
                    .catch(reject)
            })
        }
    } catch (error) {
        logger.error("Error in handling document request: " + error.toString())
        // function defined by user which needs to run when an error occurs in the handler
        safeCall(onRequestError, { req, res, error })
        return Promise.reject(error)
    }
}

const handler = withObservability(SSR_SERVICE, _handler, "handler")

export default handler
