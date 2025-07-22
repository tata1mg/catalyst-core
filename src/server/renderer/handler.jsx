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
import { ChunkExtractor } from "../utils/ChunkExtractor.js"

import CustomDocument from "@catalyst/template/server/document.jsx"

import App from "@catalyst/template/src/js/containers/App/index.jsx"
import { getRoutes } from "@catalyst/template/src/js/routes/utils.jsx"

import configureStore from "@catalyst/template/src/js/store/index.dev.js"

let createStore = configureStore

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

// Generate script tags with necessary hints for JS assets
const generateScriptTags = (jsAssets, req) => {
    const scriptElements = []

    // Get the correct base URL for assets
    const getAssetUrl = (asset) => {
        if (asset.startsWith("http")) {
            return asset
        }

        // Construct proper URL with host and port
        const protocol = req?.protocol || "http"
        const host = req?.get("host") || "localhost:3005"

        // Ensure asset path starts with /
        const assetPath = asset.startsWith("/") ? asset : `/${asset}`

        // For client assets, ensure /client/ prefix
        if (!assetPath.startsWith("/client/")) {
            return `${protocol}://${host}/client/assets/${asset}`
        }

        return `${protocol}://${host}${assetPath}`
    }

    // Deduplicate assets by URL to prevent duplicates
    const uniqueAssets = [...new Set(jsAssets)]

    uniqueAssets.forEach((asset, index) => {
        const assetUrl = getAssetUrl(asset)

        // All Vite-generated JS files should be ES modules
        const isModule = asset.endsWith(".js")

        if (isModule) {
            scriptElements.push(
                React.createElement("script", {
                    key: `script-${asset}-${index}`, // More unique key
                    src: assetUrl,
                    type: "module",
                })
            )
        } else {
            // Generate preload hint for non-JS assets
            scriptElements.push(
                React.createElement("link", {
                    key: `preload-${asset}-${index}`,
                    rel: "preload",
                    href: assetUrl,
                    as: "script",
                })
            )
        }
    })

    return scriptElements
}

// Read and inline CSS content and create React style element
const createInlineCSSElement = (cssAssets) => {
    let inlinedCSS = ""
    const publicPath = process.env.BUILD_OUTPUT_PATH || "dist"

    cssAssets.forEach((asset) => {
        try {
            let cssFilePath

            // Handle different asset path formats
            if (asset.startsWith("/client/assets/css/")) {
                cssFilePath = path.join(
                    process.env.src_path,
                    publicPath,
                    "client/assets/css",
                    path.basename(asset)
                )
            } else if (asset.startsWith("client/assets/css/")) {
                cssFilePath = path.join(process.env.src_path, publicPath, asset)
            } else {
                cssFilePath = path.join(process.env.src_path, publicPath, "client/assets/css", asset)
            }

            // Read CSS file content
            if (fs.existsSync(cssFilePath)) {
                const cssContent = fs.readFileSync(cssFilePath, "utf-8")
                inlinedCSS += `\n/* ${asset} */\n${cssContent}\n`
            } else {
                console.warn(`CSS file not found: ${cssFilePath}`)
            }
        } catch (error) {
            console.warn(`Error reading CSS file ${asset}:`, error.message)
        }
    })

    // Return React style element if there's CSS content
    if (inlinedCSS.trim()) {
        return inlinedCSS.trim()
    }

    return null
}

// Two-pass rendering: first pass to discover assets, second pass to render with assets
const performTwoPassRendering = (store, context, req, fetcherData, ssrManifest, manifest, assetManifest) => {
    let discoveredAssets = { js: [], css: [] }

    try {
        // Create ChunkExtractor for this render
        const chunkExtractor = new ChunkExtractor({
            manifest: manifest || {},
            ssrManifest: ssrManifest || {},
            assetManifest: assetManifest || {},
        })
        // Render to string (first pass) - this will track components via global.__CHUNK_EXTRACTOR__
        renderToString(getComponent(store, context, req, fetcherData))

        // Get extracted assets from ChunkExtractor
        discoveredAssets = chunkExtractor.getAssets()
    } catch (error) {
        console.warn("Error in first pass rendering:", error)
    }

    return discoveredAssets
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
    discoveredAssets = { js: [], css: [] }
) => {
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    const isBot = deviceDetails.googleBot ? true : false

    // Process ChunkExtractor discovered assets only
    const scriptElements = generateScriptTags(discoveredAssets.js, req)
    const inlinedCSS = createInlineCSSElement(discoveredAssets.css, req)

    // Use only ChunkExtractor assets (no merging with old system)
    res.locals.pageJS = scriptElements
    res.locals.pageCss = inlinedCSS

    // Transforms Head Props with discovered assets
    const shellStart = await renderStart(res.locals.pageCss, res.locals.pageJS, metaTags, isBot, fetcherData)

    let state = {}
    const jsx = getComponent(store, context, req, fetcherData)

    // Transforms Body Props
    const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)

    const finalProps = { ...shellStart, ...shellEnd, jsx: jsx, req, res }

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

    try {
        let status = matches.length && matches[0].match.path === "*" ? 404 : 200
        res.set({ "content-type": "text/html; charset=utf-8" })
        res.status(status)
        const { pipe } = renderToPipeableStream(<CompleteDocument />, {
            onShellReady() {
                res.setHeader("content-type", "text/html")
                pipe(res)
                // res.end()
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
        const store = validateConfigureStore(createStore) ? await createStore({}, req, res) : null
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
                        const discoveredAssets = performTwoPassRendering(
                            store,
                            context,
                            req,
                            fetcherData,
                            req.ssrManifest,
                            req.manifest,
                            req.assetManifest
                        )
                        return discoveredAssets
                    })
                    .then(
                        async (discoveredAssets) =>
                            await renderMarkUp(
                                null,
                                req,
                                res,
                                allTags,
                                fetcherData,
                                store,
                                matches,
                                context,
                                discoveredAssets
                            )
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
