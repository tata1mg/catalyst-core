import { defineConfig, transformWithEsbuild } from "vite"
import react from "@vitejs/plugin-react"
import svgr from "vite-plugin-svgr"
import { builtinModules, createRequire } from "node:module"
import { loadCustomViteConfig } from "./loadCustomViteConfig.js"
import { resolveDevBase, buildDevServer } from "./resolveDevServerConfig.js"

/**
 * Treat all .scss imports as CSS modules (webpack compat).
 * Webpack's css-loader with modules:true scopes every .scss file.
 * Vite only does this for files named .module.scss.
 * This plugin renames the resolved ID so Vite's CSS pipeline treats them as modules.
 */
function scssModulesPlugin() {
    return {
        name: "vite-plugin-scss-as-modules",
        enforce: "pre",
        async resolveId(source, importer, options) {
            if (!importer) return null

            if (!source.endsWith(".scss") || source.includes(".module.")) return null

            const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
            if (!resolved || resolved.id.includes("node_modules") || resolved.id.includes("src/static/css"))
                return null

            return resolved.id.replace(/\.scss$/, ".module.scss")
        },
        load(id) {
            const cleanId = id.split("?")[0]
            if (cleanId.endsWith(".module.scss") && !fs.existsSync(cleanId)) {
                const originalPath = cleanId.replace(/\.module\.scss$/, ".scss")
                if (fs.existsSync(originalPath)) {
                    this.addWatchFile(originalPath)
                    return fs.readFileSync(originalPath, "utf-8")
                }
            }
            return null
        },
        handleHotUpdate({ file, server }) {
            if (file.endsWith(".scss") && !file.endsWith(".module.scss")) {
                const virtualId = file.replace(/\.scss$/, ".module.scss")
                const virtualMod = server.moduleGraph.getModuleById(virtualId)
                if (virtualMod) {
                    server.moduleGraph.invalidateModule(virtualMod)
                    return [virtualMod]
                }
            }
        },
    }
}

function jsxInJsPlugin() {
    return {
        name: "vite-plugin-jsx-in-js",
        enforce: "pre",
        async transform(code, id) {
            if (!id.endsWith(".js")) return null
            if (id.includes("node_modules")) return null
            if (!/</.test(code)) return null
            return transformWithEsbuild(code, id, { loader: "jsx" })
        },
    }
}

const emptyStoreModuleId = "\0catalyst-empty-store"
const templateStoreImport = "@catalyst/template/src/js/store/index.js"

function optionalTemplateStorePlugin() {
    return {
        name: "vite-plugin-optional-template-store",
        enforce: "pre",
        resolveId(source) {
            const storePath = path.join(process.env.src_path, "src/js/store/index.js")
            const isTemplateStoreImport = source === templateStoreImport || path.resolve(source) === storePath
            if (!isTemplateStoreImport) return null
            if (fs.existsSync(storePath)) return null

            return emptyStoreModuleId
        },
        load(id) {
            if (id !== emptyStoreModuleId) return null

            return `
                export default function configureStore(initialState = {}) {
                    return {
                        getState: () => initialState,
                        dispatch: (action) => action,
                        subscribe: () => () => {},
                        replaceReducer: () => {},
                    }
                }
            `
        },
    }
}

import { fileURLToPath } from "url"
import { dirname } from "path"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import path from "path"
import fs from "fs"

const packageJsonConfig = path.resolve(process.env.src_path, "package.json")
const catalystPackageJsonConfig = path.resolve(__dirname, "../../package.json")

let packageJsonContent, catalystPackageJsonContent
let _moduleAliases = {},
    catalyst_moduleAliases = {}

try {
    packageJsonContent = fs.readFileSync(packageJsonConfig, "utf8")
    const packageJson = JSON.parse(packageJsonContent)
    _moduleAliases = packageJson._moduleAliases || {}
} catch (error) {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring - packageJsonConfig is a build-time-resolved local path, not attacker-controlled; console.warn here does no printf-style substitution.
    console.warn(`Failed to read or parse package.json from ${packageJsonConfig}:`, error.message)
}

try {
    catalystPackageJsonContent = fs.readFileSync(catalystPackageJsonConfig, "utf8")
    const catalystPackageJson = JSON.parse(catalystPackageJsonContent)
    catalyst_moduleAliases = catalystPackageJson._moduleAliases || {}
} catch (error) {
    console.warn(
        // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring - catalystPackageJsonConfig is a build-time-resolved local path, not attacker-controlled; console.warn here does no printf-style substitution.
        `Failed to read or parse catalyst package.json from ${catalystPackageJsonConfig}:`,
        error.message
    )
}

const allAliases = { ..._moduleAliases, ...catalyst_moduleAliases }

import { imageUrl, fontUrl } from "./scssParams.js"

// Tailwind v4's zero-config scanner (`@tailwindcss/postcss`) walks up from
// `dirname(from)` — the directory of the file PostCSS is currently compiling —
// unless given an explicit `base`. Vite passes each CSS file's own resolved
// path as `from`, so for catalyst-core's conventional layout (global
// stylesheet under `src/static/css`, components under `src/js`, no shared
// parent short of the app root) the scanner never reaches component files and
// silently drops every class actually used in JSX. Webpack's postcss-loader
// doesn't populate `from` the same way, which is why this only regresses
// under Vite. We resolve the app's own postcss.config.js ourselves and patch
// in `base: process.env.src_path` so the scan root covers the whole app.
// Only the `{ pluginName: options }` shorthand can be patched this way —
// array-form configs (`[require(...)()]`) have already closed over their
// options — so anything else is left alone and Vite falls back to its normal
// auto-loaded postcss.config.js resolution.
const resolvePostcssPlugins = () => {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - process.env.src_path is the app root set by the framework's own build tooling, not request/user input.
    const configPath = path.join(process.env.src_path, "postcss.config.js")
    if (!fs.existsSync(configPath)) return null

    const appRequire = createRequire(configPath)

    try {
        const userConfig = appRequire(configPath)
        const pluginsConfig = userConfig?.plugins

        if (!pluginsConfig || Array.isArray(pluginsConfig) || typeof pluginsConfig !== "object") {
            return null
        }

        return Object.entries(pluginsConfig).map(([name, options]) => {
            const plugin = appRequire(name)
            const finalOptions =
                name === "@tailwindcss/postcss" && (!options || options.base === undefined)
                    ? { ...options, base: process.env.src_path }
                    : options
            return plugin(finalOptions)
        })
    } catch (error) {
        // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring - configPath is a build-time-resolved local path, not attacker-controlled; console.warn here does no printf-style substitution.
        console.warn(`Failed to patch postcss config at ${configPath}:`, error.message)
        return null
    }
}

const postcssPlugins = resolvePostcssPlugins()

const alias = () => {
    if (!allAliases || typeof allAliases !== "object") {
        return {}
    }

    return Object.keys(allAliases).reduce((moduleEnvMap, alias) => {
        if (allAliases[alias] && typeof allAliases[alias] === "string") {
            try {
                // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - process.env.src_path is the app root and allAliases comes from the developer's own package.json _moduleAliases config, not request/user input.
                const aliasPath = path.join(process.env.src_path, ...allAliases[alias].split("/"))
                moduleEnvMap[alias] = aliasPath
            } catch (error) {
                // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring - alias is a key from the developer's own package.json _moduleAliases config, not attacker-controlled; console.warn here does no printf-style substitution.
                console.warn(`Failed to configure alias ${alias}:`, error.message)
            }
        }
        return moduleEnvMap
    }, {})
}

export const getClientEnvVariables = () => {
    const clientEnvVars = process.env.CLIENT_ENV_VARIABLES

    if (!clientEnvVars) {
        return {}
    }

    // Parse CLIENT_ENV_VARIABLES if it's a JSON string
    const allowedVars = typeof clientEnvVars === "string" ? JSON.parse(clientEnvVars) : clientEnvVars

    // Create define object with only allowed environment variables
    const envVarDefinitions = {}

    allowedVars.forEach((varName) => {
        if (process.env[varName] !== undefined) {
            // Define as process.env.VARIABLE_NAME for client-side usage
            envVarDefinitions[`process.env.${varName}`] = JSON.stringify(process.env[varName])
        }
    })
    envVarDefinitions[`process.env.src_path`] = JSON.stringify(process.env["src_path"])
    envVarDefinitions[`process.env.BUILD_OUTPUT_PATH`] = JSON.stringify(process.env["BUILD_OUTPUT_PATH"])
    envVarDefinitions[`process.env.PUBLIC_STATIC_ASSET_PATH`] = JSON.stringify(
        process.env["PUBLIC_STATIC_ASSET_PATH"]
    )
    envVarDefinitions[`process.env.PUBLIC_STATIC_ASSET_URL`] = JSON.stringify(
        process.env["PUBLIC_STATIC_ASSET_URL"]
    )

    // Derive AI_PUBLIC_CONFIG: only the browser block from AI_CONFIG, no API keys
    let aiConfig = {}
    try {
        const parsedConfig = JSON.parse(process.env.AI_CONFIG || "{}")
        if (parsedConfig && typeof parsedConfig === "object" && !Array.isArray(parsedConfig)) {
            aiConfig = parsedConfig
        } else {
            console.warn("[catalyst-core] AI_CONFIG must be a JSON object, ignoring it")
        }
    } catch (e) {
        console.warn(`[catalyst-core] Invalid AI_CONFIG JSON, ignoring: ${e.message}`)
    }
    const aiPublicConfig = aiConfig.browser ? { browser: aiConfig.browser } : {}
    envVarDefinitions[`process.env.AI_PUBLIC_CONFIG`] = JSON.stringify(JSON.stringify(aiPublicConfig))

    // Detect which catalyst-* AI packages are installed for the app, including
    // hoisted/workspace installs — not just a direct app-local node_modules copy.
    // Results are injected as __CATALYST_PACKAGES__.* literals so dead code
    // referencing missing packages can be branched around at runtime.
    const appRequire = createRequire(path.join(process.env.src_path || process.cwd(), "package.json"))
    let aiPackageInstalled = false
    try {
        appRequire.resolve("catalyst-ai")
        aiPackageInstalled = true
    } catch {
        aiPackageInstalled = false
    }
    envVarDefinitions["__CATALYST_PACKAGES__"] = JSON.stringify({
        ai: aiPackageInstalled,
    })

    return envVarDefinitions
}

const isProduction = process.env.NODE_ENV === "production"

const getScssResourcesImport = () => {
    const resourcesDir = path.join(process.env.src_path, "src/static/css/resources")
    const indexPath = path.join(resourcesDir, "index.scss")
    const variablesPath = path.join(resourcesDir, "_variables.scss")

    if (fs.existsSync(indexPath)) {
        return '@import "@css/resources/index.scss"; '
    }

    if (fs.existsSync(variablesPath)) {
        return '@import "@css/resources/_variables.scss"; '
    }

    return ""
}

// Pre-bundling upfront avoids Vite discovering deps at runtime which causes
// cascading full-page reloads and "stuck in loading" on dev server.
/**
 * Keep only the packages this app can actually resolve.
 *
 * The list below is a superset covering every dependency a Catalyst app might
 * use. Vite logs "Failed to resolve dependency: X, present in
 * 'optimizeDeps.include'" for each entry it cannot find, so an app that uses
 * half of them opened with 23 warning lines it could do nothing about.
 */
function resolvableFrom(candidates, appRoot) {
    const resolver = createRequire(path.join(appRoot, "package.json"))
    return candidates.filter((name) => {
        try {
            resolver.resolve(name)
            return true
        } catch (error) {
            return false
        }
    })
}

const candidateBrowserDeps = [
    "react",
    "react-dom",
    "react-dom/client",
    "react-redux",
    "react-router-dom",
    "redux",
    "redux-thunk",
    "axios",
    "react-helmet-async",
    "react-google-recaptcha",
    "react-fast-compare",
    "history",
    "lottie-web",
    // Pre-bundle alongside React so esbuild marks react/react-router as external
    // and avoids a duplicate React instance (which causes useContext null errors)
    "@tata1mg/slowboi-react",
    "invariant",
    "shallowequal",
    "prop-types",
    "redux-logger",
    "framer-motion",
    "recharts",
    "react-modal",
    "react-datepicker",
    "react-intersection-observer",
    "react-markdown",
    "react-lottie",
    "isomorphic-dompurify",
    "ua-parser-js",
    "qrcode.react",
    "fast-average-color",
    "react-dfp",
    "web-vitals",
    // Referenced by manualChunks in vite.config.client.js — pre-bundle so the
    // first navigation that pulls them in doesn't trigger a full-page reload.
    "react-loadable-visibility",
    "react-detect-offline",
    "react-side-effect",
    "react-async-script",
    "normalize.css",
]

// Node-only / instrumentation dependencies that must never be bundled into the
// SSR output. OpenTelemetry is opt-in (enabled at runtime via OTEL_ENABLE), so
// these packages may not be installed in the consuming app. They are imported
// only by dist/otel.js, which is itself dynamically imported at runtime and only
// when OTEL_ENABLE=true (see server/renderer/handler.jsx). Marking them external
// lets the bundler skip resolving them; Node resolves them at runtime, but only
// if/when the otel chunk is actually loaded.
export const nodeOnlyExternalDeps = [
    "elastic-apm-node",
    "@grpc/grpc-js",
    "@opentelemetry/api",
    "@opentelemetry/core",
    "@opentelemetry/resources",
    "@opentelemetry/semantic-conventions",
    "@opentelemetry/sdk-node",
    "@opentelemetry/sdk-metrics",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/exporter-trace-otlp-grpc",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/exporter-metrics-otlp-grpc",
    "@opentelemetry/exporter-metrics-otlp-http",
    "@opentelemetry/auto-instrumentations-node",
    "@opentelemetry/instrumentation-http",
    "@opentelemetry/instrumentation-express",
]

// Predicate form for Rollup's `external`. Also matches the many transitive
// @opentelemetry/instrumentation-* packages that auto-instrumentations-node pulls
// in, without having to enumerate each one.
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])

export const isNodeOnlyExternal = (id) =>
    nodeBuiltins.has(id) ||
    id === "elastic-apm-node" ||
    id === "@grpc/grpc-js" ||
    id.startsWith("@opentelemetry/")

// ─── Shared config ────────────────────────────────────────────────────────────
// Exported for the production build (vite.config.client.js spreads this in).
// Does NOT include `base` or `server` — those differ between dev and prod.
export const sharedViteConfig = {
    // Parallel `vite build` (SSR + client) must use separate dirs or Vite will block on shared `node_modules/.vite`.
    cacheDir: path.join(
        process.env.src_path,
        "node_modules",
        process.env.CATALYST_VITE_CACHE_ID ? `.vite-${process.env.CATALYST_VITE_CACHE_ID}` : ".vite"
    ),
    ssr: {
        // Keep selected React-side packages bundled for SSR (transformed by Vite, NOT pre-bundled)
        // noExternal: ["@tata1mg/slowboi-react"],
        // Ensure Node-only instrumentation and low-level Node deps stay external so
        // the bundler never tries to resolve the optional (opt-in) OTEL packages.
        external: nodeOnlyExternalDeps,
        optimizeDeps: {
            // Same treatment as the browser list: only include what this app
            // can resolve, or Vite warns about every entry it cannot find.
            include: resolvableFrom(
                [
                    "invariant",
                    "react-fast-compare",
                    "shallowequal",
                    "prop-types",
                    "redux-thunk",
                    "redux-logger",
                ],
                process.env.src_path
            ),
            // Prevent pre-bundling React ecosystem packages for SSR to avoid duplicate
            // React instances. Pre-bundled copies in .vite/deps_ssr/ create a separate
            // React instance from node_modules/react used by react-dom/server, causing
            // "Invalid hook call" errors when hooks try to read a null dispatcher.
            exclude: [
                "react",
                "react-dom",
                "react-router-dom",
                "@tata1mg/router",
                // "@tata1mg/slowoi-react",
                "catalyst-core/router/ClientRouter",
            ],
            esbuildOptions: {
                format: "esm",
                target: "node2022",
                loader: {
                    ".js": "jsx",
                },
            },
        },
    },
    plugins: [
        optionalTemplateStorePlugin(),
        scssModulesPlugin(),
        jsxInJsPlugin(),
        // `include` extends the default regex so Fast Refresh also wraps .js
        // files (their JSX has already been transformed by jsxInJsPlugin above).
        react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
        // Default: SVG → React component. Use `*.svg?url` (or `?raw`) for asset URL / raw source.
        // Keep `*.svg?react` so explicit imports still work. Exclude node_modules so deps keep normal asset handling.
        svgr({
            include: ["**/*.svg", "**/*.svg?react"],
            exclude: "**/node_modules/**",
        }),
    ],
    resolve: {
        alias: alias(),
        // Ensure only one copy of React-related packages is used (prevents
        // duplicate instances from hoisted/linked packages in monorepos)
        dedupe: ["react", "react-dom", "react-router-dom", "@tata1mg/slowboi-react"],
    },
    define: {
        ...getClientEnvVariables(),
    },

    build: {
        outDir: path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build"),
    },

    optimizeDeps: {
        // Explicit entries so the dep scanner crawls the app's real import
        // graph. Without this (SSR middleware mode has no index.html), Vite
        // can't see dynamic `import()` chunks produced by split(), so every
        // first-navigation discovers new deps and triggers a full reload.
        entries: [
            path.join(process.env.src_path, "client/index.js"),
            path.join(process.env.src_path, "src/**/*.{js,jsx,ts,tsx}"),
        ],
        include: resolvableFrom(candidateBrowserDeps, process.env.src_path),
        exclude: ["catalyst-core/router/ClientRouter"],
        esbuildOptions: {
            format: "esm",
            target: "node2022",
            loader: {
                ".js": "jsx",
            },
        },
    },

    css: {
        modules: {
            localsConvention: "camelCase",
            generateScopedName: "[name]__[local]___[hash:base64:5]",
        },
        ...(postcssPlugins ? { postcss: { plugins: postcssPlugins } } : {}),
        preprocessorOptions: {
            scss: {
                additionalData: (content) =>
                    `${getScssResourcesImport()}$font_url: "${fontUrl()}"; $url_for: "${imageUrl()}";\n${content}`,
                silenceDeprecations: [
                    "import",
                    "global-builtin",
                    "color-functions",
                    "if-function",
                    "slash-div",
                ],
            },
        },
    },
    json: {
        stringify: true,
    },
    assetsInclude: [
        "**/*.png",
        "**/*.jpg",
        "**/*.gif",
        "**/*.jpeg",
        "**/*.ico",
        "**/*.svg",
        "**/*.ttf",
        "**/*.eot",
        "**/*.woff2",
    ],

    // Preview configuration for production preview
    preview: {
        port: process.env.NODE_SERVER_PORT ? parseInt(process.env.NODE_SERVER_PORT) : 3005,
        host: process.env.NODE_SERVER_HOSTNAME || "localhost",
    },
}

// ─── Dev server config ────────────────────────────────────────────────────────
// Async factory so it can read the app's buildConfig.devServer for `base`, HMR
// and other Vite server options. `base` comes solely from devServer.base; the
// resolved value is propagated to the SSR renderer by server/expressServer.js.
// The production build (vite.config.client.js) ignores this and spreads
// sharedViteConfig directly.
export default defineConfig(async () => {
    const { devServer = {}, ssrPlugins = [] } = await loadCustomViteConfig()

    return {
        ...sharedViteConfig,
        base: resolveDevBase(devServer),
        server: buildDevServer(devServer, {
            frameworkPaths: [process.env.src_path, __dirname],
            isProduction,
        }),
        // Apply the app's SSR plugins in dev too — the production build already
        // does this in vite.config.server.js. This lets buildConfig.ssrPlugins
        // inject SSR-only config (e.g. a plugin whose `config()` hook adds
        // ssr.noExternal to bundle React-consuming deps so dev SSR shares the
        // app's single React instance) without hardcoding anything in the framework.
        plugins: [...(sharedViteConfig.plugins || []), ...ssrPlugins],
    }
})
