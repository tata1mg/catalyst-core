import { defineConfig } from "vite"
import baseConfig, { getClientEnvVariables } from "./vite.config.js"
import path from "path"
import { manifestCategorizationPlugin } from "./manifest-categorization-plugin.js"
import { existsSync, readFileSync } from "fs"
import { fileURLToPath, pathToFileURL } from "url"
import { dirname } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import loadEnvironmentVariables from "../scripts/loadEnvironmentVariables.js"
loadEnvironmentVariables()

// Safely import custom vite config if it exists
async function loadCustomViteConfig() {
    try {
        // Resolve the alias path manually using the same logic as vite.config.js
        const packageJsonConfig = path.resolve(process.env.src_path, "package.json")
        const catalystPackageJsonConfig = path.resolve(__dirname, "../../package.json")

        let _moduleAliases = {}
        let catalyst_moduleAliases = {}

        try {
            const packageJsonContent = readFileSync(packageJsonConfig, "utf8")
            const packageJson = JSON.parse(packageJsonContent)
            _moduleAliases = packageJson._moduleAliases || {}
        } catch (error) {
            // Silently ignore
        }

        try {
            const catalystPackageJsonContent = readFileSync(catalystPackageJsonConfig, "utf8")
            const catalystPackageJson = JSON.parse(catalystPackageJsonContent)
            catalyst_moduleAliases = catalystPackageJson._moduleAliases || {}
        } catch (error) {
            // Silently ignore
        }

        const allAliases = { ..._moduleAliases, ...catalyst_moduleAliases }
        const aliasPath = allAliases["@catalyst/template"]

        if (aliasPath && typeof aliasPath === "string") {
            const resolvedPath = path.join(process.env.src_path, ...aliasPath.split("/"))
            const buildConfigPath = path.join(resolvedPath, "buildConfig.js")

            if (existsSync(buildConfigPath)) {
                const config = await import(pathToFileURL(buildConfigPath).href)
                return config.default || config
            }
        }
    } catch (error) {
        // Silently ignore if buildConfig doesn't exist
    }
    return null
}

export default async () => {
    const customViteConfig = await loadCustomViteConfig()

    return defineConfig({
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
                    main: path.join(process.env.src_path, "client/index.jsx"),
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
}
