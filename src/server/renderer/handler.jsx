import React from "react"
import { renderStart, renderEnd } from "./render.js"
import { Provider } from "react-redux"
import { Body } from "./document/Body.jsx"
import { Head } from "./document/Head.jsx"

import { StaticRouter } from "react-router"
import ServerRouter from "../../router/ServerRouter.js"
import { renderToPipeableStream, resumeToPipeableStream } from "react-dom/server"
import { prerenderToNodeStream } from "react-dom/static"
import { getUserAgentDetails } from "../utils/userAgentUtil.js"
import { serverDataFetcher, matchRoutes as NestedMatchRoutes, getMetaData } from "../../index.jsx"
import { validateConfigureStore, validateGetRoutes, safeCall } from "../utils/validator.js"
import { ChunkExtractor } from "./ChunkExtractor.js"
import {
    readCssFromDisk,
    generateScriptElements,
    generateScriptStrings,
    getDeferredRouteKey,
    getCachedDeferredCssPathsForRoute,
    registerDeferredAssetsForRoute,
    getDeferredPreloadScriptUrls,
    generateModulePreloadLinkElements,
} from "./extract.js"
import {
    isPPREnabled,
    PPR_PRERENDER_SETTLE_MS,
    PPR_RESUME_TIMEOUT_MS,
    PPR_PROGRESSIVE_CHUNK_SIZE,
    ShellCache,
    shellCache,
    cssSignature,
    createNoncePlaceholder,
    applyNonce,
    prepareReactScripts,
    serializeForScript,
    guardLateResponseCalls,
    isPreloadLearningEnabled,
    extractPriorityImagePreloads,
    PreloadLearner,
    findHeadPreloadOffset,
    insertAt,
} from "./ppr.js"
import path from "path"
import crypto from "node:crypto"
import { Transform } from "node:stream"

import CustomDocument from "@catalyst/template/server/document"

import App from "@catalyst/template/src/js/containers/App/index"
import { getRoutes } from "@catalyst/template/src/js/routes/utils"
import createStore from "@catalyst/template/src/js/store/index.js"
import { SsrRequestProvider } from "../../web-router/components/SsrRequestContext.jsx"
import { PPRRenderProvider, PPRRouteBoundary } from "../../web-router/components/PPR.jsx"
import {
    PPRDataProvider,
    createPPRRequestCache,
    getRequestCachedData,
} from "../../web-router/components/DataFetcher.jsx"
import { getManifest, getAssetManifest, getIntegrityManifest } from "../manifestCache.js"

// Routes are static for the lifetime of the server — resolve once and reuse
// the same instance per request to avoid per-request allocation.
let _cachedRoutes
const getCachedRoutes = () => {
    if (_cachedRoutes === undefined) {
        _cachedRoutes = validateGetRoutes(getRoutes) ? getRoutes() : null
    }
    return _cachedRoutes
}

// Try to import user-defined hooks. These are optional — apps that don't export them
// will get undefined, and safeCall is a no-op for non-functions.
let _onRouteMatch,
    _onFetcherSuccess,
    _onFetcherError,
    _onAppServerSideSuccess,
    _onAppServerSideError,
    _onRenderError,
    _onRequestError,
    getPPRShellKey,
    getPPRPreloadKey,
    beforePPRFlush
try {
    const hooks = await import("@catalyst/template/server/index.js")
    _onRouteMatch = hooks.onRouteMatch
    _onFetcherSuccess = hooks.onFetcherSuccess
    _onFetcherError = hooks.onFetcherError
    _onAppServerSideSuccess = hooks.onAppServerSideSuccess
    _onAppServerSideError = hooks.onAppServerSideError
    _onRenderError = hooks.onRenderError
    _onRequestError = hooks.onRequestError
    // PPR: ({ req, res, store, matches }) => string | null. The string is added to the shell
    // cache key (use it for every request property the shell's markup depends on, e.g.
    // language or platform). null/false serves this request on the classic path.
    getPPRShellKey = hooks.getPPRShellKey
    // PPR: ({ req, res, store }) => string. Added to the shell key for learned LCP image
    // preloads (see ppr.js): every request property that changes image URLs but not the shell
    // (e.g. device pixel ratio). Throwing turns preload learning off for that request.
    getPPRPreloadKey = hooks.getPPRPreloadKey
    // PPR: ({ req, res, store }) => void. Runs right before the shell is written, the last
    // point where headers and cookies can be set (e.g. create a CSRF token whose cookie
    // has to go out with the headers).
    beforePPRFlush = hooks.beforePPRFlush
} catch {
    // No hooks file — all hooks remain undefined, safeCall will skip them
}

// Passthrough no-ops used when OTEL_ENABLE is not set; replaced below if enabled.
let withObservability = (_service, fn) => fn
let withSyncObservability = (_service, fn) => fn

if (process.env.OTEL_ENABLE === true) {
    try {
        const otel = await import("../../otel.js")
        withObservability = otel.withObservability
        withSyncObservability = otel.withSyncObservability
    } catch {
        // otel packages not installed — continue without tracing
    }
}

const SSR_SERVICE = process.env.SERVICE_NAME || `pwa-${process.env.APPLICATION}-node-server`

// Config-driven (config.json → CSP_NONCE_ENABLE): when on, every script Catalyst injects
// carries a per-request nonce so the app can serve a nonce-based CSP without opening up
// 'unsafe-inline'. Off by default — no behavior change unless explicitly enabled.
const CSP_NONCE_ENABLE = process.env.CSP_NONCE_ENABLE === true
const generateNonce = () => crypto.randomBytes(16).toString("base64")

const traceHook = (fn, spanName) =>
    typeof fn === "function" ? withSyncObservability(SSR_SERVICE, fn, spanName) : fn

const onRouteMatch = traceHook(_onRouteMatch, "onRouteMatch")
const onFetcherSuccess = traceHook(_onFetcherSuccess, "onFetcherSuccess")
const onFetcherError = traceHook(_onFetcherError, "onFetcherError")
const onAppServerSideSuccess = traceHook(_onAppServerSideSuccess, "onAppServerSideSuccess")
const onAppServerSideError = traceHook(_onAppServerSideError, "onAppServerSideError")
const onRenderError = traceHook(_onRenderError, "onRenderError")
const onRequestError = traceHook(_onRequestError, "onRequestError")

const getLogger = () => global?.logger || console

// renderMode ("ppr" | "static" | undefined) lives on the leaf-matched route's component,
// next to serverFetcher/clientFetcher. matchRoutes orders matches root-first, so the last
// entry is the page being rendered. Unset means the classic (streaming) path.
const getRenderMode = (allMatches) => allMatches[allMatches.length - 1]?.route?.component?.renderMode

const isBotRequest = (req) => {
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    // Match mweb's wider definition: synthetic monitors (StatusCake) and AI crawlers
    // also need the bot code path — no JS, and split(... ssr: false ...) widgets that
    // previously read state.shellReducer.isBot now read this via SsrRequestContext.
    return !!(deviceDetails.googleBot || deviceDetails.aiBot || deviceDetails.statusCakeBot)
}

const getPathname = (req) => new URL(req.originalUrl, "http://localhost").pathname

const routeStatus = (allMatches) => (allMatches.length && allMatches[0]?.route?.path === "*" ? 404 : 200)

function collectStream(stream) {
    return new Promise((resolve, reject) => {
        const chunks = []
        stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        stream.on("end", () => resolve(Buffer.concat(chunks)))
        stream.on("error", reject)
    })
}

// ── Asset collection ───────────────────────────────────────────────────
const _collectAssets = (req, allMatches) => {
    const chunkExtractor = new ChunkExtractor({
        manifest: getManifest() || {},
        assetManifest: getAssetManifest() || {},
    })

    // Add route-matched CSS/JS to critical bucket (loaded in <head>)
    chunkExtractor.preloadRouteCss(allMatches)

    return chunkExtractor
}

const collectAssets = withSyncObservability(SSR_SERVICE, _collectAssets, "collectAssets")

// ── JSX tree (classic, fully pre-fetched render) ────────────────────────
// requestCache: per-request store for usePPRRouteData. A PPR route can be served on this path
// (bots, PPR_ENABLE=false, getPPRShellKey null); without a cache the hook calls its fetcher
// again when React retries the suspended component, and the client gets no cachedData to
// hydrate from, so it fetches a third time.
const getComponent = (store, context, req, fetcherData, isBot, chunkExtractor, requestCache) => (
    <div id="app">
        <SsrRequestProvider value={{ isBot, chunkExtractor }}>
            <PPRDataProvider cacheKey={getPathname(req)} cache={requestCache}>
                <Provider store={store}>
                    <StaticRouter context={context} location={req.originalUrl}>
                        <ServerRouter store={store} intialData={fetcherData} />
                    </StaticRouter>
                </Provider>
            </PPRDataProvider>
        </SsrRequestProvider>
    </div>
)

// usePPRRouteData results for window.cachedData, so the client hydrates without refetching.
const routeCacheScript = (requestCache, req, nonceAttr = "") => {
    const cacheKey = getPathname(req)
    const routeCache = getRequestCachedData(requestCache, cacheKey)
    return routeCache === undefined
        ? ""
        : `<script${nonceAttr}>window.cachedData=${serializeForScript({ [cacheKey]: routeCache })}</script>`
}

// Shared <head>/<body> props for every render path.
const buildShellStart = (req, allMatches, chunkExtractor, metaTags, isBot, fetcherData, nonce) => {
    // Critical assets → <head>
    const criticalAssets = chunkExtractor ? chunkExtractor.getCriticalAssets() : { js: [], css: [] }

    // Inline critical CSS from disk (small thanks to natural code-splitting)
    const buildDir = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build")
    const inlineCss = readCssFromDisk(criticalAssets.css, buildDir)

    const deferredRouteKey = getDeferredRouteKey(req, allMatches)
    const deferredCssPaths = getCachedDeferredCssPathsForRoute(deferredRouteKey)
    const deferredRouteInlineCss = readCssFromDisk(deferredCssPaths, buildDir)

    const integrityManifest = getIntegrityManifest() || {}
    const jsScripts = generateScriptElements(criticalAssets.js, nonce, integrityManifest)
    const criticalPreloadLinks = generateModulePreloadLinkElements(
        criticalAssets.js,
        "critical-js",
        nonce,
        integrityManifest
    )
    const deferredPreloadUrls = getDeferredPreloadScriptUrls(deferredRouteKey, criticalAssets.js)
    const deferredPreloadLinks = generateModulePreloadLinkElements(
        deferredPreloadUrls,
        "deferred-js",
        nonce,
        integrityManifest
    )

    return {
        deferredRouteKey,
        buildDir,
        integrityManifest,
        deferredCssPaths,
        deferredPreloadUrls,
        shellStart: renderStart({
            inlineCss,
            deferredRouteInlineCss,
            jsScripts,
            criticalPreloadLinks,
            deferredPreloadLinks,
            metaTags,
            isBot,
            fetcherData,
        }),
    }
}

const renderDocument = (finalProps) => {
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
                nonce={finalProps.nonce}
            />
            <Body
                initialState={finalProps.initialState}
                jsx={finalProps.jsx}
                statusCode={finalProps.statusCode}
                fetcherData={finalProps.fetcherData}
                nonce={finalProps.nonce}
                pprShell={finalProps.pprShell}
            />
        </html>
    )
}

// ── Render and stream (classic — fully pre-fetched, single pass) ────────
const _renderMarkUp = async (
    errorCode,
    req,
    res,
    metaTags,
    fetcherData,
    store,
    allMatches,
    context,
    chunkExtractor,
    nonce
) => {
    const isBot = isBotRequest(req)

    const { deferredRouteKey, buildDir, integrityManifest, shellStart } = buildShellStart(
        req,
        allMatches,
        chunkExtractor,
        metaTags,
        isBot,
        fetcherData,
        nonce
    )

    const state = store.getState()
    const requestCache = createPPRRequestCache()
    const jsx = getComponent(store, context, req, fetcherData, isBot, chunkExtractor, requestCache)
    const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)

    const finalProps = { ...shellStart, ...shellEnd, jsx, req, res, nonce }

    const CompleteDocument = () => renderDocument(finalProps)

    try {
        const status = errorCode || routeStatus(allMatches)
        res.set({ "content-type": "text/html; charset=utf-8" })
        res.status(status)

        return new Promise((resolve, reject) => {
            // Single completion path: React's pipe() auto-ends `tail`, and
            // `flush()` appends the deferred asset tags before that end
            // signal propagates to `res` via the plain pipe below. This
            // avoids the onShellReady/onAllReady race where React's own
            // stream-end and a manual res.end() compete to close `res`
            // (see issue #320).
            const tail = new Transform({
                transform(chunk, _enc, cb) {
                    cb(null, chunk)
                },
                flush(cb) {
                    // Deferred assets — injected after body (non-blocking)
                    const deferredAssets = chunkExtractor
                        ? chunkExtractor.getDeferredAssets()
                        : { js: [], css: [] }

                    const nonceAttr = nonce ? ` nonce="${nonce}"` : ""

                    // Tell client which components were SSR'd so split() can
                    // eagerly import them (prevents Suspense fallback flash)
                    this.push(
                        `<script${nonceAttr}>window.__CATALYST_IS_BOT__=${isBot ? "true" : "false"};</script>`
                    )
                    this.push(routeCacheScript(requestCache, req, nonceAttr))
                    if (chunkExtractor) {
                        const renderedKeys = chunkExtractor.getRenderedComponentKeys()
                        this.push(
                            `<script${nonceAttr}>window.__SSR_RENDERED_COMPONENTS__=new Set(${JSON.stringify(
                                renderedKeys
                            )})</script>`
                        )
                    }

                    const { newCssPaths } = registerDeferredAssetsForRoute(
                        deferredRouteKey,
                        deferredAssets,
                        isBot
                    )
                    if (newCssPaths.length) {
                        this.push(`<style>${readCssFromDisk(newCssPaths, buildDir)}</style>`)
                    }
                    if (!isBot) {
                        this.push(generateScriptStrings(deferredAssets.js, nonce, integrityManifest))
                    }

                    cb()
                },
            })
            tail.pipe(res)

            const { pipe } = renderToPipeableStream(<CompleteDocument />, {
                onShellReady() {
                    res.setHeader("content-type", "text/html")
                    pipe(tail)
                },

                onAllReady() {
                    resolve()
                },

                onError(error) {
                    console.error("Error in renderToPipeableStream:", error)
                    safeCall(onRenderError, { req, res, store, error })
                    tail.destroy(error)
                    reject(error)
                },
            })
        })
    } catch (error) {
        console.error("Error in rendering document on server:", error)
        safeCall(onRenderError, { req, res, store, error })
        return Promise.reject(error)
    }
}

// ── Static (full-page cache) ─────────────────────────────────────────────
// A route opted into `Component.renderMode = "static"` is rendered once and the bytes are
// replayed to every later request, bots included. Only for pages that are identical for
// every visitor: no cookies, tokens or nonces in the markup.
const staticPageCache = new ShellCache()
export const clearStaticPageCache = () => staticPageCache.clear()

// Dev-only escape hatch: ?__refresh_static_cache re-renders (and re-caches) one static route.
const isStaticCacheBypassRequested = (req) =>
    process.env.NODE_ENV !== "production" && req.query?.__refresh_static_cache !== undefined

const _renderMarkUpStatic = async (
    errorCode,
    req,
    res,
    metaTags,
    fetcherData,
    store,
    allMatches,
    context,
    chunkExtractor,
    nonce
) => {
    const cacheKey = getPathname(req)
    // One canonical version for every visitor, so no per-request bot branching.
    const isBot = false

    const { deferredRouteKey, buildDir, integrityManifest, shellStart } = buildShellStart(
        req,
        allMatches,
        chunkExtractor,
        metaTags,
        isBot,
        fetcherData,
        nonce
    )

    const state = store.getState()
    const requestCache = createPPRRequestCache()
    const jsx = getComponent(store, context, req, fetcherData, isBot, chunkExtractor, requestCache)
    const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)
    const finalProps = { ...shellStart, ...shellEnd, jsx, req, res, nonce }
    const CompleteDocument = () => renderDocument(finalProps)

    const status = errorCode || routeStatus(allMatches)

    try {
        // No abort signal: waits for the whole tree, so the result is the complete page.
        const result = await prerenderToNodeStream(<CompleteDocument />)
        const preludeBuffer = result.prelude ? await collectStream(result.prelude) : Buffer.from("")

        const deferredAssets = chunkExtractor ? chunkExtractor.getDeferredAssets() : { js: [], css: [] }
        const trailerParts = [
            `<script>window.__CATALYST_IS_BOT__=false;</script>`,
            routeCacheScript(requestCache, req),
        ]
        if (chunkExtractor) {
            const renderedKeys = chunkExtractor.getRenderedComponentKeys()
            trailerParts.push(
                `<script>window.__SSR_RENDERED_COMPONENTS__=new Set(${JSON.stringify(renderedKeys)})</script>`
            )
        }
        const { newCssPaths } = registerDeferredAssetsForRoute(deferredRouteKey, deferredAssets, isBot)
        if (newCssPaths.length) {
            trailerParts.push(`<style>${readCssFromDisk(newCssPaths, buildDir)}</style>`)
        }
        trailerParts.push(generateScriptStrings(deferredAssets.js, undefined, integrityManifest))

        const buffer = Buffer.concat([preludeBuffer, Buffer.from(trailerParts.join(""))])

        // Only cache a clean 200, never a transient error page or a redirect.
        if (status === 200) {
            staticPageCache.set(cacheKey, { buffer, statusCode: status })
        }

        res.setHeader("x-rendering-mode", "static-cache-miss")
        res.status(status)
        res.set({ "content-type": "text/html; charset=utf-8" })
        res.end(buffer)
    } catch (error) {
        console.error(`[Static] Prerender failed for ${cacheKey}:`, error)
        safeCall(onRenderError, { req, res, store, error })
        if (!res.headersSent) {
            res.status(500).send("Internal Server Error")
        } else {
            res.end()
        }
    }
}

// ── PPR (partial prerendering) ───────────────────────────────────────────
// The response for a PPR route is
//   1. the shell: the document (head, CSS, preloads) plus the route's static skeleton
//      (Component.pprFallback), prerendered once per (pathname, getPPRShellKey) and
//      replayed from memory. It is written as soon as App.serverSideFunction has run
//      (that hook sets cookies, so it still runs before the headers go out);
//   2. the app, resumed into the shell when this request's serverFetcher data is ready;
//   3. a trailer with this request's redux state, router data and deferred assets.
// The whole app is inside the hole, so the shell never contains another user's data:
// the app's Document must keep per-request values out of the shell (PPRDynamic) or
// put the property they depend on into getPPRShellKey. As a guard, a shell that
// contains a value from the request's cookies is not cached.

const getPPRAppTree = ({ store, req, chunkExtractor, phase, requestCache, fallback, cacheKey }) => (
    <div id="app">
        <SsrRequestProvider value={{ isBot: false, chunkExtractor }}>
            <PPRDataProvider phase={phase} cacheKey={cacheKey} cache={requestCache}>
                <Provider store={store}>
                    <PPRRouteBoundary fallback={fallback}>
                        {(fetcherData) => (
                            <StaticRouter context={{}} location={req.originalUrl}>
                                <ServerRouter store={store} intialData={fetcherData} />
                            </StaticRouter>
                        )}
                    </PPRRouteBoundary>
                </Provider>
            </PPRDataProvider>
        </SsrRequestProvider>
    </div>
)

// The PPR context wraps the whole document, not just #app, so <PPRDynamic> in the app's
// Document (CSRF input, per-user scripts) is postponed out of the shell too.
const PPRDocument = ({ phase, routeData, shellStart, store, req, res, nonce, tree }) => {
    const shellEnd = renderEnd(store.getState(), res, tree, null, {})
    return (
        <PPRRenderProvider value={{ phase, routeData }}>
            {renderDocument({ ...shellStart, ...shellEnd, jsx: tree, req, res, nonce, pprShell: true })}
        </PPRRenderProvider>
    )
}

// Cookie values long enough to be identifiers (session, visitor id, tokens).
const findRequestValuesInShell = (html, req) => {
    const leaked = []
    for (const [name, value] of Object.entries(req.cookies || {})) {
        const v = typeof value === "string" ? value : ""
        // Whole value and its parts: some cookies pack several tokens (csrf-csrf: token|hash).
        const parts = [v, ...v.split(/[|:.]/)].filter((p) => p.length >= 12)
        if (parts.some((p) => html.includes(p) || html.includes(encodeURIComponent(p)))) leaked.push(name)
    }
    return leaked
}

const prerenderPPRShell = async ({
    key,
    req,
    res,
    store,
    allMatches,
    chunkExtractor,
    metaTags,
    fallback,
    appNonce,
    catalystNonce,
    signature,
}) => {
    // The shell is shared, so it must not carry this response's nonce. Render it with a
    // placeholder (the app's Document reads res.locals.cspNonce) and swap in each
    // response's own nonce when the shell is written.
    const placeholder = appNonce ? createNoncePlaceholder() : null
    const locals = res.locals || {}
    const hadLocalsNonce = Object.prototype.hasOwnProperty.call(locals, "cspNonce")
    const prevLocalsNonce = locals.cspNonce
    if (placeholder) locals.cspNonce = placeholder
    const shellNonce = catalystNonce ? placeholder : undefined

    try {
        const { shellStart, deferredCssPaths } = buildShellStart(
            req,
            allMatches,
            chunkExtractor,
            metaTags,
            false,
            {},
            shellNonce
        )
        const tree = getPPRAppTree({
            store,
            req,
            chunkExtractor,
            phase: "prerender",
            fallback,
            cacheKey: getPathname(req),
        })

        // The hole never settles while prerendering, so the render is cut once the static
        // parts are done; the hole and anything still pending is postponed.
        const controller = new AbortController()
        let renderError = null
        const timer = setTimeout(
            () => controller.abort(new Error("PPR shell complete")),
            PPR_PRERENDER_SETTLE_MS()
        )
        let result
        try {
            result = await prerenderToNodeStream(
                <PPRDocument
                    phase="prerender"
                    shellStart={shellStart}
                    store={store}
                    req={req}
                    res={res}
                    nonce={shellNonce}
                    tree={tree}
                />,
                {
                    signal: controller.signal,
                    nonce: placeholder || undefined,
                    progressiveChunkSize: PPR_PROGRESSIVE_CHUNK_SIZE(),
                    onError(error) {
                        if (!controller.signal.aborted) renderError = error
                    },
                }
            )
        } finally {
            clearTimeout(timer)
        }
        const prelude = result.prelude ? (await collectStream(result.prelude)).toString("utf8") : ""

        if (renderError) throw renderError
        if (!result.postponed) {
            getLogger().warn?.(`[PPR] ${key}: nothing was postponed; not caching a PPR shell`)
            return null
        }
        if (!prelude.includes("</head>") || !prelude.includes('<div id="app">')) {
            getLogger().warn?.(`[PPR] ${key}: shell is incomplete (head or #app missing); not caching`)
            return null
        }
        const leaked = findRequestValuesInShell(prelude, req)
        if (leaked.length) {
            getLogger().error?.(
                `[PPR] ${key}: shell contains request cookie values (${leaked.join(", ")}); not caching. ` +
                    "Wrap per-request markup in <PPRDynamic> or return null from getPPRShellKey."
            )
            return null
        }

        return {
            prelude: prepareReactScripts(prelude, placeholder),
            preloadOffset: findHeadPreloadOffset(prelude),
            postponed: JSON.stringify(result.postponed),
            placeholder,
            signature,
            cssPaths: deferredCssPaths,
            builtAt: Date.now(),
        }
    } catch (error) {
        console.error(`[PPR] Shell prerender failed for ${key}:`, error)
        safeCall(onRenderError, { req, res, store, error })
        return null
    } finally {
        if (placeholder) {
            if (hadLocalsNonce) locals.cspNonce = prevLocalsNonce
            else delete locals.cspNonce
        }
    }
}

const PPR_FAILED_RETRY_MS = 60 * 1000
const shellFailures = new Map()
// Priority image preloads learned from resumed responses (see ppr.js).
const learnedPreloads = new PreloadLearner()

/**
 * Serves a PPR route. Resolves true when the response was handled, false when this
 * request should take the classic path instead (no shell key, or the shell could not be
 * built). Never resolves false once anything has been written.
 */
const _renderMarkUpPPR = async ({ req, res, store, allMatches, cachedRoutes, nonce }) => {
    let appKey = ""
    if (typeof getPPRShellKey === "function") {
        try {
            appKey = getPPRShellKey({ req, res, store, matches: allMatches })
        } catch (error) {
            console.error("[PPR] getPPRShellKey failed; using the classic path:", error)
            return false
        }
        if (appKey === null || appKey === false) return false
    }

    // Last point where headers/cookies can be set (also before the shell is prerendered,
    // so the Document sees the same values in both renders).
    safeCall(beforePPRFlush, { req, res, store })
    if (res.headersSent) return true

    const cacheKey = getPathname(req)
    const key = `${cacheKey}|${appKey ?? ""}`
    const chunkExtractor = collectAssets(req, allMatches)
    const fallback = allMatches[allMatches.length - 1]?.route?.component?.pprFallback ?? null
    const metaTags = tracedGetMetaData(allMatches, {})
    // The nonce this response's CSP header uses (the app's middleware, or Catalyst's own).
    const appNonce = res.locals?.cspNonce || nonce

    // Rebuild the shell when the route has learned new deferred CSS/JS since it was built,
    // so the shell's inlined CSS and modulepreloads keep up with the classic path.
    const deferredRouteKey = getDeferredRouteKey(req, allMatches)
    const signature = cssSignature([
        ...getCachedDeferredCssPathsForRoute(deferredRouteKey),
        ...getDeferredPreloadScriptUrls(deferredRouteKey, []),
    ])

    // Development (vite dev server): rebuild the shell on every request so code edits show up.
    if (process.env.NODE_ENV === "development") shellCache.delete(key)
    let shell = shellCache.get(key)
    if (shell && shell.signature !== signature) {
        shellCache.delete(key)
        shell = null
    }
    const hit = Boolean(shell)
    if (!shell) {
        // A key whose shell could not be built recently goes straight to the classic path
        // instead of paying for a prerender attempt on every request.
        if (shellFailures.has(key) && Date.now() - shellFailures.get(key) < PPR_FAILED_RETRY_MS) return false
        shell = await shellCache.build(key, () =>
            prerenderPPRShell({
                key,
                req,
                res,
                store,
                allMatches,
                chunkExtractor,
                metaTags,
                fallback,
                appNonce,
                catalystNonce: nonce,
                signature,
            })
        )
        if (!shell) {
            if (shellFailures.size > 1000) shellFailures.clear()
            shellFailures.set(key, Date.now())
        }
        if (!shell || res.headersSent) return Boolean(res.headersSent)
        shellFailures.delete(key)
    }

    const { buildDir, integrityManifest, shellStart } = buildShellStart(
        req,
        allMatches,
        chunkExtractor,
        metaTags,
        false,
        {},
        nonce
    )

    const guard = guardLateResponseCalls(res, getLogger())
    let statusCode = routeStatus(allMatches)
    let fetcherData = {}

    res.status(statusCode)
    res.setHeader("content-type", "text/html; charset=utf-8")
    res.setHeader("x-rendering-mode", hit ? "ppr-hit" : "ppr-miss")

    // Route data runs while the shell is on the wire. Same hooks as the classic path; the
    // status line is already sent, so a fetcher error is rendered by the app with the
    // status it would have had exposed as window.__STATUS_CODE__.
    const routeData = (async () => {
        try {
            const data = await tracedServerDataFetcher(
                { routes: cachedRoutes, req, res, url: req.originalUrl },
                { store }
            )
            fetcherData = data || {}
            const err = fetcherData?.[req.originalUrl]?.error
            if (err) {
                statusCode = err.status_code || 404
                safeCall(onFetcherError, { req, res, store, error: err })
            } else {
                safeCall(onFetcherSuccess, { req, res, store })
            }
        } catch (error) {
            console.error("Error in executing serverFetcher functions:", error)
            statusCode = 404
            safeCall(onFetcherError, { req, res, store, error })
        }
        return fetcherData
    })()

    let preloadKey = null
    if (isPreloadLearningEnabled()) {
        try {
            const extra = typeof getPPRPreloadKey === "function" ? getPPRPreloadKey({ req, res, store }) : ""
            preloadKey = `${key}|${extra ?? ""}`
        } catch (error) {
            console.error("[PPR] getPPRPreloadKey failed; no learned preloads for this request:", error)
        }
    }
    const learnPreloads = preloadKey !== null
    const preloads = learnPreloads ? learnedPreloads.get(preloadKey).join("") : ""
    res.write(applyNonce(insertAt(shell.prelude, shell.preloadOffset, preloads), shell.placeholder, appNonce))
    if (typeof res.flush === "function") res.flush()

    const requestCache = createPPRRequestCache()
    const tree = getPPRAppTree({
        store,
        req,
        chunkExtractor,
        phase: "resume",
        requestCache,
        fallback,
        cacheKey,
    })
    const nonceAttr = appNonce ? ` nonce="${appNonce}"` : ""
    const shellCss = new Set(shell.cssPaths)

    await new Promise((resolve) => {
        let timeout
        const resumed = []
        const done = () => {
            clearTimeout(timeout)
            guard.restore()
            resolve()
        }
        res.once("finish", done)
        res.once("close", () => {
            // Client went away: stop rendering and fetching for it.
            if (!res.writableFinished) abort?.(new Error("PPR client disconnected"))
            done()
        })

        const tail = new Transform({
            transform(chunk, _enc, cb) {
                if (learnPreloads) resumed.push(chunk)
                cb(null, chunk)
            },
            flush(cb) {
                try {
                    const deferredAssets = chunkExtractor.getDeferredAssets()
                    const renderedKeys = chunkExtractor.getRenderedComponentKeys()
                    // This request's state. Written after the app so it holds the fetched data;
                    // the client hydrates on/after DOMContentLoaded, when it has run.
                    this.push(
                        `<script${nonceAttr}>window.__CATALYST_PPR__=true;window.__CATALYST_IS_BOT__=false;` +
                            `window.__INITIAL_STATE__=${serializeForScript(store.getState())};` +
                            `window.__STATUS_CODE__=${Number(statusCode) || 200};` +
                            `window.__ROUTER_INITIAL_DATA__=${serializeForScript(fetcherData)};` +
                            `window.__SSR_RENDERED_COMPONENTS__=new Set(${serializeForScript(
                                renderedKeys
                            )});</script>`
                    )
                    this.push(routeCacheScript(requestCache, req, nonceAttr))
                    if (learnPreloads) {
                        const seen = extractPriorityImagePreloads(
                            Buffer.concat(resumed.map((c) => Buffer.from(c))).toString("utf8")
                        )
                        learnedPreloads.record(preloadKey, seen)
                    }
                    registerDeferredAssetsForRoute(deferredRouteKey, deferredAssets, false)
                    // CSS the shell does not already inline.
                    const missingCss = deferredAssets.css.filter((p) => p && !shellCss.has(p))
                    if (missingCss.length) {
                        this.push(`<style>${readCssFromDisk(missingCss, buildDir)}</style>`)
                    }
                    this.push(guard.scripts(appNonce))
                    this.push(generateScriptStrings(deferredAssets.js, appNonce, integrityManifest))
                } catch (error) {
                    console.error("[PPR] Failed to write the trailer:", error)
                }
                cb()
            },
        })
        tail.pipe(res)

        let abort
        const stream = resumeToPipeableStream(
            <PPRDocument
                phase="resume"
                routeData={routeData}
                shellStart={shellStart}
                store={store}
                req={req}
                res={res}
                nonce={nonce}
                tree={tree}
            />,
            JSON.parse(shell.postponed),
            {
                nonce: appNonce,
                onShellReady() {
                    pipe(tail)
                },
                onShellError(error) {
                    console.error(`[PPR] Resume failed for ${req.originalUrl}:`, error)
                    safeCall(onRenderError, { req, res, store, error })
                    tail.end()
                },
                onError(error) {
                    // Our own aborts (timeout, disconnect) are reported once where they happen.
                    if (/^PPR (resume timed out|client disconnected)/.test(error?.message || "")) return
                    console.error(`[PPR] Error while resuming ${req.originalUrl}:`, error)
                    safeCall(onRenderError, { req, res, store, error })
                },
            }
        )
        const { pipe } = stream
        abort = stream.abort
        // On timeout React marks what is still pending for client rendering and ends.
        timeout = setTimeout(() => {
            getLogger().warn?.(`[PPR] Resume of ${req.originalUrl} timed out; the rest renders on the client`)
            abort(new Error("PPR resume timed out"))
        }, PPR_RESUME_TIMEOUT_MS())
    })
    return true
}

const tracedRenderMarkUp = withObservability(SSR_SERVICE, _renderMarkUp, "renderMarkUp")
const tracedRenderMarkUpStatic = withObservability(SSR_SERVICE, _renderMarkUpStatic, "renderMarkUpStatic")
const tracedRenderMarkUpPPR = withObservability(SSR_SERVICE, _renderMarkUpPPR, "renderMarkUpPPR")
const tracedAppServerSideFunction = withObservability(
    SSR_SERVICE,
    (args) => App.serverSideFunction(args),
    "App.serverSideFunction"
)
const tracedServerDataFetcher = withObservability(SSR_SERVICE, serverDataFetcher, "serverDataFetcher")
const tracedGetMetaData = withSyncObservability(SSR_SERVICE, getMetaData, "getMetaData")

// ── Express middleware ──────────────────────────────────────────────────
/**
 * SSR request handler. Execution pipeline per request:
 *   1. Match route
 *   2. Static route (renderMode "static") with a cached page: replay it and stop
 *   3. App.serverSideFunction (app-level server hook; may set cookies or redirect)
 *   4a. PPR route (renderMode "ppr", PPR_ENABLE on, not a bot, getPPRShellKey not null):
 *       write the cached shell, then resume the app with this request's serverFetcher data
 *   4b. Otherwise: serverDataFetcher, then renderMarkUp → renderToPipeableStream
 *       (or a static prerender that is cached for the next request)
 *
 * res.headersSent is checked after each async step: if a user hook
 * (onRouteMatch, onFetcherSuccess, etc.) has already sent a response
 * (e.g. a redirect), we bail out early without attempting another render.
 */
async function _handler(req, res) {
    try {
        let context = {}
        let fetcherData = {}
        const store = validateConfigureStore(createStore) ? await createStore({}, req, res) : null

        // If app-level middleware already generated a nonce for its CSP header
        // (res.locals.cspNonce), reuse it so the header and the script tags match.
        // Otherwise generate one here and expose it the same way.
        const nonce = CSP_NONCE_ENABLE ? res.locals.cspNonce || generateNonce() : undefined
        if (nonce) res.locals.cspNonce = nonce

        const cachedRoutes = getCachedRoutes()
        // matchRoutes returns null (not []) when nothing matches (favicon.ico, probes).
        const allMatches = (cachedRoutes ? NestedMatchRoutes(cachedRoutes, req.baseUrl) : []) || []
        let allTags = []

        safeCall(onRouteMatch, { req, res, matches: allMatches, store })

        if (res.headersSent) return

        const renderMode = getRenderMode(allMatches)
        // A cached static page carries the nonce of the request that rendered it, so static
        // mode is skipped when the response uses a nonce-based CSP.
        const isStaticRoute = renderMode === "static" && !res.locals?.cspNonce
        if (isStaticRoute && !isStaticCacheBypassRequested(req)) {
            const cached = staticPageCache.get(getPathname(req))
            if (cached) {
                res.setHeader("x-rendering-mode", "static-cache-hit")
                res.status(cached.statusCode)
                res.set({ "content-type": "text/html; charset=utf-8" })
                res.end(cached.buffer)
                return
            }
        }
        const renderMarkUp = isStaticRoute ? tracedRenderMarkUpStatic : tracedRenderMarkUp

        try {
            await tracedAppServerSideFunction({ store, req, res })
            safeCall(onAppServerSideSuccess, { req, res, store })

            if (res.headersSent) return

            if (renderMode === "ppr" && isPPREnabled() && !isBotRequest(req)) {
                try {
                    const served = await tracedRenderMarkUpPPR({
                        req,
                        res,
                        store,
                        allMatches,
                        cachedRoutes,
                        nonce,
                    })
                    if (served || res.headersSent) return
                } catch (error) {
                    console.error("[PPR] Failed to serve PPR route:", error)
                    safeCall(onRenderError, { req, res, store, error })
                    if (res.headersSent) {
                        res.end()
                        return
                    }
                    // Nothing written yet: fall through to the classic path.
                }
            }

            try {
                fetcherData = await tracedServerDataFetcher(
                    { routes: cachedRoutes, req, res, url: req.originalUrl },
                    { store }
                )

                if (res.headersSent) return

                const err = fetcherData?.[req.originalUrl]?.error
                allTags = tracedGetMetaData(allMatches, fetcherData)
                const chunkExtractor = collectAssets(req, allMatches)

                if (err) {
                    safeCall(onFetcherError, { req, res, store, error: err })

                    if (res.headersSent) return

                    const statusCode = err.status_code || 404
                    await renderMarkUp(
                        statusCode,
                        req,
                        res,
                        allTags,
                        fetcherData,
                        store,
                        allMatches,
                        context,
                        chunkExtractor,
                        nonce
                    )
                } else {
                    safeCall(onFetcherSuccess, { req, res, store })

                    if (res.headersSent) return

                    await renderMarkUp(
                        null,
                        req,
                        res,
                        allTags,
                        fetcherData,
                        store,
                        allMatches,
                        context,
                        chunkExtractor,
                        nonce
                    )
                }
            } catch (error) {
                console.error("Error in executing serverFetcher functions:", error)
                safeCall(onFetcherError, { req, res, store, error })

                if (res.headersSent) return

                const chunkExtractor = collectAssets(req, allMatches)
                await renderMarkUp(
                    404,
                    req,
                    res,
                    allTags,
                    fetcherData,
                    store,
                    allMatches,
                    context,
                    chunkExtractor,
                    nonce
                )
            }
        } catch (error) {
            console.error("Error in executing serverSideFunction inside App:", error)
            safeCall(onAppServerSideError, { req, res, store, error })

            if (res.headersSent) return

            const chunkExtractor = collectAssets(req, allMatches)
            await renderMarkUp(
                error.status_code,
                req,
                res,
                allTags,
                fetcherData,
                store,
                allMatches,
                context,
                chunkExtractor,
                nonce
            )
        }
    } catch (error) {
        console.error("Error in handling document request:", error)
        safeCall(onRequestError, { req, res, error })
    }
}

const handler = withObservability(SSR_SERVICE, _handler, "handler")

export default handler
