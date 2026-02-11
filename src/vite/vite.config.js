import { defineConfig, transformWithEsbuild } from "vite"
import react from "@vitejs/plugin-react"

/**
 * Treat all .scss imports as CSS modules (webpack compat).
 * Webpack's css-loader with modules:true scopes every .scss file.
 * Vite only does this for files named .module.scss.
 * This plugin renames the resolved ID so Vite's CSS pipeline treats them as modules.
 */
function scssModulesPlugin() {
    return {
        name: "vite-plugin-scss-as-modules",
        enforce: "pre",
        async resolveId(source, importer, options) {
            if (!source.endsWith(".scss") || source.includes(".module.")) return null
            if (!importer) return null

            const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
            if (!resolved || resolved.id.includes("node_modules")) return null

            return resolved.id.replace(/\.scss$/, ".module.scss")
        },
        load(id) {
            const cleanId = id.split("?")[0]
            if (cleanId.endsWith(".module.scss") && !fs.existsSync(cleanId)) {
                const originalPath = cleanId.replace(/\.module\.scss$/, ".scss")
                if (fs.existsSync(originalPath)) {
                    return fs.readFileSync(originalPath, "utf-8")
                }
            }
            return null
        },
    }
}

function jsxInJsPlugin() {
    return {
        name: "vite-plugin-jsx-in-js",
        enforce: "pre",
        async transform(code, id) {
            if (!id.endsWith(".js")) return null
            if (id.includes("node_modules")) return null
            if (!/</.test(code)) return null
            return transformWithEsbuild(code, id, { loader: "jsx" })
        },
    }
}

import { fileURLToPath } from "url"
import { dirname } from "path"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import path from "path"
import fs from "fs"

const packageJsonConfig = path.resolve(process.env.src_path, "package.json")
const catalystPackageJsonConfig = path.resolve(__dirname, "../../package.json")

let packageJsonContent, catalystPackageJsonContent
let _moduleAliases = {},
    catalyst_moduleAliases = {}

try {
    packageJsonContent = fs.readFileSync(packageJsonConfig, "utf8")
    const packageJson = JSON.parse(packageJsonContent)
    _moduleAliases = packageJson._moduleAliases || {}
} catch (error) {
    console.warn(`Failed to read or parse package.json from ${packageJsonConfig}:`, error.message)
}

try {
    catalystPackageJsonContent = fs.readFileSync(catalystPackageJsonConfig, "utf8")
    const catalystPackageJson = JSON.parse(catalystPackageJsonContent)
    catalyst_moduleAliases = catalystPackageJson._moduleAliases || {}
} catch (error) {
    console.warn(
        `Failed to read or parse catalyst package.json from ${catalystPackageJsonConfig}:`,
        error.message
    )
}

const allAliases = { ..._moduleAliases, ...catalyst_moduleAliases }

import { imageUrl, fontUrl } from "./scssParams.js"

const alias = () => {
    if (!allAliases || typeof allAliases !== "object") {
        return {}
    }

    return Object.keys(allAliases).reduce((moduleEnvMap, alias) => {
        if (allAliases[alias] && typeof allAliases[alias] === "string") {
            try {
                const aliasPath = path.join(process.env.src_path, ...allAliases[alias].split("/"))
                moduleEnvMap[alias] = aliasPath
            } catch (error) {
                console.warn(`Failed to configure alias ${alias}:`, error.message)
            }
        }
        return moduleEnvMap
    }, {})
}

export const getClientEnvVariables = () => {
    const clientEnvVars = process.env.CLIENT_ENV_VARIABLES

    if (!clientEnvVars) {
        return {}
    }

    // Parse CLIENT_ENV_VARIABLES if it's a JSON string
    const allowedVars = typeof clientEnvVars === "string" ? JSON.parse(clientEnvVars) : clientEnvVars

    // Create define object with only allowed environment variables
    const envVarDefinitions = {}

    allowedVars.forEach((varName) => {
        if (process.env[varName] !== undefined) {
            // Define as process.env.VARIABLE_NAME for client-side usage
            envVarDefinitions[`process.env.${varName}`] = JSON.stringify(process.env[varName])
        }
    })
    envVarDefinitions[`process.env.src_path`] = JSON.stringify(process.env["src_path"])
    return envVarDefinitions
}

const isProduction = process.env.NODE_ENV === "production"

// Common list of browser-facing dependencies that benefit from pre-bundling
const browserOptimizeDeps = [
    "react",
    "react-dom",
    "react-router-dom",
    "@tata1mg/router",
    "invariant",
    "react-fast-compare",
    "shallowequal",
    "prop-types",
    "redux-thunk",
    "redux-logger",
]

// Node-only / instrumentation dependencies that should remain external in SSR
const nodeOnlyExternalDeps = [
    "elastic-apm-node",
    "@opentelemetry/api",
    "@opentelemetry/core",
    "@opentelemetry/sdk-node",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/sdk-metrics",
    "@opentelemetry/resources",
    "@opentelemetry/instrumentation-http",
    "@opentelemetry/instrumentation-express",
    "@grpc/grpc-js",
]

export default defineConfig({
    ssr: {
        // Keep selected React-side packages bundled for SSR
        noExternal: ["@tata1mg/slowboi-react", "@tata1mg/prefetch-core", "@tata1mg/prefetch-core/react"],
        // Ensure Node-only instrumentation and low-level Node deps stay external
        external: nodeOnlyExternalDeps,
        optimizeDeps: {
            include: [
                ...browserOptimizeDeps,
                "@tata1mg/slowboi-react",
                "@tata1mg/prefetch-core",
                "@tata1mg/prefetch-core/react",
                "react-dom/server.node",
            ],
            exclude: ["catalyst-core/router/ClientRouter"],
            force: true,
            esbuildOptions: {
                format: "esm",
                target: "node2022",
                loader: {
                    ".js": "jsx",
                },
            },
        },
    },
    plugins: [scssModulesPlugin(), jsxInJsPlugin(), react()],
    resolve: {
        alias: alias(),
    },
    define: {
        ...getClientEnvVariables(),
    },

    // Production build configuration
    build: {
        outDir: path.join(process.env.src_path, "build"),
        sourcemap: isProduction,
        minify: false,
        rollupOptions: {
            output: {
                manualChunks: (id) => {
                    // Create separate chunks for better categorization
                    if (id.includes("node_modules")) {
                        return "vendor"
                    }
                    // Let Vite handle the rest automatically
                    return null
                },
            },
        },
    },

    optimizeDeps: {
        include: browserOptimizeDeps,
        exclude: ["catalyst-core/router/ClientRouter"],
        force: true,
        esbuildOptions: {
            format: "esm",
            target: "node2022",
            loader: {
                ".js": "jsx",
            },
        },
    },

    css: {
        modules: {
            localsConvention: "camelCase",
            generateScopedName: "[name]__[local]___[hash:base64:5]",
        },
        preprocessorOptions: {
            scss: {
                additionalData: `@import "@css/resources/index.scss" ; $font_url: "${fontUrl()}";  $url_for: "${imageUrl()}"; `,
                silenceDeprecations: ["import", "global-builtin", "color-functions", "if-function"],
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

    // Server configuration
    server: {
        hmr: !isProduction,
        fs: {
            allow: [process.env.src_path, __dirname],
        },
    },

    // Preview configuration for production preview
    preview: {
        port: process.env.NODE_SERVER_PORT ? parseInt(process.env.NODE_SERVER_PORT) : 3005,
        host: process.env.NODE_SERVER_HOSTNAME || "localhost",
    },
})
