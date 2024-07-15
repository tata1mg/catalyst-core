import fs from "fs"
import path from "path"
import React from "react"
import render from "./render"

import extractAssets from "./extract"
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
            if (isProduction && !res.locals.pageCss && !res.locals.pageJS && !res.locals.routePath) {
                extractAssets(res, route)
            }
            if (!res.locals.pageCss && !res.locals.pageJS && !res.locals.routePath) {
                res.locals.routePath = path
                //moving routing logic outside of the App and using ServerRoutes for creating routes on server instead
                // renderToString(
                //     <ChunkExtractorManager extractor={webExtractor}>
                //     <Provider store={store}>
                //         <StaticRouter context={context} location={req.originalUrl}>
                //             <ServerRouter store={store} intialData={fetcherData} />
                //         </StaticRouter>
                //     </Provider>
                //     </ChunkExtractorManager>
                // )
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
const renderMarkUp = async (errorCode, req, res, metaTags, fetcherData, store, matches, context) => {
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    const isBot = deviceDetails.googleBot ? true : false

    // Transforms Head Props
    const shellStart = await render.renderStart(
        res.locals.pageCss,
        res.locals.pageJS,
        metaTags,
        isBot,
        fetcherData
    )

    let state = store.getState()

    // Transforms Body Props
    const shellEnd = render.renderEnd(null, state, res, null, errorCode, fetcherData)

    const finalProps = {
        ...shellStart,
        ...shellEnd,
        jsx: getComponent,
        req,
        res,
        store,
        context,
        req,
    }

    let CompleteDocument = () => {
        if (validateCustomDocument(CustomDocument)) {
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
                        firstFoldCss={finalProps.firstFoldCss}
                        firstFoldJS={finalProps.firstFoldJS}
                        jsx={finalProps.jsx}
                        statusCode={finalProps.statusCode}
                        fetcherData={finalProps.fetcherData}
                    />
                </html>
            )
        }
    }

    const getAssets = () => {
        let assetPath = `http://${process.env.WEBPACK_DEV_SERVER_HOSTNAME}:${process.env.WEBPACK_DEV_SERVER_PORT}/`
        let webStats = path.join(__dirname, "../../../", `chunk-groups.json`)

        if (isProduction) {
            webStats = path.join(
                process.env.src_path,
                `${process.env.BUILD_OUTPUT_PATH}/public/chunk-groups.json`
            )
            assetPath = `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}`
        }

        const statsFile = fs.readFileSync(webStats)
        if (statsFile) {
            const stats = JSON.parse(statsFile)
            return stats.namedChunkGroups?.["app"]?.assets?.map((asset) => `${assetPath}${asset.name}`) || []
        }
        return []
    }

    try {
        let status = matches.length && matches[0].match.path === "*" ? 404 : 200
        res.set({ "content-type": "text/html; charset=utf-8" })
        res.status(status)
        const { pipe } = renderToPipeableStream(<CompleteDocument />, {
            bootstrapScripts: getAssets(),
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
                            await renderMarkUp(null, req, res, allTags, fetcherData, store, matches, context)
                    )
                    .catch(async (error) => {
                        logger.error("Error in executing serverFetcher functions: " + error)
                        await renderMarkUp(404, req, res, allTags, fetcherData, store, matches, context)
                    })
            })
            .catch((error) => {
                logger.error("Error in executing serverSideFunction inside App: " + error)
                renderMarkUp(error.status_code, req, res, allTags, fetcherData, store, matches, context)
            })
    } catch (error) {
        logger.error("Error in handling document request: " + error.toString())
    }
}
