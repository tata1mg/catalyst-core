import fs from "fs"
import path from "path"
import React from "react"
import { renderStart, renderEnd } from "./render.js"
// import extractAssets from "./extract.js"
import { Provider } from "react-redux"
import { Body } from "./document/Body.jsx"
import { Head } from "./document/Head.jsx"

import { StaticRouter } from "react-router-dom/server"
import ServerRouter from "../../router/ServerRouter.js"
// import { ChunkExtractor, ChunkExtractorManager } from "@loadable/server"
import { renderToPipeableStream } from "react-dom/server"
import { getUserAgentDetails } from "../../server/utils/userAgentUtil.js"
import router from "../../index.js"
const { matchPath, serverDataFetcher, matchRoutes: NestedMatchRoutes, getMetaData } = router
import { validateConfigureStore, validateCustomDocument, validateGetRoutes } from "../utils/validator.js"

// Dynamic imports using ESM
// const CustomDocument = (await import(path.join(process.env.src_path, "server/document.jsx"))).default

const App = (await import(path.join(process.env.src_path, "src/js/containers/App/index.jsx"))).default
const { getRoutes } = await import(path.join(process.env.src_path, "src/js/routes/utils.jsx"))

const storePath = path.resolve(`${process.env.src_path}/src/js/store/index.js`)

let createStore

if (fs.existsSync(storePath)) {
    try {
        const { default: configureStore } = await import(`${process.env.src_path}/src/js/store/index.js`)
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

        // if (match) {
        //     if (isProduction && !res.locals.pageCss && !res.locals.pageJS && !res.locals.routePath) {
        //         extractAssets(res, route)
        //     }
        //     if (!res.locals.pageCss && !res.locals.pageJS && !res.locals.routePath) {
        //         res.locals.routePath = path
        //         //moving routing logic outside of the App and using ServerRoutes for creating routes on server instead
        //         renderToString(
        //             <ChunkExtractorManager extractor={}>
        //                 <Provider store={store}>
        //                     <StaticRouter context={context} location={req.originalUrl}>
        //                         <ServerRouter store={store} intialData={fetcherData} />
        //                     </StaticRouter>
        //                 </Provider>
        //             </ChunkExtractorManager>
        //         )
        //     }
        //     const wc = route.component
        //     matches.push({
        //         route,
        //         match,
        //         serverSideFunction: (wc && wc.serverSideFunction) || (() => Promise.resolve()),
        //     })
        // }
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
    const shellStart = await renderStart(res.locals.pageCss, res.locals.pageJS, metaTags, isBot, fetcherData)

    let state = store.getState()
    const jsx = getComponent(store, context, req, fetcherData)

    // Transforms Body Props
    const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)

    const finalProps = { ...shellStart, ...shellEnd, jsx: jsx, req, res }

    let CompleteDocument = () => {
        // if (validateCustomDocument(CustomDocument)) {
        //     return CustomDocument(finalProps)
        // } else {
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
        // }
    }

    try {
        let status = matches.length && matches[0].match.path === "*" ? 404 : 200
        res.set({ "content-type": "text/html; charset=utf-8" })
        res.status(status)
        const { pipe } = renderToPipeableStream(<CompleteDocument />, {
            onShellReady() {
                res.setHeader("content-type", "text/html")
                pipe(res)
                res.end()
            },
            // onError(error) {
            //     console.error({ message: `\n Error while renderToPipeableStream : ${error.toString()}` })
            // },
        })
    } catch (error) {
        console.error("Error in rendering document on server:" + error)
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

        // let webStats = path.join(__dirname, "../../..", `loadable-stats.json`)

        // if (isProduction) {
        //     webStats = path.join(
        //         process.env.src_path,
        //         `${process.env.BUILD_OUTPUT_PATH}/public/loadable-stats.json`
        //     )
        // }

        // const  = new ChunkExtractor({
        //     statsFile: webStats,
        //     entrypoints: ["app"],
        // })

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
                        console.error("Error in executing serverFetcher functions: " + error)
                        await renderMarkUp(404, req, res, allTags, fetcherData, store, matches, context)
                    })
            })
            .catch((error) => {
                console.error("Error in executing serverSideFunction inside App: " + error)
                renderMarkUp(error.status_code, req, res, allTags, fetcherData, store, matches, context)
            })
    } catch (error) {
        console.error("Error in handling document request: " + error.toString())
    }
}
