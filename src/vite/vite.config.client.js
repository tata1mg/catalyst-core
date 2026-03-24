import { defineConfig } from "vite"
import baseConfig, { getClientEnvVariables } from "./vite.config.js"
import path from "path"
import { manifestCategorizationPlugin } from "./manifest-categorization-plugin.js"
import { compression } from "vite-plugin-compression2"

// import customViteConfig from "@catalyst/template/buildConfig.js"

import loadEnvironmentVariables from "../scripts/loadEnvironmentVariables.js"
loadEnvironmentVariables()

/**
 * Removes Vite's automatic CSS link tag injection from the built JS bundle.
 * Vite generates `__vite__injectCss(url)` calls in output chunks that create
 * <link rel="stylesheet"> elements at runtime. Since SSR handles CSS loading
 * server-side, we strip these to prevent duplicate stylesheet injection.
 */
function disableCssInjectPlugin() {
    return {
        name: "vite-plugin-disable-css-inject",
        apply: "build",
        enforce: "post",
        generateBundle(_, bundle) {
            for (const chunk of Object.values(bundle)) {
                if (chunk.type === "chunk" && chunk.code) {
                    chunk.code = chunk.code.replace(/__vite__injectCss\([^)]*\);?\s*/g, "")
                }
            }
        },
    }
}

const customViteConfig = {
    clientPlugins: [],
}
const clientConfig = defineConfig({
    ...baseConfig,
    mode: "production",

    // Ensure resolve configuration is inherited
    resolve: {
        ...baseConfig.resolve,
    },

    // Add manifest categorization plugin (run it last to ensure Vite manifest is available)
    plugins: [
        ...(baseConfig.plugins || []),
        manifestCategorizationPlugin({
            outputFile: "asset-categories.json",
            publicPath: `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/client/assets/`,
        }),
        ...(customViteConfig?.clientPlugins || []),
        // disableCssInjectPlugin(),
        compression({ algorithm: "gzip" }),
        compression({ algorithm: "brotliCompress", exclude: [/\.(br)$/, /\.(gz)$/] }),
    ],

    build: {
        target: "esnext",
        minify: "esbuild",
        sourcemap: false,
        manifest: true,
        ssrManifest: true,
        outDir: path.join(process.env.src_path, "build"),

        // Override input paths for client production
        rollupOptions: {
            input: {
                // Client entry point (corrected path)
                main: path.join(process.env.src_path, "client/index.js"),
            },
            output: {
                format: "es",
                entryFileNames: (chunkInfo) => {
                    return chunkInfo.name === "server" ? "server/[name].js" : "client/assets/[name]-[hash].js"
                },
                chunkFileNames: "client/assets/[name]-[hash].js",
                assetFileNames: (assetInfo) => {
                    const extType = assetInfo.name.split(".").pop()
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
                // Core framework deps → dedicated vendor chunk.
                // All other static app imports → single main bundle (keeps essential chunk
                // count low so the ChunkExtractor doesn't inject hundreds of <script> tags).
                // Dynamically imported route/split chunks remain as separate files.
                manualChunks(id, { getModuleInfo }) {
                    if (
                        /[\\/]node_modules[\\/](react|react-dom|react-redux|react-router|catalyst-core|redux|redux-thunk|axios|react-loadable-visibility|react-helmet-async|react-google-recaptcha|normalize\.css|react-detect-offline|react-side-effect|react-fast-compare|react-async-script|babel|history|react-dfp|@tata1mg\/router)[\\/]/.test(
                            id
                        )
                    ) {
                        return "vendor"
                    }
                    if (!id.includes("node_modules/")) {
                        const info = getModuleInfo(id)
                        if (info && info.dynamicImporters.length === 0) {
                            return "main"
                        }
                    }
                },
            },
        },

        modulePreload: false,

        // Production-specific optimization
        chunkSizeWarningLimit: 1000,
    },
    esbuild: {
        legalComments: "none",
    },

    // Production-specific define
    define: {
        ...getClientEnvVariables(),
        __DEV__: false,
        "process.env.NODE_ENV": JSON.stringify("production"),
    },
})

export default clientConfig
