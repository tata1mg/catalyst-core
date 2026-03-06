# Catalyst Core – Repository Context

This document captures how Catalyst Core is wired together as a React-first universal framework so new contributors can reason about every layer quickly and spot the right leverage points for performance work.

## 1. Purpose & Capabilities

Catalyst positions itself as an isomorphic React stack with prefetching, configurable layouts, SSR/CSR parity, and SEO primitives baked in.

```13:38:README.md
## Overview

Catalyst offers a comprehensive suite of features designed for modern web development. It includes isomorphic rendering for optimal performance, an extendable server with full-stack capabilities, and configurable state management. The framework employs smart prefetching of data and chunks, allows easy configuration of global styles and layouts, and provides SEO optimization at both global and page levels.
```

## 2. Package Surface & Module Aliasing

The published package exposes multiple entry points (core, logger, caching helpers, router bindings, telemetry) and reserves a hierarchy of module aliases so template apps can import `@catalyst/*` paths without brittle relative links.

```13:33:package.json
    "_moduleAliases": {
        "@catalyst/template": ".",
        "@catalyst/template/src": "src",
        "@catalyst/template/routes": "src/js/routes",
        "@catalyst/template/server": "server",
        "@catalyst/template/store": "src/js/store",
        "@catalyst/template/config": "config",
        "@catalyst": ".",
        "@catalyst/root": "../",
        "@catalyst/router": "router",
        "@catalyst/scripts": "scripts",
        "@catalyst/server": "server",
        "@catalyst/webpack": "webpack"
    },
    "exports": {
        ".": "./dist/index.js",
        "./logger": "./dist/logger.js",
        "./caching": "./dist/caching.js",
        "./router/ClientRouter": "./dist/router/ClientRouter.js",
        "./sentry": "./dist/sentry.js",
        "./otel": "./dist/otel.js"
    },
```

The runtime replays these aliases for both Catalyst internals and consumer projects right before the server or build processes boot.

```1:51:src/scripts/registerAliases.js
import path from "path"
import moduleAlias from "module-alias"
import { _moduleAliases } from "../../package.json"
...
moduleAlias.addAliases(catalystResultMap)
...
    moduleAlias.addAliases(
        Object.keys(templateModuleAliases || []).reduce((resultMap, aliasName) => {
            const aliasPath = templateModuleAliases[aliasName]
            ...
            return resultMap
        }, {})
    )
```

## 3. CLI & Script Workflow

The `catalyst` binary dispatches to precompiled script entry points, ensuring every `start`, `build`, or `serve` command goes through consistent environment setup and error handling.

```1:39:bin/catalyst.js
const args = process.argv.slice(2)
...
if (["build", "start", "serve", "devBuild", "devServe"].includes(script)) {
    const result = spawnSync(
        process.execPath,
        nodeArgs.concat(require.resolve("../dist/scripts/" + script)).concat(args.slice(scriptIndex + 1)),
        { stdio: "inherit" }
    )
...
} else {
    console.log('Unknown script "' + script + '".')
}
```

The production build script chains version checks, cleans the build folder, executes both client and SSR webpack builds, and transpiles the user’s server code into the output directory before printing gzip stats.

```17:68:src/scripts/build.js
    const commands = [
        "node ./dist/scripts/checkVersion",
        `${isWindows ? "rd -r -fo" : "rm -rf"} ${process.cwd()}/${BUILD_OUTPUT_PATH} && node ./dist/scripts/loadScriptsBeforeServerStarts.js`,
        `cross-env APPLICATION=${name || "catalyst_app"} webpack --config ./dist/webpack/production.client.babel.js --progress`,
        `cross-env APPLICATION=${name || "catalyst_app"} SSR=true webpack --config ./dist/webpack/production.ssr.babel.js`,
        ...
    ]
...
        printBundleInformation()
        console.log(`\nThe ${cyan(BUILD_OUTPUT_PATH)} folder is ready to be deployed.`)
```

The dev `start` command spawns two long‑running processes (client bundler + Express server with file watching) under a shared environment, so hot reload and server restarts stay in sync.

```16:74:src/scripts/start.js
    const command = `
    node ./dist/scripts/checkVersion
    npx babel-node -r ./dist/scripts/loadScriptsBeforeServerStarts.js ./dist/webpack/development.client.babel ... &
    npx babel-node -r ./dist/scripts/loadScriptsBeforeServerStarts.js ./dist/server/startServer.js --extensions .js,.ts,.jsx,.tsx --watch-path=${process.env.PWD}/server --watch-path=${process.env.PWD}/src ...
    `
...
        spawnSync(command, [], {
            cwd: dirname,
            stdio: "inherit",
            shell: true,
            env: {
                ...process.env,
                src_path: process.cwd(),
                NODE_ENV: "development",
                IS_DEV_COMMAND: false,
                APPLICATION: name || "catalyst_app",
                BUILD_OUTPUT_PATH: BUILD_OUTPUT_PATH,
                ...argumentsObject,
            },
        })
```

## 4. Environment Setup & Logging

Before any server or webpack code executes, Catalyst loads the consuming app’s `config/config.json` into `process.env`, registers module aliases, and configures the logger. CSS modules are transpiled on the fly during development for SSR parity.

```1:31:src/scripts/loadScriptsBeforeServerStarts.js
import "./registerAliases.js"
...
loadEnvironmentVariables()
...
configureLogger({
    enableDebugLogs: process.env.ENABLE_DEBUG_LOGS,
    ...
})
...
if (process.env.NODE_ENV === "development")
    csshook({
        extensions: [".scss", ".css"],
        processorOpts: { parser: postcssScssParser.parse },
        generateScopedName: cssModulesIdentifierDev,
        devMode: true,
        ignore: path.posix.join(process.env.src_path, "/src/static/css/base/(?!.*.scss$).*"),
    })
```

The logger wires console transports and three rotating file streams by default, exposing `logger.info/debug/error` globally for all other layers.

```16:79:src/logger.js
const configureLogger = (config = {}) => {
    const { enableDebugLogs = true, enableFileLogging = true, enableConsoleLogging = true } = config
    ...
    if (enableConsoleLogging && JSON.parse(enableConsoleLogging)) {
        infoLogger.add(consoleTransport)
        ...
    }
    if (enableFileLogging && JSON.parse(enableFileLogging)) {
        infoLogger.add(fileTransport("info"))
        ...
    }
    const Logger = {
        debug: () => {},
        error: (msg) => { ... },
        info: (msg) => { ... },
    }
    ...
    if (global) global.logger = Logger
    return Logger
}
```

## 5. Bundling & Asset Pipeline

All webpack configurations share a base that targets the user app’s `client/index.js`, emits hashed assets, and treats CSS/SCSS files differently depending on whether they are global or modular.

```69:223:src/webpack/base.babel.js
export default {
    context: path.resolve(process.env.src_path),
    mode: isDev ? "development" : "production",
    entry: { app: [path.resolve(process.env.src_path, "./client/index.js")] },
    output: {
        path: path.join(process.env.src_path, `${process.env.BUILD_OUTPUT_PATH}/public`),
        filename: process.env.NODE_ENV === "development" ? "[name].bundle.js" : "[name].[contenthash].js",
        chunkFilename: ...,
        publicPath: publicPath,
    },
    resolve: {
        extensions: [".js", ".jsx", ".scss", ".ts", ".tsx"],
        alias: Object.keys(_moduleAliases || {}).reduce(...),
    },
    module: {
        rules: [
            { test: /\.jsx$|\.js$/, use: { loader: "babel-loader", options: isSSR ? ... } },
            ...
            {
                test: /\.scss$/,
                exclude: [...],
                use: [
                    isDev && "css-hot-loader",
                    !isSSR && MiniCssExtractPlugin.loader,
                    { loader: "css-loader", options: { modules: {...} } },
                    ...
                ],
            },
            ...
        ],
    },
}
```

The development pipeline spins up two compilers: one webpack-dev-server instance with React Refresh plus a dedicated SSR compiler that outputs `handler.development.js` into `.catalyst-dev`. Both watch for changes and clean up after exit.

```20:205:src/webpack/development.client.babel.js
const webpackClientConfig = merge(baseConfig, {
    devtool: "inline-source-map",
    plugins: [
        new LoadablePlugin({ filename: "loadable-stats.json", writeToDisk: { filename: path.join(__dirname, "../..") } }),
        new ReactRefreshWebpackPlugin({ overlay: { entry: false } }),
        ...
    ],
    optimization: { runtimeChunk: "single", splitChunks: { cacheGroups: { commonVendor: {...}, utilityVendor: {...} } } },
})
const webpackSSRConfig = mergeWithCustomize(...)(baseConfig, {
    target: "node",
    entry: { handler: path.resolve(__dirname, "..", "./server/renderer/handler.js") },
    externals: [nodeExternals(...), nodeExternals(...)],
    output: {
        path: path.join(__dirname, "../..", ".catalyst-dev", "/server", "/renderer"),
        filename: "handler.development.js",
        libraryTarget: "commonjs",
    },
    plugins: [new LoadablePlugin(...), new MiniCssExtractPlugin(...), ...],
})
const ssrCompiler = webpack(webpackSSRConfig)
const watchInstance = ssrCompiler.watch(...)
let devServer = new WebpackDevServer({ port: WEBPACK_DEV_SERVER_PORT, host: WEBPACK_DEV_SERVER_HOSTNAME, hot: true, ... }, webpack(webpackClientConfig))
...
process.on("SIGINT", cleanup)
```

## 6. Runtime Server Architecture

`startServer` listens for the latest loadable stats file and restarts Express automatically whenever the SSR bundle changes.

```45:135:src/server/startServer.js
const port = process.env.NODE_SERVER_PORT ?? 3005
...
let statsPath = path.join(__dirname, "../../", ".catalyst-dev", "/server", "/renderer", "handler.development.js")
if (env === "production") {
    statsPath = path.join(process.env.src_path, `${process.env.BUILD_OUTPUT_PATH}/public/loadable-stats.json`)
}
const watcher = chokidar.watch(statsPath, { persistent: true })
...
const startServer = () => {
    const server = require("./expressServer.js").default
    serverInstance = server.listen({ port, host }, (error) => {
        ...
    })
}
...
watcher.on("change", () => { ... serverInstance.close(() => startServer()) ... })
```

The Express server wires body parsing, cookie handling, optional user middlewares, compression, and static serving before delegating all requests to the React renderer.

```1:52:src/server/expressServer.js
const app = express()
app.use(bodyParser.json())
app.use(bodyParser.raw({ type: "application/*" }))
app.use(cookieParser())
if (validateMiddleware(addMiddlewares)) addMiddlewares(app)
app.use(compression())
if (env === "production") {
    app.use(
        process.env.PUBLIC_STATIC_ASSET_PATH,
        expressStaticGzip(path.join(process.env.src_path, `./${process.env.BUILD_OUTPUT_PATH}/public`), {
            enableBrotli: true,
            orderPreference: ["br", "gzip", "deflate"],
        })
    )
} else {
    app.use(process.env.PUBLIC_STATIC_ASSET_PATH, express.static(path.join(process.env.src_path, `./${process.env.BUILD_OUTPUT_PATH}/public`)))
}
app.use("*", ReactRenderer)
```

## 7. Rendering, Lifecycle Hooks & Data Fetching

The SSR handler orchestrates routing, store creation, server-side fetchers, head metadata, chunk extraction, and streaming HTML responses. It also exposes multiple lifecycle hooks (`preServerInit`, `onRouteMatch`, `onFetcherSuccess`, etc.) through the template’s `server/index.js`.

```53:120:src/server/renderer/handler.js
const getMatchRoutes = (routes, req, res, store, context, fetcherData, basePath = "", webExtractor) => {
    return routes.reduce((matches, route) => {
        const match = matchPath({ path: `${basePath}/${path}`, caseSensitive: false, end: true }, req.baseUrl || "/")
        if (match) {
            if (!res.locals.pageCss && !res.locals.preloadJSLinks && !res.locals.routePath) {
                res.locals.routePath = path
                extractAssets(res, route)
            }
            if (!res.locals.pageCss && !res.locals.preloadJSLinks) {
                renderToString(
                    <ChunkExtractorManager extractor={webExtractor}>
                        <Provider store={store}>
                            <StaticRouter context={context} location={req.originalUrl}>
                                <ServerRouter store={store} intialData={fetcherData} />
                            </StaticRouter>
                        </Provider>
                    </ChunkExtractorManager>
                )
            }
            matches.push({ route, match, serverSideFunction: (wc && wc.serverSideFunction) || (() => Promise.resolve()) })
        }
        ...
    }, [])
}
```

Rendering ultimately streams the custom document and injects first-fold CSS/JS once the tree is ready.

```122:220:src/server/renderer/handler.js
const renderMarkUp = async (...) => {
    const deviceDetails = getUserAgentDetails(req.headers["user-agent"] || "")
    const jsx = webExtractor.collectChunks(getComponent(store, context, req, fetcherData))
    let publicAssetPath = `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}`
    if (IS_DEV_COMMAND === "true") {
        publicAssetPath = `http://${WEBPACK_DEV_SERVER_HOSTNAME}:${WEBPACK_DEV_SERVER_PORT}/assets/`
    }
    let CompleteDocument = () => {
        if (validateCustomDocument(CustomDocument)) {
            return CustomDocument(finalProps)
        } else {
            return (
                <html lang={finalProps.lang}>
                    <Head ... />
                    <Body ... />
                </html>
            )
        }
    }
    return new Promise((resolve, reject) => {
        const { pipe } = renderToPipeableStream(<CompleteDocument />, {
            onShellReady() { pipe(res) },
            onAllReady() {
                const { firstFoldCss, firstFoldJS } = cacheAndFetchAssets({ webExtractor, res, isBot })
                res.write(firstFoldCss)
                res.write(firstFoldJS)
                res.end()
                resolve()
            },
            onError(error) {
                logger.error({ message: `\n Error while renderToPipeableStream : ${error.toString()}` })
                safeCall(onRenderError)
                reject(error)
            },
        })
    })
}
```

The handler executes the app shell’s `serverSideFunction`, route-level `serverFetcher` handlers, and metadata derivation before returning the response.

```266:334:src/server/renderer/handler.js
        await App.serverSideFunction({ store, req, res })
        ...
        fetcherData = await serverDataFetcher({ routes: routes, req, res, url: req.originalUrl }, { store })
        ...
        allTags = getMetaData(allMatches, fetcherData)
        safeCall(onFetcherSuccess, { req, res, fetcherData })
        ...
        renderMarkUp(null, req, res, allTags, fetcherData, store, matches, context, webExtractor)
```

Route data fetching semantics (client vs. server fetchers, hooks for refetch/clear) are spelled out in the bundled context document.

```165:248:context.md
TITLE: Data fetching in catalyst
...
1. **Client Fetcher** ... 2. **Server Fetcher** ...
Page.clientFetcher = async ({ route, location, params, searchParams, navigate }, { store }) => { ... }
Page.serverFetcher = async ({ route, location, params, searchParams, navigate },{ store }) => { ... }
...
useCurrentRouteData ... returns ... data, refetch, clear ...
```

### Document primitives & hydration state

The built-in `Head` and `Body` components centralize CSS/JS injection, meta tags, and serialization of Redux + router state so custom documents only need to wrap them.

```13:40:src/server/renderer/document/Head.js
export function Head(props) {
    ...
    return (
        <head>
            <meta charSet="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            {publicAssetPath && <link rel="preconnect" href={publicAssetPath} />}
            ...
            {pageCss && <style dangerouslySetInnerHTML={{ __html: pageCss }} />}
            {!isBot && preloadJSLinks}
        </head>
    )
}
```

```12:35:src/server/renderer/document/Body.js
export function Body(props) {
    const { jsx = "", initialState = {}, fetcherData = {}, children } = props
    return (
        <body>
            {jsx}
            <script
                dangerouslySetInnerHTML={{
                    __html: `
                    window.__INITIAL_STATE__ = ${JSON.stringify(initialState)}
                    window.__ROUTER_INITIAL_DATA__ = ${JSON.stringify(fetcherData)}
            `,
                }}
            />
            {children}
        </body>
    )
}
```

### Asset caching

CSS and preload link caching keeps repeat requests fast and avoids redundant file reads, while first-fold CSS/JS snippets are streamed inline for bots or cache misses.

```4:154:src/server/renderer/extract.js
export function cachePreloadJSLinks(key, data) {
    ...
    process.preloadJSLinkCache[key] = preloadJSLinks
}
export function cacheCSS(key, data) {
    ...
    if (process.env.NODE_ENV === "production") {
        data.map((assetChunk) => {
            ...
            pageCss += fs.readFileSync(path.resolve(process.env.src_path, `${process.env.BUILD_OUTPUT_PATH}/public`, assetName))
            ...
        })
    }
    ...
}
export default function (res, route) {
    const requestPath = route.path
    const cachedCss = fetchCachedCSS(requestPath)
    const cachedPreloadJSLinks = fetchPreloadJSLinkCache(requestPath)
    if (cachedCss || cachedPreloadJSLinks) {
        res.locals.pageCss = cachedCss
        res.locals.preloadJSLinks = cachedPreloadJSLinks
        return
    }
    logger.info({ message: "Cache Missed", uri: requestPath })
}
export const cacheAndFetchAssets = ({ webExtractor, res, isBot }) => {
    ...
    if (routePath) {
        if (isProd) {
            firstFoldCss = cacheCSS(routePath, linkElements)
            if (firstFoldCss?.length) firstFoldCss = `<style>${firstFoldCss}</style>`
        } else {
            cacheCSS(routePath, linkElements)
            firstFoldCss = webExtractor.getStyleTags()
        }
        firstFoldJS = webExtractor.getScriptTags()
    }
    ...
}
```

## 8. Router & App Shell

Catalyst wraps `@tata1mg/router` but lets template apps define their route tree once and reuse it for SSR and CSR through `preparedRoutes`.

```1:10:src/router/ClientRouter.js
import { createBrowserRouter } from "@tata1mg/router"
const { preparedRoutes } = require(`${process.env.src_path}/src/js/routes/utils.js`)
const clientRouter = ({ store, routerInitialState }) =>
    createBrowserRouter(preparedRoutes({ store, routerInitialState }))
```

```1:9:src/router/ServerRouter.js
import { useRoutes } from "@tata1mg/router"
const ServerRouter = (reduxData) => {
    const { store, intialData } = reduxData
    return useRoutes(preparedRoutes({ store, routerInitialState: intialData }))
}
```

The scaffolded app shell injects `RouterDataProvider`, `<MetaTag/>`, and `<App/>`, and each component can attach `clientFetcher`, `serverFetcher`, and `serverSideFunction` hooks.

```12:42:template/src/js/routes/utils.js
export const preparedRoutes = ({ routerInitialState }) => {
    const getPreparedRoutes = (routes) => {
        return routes.map((route, index) => {
            const Component = route.component
            const routeToRender = {
                ...route,
                element: <Component key={index} />,
            }
            if (route.children) {
                routeToRender.children = getPreparedRoutes(route.children)
            }
            return routeToRender
        })
    }
    return [
        {
            element: (
                <RouterDataProvider config={{}} initialState={routerInitialState}>
                    <MetaTag />
                    <App />
                </RouterDataProvider>
            ),
            children: getPreparedRoutes(routes),
        },
    ]
}
```

```1:17:template/src/js/containers/App/index.js
const App = () => {
    return (
        <>
            <Outlet />
        </>
    )
}
App.serverSideFunction = () => {
    return new Promise((resolve) => resolve())
}
```

## 9. Template Application & Extensibility

The `template/` folder doubles as the default project scaffold and living reference for best practices—loadable route definitions, config contract, custom document, server middlewares, and API abstraction.

```1:40:template/src/js/routes/index.js
const routes = [
    {
        path: "/",
        component: MainLayout,
        children: [
            { path: "", index: true, component: Home },
            { path: "breed/:breed", component: BreedDetails },
            { path: "about", component: About },
        ],
    },
]
```

```1:13:template/config/config.json
{
    "NODE_SERVER_HOSTNAME": "localhost",
    "NODE_SERVER_PORT": 3005,
    "WEBPACK_DEV_SERVER_HOSTNAME": "localhost",
    "WEBPACK_DEV_SERVER_PORT": 3006,
    "BUILD_OUTPUT_PATH": "build",
    "PUBLIC_STATIC_ASSET_PATH": "/assets/",
    "PUBLIC_STATIC_ASSET_URL": "http://localhost:3005",
    "API_URL": "random_api_url",
    "ANALYZE_BUNDLE": false,
    "CUSTOM_VAR": "custom",
    "CLIENT_ENV_VARIABLES": ["API_URL", "CUSTOM_VAR"]
}
```

```1:17:template/server/document.js
function Document(props) {
    return (
        <html lang="en">
            <Head {...props}>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                ...
            </Head>
            <Body {...props} />
        </html>
    )
}
```

```1:12:template/server/server.js
export function addMiddlewares(app) {
    app.use("/assets", express.static(path.join(__dirname, "../src/static/images")))
    app.use("/api", (req, res) => {
        res.send({ message: "With regards, from server" })
    })
}
```

```1:16:template/api.js
const fetchFunction = (url, options) => {
    let baseURL = process.env.API_URL
    let finalUrl = baseURL + url
    // Request Interceptor ...
    return fetch(finalUrl, options).then((response) => {
        return response.json().then((parsedResponse) => {
            // Response Interceptor ...
            return parsedResponse
        })
    })
}
```

Hydration happens via `template/client/index.js`, which waits for `loadableReady`, pulls `window.__ROUTER_INITIAL_DATA__`, and hydrates the router tree.

```1:23:template/client/index.js
window.addEventListener("load", () => {
    loadableReady(() => {
        const { __ROUTER_INITIAL_DATA__: routerInitialData } = window
        const router = clientRouter({ routerInitialState: routerInitialData })
        const Application = (
            <React.StrictMode>
                <RouterProvider router={router} />
            </React.StrictMode>
        )
        hydrateRoot(document.getElementById("app"), Application)
    })
})
```

Webpack customization hooks are centralized in `template/webpackConfig.js` so app authors can add plugins or transpile extra modules without forking core configs.

```1:6:template/webpackConfig.js
module.exports = {
    developmentPlugins: [],
    ssrPlugins: [],
    clientPlugins: [],
    transpileModules: [],
}
```

## 10. Observability & Resilience

Catalyst re-exports telemetry building blocks so apps can opt into OpenTelemetry traces/metrics, Sentry error capture, and the built-in React error boundary.

```16:140:src/otel.js
function init(config = {}) {
    const {
        serviceName = "catalyst-server",
        serviceVersion = "1.0.0",
        environment = "development",
        traceUrl = "http://localhost:4318/v1/traces",
        ...
    } = config
    ...
    const sdk = new NodeSDK({
        resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName, ... }),
        spanProcessor: new BatchSpanProcessor(otlpTraceExporter, { ... }),
        metricReader: new PeriodicExportingMetricReader({ exporter: otlpMetricExporter, exportIntervalMillis }),
        instrumentations: [getNodeAutoInstrumentations()],
    })
    sdk.start()
    ...
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
    process.on("SIGINT", () => gracefulShutdown("SIGINT"))
    return { sdk, meter }
}
```

```29:115:src/sentry.js
const Sentry = getSentryInstance()
export function init() {
    if (sentryInitialized) { ... }
    let sentryConfig = process.env.SENTRY_CONFIG
    ...
    if (!sentryConfig.dsn) {
        console.warn("Sentry DSN not found in configuration, skipping initialization")
        return
    }
    try {
        if (isServer) {
            Sentry.init({ dsn: sentryConfig.dsn, tracesSampleRate: sentryConfig.tracesSampleRate || 1.0, ... })
        } else {
            Sentry.init({ ... })
        }
        sentryInitialized = true
    } catch (error) {
        console.error("Failed to initialize Sentry:", error.message)
        return
    }
}
export class ErrorBoundary extends React.Component {
    ...
    componentDidCatch(error, errorInfo) {
        captureException(error, { componentStack: errorInfo.componentStack })
    }
    ...
}
```

## 11. Universal App & Native Bridges

The `context.md` knowledge base doubles as documentation for the universal (web + native shell) story: scaffolding commands, emulator setup, cache management, build optimization, whitelisting, splash screens, native APIs (camera, file picker, haptics), and device/protocol configuration.

```632:914:context.md
-   Catalyst also provides support to build native iOS/android applications
...
TITLE: Universal App Cache Management
...
Configure caching through the `config.json` file:
{
    "WEBVIEW_CONFIG": {
        "android": {
            "buildType": "debug",
            "cachePattern": "*.css,*.js"
        }
    }
}
...
TITLE: Universal App Build Optimization
...
The Build Optimization feature significantly enhances performance by preloading static assets directly from device storage rather than retrieving them over the network. This approach reduces page load times by approximately 90%, especially for the initial app launch.
```

## 12. Performance Characteristics & Opportunities

Existing optimizations:

- Streaming SSR via `renderToPipeableStream` with first-fold CSS/JS injection keeps TTFB low and bots served with fully inlined assets (`src/server/renderer/handler.js` & `extract.js`).
- Route-specific CSS and preload caches prevent redundant filesystem reads after the first request per route (`src/server/renderer/extract.js`).
- Webpack split-chunk defaults isolate React + router stacks into shared vendors for better long-term caching (`src/webpack/development.client.babel.js` and production equivalents).

Opportunities to improve responsiveness further:

1. **Avoid double-rendering during route matching.** `getMatchRoutes` renders the entire `ServerRouter` tree with `renderToString` purely to populate loadable contexts even before the actual streaming render, doubling React work per request. Consider precomputing assets without a full render, or reusing the initial render output instead of discarding it.

   ```55:80:src/server/renderer/handler.js
            if (!res.locals.pageCss && !res.locals.preloadJSLinks) {
                renderToString(
                    <ChunkExtractorManager extractor={webExtractor}>
                        <Provider store={store}>
                            <StaticRouter context={context} location={req.originalUrl}>
                                <ServerRouter store={store} intialData={fetcherData} />
                            </StaticRouter>
                        </Provider>
                    </ChunkExtractorManager>
                )
            }
   ```

2. **Move CSS cache hydration off the request thread.** When a route is first hit, the server synchronously reads every CSS asset via `fs.readFileSync`, which blocks the event loop for large pages. Precomputing CSS blobs after build or switching to async reads with memoization would shave latency spikes.

   ```33:55:src/server/renderer/extract.js
            if (process.env.NODE_ENV === "production") {
                data.map((assetChunk) => {
                    ...
                    if (ext === ".css") {
                        if (!listOfCachedAssets[assetName] && !process.cssCache?.[key]?.listOfCachedAssets?.[assetName]) {
                            pageCss += fs.readFileSync(
                                path.resolve(
                                    process.env.src_path,
                                    `${process.env.BUILD_OUTPUT_PATH}/public`,
                                    assetName
                                )
                            )
                            listOfCachedAssets[assetName] = true
                        }
                    }
                })
            }
   ```

3. **Parallelize production builds.** `src/scripts/build.js` currently joins the entire build pipeline into one long shell command executed via `spawnSync`, so webpack client/SSR and Babel transpilation always run serially. Splitting them into discrete async processes (with failure aggregation) would cut build times substantially on multi-core machines.

4. **Instrument lifecycle hooks for slow fetchers.** Hooks like `onFetcherSuccess` exist but do not log duration or per-route payload sizes. Wrapping `serverDataFetcher` promises with timing metrics (emit via logger or OTEL) will surface bottlenecks across routes without extra tooling.

## 13. Contribution Tips

- Always run `npm run start` for iterative work so both the webpack-dev-server and SSR watcher stay synchronized (`src/scripts/start.js`).
- Keep `config/config.json` aligned with the required keys enforced by `scripts/validator.js`, otherwise environment bootstrapping fails early.
- Extend the template project (inside each consuming repo) rather than modifying `src/` files directly unless you are changing the framework itself—`template/` is intentionally exhaustive so new features can ship with runnable examples.
- For performance investigations, start by tracing server logs emitted by the global logger and add OTEL instrumentation (via `src/otel.js`) around the suspected sections before making invasive changes.

## 14. Additional Performance Improvement Suggestions

1. **Warm chunk metadata after build.** Once `webpack --config production.ssr.babel.js` finishes, asynchronously execute a small script that loads `loadable-stats.json` and walks the route tree (`template/src/js/routes/index.js`). Persist the resulting `{routePath -> css/js assets}` map alongside the build so `extract.js` can hydrate caches without calling `renderToString` or reading CSS files on the first request.

2. **Adopt HTTP/2 server push equivalents via `Link` headers.** The `Head` component already emits `<link rel="preconnect">` and preload tags, but adding `res.setHeader("Link", ...)` inside `renderMarkUp` (`src/server/renderer/handler.js`) for critical CSS/JS improves multiplexed transfers on HTTP/2 and requires zero client changes.

3. **Gate router data refetches behind stale checks.** Hooks like `useCurrentRouteData` can flood fetchers with redundant calls when components remount quickly. Introduce a tiny cache layer in `@tata1mg/router` integration (e.g., store.lastFetchedAt keyed by route) so `refetch` short-circuits when params/search have not changed within a configurable TTL.

4. **Move config validation to preflight command.** `src/scripts/validator.js` runs inside hot paths (e.g., before every middleware registration). Ship a `catalyst doctor` CLI that validates config/module aliases/store shape once so runtime no longer performs repetitive schema checks.

5. **Bundle analyzer budget enforcement.** `printBundleInformation()` prints sizes but does not fail builds. Add a `MAX_GZIP_KB` threshold in app config and fail `npm run build` when any asset exceeds the budget, forcing teams to split code before regressions reach production.

6. **Smarter dev server restarts.** `chokidar` restarts the entire Express server on any change under `/server` or `/src`. Large repos incur multiple restarts per save. Consider debouncing restarts or using fine-grained invalidation (only reload middleware changed modules) to keep feedback loops tight.

7. **Async logging sinks.** Winston’s DailyRotateFile writes synchronously, which can slow throughput under heavy SSR load. Switch to the native `fs.promises` transport or buffer logs through `WritableStream` + `setImmediate` so render threads spend less time in I/O.

8. **Surface perf counters in OTEL by default.** `src/otel.js` wires custom gauges but the SDK is opt-in. Provide a zero-config wrapper that autostarts OTEL when `ENABLE_OTEL=true`, and tag spans around `serverDataFetcher`, `renderToPipeableStream`, and cache hits/misses. This gives contributors live insights without extra code.


