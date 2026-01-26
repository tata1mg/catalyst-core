import fs from "fs"
import path from "path"
import React from "react"

import extractAssets, { cacheAndFetchAssets } from "./extract"
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
    onRouteMatch,
    onFetcherSuccess,
    onFetcherError,
    onRenderError,
    onRequestError,
} from "@catalyst/template/server/index.js"

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

// Cache webStats path - computed once at module load
const webStatsPath = isProduction
    ? path.join(process.env.src_path, `${process.env.BUILD_OUTPUT_PATH}/public/loadable-stats.json`)
    : path.join(__dirname, "../../..", `loadable-stats.json`)

// Cache ChunkExtractor in production - stats file doesn't change after build
// This avoids reading and parsing the stats file on every request
let cachedWebExtractor = null
const getWebExtractor = () => {
    if (isProduction) {
        if (!cachedWebExtractor) {
            cachedWebExtractor = new ChunkExtractor({
                statsFile: webStatsPath,
                entrypoints: ["app"],
            })
        }
        return cachedWebExtractor
    }
    // In development, create new extractor each time (stats file may change)
    return new ChunkExtractor({
        statsFile: webStatsPath,
        entrypoints: ["app"],
    })
}

// Cache routes array - getRoutes() returns same reference, but validate once
let cachedRoutes = null
const getCachedRoutes = () => {
    if (!cachedRoutes) {
        cachedRoutes = validateGetRoutes(getRoutes) ? getRoutes() : []
    }
    return cachedRoutes
}

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

// matches request route with routes defined in the application.
const getMatchRoutes = (routes, req, res, store, context, fetcherData, basePath = "", webExtractor) => {
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
                renderToString(
                    <ChunkExtractorManager extractor={webExtractor}>
                        <Provider store={store}>
                            <StaticRouter context={context} location={req.originalUrl}>
                                <ServerRouter store={store} intialData={fetcherData} />
                            </StaticRouter>
                        </Provider>
                    </ChunkExtractorManager>
                )
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
            const nested = getMatchRoutes(
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

    // Extract res.locals once to avoid passing full res object to document
    // This reduces memory footprint as document only needs these specific values
    const resLocals = {
        pageCss: res.locals.pageCss,
        preloadJSLinks: res.locals.preloadJSLinks,
        isWebView: res.locals.isWebView,
        isLegacyWebView: res.locals.isLegacyWebView,
        cspNonce: res.locals.cspNonce,
        affiliateConfig: res.locals.affiliateConfig,
        requestCookies: res.locals.requestCookies,
        customHeaders: res.locals.customHeaders,
    }

    const finalProps = {
        req,
        res,
        resLocals, // Extracted res.locals for document.js optimization
        lang: "en",
        pageCss: resLocals.pageCss,
        preloadJSLinks: resLocals.preloadJSLinks,
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
                    res.write(firstFoldCss)
                    res.write(firstFoldJS)
                    res.end()
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

/**
 * middleware for document handling
 * @param {object} req - request object
 * @param {object} res - response object
 */
export default async function (req, res) {
    try {
        let context = {}
        let fetcherData = {}

        // Use cached webExtractor (in production) to avoid reading/parsing stats file per request
        const webExtractor = getWebExtractor()

        // creates store
        const store = validateConfigureStore(createStore) ? createStore({}, req, res) : null

        // Use cached routes to avoid repeated validation
        const routes = getCachedRoutes()

        // Matches req url with routes
        const matches = getMatchRoutes(routes, req, res, store, context, fetcherData, undefined, webExtractor)
        const allMatches = NestedMatchRoutes(routes, req.baseUrl)
        let allTags = []

        // function defined by user which needs to run after route is matched
        safeCall(onRouteMatch, { req, res, matches })

        if (res.headersSent) {
            return Promise.resolve(res)
        }

        try {
            // Executing app server side function
            await App.serverSideFunction({ store, req, res })

            if (res.headersSent) {
                return Promise.resolve(res)
            }

            try {
                // Executing serverFetcher functions with serverDataFetcher provided by router and returning document
                fetcherData = await serverDataFetcher(
                    { routes: routes, req, res, url: req.originalUrl },
                    { store }
                )

                if (res.headersSent) {
                    return Promise.resolve(res)
                }

                allTags = getMetaData(allMatches, fetcherData)

                // function defined by user which needs to run after SSR functions are executed
                safeCall(onFetcherSuccess, { req, res, fetcherData })

                if (res.headersSent) {
                    return Promise.resolve(res)
                }

                return new Promise((resolve, reject) => {
                    renderMarkUp(null, req, res, allTags, fetcherData, store, matches, context, webExtractor)
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
                    renderMarkUp(404, req, res, allTags, fetcherData, store, matches, context, webExtractor)
                        .then(resolve)
                        .catch(reject)
                })
            }
        } catch (error) {
            logger.error("Error in executing serverSideFunction inside App: " + error)
            return new Promise((resolve, reject) => {
                renderMarkUp(
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
