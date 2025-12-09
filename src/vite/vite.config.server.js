import loadEnvironmentVariables from "../scripts/loadEnvironmentVariables.js"
loadEnvironmentVariables()
import { defineConfig } from "vite"
import baseConfig, { getClientEnvVariables } from "./vite.config.js"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { dirname } from "path"
import { existsSync, readFileSync } from "fs"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
import { injectCacheKeyPlugin } from "./inject-cache-key-plugin.js"

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

        resolve: {
            ...baseConfig.resolve,
        },
        // Add cache key injection plugin first to transform split calls
        plugins: [
            injectCacheKeyPlugin(),
            ...(baseConfig.plugins || []),
            ...(customViteConfig?.ssrPlugins || []),
        ],

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
                        return chunkInfo.name === "server"
                            ? "server/[name].js"
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
}
