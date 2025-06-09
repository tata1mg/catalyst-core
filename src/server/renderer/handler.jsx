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
import { validateConfigureStore, validateCustomDocument, validateGetRoutes } from "../utils/validator.js"

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

// Component usage tracker for two-pass rendering
const createComponentTracker = () => {
    const usedComponents = new Set()

    const originalCreateElement = React.createElement
    React.createElement = function (type, props, ...children) {
        // Track component usage by checking for component file paths
        if (typeof type === "function" && type.name) {
            // Extract component path from stack trace or component metadata
            const componentPath = getComponentPath(type)
            if (componentPath) {
                usedComponents.add(componentPath)
            }
        }
        return originalCreateElement.call(this, type, props, ...children)
    }

    return {
        getUsedComponents: () => Array.from(usedComponents),
        cleanup: () => {
            React.createElement = originalCreateElement
            usedComponents.clear()
        },
    }
}

// Helper to extract component path from function
const getComponentPath = (component) => {
    try {
        // Try to get path from component metadata or stack trace
        if (component.__source) {
            return component.__source.fileName
        }

        // Fallback: try to match component name to known paths
        const componentName = component.name || component.displayName
        if (componentName) {
            // This is a simplified approach - in production you might want a more robust mapping
            return `../../src/js/widgets/**/${componentName}/${componentName}.jsx`
        }
    } catch (error) {
        // Ignore errors in component path extraction
    }
    return null
}

// Extract assets from SSR manifest based on used components
const extractAssetsFromManifest = (usedComponents, ssrManifest, manifest) => {
    const requiredAssets = {
        js: new Set(),
        css: new Set(),
    }

    // Look through SSR manifest for matching components
    Object.keys(ssrManifest).forEach((componentPath) => {
        // Check if this component was used (fuzzy matching for now)
        const isUsed = usedComponents.some((usedPath) => {
            return (
                componentPath.includes(path.basename(usedPath, ".jsx")) ||
                usedPath.includes(path.basename(componentPath, ".jsx"))
            )
        })

        if (isUsed) {
            const assets = ssrManifest[componentPath]
            if (Array.isArray(assets)) {
                assets.forEach((asset) => {
                    if (asset.endsWith(".js")) {
                        requiredAssets.js.add(asset)
                    } else if (asset.endsWith(".css")) {
                        requiredAssets.css.add(asset)
                    }
                })
            }
        }
    })
    const mainCssKey = Object.keys(manifest).find((key) => key.includes("client/index.jsx"))
    const mainCssFilePath = manifest[mainCssKey].css
    requiredAssets.css.add(...mainCssFilePath)

    return {
        js: Array.from(requiredAssets.js),
        css: Array.from(requiredAssets.css),
    }
}

// Generate script tags with necessary hints for JS assets
const generateScriptTags = (jsAssets, req) => {
    const scriptElements = []
    const publicPath = process.env.PUBLIC_STATIC_ASSET_URL || "/client/assets/"

    jsAssets.forEach((asset, index) => {
        const assetUrl = asset.startsWith("http") ? asset : `${publicPath}${asset}`

        // Determine if it's an ES module based on file content or naming convention
        const isModule = asset.includes("-") && asset.endsWith(".js") // Vite generated modules typically have hashes

        if (isModule) {
            // Generate modulepreload hint for ES modules
            // scriptElements.push(
            //     React.createElement('link', {
            //         key: `modulepreload-${index}`,
            //         rel: 'modulepreload',
            //         href: assetUrl,
            //         crossOrigin: 'anonymous'
            //     })
            // )
            // Generate module script tag
            scriptElements.push(
                React.createElement("script", {
                    key: `script-${index}`,
                    src: assetUrl,
                    type: "module",
                })
            )
        } else {
            // Generate preload hint for regular scripts
            scriptElements.push(
                React.createElement("link", {
                    key: `preload-${index}`,
                    rel: "preload",
                    href: assetUrl,
                    as: "script",
                })
            )
            // Generate script tag
            scriptElements.push(
                React.createElement("script", {
                    key: `script-${index}`,
                    src: assetUrl,
                    defer: true,
                })
            )
        }
    })

    return scriptElements
}

// Read and inline CSS content and create React style element
const createInlineCSSElement = (cssAssets, req) => {
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

// Process existing assets in res.locals
const processExistingAssets = (existingPageJS, existingPageCSS, req) => {
    let processedJS = []
    let processedCSS = null

    // Process existing JS assets
    if (Array.isArray(existingPageJS)) {
        existingPageJS.forEach((asset, index) => {
            if (React.isValidElement(asset)) {
                // Already a React element
                processedJS.push(asset)
            } else if (typeof asset === "string") {
                if (asset.includes("<script") || asset.includes("<link")) {
                    // Convert HTML string to React element
                    const htmlElement = convertHTMLStringToReactElement(asset, `existing-${index}`)
                    if (htmlElement) {
                        processedJS.push(htmlElement)
                    }
                } else {
                    // Raw asset paths - convert to script elements
                    const scriptElements = generateScriptTags([asset], req)
                    processedJS.push(...scriptElements)
                }
            }
        })
    }

    // Process existing CSS assets
    if (React.isValidElement(existingPageCSS)) {
        // Already a React element
        processedCSS = existingPageCSS
    } else if (typeof existingPageCSS === "string") {
        if (existingPageCSS.includes("/*") || existingPageCSS.includes("{")) {
            // Already inlined CSS content - create style element
            processedCSS = React.createElement("style", {
                key: "existing-css",
                dangerouslySetInnerHTML: { __html: existingPageCSS },
            })
        } else {
            // Assume it's a file path
            processedCSS = createInlineCSSElement([existingPageCSS], req)
        }
    } else if (Array.isArray(existingPageCSS)) {
        // Array of CSS file paths
        processedCSS = createInlineCSSElement(existingPageCSS, req)
    }

    return {
        js: processedJS,
        css: processedCSS,
    }
}

// Helper function to convert HTML strings to React elements
const convertHTMLStringToReactElement = (htmlString, key) => {
    try {
        // Simple parser for script and link tags
        if (htmlString.includes("<script")) {
            const srcMatch = htmlString.match(/src="([^"]*)"/)
            const typeMatch = htmlString.match(/type="([^"]*)"/)
            const deferMatch = htmlString.includes("defer")
            const crossoriginMatch = htmlString.match(/crossorigin(?:="([^"]*)")?/)

            const props = {
                key: key,
                src: srcMatch ? srcMatch[1] : undefined,
                type: typeMatch ? typeMatch[1] : undefined,
                defer: deferMatch,
                crossOrigin: crossoriginMatch ? crossoriginMatch[1] || "anonymous" : undefined,
            }

            // Remove undefined props
            Object.keys(props).forEach((k) => props[k] === undefined && delete props[k])

            return React.createElement("script", props)
        } else if (htmlString.includes("<link")) {
            const hrefMatch = htmlString.match(/href="([^"]*)"/)
            const relMatch = htmlString.match(/rel="([^"]*)"/)
            const asMatch = htmlString.match(/as="([^"]*)"/)
            const crossoriginMatch = htmlString.match(/crossorigin(?:="([^"]*)")?/)

            const props = {
                key: key,
                href: hrefMatch ? hrefMatch[1] : undefined,
                rel: relMatch ? relMatch[1] : undefined,
                as: asMatch ? asMatch[1] : undefined,
                crossOrigin: crossoriginMatch ? crossoriginMatch[1] || "anonymous" : undefined,
            }

            // Remove undefined props
            Object.keys(props).forEach((k) => props[k] === undefined && delete props[k])

            return React.createElement("link", props)
        }
    } catch (error) {
        console.warn("Error converting HTML string to React element:", error)
    }
    return null
}

// Two-pass rendering: first pass to discover assets, second pass to render with assets
const performTwoPassRendering = (store, context, req, fetcherData, ssrManifest, manifest) => {
    let discoveredAssets = { js: [], css: [] }

    try {
        // First pass: Render to string to discover used components
        const tracker = createComponentTracker()

        const firstPassComponent = (
            <div id="app">
                <Provider store={store}>
                    <StaticRouter context={context} location={req.originalUrl}>
                        <ServerRouter store={store} intialData={fetcherData} />
                    </StaticRouter>
                </Provider>
            </div>
        )

        // Render to string (first pass)
        renderToString(firstPassComponent)

        // Get used components and extract assets
        const usedComponents = tracker.getUsedComponents()
        if (ssrManifest && usedComponents.length > 0) {
            discoveredAssets = extractAssetsFromManifest(usedComponents, ssrManifest, manifest)
        }

        // Cleanup tracker
        tracker.cleanup()
    } catch (error) {
        console.warn("Error in first pass rendering:", error)
    }

    return discoveredAssets
}

// Preloads chunks required for rendering document
const getComponent = (store, context, req, fetcherData) => {
    return (
        <div id="app">
            <Suspense>
                <Provider store={store}>
                    <StaticRouter context={context} location={req.originalUrl}>
                        <ServerRouter store={store} intialData={fetcherData} />
                    </StaticRouter>
                </Provider>
            </Suspense>
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
    ssrAssets,
    clientAssets,
    discoveredAssets = { js: [], css: [] }
) => {
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    const isBot = deviceDetails.googleBot ? true : false

    // Process discovered assets
    const scriptElements = generateScriptTags(discoveredAssets.js, req)
    const inlinedCSS = createInlineCSSElement(discoveredAssets.css, req)

    // Process existing assets
    const existingAssets = processExistingAssets(res.locals.pageJS, res.locals.pageCss, req)

    // Merge discovered assets with existing assets
    const allPageJS = [...existingAssets.js, ...scriptElements]

    // Merge CSS elements
    const allPageCSS = []
    if (existingAssets.css) {
        allPageCSS.push(existingAssets.css)
    }
    if (inlinedCSS) {
        allPageCSS.push(inlinedCSS)
    }

    // Update res.locals with processed assets
    res.locals.pageJS = allPageJS
    res.locals.pageCss = allPageCSS.length === 1 ? allPageCSS[0] : allPageCSS.length > 1 ? allPageCSS : null
    console.log(">>>>>>>css", res.locals.pageCss)

    // Transforms Head Props with discovered assets
    const shellStart = await renderStart(res.locals.pageCss, res.locals.pageJS, metaTags, isBot, fetcherData)

    let state = store.getState()
    const jsx = getComponent(store, context, req, fetcherData)

    // Transforms Body Props
    const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)

    const finalProps = { ...shellStart, ...shellEnd, jsx: jsx, req, res, ssrAssets, clientAssets }

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

        // Read assets from Vite manifests
        let ssrAssets = []
        let clientAssets = []

        if (req.ssrManifest) {
            try {
                // Extract assets from SSR manifest
                Object.values(req.ssrManifest).forEach((entry) => {
                    if (entry.file) {
                        ssrAssets.push(entry.file)
                    }
                    if (entry.css) {
                        ssrAssets.push(...entry.css)
                    }
                    if (entry.assets) {
                        ssrAssets.push(...entry.assets)
                    }
                })
            } catch (error) {
                console.warn("Error reading SSR manifest:", error)
            }
        }

        if (req.manifest) {
            try {
                // Extract assets from client manifest
                Object.values(req.manifest).forEach((entry) => {
                    if (entry.file) {
                        clientAssets.push(entry.file)
                    }
                    if (entry.css) {
                        clientAssets.push(...entry.css)
                    }
                    if (entry.assets) {
                        clientAssets.push(...entry.assets)
                    }
                })
            } catch (error) {
                console.warn("Error reading client manifest:", error)
            }
        }

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
                            req.manifest
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
                                ssrAssets,
                                clientAssets,
                                discoveredAssets
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
                            ssrAssets,
                            clientAssets
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
                    ssrAssets,
                    clientAssets
                )
            })
    } catch (error) {
        console.error("Error in handling document request: " + error.toString())
    }
}
