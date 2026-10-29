import React from "react"
import { renderStart, renderEnd } from "./render.js"
import { Provider } from "react-redux"
import { Body } from "./document/Body.jsx"
import { Head } from "./document/Head.jsx"

import { StaticRouter } from "react-router"
import ServerRouter from "../../router/ServerRouter.js"
import { renderToPipeableStream } from "react-dom/server"
import { getUserAgentDetails } from "../utils/userAgentUtil.js"
import { serverDataFetcher, matchRoutes as NestedMatchRoutes, getMetaData } from "../../index.jsx"
import { validateConfigureStore, validateGetRoutes, safeCall } from "../utils/validator.js"
import { ChunkExtractor } from "./ChunkExtractor.js"
import {
    readCssFromDisk,
    generateScriptElements,
    generateCssLinkStrings,
    generateScriptStrings,
    getDeferredRouteKey,
    getCachedDeferredCssPathsForRoute,
    registerDeferredAssetsForRoute,
    getDeferredPreloadScriptUrls,
    generateModulePreloadLinkElements,
    generateLinkHeader,
    generateCustomLinkHeader,
} from "./extract.js"
import path from "path"
import crypto from "node:crypto"
import { Transform } from "node:stream"

import CustomDocument from "@catalyst/template/server/document"

import App from "@catalyst/template/src/js/containers/App/index"
import { getRoutes } from "@catalyst/template/src/js/routes/utils"
import createStore from "@catalyst/template/src/js/store/index.js"
import { SsrRequestProvider } from "../../web-router/components/SsrRequestContext.jsx"
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
    _getEarlyHintLinks
try {
    const hooks = await import("@catalyst/template/server/index.js")
    _onRouteMatch = hooks.onRouteMatch
    _onFetcherSuccess = hooks.onFetcherSuccess
    _onFetcherError = hooks.onFetcherError
    _onAppServerSideSuccess = hooks.onAppServerSideSuccess
    _onAppServerSideError = hooks.onAppServerSideError
    _onRenderError = hooks.onRenderError
    _onRequestError = hooks.onRequestError
    _getEarlyHintLinks = hooks.getEarlyHintLinks
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

// Config-driven (config.json → CLOUDFLARE_EARLY_HINTS_ENABLE): when on, the early-hint links are
// also sent as a `Link` header on rendered responses so a fronting CDN (e.g. Cloudflare Early
// Hints) can learn them and replay them as a 103 on later requests to the same URL. Off by default.
const CLOUDFLARE_EARLY_HINTS_ENABLE = process.env.CLOUDFLARE_EARLY_HINTS_ENABLE === true

// Config-driven (config.json → NATIVE_EARLY_HINTS_ENABLE): when on, this server sends one HTTP 103
// via res.writeEarlyHints() right after route matching — before App.serverSideFunction and the
// data fetcher — so the *current* request benefits. Only one 103 is sent: browsers act on the
// first. Browsers only honour 103 over HTTP/2+, so the TLS hop in front (CDN/proxy) must forward
// it. Skipped for bots and non-GET requests. Off by default.
const NATIVE_EARLY_HINTS_ENABLE = process.env.NATIVE_EARLY_HINTS_ENABLE === true

// Config-driven (config.json → EARLY_HINTS_LINKS): static app-supplied preconnect/preload entries.
// JSON array of { url, rel: "preconnect"|"preload", as?, type?, crossorigin?, fetchPriority? }.
// URLs that change per release or request belong in the getEarlyHintLinks hook instead.
const EARLY_HINTS_LINKS = (() => {
    try {
        const parsed = JSON.parse(process.env.EARLY_HINTS_LINKS || "[]")
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
})()
const staticHintLinks = generateCustomLinkHeader(EARLY_HINTS_LINKS)

// Config-driven (config.json → EARLY_HINTS_MAX_DEFERRED_LINKS): how many split() chunks learned
// from earlier renders of the route are hinted at fetchpriority=low. Keeps the header (which a
// CDN may drop whole when oversized) small. Default 10; 0 disables; negative means no cap.
const EARLY_HINTS_MAX_DEFERRED_LINKS = (() => {
    const parsed = Number(process.env.EARLY_HINTS_MAX_DEFERRED_LINKS ?? 10)
    return Number.isFinite(parsed) ? parsed : 10
})()
const capDeferredHints = (urls) =>
    EARLY_HINTS_MAX_DEFERRED_LINKS < 0 ? urls : urls.slice(0, EARLY_HINTS_MAX_DEFERRED_LINKS)

// Config-driven (config.json → EARLY_HINTS_MAX_LINK_BYTES): byte budget for the hint list, which is
// sent both as the 103 and as the 200's `Link` header. A route's static-import closure can run to
// dozens of chunks, and proxies/CDNs reject or drop oversized response headers. Entries are kept in
// priority order (route scripts, app links, static deps, learned deferred) until the budget is
// spent; deps left out still get <link rel="modulepreload"> in the HTML. Default 4096; negative
// means no budget.
const EARLY_HINTS_MAX_LINK_BYTES = (() => {
    const parsed = Number(process.env.EARLY_HINTS_MAX_LINK_BYTES ?? 4096)
    return Number.isFinite(parsed) ? parsed : 4096
})()
const fitLinkBudget = (links) => {
    if (EARLY_HINTS_MAX_LINK_BYTES < 0) return links
    const kept = []
    let bytes = 0
    for (const link of links) {
        const size = link.length + (kept.length ? 2 : 0)
        if (bytes + size > EARLY_HINTS_MAX_LINK_BYTES) continue
        kept.push(link)
        bytes += size
    }
    return kept
}

const traceHook = (fn, spanName) =>
    typeof fn === "function" ? withSyncObservability(SSR_SERVICE, fn, spanName) : fn

const onRouteMatch = traceHook(_onRouteMatch, "onRouteMatch")
const onFetcherSuccess = traceHook(_onFetcherSuccess, "onFetcherSuccess")
const onFetcherError = traceHook(_onFetcherError, "onFetcherError")
const onAppServerSideSuccess = traceHook(_onAppServerSideSuccess, "onAppServerSideSuccess")
const onAppServerSideError = traceHook(_onAppServerSideError, "onAppServerSideError")
const onRenderError = traceHook(_onRenderError, "onRenderError")
const onRequestError = traceHook(_onRequestError, "onRequestError")

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

// ── Early Hints ────────────────────────────────────────────────────────
// Critical JS depends only on the matched route and the build manifests, so it is computed
// once per leaf route and reused.
const criticalHintCache = new Map()
const getCriticalHintLinks = (allMatches) => {
    const key = allMatches[allMatches.length - 1]?.route ?? null
    let hint = criticalHintCache.get(key)
    if (!hint) {
        const extractor = new ChunkExtractor({
            manifest: getManifest() || {},
            assetManifest: getAssetManifest() || {},
            registerGlobal: false,
        })
        extractor.preloadRouteCss(allMatches)
        const { js, scripts } = extractor.getCriticalAssets()
        const roots = new Set(scripts)
        const integrityManifest = getIntegrityManifest() || {}
        hint = {
            js,
            rootLinks: generateLinkHeader(scripts, "high", integrityManifest),
            depLinks: generateLinkHeader(
                js.filter((url) => !roots.has(url)),
                "high",
                integrityManifest
            ),
        }
        criticalHintCache.set(key, hint)
    }
    return hint
}

const getEarlyHintLinks = (req, res, allMatches) => {
    const critical = getCriticalHintLinks(allMatches)
    const deferredJs = getDeferredPreloadScriptUrls(getDeferredRouteKey(req, allMatches), critical.js)
    const appLinks = safeCall(_getEarlyHintLinks, { req, res, matches: allMatches })
    return fitLinkBudget([
        ...new Set([
            ...critical.rootLinks,
            ...staticHintLinks,
            ...generateCustomLinkHeader(Array.isArray(appLinks) ? appLinks : []),
            ...critical.depLinks,
            ...generateLinkHeader(capDeferredHints(deferredJs), "low", getIntegrityManifest() || {}),
        ]),
    ])
}

const isBotRequest = (req) => {
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    return !!(deviceDetails.googleBot || deviceDetails.aiBot || deviceDetails.statusCakeBot)
}

// ── JSX tree ───────────────────────────────────────────────────────────
const getComponent = (store, context, req, fetcherData, isBot) => (
    <div id="app">
        <SsrRequestProvider value={{ isBot }}>
            <Provider store={store}>
                <StaticRouter context={context} location={req.originalUrl}>
                    <ServerRouter store={store} intialData={fetcherData} />
                </StaticRouter>
            </Provider>
        </SsrRequestProvider>
    </div>
)

// ── Render and stream ──────────────────────────────────────────────────
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
    // Match mweb's wider definition: synthetic monitors (StatusCake) and AI crawlers
    // also need the bot code path — no JS, and split(... ssr: false ...) widgets that
    // previously read state.shellReducer.isBot now read this via SsrRequestContext.
    const isBot = isBotRequest(req)

    // Critical assets → <head>
    const criticalAssets = chunkExtractor
        ? chunkExtractor.getCriticalAssets()
        : { js: [], scripts: [], css: [] }

    // Inline critical CSS from disk (small thanks to natural code-splitting)
    const buildDir = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build")
    const inlineCss = readCssFromDisk(criticalAssets.css, buildDir)

    const deferredRouteKey = getDeferredRouteKey(req, allMatches)
    const deferredRouteInlineCss = readCssFromDisk(
        getCachedDeferredCssPathsForRoute(deferredRouteKey),
        buildDir
    )

    const integrityManifest = getIntegrityManifest() || {}
    const jsScripts = generateScriptElements(criticalAssets.scripts, nonce, integrityManifest)
    const criticalPreloadLinks = generateModulePreloadLinkElements(criticalAssets.js, "critical-js", nonce, integrityManifest)
    const deferredPreloadUrls = getDeferredPreloadScriptUrls(deferredRouteKey, criticalAssets.js)
    const deferredPreloadLinks = generateModulePreloadLinkElements(deferredPreloadUrls, "deferred-js", nonce, integrityManifest)

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
    const jsx = getComponent(store, context, req, fetcherData, isBot)
    const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)

    const finalProps = { ...shellStart, ...shellEnd, jsx, req, res, nonce }

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
                    nonce={finalProps.nonce}
                />
                <Body
                    initialState={finalProps.initialState}
                    jsx={finalProps.jsx}
                    statusCode={finalProps.statusCode}
                    fetcherData={finalProps.fetcherData}
                    nonce={finalProps.nonce}
                />
            </html>
        )
    }

    try {
        const status = errorCode || (allMatches.length && allMatches[0]?.route?.path === "*" ? 404 : 200)
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
                        : { js: [], scripts: [], css: [] }

                    const nonceAttr = nonce ? ` nonce="${nonce}"` : ""

                    // Tell client which components were SSR'd so split() can
                    // eagerly import them (prevents Suspense fallback flash)
                    this.push(
                        `<script${nonceAttr}>window.__CATALYST_IS_BOT__=${isBot ? "true" : "false"};</script>`
                    )
                    if (chunkExtractor) {
                        const renderedKeys = chunkExtractor.getRenderedComponentKeys()
                        this.push(
                            `<script${nonceAttr}>window.__SSR_RENDERED_COMPONENTS__=new Set(${JSON.stringify(renderedKeys)})</script>`
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
                        this.push(generateScriptStrings(deferredAssets.scripts, nonce, integrityManifest))
                    }

                    cb()
                },
            })
            tail.pipe(res)

            const { pipe } = renderToPipeableStream(<CompleteDocument />, {
                onShellReady() {
                    res.setHeader("content-type", "text/html")
                    if (res.locals.earlyHintLinks) res.append("link", res.locals.earlyHintLinks.join(", "))
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

const tracedRenderMarkUp = withObservability(SSR_SERVICE, _renderMarkUp, "renderMarkUp")
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
 *   1. Match route → collect assets
 *   2. App.serverSideFunction (app-level server hook)
 *   3. serverDataFetcher (route-level data fetching)
 *   4. renderMarkUp → renderToPipeableStream (stream to client)
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
        const allMatches = cachedRoutes ? NestedMatchRoutes(cachedRoutes, req.baseUrl) : []
        let allTags = []

        safeCall(onRouteMatch, { req, res, matches: allMatches, store })

        if (res.headersSent) return

        const sendNativeHints = NATIVE_EARLY_HINTS_ENABLE && req.method === "GET" && !isBotRequest(req)
        if (sendNativeHints || CLOUDFLARE_EARLY_HINTS_ENABLE) {
            const earlyHintLinks = getEarlyHintLinks(req, res, allMatches)
            if (earlyHintLinks.length) {
                if (sendNativeHints) res.writeEarlyHints({ link: earlyHintLinks })
                if (CLOUDFLARE_EARLY_HINTS_ENABLE) res.locals.earlyHintLinks = earlyHintLinks
            }
        }

        try {
            await tracedAppServerSideFunction({ store, req, res })
            safeCall(onAppServerSideSuccess, { req, res, store })

            if (res.headersSent) return

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
                    await tracedRenderMarkUp(
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

                    await tracedRenderMarkUp(
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
                await tracedRenderMarkUp(
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
            await tracedRenderMarkUp(
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
