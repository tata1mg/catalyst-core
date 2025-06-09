// vite.config.prod.js - Production-specific configuration
import { defineConfig } from "vite"
import baseConfig from "./vite.config.js"
import path from "path"

import { fileURLToPath } from "url"
import { dirname } from "path"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
    ...baseConfig,
    mode: "production",

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
        },

        // Production-specific optimization
        chunkSizeWarningLimit: 1000,

        // Separate builds for client and server
        lib:
            process.env.BUILD_TARGET === "server"
                ? {
                      entry: path.join(process.env.src_path, "server/server.js"),
                      name: "server",
                      fileName: "server",
                      formats: ["es"],
                  }
                : undefined,
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
