import fs from "fs"
import path from "path"
import React, { Suspense } from "react"
import { renderStart, renderEnd } from "./render.js"
// import extractAssets from "./extract.js"
import { Provider } from "react-redux"
import { Body } from "./document/Body.jsx"
import { Head } from "./document/Head.jsx"

import { StaticRouter } from "react-router-dom/server"
import ServerRouter from "../../router/ServerRouter.js"
import { renderToPipeableStream, renderToString } from "react-dom/server"
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

import CustomDocument from "@catalyst/template/server/document.jsx"

import App from "@catalyst/template/src/js/containers/App/index.jsx"
import { getRoutes } from "@catalyst/template/src/js/routes/utils.jsx"

import configureStore from "@catalyst/template/src/js/store/index.js"

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
    discoveredAssets = { js: [], css: [] },
    chunkExtractor = null
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
    const jsx = getComponent(store, context, req, fetcherData)

    // Transforms Body Props
    const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)

    const finalProps = {
        ...shellStart,
        ...shellEnd,
        jsx: jsx,
        req,
        res,
    }

    let CompleteDocument = () => {
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
        const { pipe } = renderToPipeableStream(<CompleteDocument />, {
            onShellReady() {
                res.setHeader("content-type", "text/html")
                res.write(`<!DOCTYPE html>`)
                pipe(res)
                // res.end()
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
        // creates store
        const store = validateConfigureStore(configureStore) ? await configureStore({}, req, res) : null
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

                        // Perform two-pass rendering to discover required assets
                        const { discoveredAssets, chunkExtractor } = collectEssentialAssets(
                            req.ssrManifest,
                            req.manifest,
                            req.assetManifest
                        )
                        return { discoveredAssets, chunkExtractor }
                    })
                    .then(
                        async ({ discoveredAssets, chunkExtractor }) =>
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
                                chunkExtractor
                            )
                    )
                    .catch(async (error) => {
                        console.error("Error in executing serverFetcher functions: " + error)
                        await renderMarkUp(
                            404,
                            req,
                            res,
                            allTags,
                            fetcherData,
                            store,
                            matches,
                            context,
                            { js: [], css: [] },
                            null
                        )
                    })
            })
            .catch((error) => {
                console.error("Error in executing serverSideFunction inside App: " + error)
                renderMarkUp(
                    error.status_code,
                    req,
                    res,
                    allTags,
                    fetcherData,
                    store,
                    matches,
                    context,
                    { js: [], css: [] },
                    null
                )
            })
    } catch (error) {
        console.error("Error in handling document request: " + error.toString())
    }
}
