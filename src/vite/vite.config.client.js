import loadEnvironmentVariables from "../scripts/loadEnvironmentVariables.js"
loadEnvironmentVariables()
import { defineConfig } from "vite"
import baseConfig, { getClientEnvVariables } from "./vite.config.js"
import path from "path"
import { manifestCategorizationPlugin } from "./manifest-categorization-plugin.js"
import { injectCacheKeyPlugin } from "./inject-cache-key-plugin.js"

const buildConfigPath = path.join(process.env.src_path, "buildConfig.js")
const customViteConfig = await import(buildConfigPath)

const clientConfig = defineConfig({
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
        ...(customViteConfig?.clientPlugins || []),
    ],

    build: {
        target: "esnext",
        minify: "esbuild",
        sourcemap: false,
        manifest: true,
        ssrManifest: true,
        outDir: path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build"),

        // cssCodeSplit: true (default) — each chunk gets its own CSS file.
        // Since ALL CSS is served via external <link> tags (never inlined),
        // per-chunk CSS is fine — more files but each is small and cacheable.

        rollupOptions: {
            input: {
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

                // Each manual chunk gets its own [hash] from chunkFileNames,
                // so a change in one group does not bust caches for the others.
                // Keep CSS out of manual chunks so cssCodeSplit works correctly.
                manualChunks(id) {
                    if (/\.(css|scss|sass|less|styl)(\?.*)?$/.test(id)) {
                        return undefined
                    }

                    // Other node_modules → let Vite pack them with the chunks that use them.
                    return undefined
                },
            },
        },

        modulePreload: false,
        chunkSizeWarningLimit: 2000,
    },
    esbuild: {
        legalComments: "none",
    },

    define: {
        ...getClientEnvVariables(),
        __DEV__: false,
        "process.env.NODE_ENV": JSON.stringify("production"),
    },
})

export default clientConfig
