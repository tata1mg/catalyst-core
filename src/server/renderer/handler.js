import fs from "fs"
import path from "path"
import React from "react"

import Extractor from "./extractor"
import { Provider } from "react-redux"
import { Head, Body } from "./document"
import { StaticRouter } from "react-router-dom/server"
import ServerRouter from "@catalyst/router/ServerRouter.js"
import App from "@catalyst/template/src/js/containers/App/index.js"
import { renderToPipeableStream, renderToString } from "react-dom/server"
import { getUserAgentDetails } from "@catalyst/server/utils/userAgentUtil"
import { matchPath, serverDataFetcher, matchRoutes as NestedMatchRoutes, getMetaData } from "@tata1mg/router"
import {
    validateConfigureStore,
    validateCustomDocument,
    validateGetRoutes,
} from "@catalyst/server/utils/validator"

import CustomDocument from "@catalyst/template/server/document.js"
import { getRoutes } from "@catalyst/template/src/js/routes/utils.js"

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
const getMatchRoutes = (routes, req, res, store, context, fetcherData, basePath = "") => {
    return routes.reduce((matches, route) => {
        const { path } = route
        const match = matchPath(
            { path: `${basePath}/${path}`, caseSensitive: false, end: true },
            req.baseUrl || "/"
        )

        if (match) {
            matches.push({
                route,
                match,
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
                `${basePath}/${path}`
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
    extractor
) => {
    let state = store.getState()
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    const isBot = deviceDetails.googleBot ? true : false
    const status = matches.length && matches[0].match.path === "*" ? 404 : 200

    const { IS_DEV_COMMAND, WEBPACK_DEV_SERVER_HOSTNAME, WEBPACK_DEV_SERVER_PORT } = process.env

    let publicAssetPath = `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}`

    // serves assets from localhost on running devBuild and devServe command
    if (JSON.parse(IS_DEV_COMMAND)) {
        publicAssetPath = `http://${WEBPACK_DEV_SERVER_HOSTNAME}:${WEBPACK_DEV_SERVER_PORT}/assets/`
    }

    const pageCss = await extractor.getBootstrapCss()

    const finalProps = {
        lang: "",
        pageCss,
        isBot,
        fetcherData,
        metaTags,
        publicAssetPath,
        initialState: state,
        jsx: getComponent(store, context, req, fetcherData),
        statusCode: status,
        req,
        res,
        store,
        context,
    }

    let CompleteDocument = () => {
        if (validateCustomDocument(CustomDocument)) {
            return CustomDocument(finalProps)
        } else {
            return (
                <html lang={finalProps.lang}>
                    <Head
                        pageCss={finalProps.pageCss}
                        isBot={finalProps.isBot}
                        fetcherData={finalProps.fetcherData}
                        metaTags={finalProps.metaTags}
                        publicAssetPath={finalProps.publicAssetPath}
                    />
                    <Body
                        initialState={finalProps.initialState}
                        jsx={finalProps.jsx}
                        statusCode={finalProps.statusCode}
                        fetcherData={finalProps.fetcherData}
                        store={finalProps.store}
                        context={finalProps.context}
                        req={finalProps.req}
                    />
                </html>
            )
        }
    }

    try {
        res.set({ "content-type": "text/html; charset=utf-8" })
        res.status(status)
        const { pipe } = renderToPipeableStream(<CompleteDocument />, {
            bootstrapScripts: extractor.getBootstrapScripts(),
            onShellReady() {
                res.setHeader("content-type", "text/html")
                pipe(res)
                res.end()
            },
            onError(error) {
                logger.error({ message: `\n Error while renderToPipeableStream : ${error.toString()}` })
            },
        })
    } catch (error) {
        logger.error("Error in rendering document on server:" + error)
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

        // creates store
        const store = validateConfigureStore(createStore) ? createStore({}, req) : null

        // user defined routes
        const routes = validateGetRoutes(getRoutes) ? getRoutes() : []

        // Matches req url with routes
        const matches = getMatchRoutes(routes, req, res, store, context, fetcherData, undefined)
        const allMatches = NestedMatchRoutes(getRoutes(), req.baseUrl)
        let allTags = []
        const extractor = new Extractor({ entrypoint: "app" })

        // Executing app server side function
        App.serverSideFunction({ store, req, res })
            // Executing serverFetcher functions with serverDataFetcher provided by router and returning document
            .then(() => {
                serverDataFetcher({ routes: routes, req, res, url: req.originalUrl }, { store })
                    .then((res) => {
                        fetcherData = res
                        allTags = getMetaData(allMatches, fetcherData)
                    })
                    .then(
                        async () =>
                            await renderMarkUp(
                                null,
                                req,
                                res,
                                allTags,
                                fetcherData,
                                store,
                                matches,
                                context,
                                extractor
                            )
                    )
                    .catch(async (error) => {
                        logger.error("Error in executing serverFetcher functions: " + error)
                        await renderMarkUp(
                            404,
                            req,
                            res,
                            allTags,
                            fetcherData,
                            store,
                            matches,
                            context,
                            extractor
                        )
                    })
            })
            .catch((error) => {
                logger.error("Error in executing serverSideFunction inside App: " + error)
                renderMarkUp(
                    error.status_code,
                    req,
                    res,
                    allTags,
                    fetcherData,
                    store,
                    matches,
                    context,
                    extractor
                )
            })
    } catch (error) {
        logger.error("Error in handling document request: " + error.toString())
    }
}
