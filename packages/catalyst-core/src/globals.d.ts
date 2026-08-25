// Injected by webpack DefinePlugin in base.babel.js at build time.
// Reflects which @catalyst/* packages are present in the app's node_modules.
declare const __CATALYST_PACKAGES__: {
    readonly ai: boolean
    readonly webAILocal: boolean
    readonly nativeAILocal: boolean
}

// `@catalyst/template` is the consuming application, aliased to the app root by
// the `_moduleAliases` entry in package.json. Those modules live in the app, not
// in this package, so there is nothing for TypeScript to resolve here — they are
// typed as `any` to model the framework/app boundary.
declare module "@catalyst/template/*" {
    const value: any
    export default value
    export const getRoutes: any
    export const onRouteMatch: any
    export const onFetcherSuccess: any
    export const onFetcherError: any
    export const onAppServerSideSuccess: any
    export const onAppServerSideError: any
    export const onRenderError: any
    export const onRequestError: any
    export const preparedRoutes: any
}

// Set per request by the SSR handler so client-side hydration can read the
// device safe-area insets that were used to render the shell.
declare var __SAFE_AREA_INITIAL__: any

// Globals owned by the native bridge (src/native/bridge). They are installed on
// `window` by code that lives outside this package's type graph — the native
// WebView host injects `NativeBridge` (Android) and `webkit.messageHandlers`
// (iOS), and `WebBridge.init()` attaches the web half — so there is nothing for
// TypeScript to resolve. They are typed as `any` to model that host boundary,
// matching how `@catalyst/template/*` models the framework/app boundary above.
//
// The bridge guards every one of these with a `typeof window === "undefined"`
// or truthiness check before use, because none of them exist under SSR or in a
// plain browser; declaring them here does not change that contract.
interface Window {
    /** Web half of the bridge, attached by `WebBridge.init()`. */
    WebBridge: any
    /** Android WebView bridge, injected by the native host. */
    NativeBridge: any
    /** iOS WKWebView message handlers, injected by the native host. */
    webkit: any
    /** Opt-in flag read by `WebBridge.init()` to load the perf collector. */
    __CATALYST_PROFILER_ENABLED: any
    /** Perf collector internals (src/native/bridge/perf). */
    CatalystPerf: any
    __catalystPerfCollector: any
    __catalystPerfStore: any
    __catalystPerfBatch: any
    __catalystPerfEvent: any
    /** Clock skew between the native host and the WebView, set by native. */
    __NATIVE_TIME_OFFSET: any
}

// Set on the server for the duration of one render by the SSR renderer, so
// split() can record which chunks a request actually touched.
declare var __CHUNK_EXTRACTOR__: any

// Inlined into the document by the SSR handler. `__SSR_RENDERED_COMPONENTS__`
// lists the cacheKeys server-rendered for this request, which split() uses to
// decide what to prefetch before hydration; `__CATALYST_IS_BOT__` mirrors the
// server's crawler decision so hydration matches the server output.
declare var __SSR_RENDERED_COMPONENTS__: any
declare var __CATALYST_IS_BOT__: any
