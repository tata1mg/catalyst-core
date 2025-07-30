import loadEnvironmentVariables from "../scripts/loadEnvironmentVariables.js"
loadEnvironmentVariables()
import { defineConfig } from "vite"
import baseConfig, { getClientEnvVariables } from "./vite.config.js"
import path from "path"
import { fileURLToPath } from "url"
import { dirname } from "path"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
import { injectCacheKeyPlugin } from "./inject-cache-key-plugin.js"

export default defineConfig({
    ...baseConfig,
    mode: "production",

    resolve: {
        ...baseConfig.resolve,
    },
    // Add cache key injection plugin first to transform split calls
    plugins: [injectCacheKeyPlugin(), ...(baseConfig.plugins || [])],

    build: {
        ...baseConfig.build,
        target: "es2022",
        minify: "esbuild",
        sourcemap: false,
        manifest: false,
        ssrManifest: false,

        // Override input paths for production
        rollupOptions: {
            ...baseConfig.build.rollupOptions,
            input: {
                // Server entry point for SSR
                server: path.join(__dirname, "../server/renderer/index.js"),
            },
            output: {
                format: "es",
                entryFileNames: (chunkInfo) => {
                    return chunkInfo.name === "server" ? "server/[name].js" : "server/assets/[name]-[hash].js"
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
            // Prevent externalization for server build - bundle all dependencies
            external: [],
        },

        // Production-specific optimization
        chunkSizeWarningLimit: 1000,

        // Separate builds for client and server
        lib: {
            entry: path.join(__dirname, "./renderer/index.js"),
            name: "server",
            fileName: "server",
            formats: ["es"],
        },
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
})
