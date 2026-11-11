/* global globalThis */
import React from "react"
import { renderStart, renderEnd } from "./render.js"
import { Provider } from "react-redux"
import { Body } from "./document/Body.jsx"
import { Head } from "./document/Head.jsx"

import { StaticRouter, matchRoutes as NestedMatchRoutes } from "react-router"
import ServerRouter from "../../router/ServerRouter.js"
import { renderToPipeableStream, resumeToPipeableStream } from "react-dom/server"
import { prerenderToNodeStream } from "react-dom/static"
import { getUserAgentDetails } from "../utils/userAgentUtil.js"
import { serverDataFetcher } from "../../web-router/components/RouterDataProvider.jsx"
import { getMetaData } from "../../web-router/utils/metaDataUtils.jsx"
import {
    validateConfigureStore,
    validateGetRoutes,
    validateCustomDocument,
    handleError,
    safeCall,
} from "../utils/validator.js"
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
import { getManifest, getAssetManifest } from "../manifestCache.js"
import { wrapSSRError, formatError } from "../../errors/index.js"
import { resolveOutputMode, getDebugEnvInfo } from "../../scripts/scriptUtils.js"

// Resolved once at module load — spawned via serve.js/start.js, which
// forward the mode as CATALYST_OUTPUT_MODE. Passed an empty argv on purpose:
// this process never sees the parent's CLI flags, so process.argv here would
// never contain --debug/--verbose — only CATALYST_OUTPUT_MODE is real input.
const outputMode = resolveOutputMode([], process.env)
const STAGE_LABEL: Record<string, string> = {
    RENDER: "render",
    FETCHER: "serverFetcher",
    SERVER_SIDE_FUNCTION: "serverSideFunction",
    REQUEST_HANDLING: "request",
}

// One failure is reported once. A render error used to surface at every catch
// site it bubbled through -- render, fetcher, serverSideFunction, request --
// each re-rendering the same broken tree, so one throw printed four coded
// reports and four stacks per request.
const reported = new WeakSet<object>()

// Marks an error that came out of rendering. The fetcher and
// serverSideFunction fallbacks re-render the page; re-rendering after the
// render itself failed only throws the same error again.
const RENDER_FAILED = Symbol.for("catalyst.renderFailed")

const asError = (error: any) => (error && typeof error === "object" ? error : new Error(String(error)))
const markRenderFailure = (error: any) => {
    const err = asError(error)
    err[RENDER_FAILED] = true
    // Already reported by the render path; a thrown string arrives here as a
    // fresh Error the outer catch would otherwise report a second time.
    reported.add(err)
    return err
}
const isRenderFailure = (error: any) => Boolean(error && typeof error === "object" && error[RENDER_FAILED])

const logSSRError = (stage: string, error: any, req?: any) => {
    if (error && typeof error === "object") {
        if (reported.has(error)) return
        reported.add(error)
    }
    const wrapped = wrapSSRError(stage, error)

    // This module is bundled into the app's build, so it cannot reach
    // catalyst-core's terminal renderer by path. The server that loads it
    // provides one (see expressServer.ts); a custom server without it gets the
    // registry's plain formatting.
    const report = (globalThis as any).__catalystReportRuntimeError
    if (typeof report === "function") {
        const where = req ? `${req.method} ${req.originalUrl}` : null
        report({
            error,
            code: wrapped.code,
            docs: wrapped.docUrl,
            scope: [where, STAGE_LABEL[stage]].filter(Boolean).join(" · "),
        })
        return
    }
    // Debug mode's boxed output already embeds the full stack trace (see
    // errors/index.js#formatDebug), so only default/verbose need the original
    // error printed separately to avoid losing the stack.
    const debugEnv = outputMode === "debug" ? getDebugEnvInfo() : undefined
    console.error(formatError(wrapped, outputMode, debugEnv))
    if (outputMode !== "debug") console.error(error)
}

/**
 * Finish a request whose handling failed. Without this a render error left the
 * response open: the browser spun until it timed out and the terminal was the
 * only place the failure showed.
 */
const sendFailure = (res: any, error: any) => {
    // Plain Node response calls, and never a throw: failing while reporting a
    // failure would turn one error into an unhandled rejection.
    try {
        if (res.headersSent) {
            if (!res.writableEnded) res.end()
            return
        }
        const detail =
            process.env.NODE_ENV !== "production" && error
                ? `\n\n${error?.message || String(error)}\n\nThe full error is in the terminal running catalyst start.`
                : ""
        res.statusCode = 500
        res.setHeader?.("content-type", "text/plain; charset=utf-8")
        res.end(`Internal Server Error${detail}`)
    } catch {
        // The connection is already gone; nothing left to tell it.
    }
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
        const getRoutesErr = validateGetRoutes(getRoutes)
        if (getRoutesErr) handleError(getRoutesErr)
        _cachedRoutes = getRoutesErr ? null : getRoutes()
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
    _onRequestError: any,
    getPPRShellKey: any,
    getPPRPreloadKey: any,
    beforePPRFlush: any
try {
    const hooks = await import("@catalyst/template/server/index.js")
    _onRouteMatch = hooks.onRouteMatch
    _onFetcherSuccess = hooks.onFetcherSuccess
    _onFetcherError = hooks.onFetcherError
    _onAppServerSideSuccess = hooks.onAppServerSideSuccess
    _onAppServerSideError = hooks.onAppServerSideError
    _onRenderError = hooks.onRenderError
    _onRequestError = hooks.onRequestError
    const pprHooks: any = hooks
    // PPR: ({ req, res, store, matches }) => string | null. The string is added to the shell
    // cache key (use it for every request property the shell's markup depends on, e.g.
    // language or platform). null/false serves this request on the classic path.
    getPPRShellKey = pprHooks.getPPRShellKey
    // PPR: ({ req, res, store }) => string. Added to the shell key for learned LCP image
    // preloads (see ppr.ts): every request property that changes image URLs but not the shell
    // (e.g. device pixel ratio). Throwing turns preload learning off for that request.
    getPPRPreloadKey = pprHooks.getPPRPreloadKey
    // PPR: ({ req, res, store }) => void. Runs right before the shell is written, the last
    // point where headers and cookies can be set (e.g. create a CSRF token whose cookie
    // has to go out with the headers).
    beforePPRFlush = pprHooks.beforePPRFlush
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

const getLogger = (): any => (globalThis as any).logger || console

// renderMode ("ppr" | "static" | undefined) lives on the leaf-matched route's component,
// next to serverFetcher/clientFetcher. matchRoutes orders matches root-first, so the last
// entry is the page being rendered. Unset means the classic (streaming) path.
const getRenderMode = (allMatches: any) => {
    const route = allMatches[allMatches.length - 1]?.route
    return (route?.Component || route?.component)?.renderMode
}
const getRouteComponent = (allMatches: any) => {
    const route = allMatches[allMatches.length - 1]?.route
    return route?.Component || route?.component
}

const isBotRequest = (req: any) => {
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    // Synthetic monitors (StatusCake) and AI crawlers also take the bot code path: no JS,
    // and split(... ssr: false ...) widgets render on the server (via SsrRequestContext).
    return !!(deviceDetails.googleBot || deviceDetails.aiBot || deviceDetails.statusCakeBot)
}

const getPathname = (req: any) => new URL(req.originalUrl, "http://localhost").pathname
// Static pages: route fetchers read req.query, so the (sorted) query is part of the key.
const getStaticCacheKey = (req: any) => {
    const url = new URL(req.originalUrl, "http://localhost")
    url.searchParams.delete("__refresh_static_cache") // dev bypass refreshes the plain entry
    url.searchParams.sort()
    const query = url.searchParams.toString()
    return query ? `${url.pathname}?${query}` : url.pathname
}

const routeStatus = (allMatches: any) => (allMatches.length && allMatches[0]?.route?.path === "*" ? 404 : 200)

function collectStream(stream: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        stream.on("data", (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        stream.on("end", () => resolve(Buffer.concat(chunks)))
        stream.on("error", reject)
    })
}

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

// requestCache: per-request store for usePPRRouteData. A PPR route can be served on this path
// (bots, PPR_ENABLE off, getPPRShellKey null); without a cache the hook calls its fetcher again
// when React retries the suspended component, and the client gets no cachedData to hydrate
// from, so it fetches a third time.
const getComponent = (
    store: any,
    context: any,
    req: any,
    fetcherData: any,
    isBot: any,
    chunkExtractor?: any,
    requestCache?: any
) => (
    <div id="app">
        <SsrRequestProviderAny value={{ isBot, chunkExtractor }}>
            <PPRDataProvider cacheKey={getPathname(req)} cache={requestCache}>
                <ProviderAny store={store}>
                    <StaticRouterAny context={context} location={req.originalUrl}>
                        <ServerRouter store={store} intialData={fetcherData} />
                    </StaticRouterAny>
                </ProviderAny>
            </PPRDataProvider>
        </SsrRequestProviderAny>
    </div>
)

// usePPRRouteData results for window.cachedData, so the client hydrates without refetching.
const routeCacheScript = (requestCache: any, req: any, nonceAttr = "") => {
    const cacheKey = getPathname(req)
    const routeCache = getRequestCachedData(requestCache, cacheKey)
    return routeCache === undefined
        ? ""
        : `<script${nonceAttr}>window.cachedData=${serializeForScript({ [cacheKey]: routeCache })}</script>`
}

// Shared <head>/<body> props for every render path.
const buildShellStart = (
    req: any,
    allMatches: any,
    chunkExtractor: any,
    metaTags: any,
    isBot: boolean,
    fetcherData: any
) => {
    // Critical assets → <head>
    const criticalAssets = chunkExtractor ? chunkExtractor.getCriticalAssets() : { js: [], css: [] }

    // Inline critical CSS from disk (small thanks to natural code-splitting)
    const buildDir = path.join(process.env.src_path!, process.env.BUILD_OUTPUT_PATH || "build")
    const inlineCss = readCssFromDisk(criticalAssets.css, buildDir)

    const deferredRouteKey = getDeferredRouteKey(req, allMatches)
    const deferredCssPaths = getCachedDeferredCssPathsForRoute(deferredRouteKey)
    const deferredRouteInlineCss = readCssFromDisk(deferredCssPaths, buildDir)

    const jsScripts = generateScriptElements(criticalAssets.js)
    const criticalPreloadLinks = generateModulePreloadLinkElements(criticalAssets.js, "critical-js")
    const deferredPreloadUrls = getDeferredPreloadScriptUrls(deferredRouteKey, criticalAssets.js)
    const deferredPreloadLinks = generateModulePreloadLinkElements(deferredPreloadUrls, "deferred-js")

    return {
        deferredRouteKey,
        buildDir,
        deferredCssPaths,
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

const renderDocument = (finalProps: any) => {
    // CustomDocument is an OPTIONAL export (server/document.js) — its
    // absence is valid, so PREFLIGHT-020 (missing) is not surfaced. If it
    // IS exported but isn't callable, flag it (PREFLIGHT-021) and fall
    // back to the built-in document rather than crashing the render.
    if (CustomDocument) {
        const customDocErr = validateCustomDocument(CustomDocument)
        if (customDocErr) handleError(customDocErr)
        else return CustomDocument(finalProps)
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
                pprShell={finalProps.pprShell}
            />
        </html>
    )
}

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
    const isBot = isBotRequest(req)
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

    const { deferredRouteKey, buildDir, shellStart } = buildShellStart(
        req,
        allMatches,
        chunkExtractor,
        metaTags,
        isBot,
        fetcherData
    )

    const state = store.getState()
    const requestCache = createPPRRequestCache()
    const jsx = getComponent(store, context, req, fetcherData, isBot, chunkExtractor, requestCache)
    const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)

    // The response status also reaches the document as `statusCode`, which Body
    // exposes as window.__STATUS_CODE__. `errorCode` stays for custom documents.
    const status = errorCode || routeStatus(allMatches)
    const finalProps: any = { ...shellStart, ...shellEnd, jsx, req, res, safeArea, statusCode: status }

    const CompleteDocument = () => renderDocument(finalProps)

    try {
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
                    this.push(routeCacheScript(requestCache, req))
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
            // destroy(error) below emits "error" on this stream. Unhandled, that
            // became an uncaughtException per render on top of the report
            // already printed; the failure is handled through reject().
            tail.on("error", () => {})
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
                    logSSRError("RENDER", error, req)
                    safeCall(onRenderError, { req, res, store, error })
                    cleanupSafeArea()
                    tail.destroy(error)
                    reject(markRenderFailure(error))
                },
            })
        })
    } catch (error: any) {
        cleanupSafeArea()
        logSSRError("RENDER", error, req)
        safeCall(onRenderError, { req, res, store, error })
        return Promise.reject(markRenderFailure(error))
    }
}

// ── Static (full-page cache) ─────────────────────────────────────────────
// A route opted into `Component.renderMode = "static"` is rendered once and the bytes are
// replayed to every later request, bots included. Only for pages that are identical for
// every visitor: no cookies, tokens or nonces in the markup.
const staticPageCache = new ShellCache()
export const clearStaticPageCache = () => staticPageCache.clear()

// Dev-only escape hatch: ?__refresh_static_cache re-renders (and re-caches) one static route.
const isStaticCacheBypassRequested = (req: any) =>
    process.env.NODE_ENV !== "production" && req.query?.__refresh_static_cache !== undefined

// Cookie values long enough to be identifiers (session, visitor id, tokens).
const findRequestValuesInShell = (html: string, req: any) => {
    const leaked: string[] = []
    for (const [name, value] of Object.entries(req.cookies || {})) {
        const v = typeof value === "string" ? value : ""
        // Whole value and its parts: some cookies pack several tokens (e.g. CSRF "token|hash").
        const parts = [v, ...v.split(/[|:.]/)].filter((part) => part.length >= 12)
        if (parts.some((part) => html.includes(part) || html.includes(encodeURIComponent(part))))
            leaked.push(name)
    }
    return leaked
}

const _renderMarkUpStatic = async (
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
    const cacheKey = getStaticCacheKey(req)
    // One canonical version for every visitor, so no per-request bot branching.
    const isBot = false
    const safeArea = { ...DEFAULT_SAFE_AREA_INSETS }

    const { deferredRouteKey, buildDir, shellStart } = buildShellStart(
        req,
        allMatches,
        chunkExtractor,
        metaTags,
        isBot,
        fetcherData
    )

    const status = errorCode || routeStatus(allMatches)
    const state = store.getState()
    const requestCache = createPPRRequestCache()
    const jsx = getComponent(store, context, req, fetcherData, isBot, chunkExtractor, requestCache)
    const shellEnd = renderEnd(state, res, jsx, errorCode, fetcherData)
    const finalProps: any = { ...shellStart, ...shellEnd, jsx, req, res, safeArea, statusCode: status }
    const CompleteDocument = () => renderDocument(finalProps)

    try {
        // No abort signal: waits for the whole tree, so the result is the complete page.
        const result: any = await prerenderToNodeStream(<CompleteDocument />)
        const preludeBuffer = result.prelude ? await collectStream(result.prelude) : Buffer.from("")

        const deferredAssets = chunkExtractor ? chunkExtractor.getDeferredAssets() : { js: [], css: [] }
        const trailerParts = [
            `<script>window.__CATALYST_IS_BOT__=false;</script>`,
            routeCacheScript(requestCache, req),
        ]
        if (chunkExtractor) {
            const renderedKeys = chunkExtractor.getRenderedComponentKeys()
            trailerParts.push(
                // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag - renderedKeys are internal bundler component-module keys, never request input, and are serialized for a script.
                `<script>window.__SSR_RENDERED_COMPONENTS__=new Set(${serializeForScript(renderedKeys)})</script>`
            )
        }
        const { newCssPaths } = registerDeferredAssetsForRoute(deferredRouteKey, deferredAssets, isBot)
        if (newCssPaths.length) {
            trailerParts.push(`<style>${readCssFromDisk(newCssPaths, buildDir)}</style>`)
        }
        trailerParts.push(generateScriptStrings(deferredAssets.js))

        const buffer = Buffer.concat([preludeBuffer, Buffer.from(trailerParts.join(""))])

        // Only cache a clean 200, never a transient error page or a redirect, and never a
        // page that carries this visitor's cookie values (it would be replayed to everyone).
        if (status === 200) {
            const leaked = findRequestValuesInShell(buffer.toString("utf8"), req)
            if (leaked.length) {
                getLogger().error?.(
                    `[Static] ${cacheKey}: page contains request cookie values (${leaked.join(", ")}); not caching`
                )
            } else {
                staticPageCache.set(cacheKey, { buffer, statusCode: status })
            }
        }

        res.setHeader("x-rendering-mode", "static-cache-miss")
        res.status(status)
        res.set({ "content-type": "text/html; charset=utf-8" })
        res.end(buffer)
    } catch (error: any) {
        logSSRError("RENDER", error, req)
        safeCall(onRenderError, { req, res, store, error })
        throw markRenderFailure(error)
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

const getPPRAppTree = ({ store, req, chunkExtractor, phase, requestCache, fallback, cacheKey }: any) => (
    <div id="app">
        <SsrRequestProviderAny value={{ isBot: false, chunkExtractor }}>
            <PPRDataProvider phase={phase} cacheKey={cacheKey} cache={requestCache}>
                <ProviderAny store={store}>
                    <PPRRouteBoundary fallback={fallback}>
                        {(fetcherData: any) => (
                            <StaticRouterAny context={{}} location={req.originalUrl}>
                                <ServerRouter store={store} intialData={fetcherData} />
                            </StaticRouterAny>
                        )}
                    </PPRRouteBoundary>
                </ProviderAny>
            </PPRDataProvider>
        </SsrRequestProviderAny>
    </div>
)

// The PPR context wraps the whole document, not just #app, so <PPRDynamic> in the app's
// Document (CSRF input, per-user scripts) is postponed out of the shell too.
const PPRDocument = ({ phase, routeData, shellStart, store, req, res, tree }: any) => {
    const shellEnd = renderEnd(store.getState(), res, tree, null, {})
    return (
        <PPRRenderProvider value={{ phase, routeData }}>
            {renderDocument({
                ...shellStart,
                ...shellEnd,
                jsx: tree,
                req,
                res,
                safeArea: { ...DEFAULT_SAFE_AREA_INSETS },
                statusCode: 200,
                pprShell: true,
            })}
        </PPRRenderProvider>
    )
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
    signature,
}: any) => {
    // The shell is shared, so it must not carry this response's nonce. Render it with a
    // placeholder (the app's Document reads res.locals.cspNonce) and swap in each
    // response's own nonce when the shell is written.
    const placeholder = appNonce ? createNoncePlaceholder() : null
    const locals = res.locals || {}
    const hadLocalsNonce = Object.prototype.hasOwnProperty.call(locals, "cspNonce")
    const prevLocalsNonce = locals.cspNonce
    if (placeholder) locals.cspNonce = placeholder

    try {
        const { shellStart, deferredCssPaths } = buildShellStart(
            req,
            allMatches,
            chunkExtractor,
            metaTags,
            false,
            {}
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
        let renderError: any = null
        const timer = setTimeout(
            () => controller.abort(new Error("PPR shell complete")),
            PPR_PRERENDER_SETTLE_MS()
        )
        let result: any
        try {
            result = await prerenderToNodeStream(
                <PPRDocument
                    phase="prerender"
                    shellStart={shellStart}
                    store={store}
                    req={req}
                    res={res}
                    tree={tree}
                />,
                {
                    signal: controller.signal,
                    nonce: placeholder || undefined,
                    progressiveChunkSize: PPR_PROGRESSIVE_CHUNK_SIZE(),
                    onError(error: any) {
                        if (!controller.signal.aborted) renderError = error
                    },
                } as any
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
    } catch (error: any) {
        logSSRError("RENDER", error, req)
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
const LEARN_PRELOADS_MAX_BYTES = 512 * 1024
const shellFailures = new Map<string, number>()
// Priority image preloads learned from resumed responses (see ppr.ts).
const learnedPreloads = new PreloadLearner()

/**
 * Serves a PPR route. Resolves true when the response was handled, false when this
 * request should take the classic path instead (no shell key, or the shell could not be
 * built). Never resolves false once anything has been written.
 */
const _renderMarkUpPPR = async ({ req, res, store, allMatches, cachedRoutes }: any) => {
    let appKey: any = ""
    if (typeof getPPRShellKey === "function") {
        try {
            appKey = getPPRShellKey({ req, res, store, matches: allMatches })
        } catch (error) {
            getLogger().error?.("[PPR] getPPRShellKey failed; using the classic path:", error)
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
    const fallback = getRouteComponent(allMatches)?.pprFallback ?? null
    const metaTags = tracedGetMetaData(allMatches, {})
    // The nonce this response's CSP header uses, when the app sets one.
    const appNonce = res.locals?.cspNonce

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
        const failedAt = shellFailures.get(key)
        if (failedAt !== undefined && Date.now() - failedAt < PPR_FAILED_RETRY_MS) return false
        // Too many shells being built at once (many distinct keys): serve this one classic.
        if (shellCache.isSaturated(key)) return false
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

    const { buildDir, shellStart } = buildShellStart(req, allMatches, chunkExtractor, metaTags, false, {})

    const guard = guardLateResponseCalls(res, getLogger())
    let statusCode = routeStatus(allMatches)
    let fetcherData: any = {}

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
        } catch (error: any) {
            logSSRError("FETCHER", error, req)
            statusCode = 404
            safeCall(onFetcherError, { req, res, store, error })
        }
        return fetcherData
    })()
    // Late cookie/redirect calls stay guarded until route data settles, even if the client
    // goes away first; restore() is idempotent.
    const restoreGuard = () => routeData.finally(() => guard.restore())

    // A fetcher may have redirected or ended the response before its first await.
    if (res.headersSent || res.writableEnded) {
        restoreGuard()
        return true
    }

    let preloadKey: string | null = null
    if (isPreloadLearningEnabled()) {
        try {
            const extra = typeof getPPRPreloadKey === "function" ? getPPRPreloadKey({ req, res, store }) : ""
            preloadKey = `${key}|${extra ?? ""}`
        } catch (error) {
            getLogger().error?.("[PPR] getPPRPreloadKey failed; no learned preloads for this request:", error)
        }
    }
    const learnPreloads = preloadKey !== null
    const preloads = learnPreloads ? learnedPreloads.get(preloadKey as string).join("") : ""
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

    await new Promise<void>((resolve) => {
        let timeout: any
        let abort: any
        // Start of the resumed output, where React writes the priority image preloads.
        const resumed: any[] = []
        let resumedBytes = 0
        const done = () => {
            clearTimeout(timeout)
            restoreGuard()
            resolve()
        }
        res.once("finish", done)
        res.once("close", () => {
            // Client went away: stop rendering and fetching for it.
            if (!res.writableFinished) abort?.(new Error("PPR client disconnected"))
            done()
        })

        const tail = new Transform({
            transform(chunk: any, _enc: any, cb: any) {
                if (learnPreloads && resumedBytes < LEARN_PRELOADS_MAX_BYTES) {
                    resumed.push(chunk)
                    resumedBytes += chunk.length
                }
                cb(null, chunk)
            },
            flush(cb: any) {
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
                            `window.__SSR_RENDERED_COMPONENTS__=new Set(${serializeForScript(renderedKeys)});</script>`
                    )
                    this.push(routeCacheScript(requestCache, req, nonceAttr))
                    if (learnPreloads) {
                        const seen = extractPriorityImagePreloads(
                            Buffer.concat(resumed.map((c) => Buffer.from(c))).toString("utf8")
                        )
                        learnedPreloads.record(preloadKey as string, seen)
                    }
                    registerDeferredAssetsForRoute(deferredRouteKey, deferredAssets, false)
                    // CSS the shell does not already inline.
                    const missingCss = deferredAssets.css.filter(
                        (cssPath: string) => cssPath && !shellCss.has(cssPath)
                    )
                    if (missingCss.length) {
                        this.push(`<style>${readCssFromDisk(missingCss, buildDir)}</style>`)
                    }
                    this.push(guard.scripts(appNonce))
                    this.push(
                        generateScriptStrings(deferredAssets.js).replace(/<script /g, `<script${nonceAttr} `)
                    )
                } catch (error) {
                    logSSRError("RENDER", error, req)
                }
                cb()
            },
        })
        tail.on("error", () => {})
        tail.pipe(res)

        const stream: any = resumeToPipeableStream(
            <PPRDocument
                phase="resume"
                routeData={routeData}
                shellStart={shellStart}
                store={store}
                req={req}
                res={res}
                tree={tree}
            />,
            JSON.parse(shell.postponed),
            {
                nonce: appNonce,
                onShellReady() {
                    pipe(tail)
                },
                onShellError(error: any) {
                    logSSRError("RENDER", error, req)
                    safeCall(onRenderError, { req, res, store, error })
                    tail.end()
                },
                onError(error: any) {
                    // Our own aborts (timeout, disconnect) are reported once where they happen.
                    if (/^PPR (resume timed out|client disconnected)/.test(error?.message || "")) return
                    logSSRError("RENDER", error, req)
                    safeCall(onRenderError, { req, res, store, error })
                },
            } as any
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
    (args: any) => App.serverSideFunction(args),
    "App.serverSideFunction"
)
const tracedServerDataFetcher = withObservability(SSR_SERVICE, serverDataFetcher, "serverDataFetcher")
const tracedGetMetaData = withSyncObservability(SSR_SERVICE, getMetaData, "getMetaData")

// ── Express middleware ──────────────────────────────────────────────────
/**
 * SSR request handler. Execution pipeline per request:
 *   1. Match route
 *   2. App.serverSideFunction (app-level server hook; may set cookies or redirect)
 *   3. Static route (renderMode "static") with a cached page: replay it and stop
 *   4a. PPR route (renderMode "ppr", PPR_ENABLE on, not a bot, getPPRShellKey not null):
 *       write the cached shell, then resume the app with this request's serverFetcher data
 *   4b. Otherwise: serverDataFetcher, then renderMarkUp → renderToPipeableStream
 *       (or a static prerender that is cached for the next request)
 *
 * res.headersSent is checked after each async step: if a user hook
 * (onRouteMatch, onFetcherSuccess, etc.) has already sent a response
 * (e.g. a redirect), we bail out early without attempting another render.
 */
async function _handler(req: any, res: any) {
    try {
        let context: any = {}
        let fetcherData: any = {}
        // A missing / non-function configureStore is not recoverable per
        // request: every downstream step (serverSideFunction, data fetchers,
        // render) assumes a real store. Log the coded error and fail the
        // request with a 500 rather than rendering with `store = null`, which
        // surfaces as a confusing render-time crash further down.
        const configureStoreErr = validateConfigureStore(createStore)
        if (configureStoreErr) {
            handleError(configureStoreErr)
            if (!res.headersSent) res.status(500).send("Internal Server Error")
            return
        }
        const store = await createStore({}, req, res)

        const cachedRoutes = getCachedRoutes()
        const allMatches = cachedRoutes ? NestedMatchRoutes(cachedRoutes, req.originalUrl) || [] : []
        let allTags: any = []

        safeCall(onRouteMatch, { req, res, matches: allMatches, store })

        if (res.headersSent) return

        const renderMode = getRenderMode(allMatches)
        // A cached static page or PPR shell is shared by every visitor, so requests that carry
        // per-request document values (a nonce-based CSP, native safe-area insets) use the
        // classic path.
        const hasSafeArea = parseSafeAreaFromHeaders(req) !== null
        const isStaticRoute = renderMode === "static" && !res.locals?.cspNonce && !hasSafeArea
        const renderMarkUp = isStaticRoute ? tracedRenderMarkUpStatic : tracedRenderMarkUp

        try {
            await tracedAppServerSideFunction({ store, req, res })
            safeCall(onAppServerSideSuccess, { req, res, store })

            if (res.headersSent) return

            // Static: replay a cached page only after App.serverSideFunction, so its redirects,
            // auth checks and cookies still apply to every request.
            if (isStaticRoute && !isStaticCacheBypassRequested(req)) {
                const cached = staticPageCache.get(getStaticCacheKey(req))
                if (cached) {
                    res.setHeader("x-rendering-mode", "static-cache-hit")
                    res.status(cached.statusCode)
                    res.set({ "content-type": "text/html; charset=utf-8" })
                    res.end(cached.buffer)
                    return
                }
            }

            if (renderMode === "ppr" && isPPREnabled() && !isBotRequest(req) && !hasSafeArea) {
                let served = false
                try {
                    served = await tracedRenderMarkUpPPR({ req, res, store, allMatches, cachedRoutes })
                } catch (error: any) {
                    logSSRError("RENDER", error, req)
                    safeCall(onRenderError, { req, res, store, error })
                    if (res.headersSent) {
                        if (!res.writableEnded) res.end()
                        return
                    }
                    // Nothing written yet: fall through to the classic path.
                }
                if (served || res.headersSent) return
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
                        chunkExtractor
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
                        chunkExtractor
                    )
                }
            } catch (error: any) {
                if (isRenderFailure(error)) throw error
                logSSRError("FETCHER", error, req)
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
                    chunkExtractor
                )
            }
        } catch (error: any) {
            if (isRenderFailure(error)) throw error
            logSSRError("SERVER_SIDE_FUNCTION", error, req)
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
                chunkExtractor
            )
        }
    } catch (error: any) {
        logSSRError("REQUEST_HANDLING", error, req)
        safeCall(onRequestError, { req, res, error })
        sendFailure(res, error)
    }
}

const handler = withObservability(SSR_SERVICE, _handler, "handler")

export default handler
