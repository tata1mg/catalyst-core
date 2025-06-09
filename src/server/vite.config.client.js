// vite.config.client.js - Client-specific configuration
import { defineConfig } from "vite"
import baseConfig, { getClientEnvVariables } from "./vite.config.js"
import path from "path"

import loadEnvironmentVariables from "../scripts/loadEnvironmentVariables.js"
loadEnvironmentVariables()
import { imageUrl, fontUrl } from "./scssParams.js"

const clientConfig = defineConfig({
    ...baseConfig,
    mode: "production",

    // Ensure resolve configuration is inherited
    resolve: {
        ...baseConfig.resolve,
    },

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
                main: path.join(process.env.src_path, "client/index.jsx"),
            },
            output: {
                emptyOutDir: true,
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
            },
        },

        // Production-specific optimization
        chunkSizeWarningLimit: 1000,
    },

    // Client-specific SSR config
    ssr: {
        ...baseConfig.ssr,
        // Use base config noExternal for client build
        noExternal: baseConfig.ssr.noExternal,
    },

    // Production-specific CSS configuration
   css: {
        modules: {
            localsConvention: "camelCase",
            generateScopedName:"[name]__[local]___[hash:base64:5]",
        },
        preprocessorOptions: {
            scss: {
                additionalData: `@import "@css/resources/index.scss" ; $font_url: "${fontUrl()}";  $url_for: "${imageUrl()}"; `,
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


    // Production server configuration
    server: {
        hmr: false,
        watch: null,
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

export default clientConfig
