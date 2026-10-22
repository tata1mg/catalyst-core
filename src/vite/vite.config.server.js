import loadEnvironmentVariables from "../scripts/loadEnvironmentVariables.js"
loadEnvironmentVariables()
import { defineConfig } from "vite"
// Spread the static shared config (a plain object), NOT the default export —
// the default export is now an async dev-server factory function, and spreading
// a function would silently drop cacheDir, resolve aliases, css, plugins and
// build from the production SSR bundle. Mirrors vite.config.client.js.
import { sharedViteConfig as baseConfig, getClientEnvVariables, isNodeOnlyExternal } from "./vite.config.js"
import path from "path"
import { fileURLToPath } from "url"
import { dirname } from "path"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
import { injectCacheKeyPlugin } from "./inject-cache-key-plugin.js"
import { loadCustomViteConfig } from "./loadCustomViteConfig.js"

export default defineConfig(async () => {
    const customViteConfig = await loadCustomViteConfig()

    return {
        ...baseConfig,
        mode: "production",

        // Add cache key injection plugin first to transform split calls
        plugins: [
            injectCacheKeyPlugin(),
            ...(baseConfig.plugins || []),
            ...(customViteConfig?.ssrPlugins || []),
        ],

        // The CLI prints its own build summary and asset table, so Vite's
        // duplicate table and rollup's advisory warnings are pure noise.

        build: {
            ...baseConfig.build,
            // Parallel client and server builds share this directory -- emptying it
            // would delete the other bundle. Declared explicitly so Vite does not
            // warn about an outDir outside the project root.
            emptyOutDir: false,
            outDir: path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build"),
            target: "es2022",
            minify: "esbuild",
            sourcemap: false,
            manifest: false,
            ssrManifest: false,

            rollupOptions: {
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
                // Belt-and-suspenders with ssr.external: ensures the opt-in OTEL /
                // node-only packages (and their transitive @opentelemetry/* deps) are
                // never resolved/bundled, even though they may not be installed.
                external: isNodeOnlyExternal,
                input: {
                    // Server entry point for SSR
                    server: path.join(__dirname, "../server/renderer/index.js"),
                },
                output: {
                    format: "es",
                    entryFileNames: (chunkInfo) => {
                        return chunkInfo.name === "server"
                            ? "server/index.js"
                            : "server/assets/[name]-[hash].js"
                    },
                    chunkFileNames: "server/assets/[name]-[hash].js",
                    assetFileNames: (assetInfo) => {
                        const extType = assetInfo.name.split(".").pop()
                        if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(extType)) {
                            return "server/assets/images/[name]-[hash][extname]"
                        }
                        if (/woff2?|eot|ttf|otf/i.test(extType)) {
                            return "server/assets/fonts/[name]-[hash][extname]"
                        }
                        if (/css/i.test(extType)) {
                            return "server/assets/css/[name]-[hash][extname]"
                        }
                        return "server/assets/[name]-[hash][extname]"
                    },
                },
            },

            chunkSizeWarningLimit: 2000,
        },

        // Optimization for production
        esbuild: {
            legalComments: "none",
        },

        // Production-specific define
        define: {
            ...getClientEnvVariables(),
            __DEV__: false,
            "process.env.NODE_ENV": JSON.stringify("production"),
        },
    }
})
