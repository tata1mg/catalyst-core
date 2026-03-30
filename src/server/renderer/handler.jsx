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
import { validateConfigureStore, validateGetRoutes } from "../utils/validator.js"
import { ChunkExtractor } from "./ChunkExtractor.js"
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

// ── Route matching ─────────────────────────────────────────────────────
const getMatchRoutes = (routes, req, res, store, context, fetcherData, basePath = "") => {
    return routes.reduce((matches, route) => {
        const { path } = route
        const match = matchPath(
            { path: `${basePath}/${path}`, caseSensitive: false, end: true },
            req.baseUrl || "/"
        )

        if (!match && route.children) {
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

// ── Asset collection ───────────────────────────────────────────────────
const collectAssets = (req, allMatches) => {
    const chunkExtractor = new ChunkExtractor({
        manifest: req.manifest || {},
        ssrManifest: req.ssrManifest || {},
        assetManifest: req.assetManifest || {},
    })

    // Add route-matched CSS/JS to critical bucket (loaded in <head>)
    chunkExtractor.preloadRouteCss(allMatches)

    return chunkExtractor
}

// ── JSX tree ───────────────────────────────────────────────────────────
const getComponent = (store, context, req, fetcherData) => (
    <div id="app">
        <Provider store={store}>
            <StaticRouter context={context} location={req.originalUrl}>
                <ServerRouter store={store} intialData={fetcherData} />
            </StaticRouter>
        </Provider>
    </div>
)

// ── Render and stream ──────────────────────────────────────────────────
const renderMarkUp = async (
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
    const jsx = getComponent(store, context, req, fetcherData)
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
        const status = matches.length && matches[0].match.path === "*" ? 404 : 200
        res.set({ "content-type": "text/html; charset=utf-8" })
        res.status(status)

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
                res.write(generateScriptStrings(deferredAssets.js))
            },
        })
    } catch (error) {
        console.error("Error in rendering document on server:" + error)
    }
}

// ── Express middleware ──────────────────────────────────────────────────
export default async function (req, res) {
    try {
        let context = {}
        let fetcherData = {}
        const store = validateConfigureStore(createStore) ? await createStore({}, req, res) : null
        const routes = validateGetRoutes(getRoutes) ? getRoutes() : []

        const matches = getMatchRoutes(routes, req, res, store, context, fetcherData, undefined)
        const allMatches = NestedMatchRoutes(getRoutes(), req.baseUrl)
        let allTags = []

        App.serverSideFunction({ store, req, res })
            .then(() => {
                serverDataFetcher({ routes, req, res, url: req.originalUrl }, { store })
                    .then((res) => {
                        fetcherData = res
                        allTags = getMetaData(allMatches, fetcherData)
                        return collectAssets(req, allMatches)
                    })
                    .then(
                        async (chunkExtractor) =>
                            await renderMarkUp(
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
                    )
                    .catch(async (error) => {
                        console.error("Error in executing serverFetcher functions: " + error)
                        await renderMarkUp(404, req, res, allTags, fetcherData, store, matches, context, null)
                    })
            })
            .catch((error) => {
                console.error("Error in executing serverSideFunction inside App: " + error)
                renderMarkUp(error.status_code, req, res, allTags, fetcherData, store, matches, context, null)
            })
    } catch (error) {
        console.error("Error in handling document request: " + error.toString())
    }
}
