// vite.config.prod.js - Production-specific configuration
import { defineConfig } from "vite"
import baseConfig from "./vite.config.js"
import path from "path"

import { fileURLToPath } from "url"
import { dirname } from "path"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
import loadEnvironmentVariables from "../scripts/loadEnvironmentVariables.js"
loadEnvironmentVariables()
export default defineConfig({
    ...baseConfig,
    mode: "production",

    // Ensure resolve configuration is inherited
    resolve: {
        ...baseConfig.resolve,
    },

    build: {
        ...baseConfig.build,
        target: "es2022",
        minify: "esbuild",
        sourcemap: false,

        // Override input paths for production
        rollupOptions: {
            ...baseConfig.build.rollupOptions,
            input: {
                // Client entry point (corrected path)
                main: path.join(process.env.src_path, "client/index.jsx"),
                // Server entry point for SSR
                server: path.join(__dirname, "./renderer/index.js"),
            },
            output: {
                ...baseConfig.build.rollupOptions.output,
            },
            // Prevent externalization for server build - bundle all dependencies
            external:
                process.env.BUILD_TARGET === "server" ? [] : baseConfig.build.rollupOptions.external || [],
        },

        // Production-specific optimization
        chunkSizeWarningLimit: 1000,

        // Separate builds for client and server
        lib:
            process.env.BUILD_TARGET === "server"
                ? {
                      entry: path.join(__dirname, "./renderer/index.js"),
                      name: "server",
                      fileName: "server",
                      formats: ["es"],
                  }
                : undefined,
    },

    // Ensure SSR config is properly set for server builds
    ssr: {
        ...baseConfig.ssr,
        // Don't externalize any modules for server build - bundle everything
        noExternal: process.env.BUILD_TARGET === "server" ? true : baseConfig.ssr.noExternal,
    },

    // Production-specific CSS configuration
    css: {
        ...baseConfig.css,
        modules: {
            ...baseConfig.css.modules,
            generateScopedName: "[hash:base64:8]", // Shorter class names for production
        },
        devSourcemap: false,
    },

    // Production server configuration
    server: {
        hmr: false,
        watch: null,
    },

    // Optimization for production
    esbuild: {
        drop: ["console", "debugger"], // Remove console logs and debugger statements
        legalComments: "none",
    },

    // Production-specific define
    define: {
        ...baseConfig.define,
        __DEV__: false,
        "process.env.NODE_ENV": JSON.stringify("production"),
    },
})
