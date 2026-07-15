import loadEnvironmentVariables from "../scripts/loadEnvironmentVariables.js"
loadEnvironmentVariables()
import { defineConfig } from "vite"
import baseConfig, { getClientEnvVariables, isNodeOnlyExternal } from "./vite.config.js"
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

        build: {
            ...baseConfig.build,
            outDir: path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build"),
            target: "es2022",
            minify: "esbuild",
            sourcemap: false,
            manifest: false,
            ssrManifest: false,

            rollupOptions: {
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
