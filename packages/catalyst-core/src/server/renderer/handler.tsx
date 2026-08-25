/* global globalThis */
import React from "react"
import { renderStart, renderEnd } from "./render.js"
import { Provider } from "react-redux"
import { Body } from "./document/Body.jsx"
import { Head } from "./document/Head.jsx"

import { StaticRouter, matchRoutes as NestedMatchRoutes } from "react-router"
import ServerRouter from "../../router/ServerRouter.js"
import { renderToPipeableStream } from "react-dom/server"
import { getUserAgentDetails } from "../utils/userAgentUtil.js"
import { serverDataFetcher } from "../../web-router/components/RouterDataProvider.jsx"
import { getMetaData } from "../../web-router/utils/metaDataUtils.jsx"
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
import path from "path"
import { Transform } from "node:stream"

import CustomDocument from "@catalyst/template/server/document"

import App from "@catalyst/template/src/js/containers/App/index"
import { getRoutes } from "@catalyst/template/src/js/routes/utils"
import createStore from "@catalyst/template/src/js/store/index.js"
import { SsrRequestProvider } from "../../web-router/components/SsrRequestContext.jsx"
import { getManifest, getAssetManifest } from "../manifestCache.js"
import { wrapSSRError, formatError } from "../../errors/index.js"
import { resolveOutputMode, getDebugEnvInfo } from "../../scripts/scriptUtils.js"

// Resolved once at module load — spawned via serve.js/start.js, which
// forward the mode as CATALYST_OUTPUT_MODE. Passed an empty argv on purpose:
// this process never sees the parent's CLI flags, so process.argv here would
// never contain --debug/--verbose — only CATALYST_OUTPUT_MODE is real input.
const outputMode = resolveOutputMode([], process.env)
// Debug mode's boxed output already embeds the full stack trace (see
// errors/index.js#formatDebug), so only default/verbose need the original
// error printed separately to avoid losing the stack.
const logSSRError = (stage, error) => {
    const wrapped = wrapSSRError(stage, error)
    const debugEnv = outputMode === "debug" ? getDebugEnvInfo() : undefined
    console.error(formatError(wrapped, outputMode, debugEnv))
    if (outputMode !== "debug") console.error(error)
}

const DEFAULT_SAFE_AREA_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

const parseSafeAreaFromHeaders = (req: any) => {
    const readEdge = (header: string) => {
        const raw = req.get(header) ?? req.headers[header.toLowerCase()]
        const value = Number(raw)
        return Number.isFinite(value) && value >= 0 ? value : null
    }

    const top = readEdge("X-Safe-Area-Top")
    const right = readEdge("X-Safe-Area-Right")
    const bottom = readEdge("X-Safe-Area-Bottom")
    const left = readEdge("X-Safe-Area-Left")

    if (![top, right, bottom, left].some((value: any) => value !== null)) return null

    return {
        top: top ?? 0,
        right: right ?? 0,
        bottom: bottom ?? 0,
        left: left ?? 0,
    }
}

// App contract checks run at module load, not per request. The validators
// log-and-continue (see server/utils/validator.ts): a violation is reported once
// through the shared structured-error formatter at module load — server startup
// in production, first SSR request in dev — rather than being re-reported on
// every request or swallowed into onRequestError by _handler's try/catch.
validateGetRoutes(getRoutes)
validateConfigureStore(createStore)

// Routes are static for the lifetime of the server — resolve once and reuse
// the same instance per request to avoid per-request allocation.
let _cachedRoutes: any
const getCachedRoutes = () => {
    if (_cachedRoutes === undefined) {
        _cachedRoutes = getRoutes()
    }
    return _cachedRoutes
}

// Try to import user-defined hooks. These are optional — apps that don't export them
// will get undefined, and safeCall is a no-op for non-functions.
let _onRouteMatch: any,
    _onFetcherSuccess: any,
    _onFetcherError: any,
    _onAppServerSideSuccess: any,
    _onAppServerSideError: any,
    _onRenderError: any,
    _onRequestError: any
try {
    const hooks = await import("@catalyst/template/server/index.js")
    _onRouteMatch = hooks.onRouteMatch
    _onFetcherSuccess = hooks.onFetcherSuccess
    _onFetcherError = hooks.onFetcherError
    _onAppServerSideSuccess = hooks.onAppServerSideSuccess
    _onAppServerSideError = hooks.onAppServerSideError
    _onRenderError = hooks.onRenderError
    _onRequestError = hooks.onRequestError
} catch {
    // No hooks file — all hooks remain undefined, safeCall will skip them
}

// Passthrough no-ops used when OTEL_ENABLE is not set; replaced below if enabled.
let withObservability: any = (_service: any, fn: any) => fn
let withSyncObservability: any = (_service: any, fn: any) => fn

// config.json booleans survive the process.env swap in loadEnvironmentVariables(),
// so this is genuinely true at runtime when config sets OTEL_ENABLE: true. The cast
// exists only because TS types process.env values as string | undefined.
if ((process.env.OTEL_ENABLE as any) === true) {
    try {
        const otel = await import("../../otel.js")
        withObservability = otel.withObservability
        withSyncObservability = otel.withSyncObservability
    } catch {
        // otel packages not installed — continue without tracing
    }
}

const SSR_SERVICE = process.env.SERVICE_NAME || `pwa-${process.env.APPLICATION}-node-server`

const traceHook = (fn: any, spanName: string) =>
    typeof fn === "function" ? withSyncObservability(SSR_SERVICE, fn, spanName) : fn

const onRouteMatch = traceHook(_onRouteMatch, "onRouteMatch")
const onFetcherSuccess = traceHook(_onFetcherSuccess, "onFetcherSuccess")
const onFetcherError = traceHook(_onFetcherError, "onFetcherError")
const onAppServerSideSuccess = traceHook(_onAppServerSideSuccess, "onAppServerSideSuccess")
const onAppServerSideError = traceHook(_onAppServerSideError, "onAppServerSideError")
const onRenderError = traceHook(_onRenderError, "onRenderError")
const onRequestError = traceHook(_onRequestError, "onRequestError")

// ── Asset collection ───────────────────────────────────────────────────
const _collectAssets = (req: any, allMatches: any) => {
    const chunkExtractor = new ChunkExtractor({
        manifest: getManifest() || {},
        assetManifest: getAssetManifest() || {},
    })

    // Add route-matched CSS/JS to critical bucket (loaded in <head>)
    chunkExtractor.preloadRouteCss(allMatches)

    return chunkExtractor
}

const collectAssets = withSyncObservability(SSR_SERVICE, _collectAssets, "collectAssets")

// ── JSX tree ───────────────────────────────────────────────────────────
// Three type-only escape hatches in the tree below. They are declared here as
// plain aliases rather than inline @ts-expect-error comments, whose placement
// inside JSX is unreliable. The aliases are erased at compile time and change
// nothing at runtime.
//
//   - SsrRequestProvider / Provider are still .jsx, so TypeScript infers their
//     props from the implementation and does not model implicit JSX children.
//     Both aliases can go away once those modules are converted.
//   - `context` is a react-router v5 prop that v7's StaticRouter no longer
//     accepts or reads. It is kept because this conversion must not change
//     runtime behaviour; removing it is a separate change.
const SsrRequestProviderAny = SsrRequestProvider as any
const ProviderAny = Provider as any
const StaticRouterAny = StaticRouter as any

const getComponent = (store: any, context: any, req: any, fetcherData: any, isBot: any) => (
    <div id="app">
        <SsrRequestProviderAny value={{ isBot }}>
            <ProviderAny store={store}>
                <StaticRouterAny context={context} location={req.originalUrl}>
                    <ServerRouter store={store} intialData={fetcherData} />
                </StaticRouterAny>
            </ProviderAny>
        </SsrRequestProviderAny>
    </div>
)

// ── Render and stream ──────────────────────────────────────────────────
const _renderMarkUp = async (
    errorCode: any,
    req: any,
    res: any,
    metaTags: any,
    fetcherData: any,
    store: any,
    allMatches: any,
    context: any,
    chunkExtractor: any
) => {
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    // Match mweb's wider definition: synthetic monitors (StatusCake) and AI crawlers
    // also need the bot code path — no JS, and split(... ssr: false ...) widgets that
    // previously read state.shellReducer.isBot now read this via SsrRequestContext.
    const isBot = !!(deviceDetails.googleBot || deviceDetails.aiBot || deviceDetails.statusCakeBot)
    const safeArea = parseSafeAreaFromHeaders(req) || { ...DEFAULT_SAFE_AREA_INSETS }
    const previousSafeArea = globalThis.__SAFE_AREA_INITIAL__
    globalThis.__SAFE_AREA_INITIAL__ = safeArea

    const cleanupSafeArea = () => {
        if (previousSafeArea === undefined) {
            delete globalThis.__SAFE_AREA_INITIAL__
        } else {
            globalThis.__SAFE_AREA_INITIAL__ = previousSafeArea
        }
    }

    // Critical assets → <head>
    const criticalAssets = chunkExtractor ? chunkExtractor.getCriticalAssets() : { js: [], css: [] }

    // Inline critical CSS from disk (small thanks to natural code-splitting)
    const buildDir = path.join(process.env.src_path!, process.env.BUILD_OUTPUT_PATH || "build")
    const inlineCss = readCssFromDisk(criticalAssets.css, buildDir)

    const deferredRouteKey = getDeferredRouteKey(req, allMatches)
    const deferredRouteInlineCss = readCssFromDisk(
        getCachedDeferredCssPathsForRoute(deferredRouteKey),
        buildDir
    )

    const jsScripts = generateScriptElements(criticalAssets.js)
    const criticalPreloadLinks = generateModulePreloadLinkElements(criticalAssets.js, "critical-js")
    const deferredPreloadUrls = getDeferredPreloadScriptUrls(deferredRouteKey, criticalAssets.js)
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
    const jsx = getComponent(store, context, req, fetcherData, isBot)
    const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)

    const finalProps: any = { ...shellStart, ...shellEnd, jsx, req, res, safeArea }

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
                    safeArea={finalProps.safeArea}
                />
            </html>
        )
    }

    try {
        const status = errorCode || (allMatches.length && allMatches[0]?.route?.path === "*" ? 404 : 200)
        res.set({ "content-type": "text/html; charset=utf-8" })
        res.status(status)

        return new Promise<void>((resolve, reject) => {
            // Single completion path: React's pipe() auto-ends `tail`, and
            // `flush()` appends the deferred asset tags before that end
            // signal propagates to `res` via the plain pipe below. This
            // avoids the onShellReady/onAllReady race where React's own
            // stream-end and a manual res.end() compete to close `res`
            // (see issue #320).
            const tail = new Transform({
                transform(chunk: any, _enc: any, cb: any) {
                    cb(null, chunk)
                },
                flush(cb: any) {
                    // Deferred assets — injected after body (non-blocking)
                    const deferredAssets = chunkExtractor
                        ? chunkExtractor.getDeferredAssets()
                        : { js: [], css: [] }

                    // Tell client which components were SSR'd so split() can
                    // eagerly import them (prevents Suspense fallback flash)
                    this.push(`<script>window.__CATALYST_IS_BOT__=${isBot ? "true" : "false"};</script>`)
                    if (chunkExtractor) {
                        const renderedKeys = chunkExtractor.getRenderedComponentKeys()
                        this.push(
                            // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag - renderedKeys are internal bundler component-module keys tracked by ChunkExtractor, never request/user input, and are JSON.stringify-escaped before embedding.
                            `<script>window.__SSR_RENDERED_COMPONENTS__=new Set(${JSON.stringify(renderedKeys)})</script>`
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
                        this.push(generateScriptStrings(deferredAssets.js))
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
                    cleanupSafeArea()
                    resolve()
                },

                onError(error: any) {
                    logSSRError("RENDER", error)
                    safeCall(onRenderError, { req, res, store, error })
                    cleanupSafeArea()
                    tail.destroy(error)
                    reject(error)
                },
            })
        })
    } catch (error: any) {
        cleanupSafeArea()
        logSSRError("RENDER", error)
        safeCall(onRenderError, { req, res, store, error })
        return Promise.reject(error)
    }
}

const tracedRenderMarkUp = withObservability(SSR_SERVICE, _renderMarkUp, "renderMarkUp")
const tracedAppServerSideFunction = withObservability(
    SSR_SERVICE,
    (args: any) => App.serverSideFunction(args),
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
async function _handler(req: any, res: any) {
    try {
        let context: any = {}
        let fetcherData: any = {}
        const store = await createStore({}, req, res)

        const cachedRoutes = getCachedRoutes()
        const allMatches = cachedRoutes ? NestedMatchRoutes(cachedRoutes, req.originalUrl) || [] : []
        let allTags: any = []

        safeCall(onRouteMatch, { req, res, matches: allMatches, store })

        if (res.headersSent) return

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
                        chunkExtractor
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
                        chunkExtractor
                    )
                }
            } catch (error: any) {
                logSSRError("FETCHER", error)
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
                    chunkExtractor
                )
            }
        } catch (error: any) {
            logSSRError("SERVER_SIDE_FUNCTION", error)
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
                chunkExtractor
            )
        }
    } catch (error: any) {
        logSSRError("REQUEST_HANDLING", error)
        safeCall(onRequestError, { req, res, error })
    }
}

const handler = withObservability(SSR_SERVICE, _handler, "handler")

export default handler
