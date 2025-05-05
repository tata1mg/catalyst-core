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
                    />
                </html>
            )
        }
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
                    resolve()
                },
                onError(error) {
                    logger.error({ message: `\n Error while renderToPipeableStream : ${error.toString()}` })
                    // function defined by user which needs to run if rendering fails
                    safeCall(onRenderError)
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

        // Executing app server side function
        return (
            App.serverSideFunction({ store, req, res })
                // Executing serverFetcher functions with serverDataFetcher provided by router and returning document
                .then(() => {
                    return (
                        serverDataFetcher({ routes: routes, req, res, url: req.originalUrl }, { store })
                            .then((response) => {
                                fetcherData = response
                                allTags = getMetaData(allMatches, fetcherData)
                                // function defined by user which needs to run after SSR functions are executed
                                safeCall(onFetcherSuccess, { req, res, fetcherData })
                                return new Promise((resolve, reject) => {
                                    renderMarkUp(
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
                            })
                            // TODO: this is never called, serverDataFetcher never throws any error
                            .catch(async (error) => {
                                logger.error("Error in executing serverFetcher functions: " + error)
                                safeCall(onFetcherError, { req, res, error })
                                return new Promise((resolve, reject) => {
                                    renderMarkUp(
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
                            })
                    )
                })
                .catch((error) => {
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
                })
        )
    } catch (error) {
        logger.error("Error in handling document request: " + error.toString())
        // function defined by user which needs to run when an error occurs in the handler
        safeCall(onRequestError, { req, res, error })
        return Promise.reject(error)
    }
}
