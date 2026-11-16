import loadEnvironmentVariables from "../scripts/loadEnvironmentVariables.js"
loadEnvironmentVariables()
import { defineConfig } from "vite"
import { sharedViteConfig as baseConfig, getClientEnvVariables } from "./vite.config.js"
import path from "path"
import { manifestCategorizationPlugin } from "./manifest-categorization-plugin.js"
import { injectCacheKeyPlugin } from "./inject-cache-key-plugin.js"
import { hoistImportsPlugin } from "./hoist-imports-plugin.js"
import { loadCustomViteConfig } from "./loadCustomViteConfig.js"

// Long-lived vendor chunks, highest priority first. Rolldown pulls each
// captured module's dependencies into the same group, and a higher-priority
// group claims a module first. `app` (catalyst-core) must stay last: it
// imports the app's routes (router/ClientRouter), so ranked any higher it
// would pull these vendors in with them.
const chunkGroups = [
    ["vendor-react", /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/],
    ["vendor-router", /[\\/]node_modules[\\/](react-router(?:-dom|-config)?|history)[\\/]/],
    ["vendor-network", /[\\/]node_modules[\\/]axios[\\/]/],
    ["vendor-lottie", /[\\/]node_modules[\\/]lottie[^\\/]*[\\/]/],
    ["vendor-ads", /[\\/]node_modules[\\/](react-google-recaptcha|react-async-script|react-dfp)[\\/]/],
    [
        "vendor-ui",
        /[\\/]node_modules[\\/](react-loadable-visibility|react-detect-offline|normalize\.css)[\\/]/,
    ],
    ["app", /[\\/]node_modules[\\/]catalyst-core[\\/]/],
]

// Keep CSS out of the groups so cssCodeSplit works correctly.
const isStyle = (id) => /\.(css|scss|sass|less|styl)(\?.*)?$/.test(id)

const createClientConfig = async () => {
    const customViteConfig = await loadCustomViteConfig()

    return {
        ...baseConfig,
        mode: "production",
        base: `${process.env.PUBLIC_STATIC_ASSET_URL || ""}${process.env.PUBLIC_STATIC_ASSET_PATH || "/"}`,

        plugins: [
            ...(baseConfig.plugins || []),
            manifestCategorizationPlugin({
                outputFile: "asset-categories.json",
                publicPath: `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/client/assets/`,
            }),
            injectCacheKeyPlugin(),
            hoistImportsPlugin(),
            ...(customViteConfig?.clientPlugins || []),
        ],

        build: {
            target: "esnext",
            minify: "oxc",
            sourcemap: false,
            manifest: true,
            ssrManifest: true,
            // Parallel client and server builds share this directory -- emptying it
            // would delete the other bundle. Declared explicitly so Vite does not
            // warn about an outDir outside the project root.
            emptyOutDir: false,
            outDir: path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build"),

            // cssCodeSplit: true (default) — each chunk gets its own CSS file.
            // Since ALL CSS is served via external <link> tags (never inlined),
            // per-chunk CSS is fine — more files but each is small and cacheable.

            rolldownOptions: {
                // Advisory warnings about third-party code the app author
                // cannot act on: a dependency's misplaced /*#__PURE__*/ comment
                // and unused re-exports from our own entry. Genuine problems
                // (unresolved imports, circular deps, missing exports) still
                // surface.
                onwarn(warning, defaultHandler) {
                    const ignored = new Set([
                        "INVALID_ANNOTATION",
                        "UNUSED_EXTERNAL_IMPORT",
                        "MODULE_LEVEL_DIRECTIVE",
                    ])
                    if (ignored.has(warning.code)) return
                    defaultHandler(warning)
                },
                input: {
                    main: path.join(process.env.src_path, "client/index.js"),
                },
                output: {
                    format: "es",
                    entryFileNames: (chunkInfo) => {
                        return chunkInfo.name === "server"
                            ? "server/[name].js"
                            : "client/assets/[name]-[hash].js"
                    },
                    chunkFileNames: "client/assets/[name]-[hash].js",
                    assetFileNames: (assetInfo) => {
                        const extType = (assetInfo.names?.[0] ?? assetInfo.name ?? "").split(".").pop()
                        if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(extType)) {
                            return "client/assets/images/[name]-[hash][extname]"
                        }
                        if (/woff2?|eot|ttf|otf/i.test(extType)) {
                            return "client/assets/fonts/[name]-[hash][extname]"
                        }
                        if (/css/i.test(extType)) {
                            return "client/assets/css/[name]-[hash][extname]"
                        }
                        return "client/assets/[name]-[hash][extname]"
                    },

                    // Each group gets its own [hash] from chunkFileNames,
                    // so a change in one group does not bust caches for the others.
                    codeSplitting: {
                        groups: chunkGroups.map(([name, pattern], index) => ({
                            name,
                            priority: chunkGroups.length - index,
                            test: (id) => !isStyle(id) && pattern.test(id),
                        })),
                    },
                    comments: { legal: false },
                },
            },

            modulePreload: false,
            chunkSizeWarningLimit: 2000,
        },

        define: {
            ...getClientEnvVariables(),
            __DEV__: false,
            "process.env.NODE_ENV": JSON.stringify("production"),
        },
    }
}

export default defineConfig(createClientConfig)
