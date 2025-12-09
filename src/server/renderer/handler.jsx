import React from "react"
import { renderStart, renderEnd } from "./render.js"
import { Provider } from "react-redux"
import { Body } from "./document/Body.jsx"
import { Head } from "./document/Head.jsx"
import { StaticRouter } from "react-router-dom/server"
import ServerRouter from "../../router/ServerRouter.js"
import { renderToPipeableStream, resumeToPipeableStream } from "react-dom/server"
import { prerenderToNodeStream } from "react-dom/static"
import { getUserAgentDetails } from "../utils/userAgentUtil.js"
import { matchPath, matchRoutes as NestedMatchRoutes, getMetaData } from "../../index.jsx"
import { validateConfigureStore, validateGetRoutes } from "../utils/validator.js"
import { ChunkExtractor } from "./ChunkExtractor.js"
import {
    generateScriptTags,
    generateStylesheetLinks,
    generateScriptTagsAsStrings,
    generateStylesheetLinksAsStrings,
} from "./extract.js"
import { clearPPRCache, PPRDataProvider, getCachedData } from "../../web-router/components/DataFetcher.jsx"
import CustomDocument from "@catalyst/template/server/document.jsx"
import App from "@catalyst/template/src/js/containers/App/index.jsx"
import { getRoutes } from "@catalyst/template/src/js/routes/utils.jsx"
import createStore from "@catalyst/template/src/js/store/index.js"

// Cache for prerendered shells (keyed by pathname)
const prerenderCache = new Map()

export const clearPrerenderCache = () => prerenderCache.clear()

/**
 * Collects a readable stream into a buffer
 */
function collectStream(stream) {
    return new Promise((resolve, reject) => {
        const chunks = []
        stream.on("data", (chunk) => chunks.push(chunk))
        stream.on("end", () => resolve(Buffer.concat(chunks)))
        stream.on("error", reject)
    })
}

/**
 * Matches request route with routes defined in the application
 */
function getMatchRoutes(routes, req, basePath = "") {
    return routes.reduce((matches, route) => {
        const { path } = route
        const match = matchPath(
            { path: `${basePath}/${path}`, caseSensitive: false, end: true },
            req.baseUrl || "/"
        )

        if (!match && route.children) {
            const nested = getMatchRoutes(route.children, req, `${basePath}/${path}`)
            if (nested.length) matches = matches.concat(nested)
        }

        return matches
    }, [])
}

/**
 * Streams React JSX to response with optional prerendered state
 */
// function streamToResponse(jsx, req, res, chunkExtractor, postponed = null, preludeSent = false) {
//     const url = req.originalUrl
//     const renderMode = postponed ? "resumeToPipeableStream" : "renderToPipeableStream"
//     const startTime = Date.now()

//     console.log(`[Stream] ▶ Starting ${renderMode} for: ${url}`)
//     console.log(`[Stream]   postponed: ${postponed ? "present" : "null"}, preludeSent: ${preludeSent}`)

//     return new Promise((resolve, reject) => {
//         let isAborted = false

//         const options = {
//             onShellReady() {
//                 if (isAborted) return
//                 const shellTime = Date.now() - startTime
//                 console.log(`[Stream] ✓ Shell ready (${shellTime}ms) - TTFB sent for: ${url}`)

//                 // Only set headers and DOCTYPE if we haven't already sent the prelude
//                 if (!preludeSent) {
//                     res.setHeader("content-type", "text/html; charset=utf-8")
//                     res.write("<!DOCTYPE html>")
//                 }
//                 pipe(process.stdout)
//             },
//             onShellError(error) {
//                 console.error(`[Stream] ✗ Shell error for ${url}:`, error)
//                 reject(error)
//             },
//             onAllReady() {
//                 if (isAborted) return
//                 const totalTime = Date.now() - startTime
//                 console.log(`[Stream] ✓ All ready (${totalTime}ms) - Streaming complete for: ${url}`)
//                 if (chunkExtractor) {
//                     try {
//                         const assets = chunkExtractor.getNonEssentialAssets()
//                         res.write(generateStylesheetLinksAsStrings(assets.css, req, chunkExtractor))
//                         res.write(generateScriptTagsAsStrings(assets.js, req))
//                         console.log(
//                             `[Stream]   Injected ${assets.js.length} JS, ${assets.css.length} CSS assets`
//                         )
//                     } catch (err) {
//                         console.warn("[Stream] Error injecting assets:", err)
//                     }
//                 }
//                 res.end()
//                 resolve()
//             },
//             onError(error) {
//                 console.error(`[Stream] Streaming error for ${url}:`, error)
//                 reject(error)
//             },
//         }
//         console.log(">>>>>>postponed", postponed, jsx)
//         const { pipe, abort } = resumeToPipeableStream(jsx, postponed, {
//             onShellReady() {
//                 if (isAborted) return
//                 const shellTime = Date.now() - startTime
//                 console.log(`[Stream] ✓ Shell ready (${shellTime}ms) - TTFB sent for: ${url}`)

//                 // Only set headers and DOCTYPE if we haven't already sent the prelude
//                 if (!preludeSent) {
//                     res.setHeader("content-type", "text/html; charset=utf-8")
//                     res.write("<!DOCTYPE html>")
//                 }
//                 pipe(res)
//             },
//             onShellError(error) {
//                 console.error(`[Stream] ✗ Shell error for ${url}:`, error)
//                 cleanup()
//                 reject(error)
//             },
//             onAllReady() {
//                 if (isAborted) return
//                 const totalTime = Date.now() - startTime
//                 console.log(`[Stream] ✓ All ready (${totalTime}ms) - Streaming complete for: ${url}`)
//                 if (chunkExtractor) {
//                     try {
//                         const assets = chunkExtractor.getNonEssentialAssets()
//                         res.write(generateStylesheetLinksAsStrings(assets.css, req, chunkExtractor))
//                         res.write(generateScriptTagsAsStrings(assets.js, req))
//                         console.log(
//                             `[Stream]   Injected ${assets.js.length} JS, ${assets.css.length} CSS assets`
//                         )
//                     } catch (err) {
//                         console.warn("[Stream] Error injecting assets:", err)
//                     }
//                 }
//                 res.end()
//                 cleanup()
//                 resolve()
//             },
//             onError(error) {
//                 console.error(`[Stream] Streaming error for ${url}:`, error)
//                 cleanup()
//                 reject(error)
//             },
//         })

//         const cleanup = () => {
//             req.off("close", handleAbort)
//             res.off("close", handleAbort)
//         }

//         const handleAbort = () => {
//             if (isAborted) return
//             isAborted = true
//             console.log(`[Stream] ⚠ Client disconnected, aborting: ${url}`)
//             abort()
//             cleanup()
//             resolve()
//         }

//         req.on("close", handleAbort)
//         res.on("close", handleAbort)
//     })
// }

/**
 * Main request handler using PPR (Partial Prerendering)
 */
export default async function handler(req, res) {
    const url = req.originalUrl

    try {
        // Step 1: Setup
        const store = validateConfigureStore(createStore) ? await createStore({}, req, res) : null
        const routes = validateGetRoutes(getRoutes) ? getRoutes() : []
        const matches = getMatchRoutes(routes, req)
        const allMatches = NestedMatchRoutes(getRoutes(), req.baseUrl)
        const cacheKey = new URL(url, `http://${req.headers.host}`).pathname

        const AppContent = ({ phase, controller }) => {
            var jsx = (
                <div id="app">
                    <PPRDataProvider phase={phase} controller={controller} cacheKey={cacheKey}>
                        <Provider store={store}>
                            <StaticRouter context={{}} location={url}>
                                <ServerRouter store={store} intialData={{}} />
                            </StaticRouter>
                        </Provider>
                    </PPRDataProvider>
                </div>
            )

            const finalProps = {
                jsx: jsx,
                req,
                res,
            }

            if (CustomDocument) {
                return CustomDocument(finalProps)
            } else {
                return (
                    <html lang={finalProps.lang}>
                        <Head />
                        <Body jsx={finalProps.jsx} />
                    </html>
                )
            }
        }

        let chunkExtractor = null
        let discoveredAssets = { js: [], css: [] }
        try {
            chunkExtractor = new ChunkExtractor({
                manifest: req.manifest || {},
                ssrManifest: req.ssrManifest || {},
                assetManifest: req.assetManifest || {},
            })
            discoveredAssets = chunkExtractor.getEssentialAssets()
        } catch (error) {
            console.warn(`[PPR]   Error collecting assets:`, error.message)
        }

        const status = matches.length && matches[0].match?.path === "*" ? 404 : 200
        res.status(status)

        // Step 5: Prerender (cache check)
        const cacheHit = prerenderCache.has(cacheKey)

        // Set headers before any content
        res.setHeader("content-type", "text/html; charset=utf-8")

        if (cacheHit) {
            const cached = prerenderCache.get(cacheKey)

            // Write cached prelude immediately

            // For cache hit, we need a FRESH prerender to get matching postponed state
            // (postponed state is tied to the specific React element tree)
            // const controller = new AbortController()
            // setTimeout(() => controller.abort(), 50)
            try {
                // )
                const { pipe, abort } = resumeToPipeableStream(
                    <AppContent phase={"resume"} />,
                    JSON.parse(cached.postponeBuffer),
                    {
                        onShellReady() {
                            res.setHeader("x-rendering-mode", "resumeToPipeableStream")
                            if (cached.preludeBuffer) {
                                res.write(cached.preludeBuffer)
                                // Flush to send data immediately (compression middleware buffers otherwise)
                                if (typeof res.flush === "function") res.flush()
                            }
                        },
                        onShellError(error) {
                            console.error(`[Stream] ✗ Shell error for ${url}:`, error)
                        },
                        onAllReady() {
                            const cachedData = getCachedData(cacheKey)
                            if (cachedData && Object.keys(cachedData).length > 0) {
                                console.log("cachedData", cachedData)
                                const dataObject = {
                                    [cacheKey]: cachedData,
                                }
                                res.write(`<script>window.cachedData=${JSON.stringify(dataObject)}</script>`)
                            }
                            pipe(res)
                            clearPPRCache()

                            // if (chunkExtractor) {
                            //     try {
                            //         const assets = chunkExtractor.getDynamicAssets()
                            //         res.write(
                            //             generateStylesheetLinksAsStrings(assets.css, req, chunkExtractor)
                            //         )
                            //         res.write(generateScriptTagsAsStrings(assets.js, req))
                            //         console.log(
                            //             `[Stream]   Injected ${assets.js.length} JS, ${assets.css.length} CSS assets`
                            //         )
                            //     } catch (err) {
                            //         console.warn("[Stream] Error injecting assets:", err)
                            //     }
                            // }
                            res.end()
                        },
                        onError(error) {
                            clearPPRCache()
                            console.error(`[Stream] Streaming error for ${url}:`, error)
                        },
                    }
                )
            } catch (error) {
                // Fallback: end the response with what we have
                console.warn(`[PPR]   ✗ Resume failed for req: ${req.originalUrl} Error: ${error.message} `)
                res.end()
            }
        } else {
            // Cache miss - full prerender flow

            try {
                const controller = new AbortController()

                const result = await prerenderToNodeStream(
                    <AppContent controller={controller} phase={"prerender"} />,
                    {
                        signal: controller.signal,
                    }
                )

                // Collect prelude stream into buffer before caching
                const preludeBuffer = result.prelude ? await collectStream(result.prelude) : null
                const postponeBuffer = result.postponed ? JSON.stringify(result.postponed) : null
                // Cache ONLY the prelude buffer (not postponed - it's tied to this specific render)
                prerenderCache.set(cacheKey, { preludeBuffer, postponeBuffer })

                // Write the prelude to response
                // res.write(preludeBuffer)

                try {
                    // )
                    const { pipe, abort } = resumeToPipeableStream(
                        <AppContent phase={"1st Req"} />,
                        JSON.parse(postponeBuffer),
                        {
                            onShellReady() {
                                res.setHeader("x-rendering-mode", "1st Req")
                                if (preludeBuffer) {
                                    res.write(preludeBuffer)
                                    // Flush to send data immediately (compression middleware buffers otherwise)
                                    if (typeof res.flush === "function") res.flush()
                                }
                            },
                            onShellError(error) {
                                console.error(`[Stream] ✗ Shell error for ${url}:`, error)
                            },
                            onAllReady() {
                                pipe(res)
                                clearPPRCache()
                                if (chunkExtractor) {
                                    try {
                                        const assets = chunkExtractor.getDynamicAssets()
                                        res.write(
                                            generateStylesheetLinksAsStrings(assets.css, req, chunkExtractor)
                                        )
                                        res.write(generateScriptTagsAsStrings(assets.js, req))
                                        console.log(
                                            `[Stream]   Injected ${assets.js.length} JS, ${assets.css.length} CSS assets`
                                        )
                                    } catch (err) {
                                        console.warn("[Stream] Error injecting assets:", err)
                                    }
                                }
                                res.end()
                            },
                            onError(error) {
                                clearPPRCache()
                                console.error(`[Stream] Streaming error for ${url}:`, error)
                            },
                        }
                    )
                } catch (error) {
                    // Fallback: end the response with what we have
                    res.end()
                }
            } catch (error) {
                console.warn(
                    `[PPR]   ✗ Prerender failed for req: ${req.originalUrl} Error: ${error.message} `
                )
            }
        }
    } catch (error) {
        console.error(`[PPR] ❌ Request failed: ${url}`, error)
        if (!res.headersSent) {
            res.status(500).send("Internal Server Error")
        }
    }
}
