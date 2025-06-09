// vite.config.js
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

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
        console.warn("No module aliases found or invalid aliases configuration")
        return {}
    }

    return Object.keys(allAliases).reduce((moduleEnvMap, alias) => {
        if (allAliases[alias] && typeof allAliases[alias] === "string") {
            try {
                const aliasPath = path.join(process.env.src_path, ...allAliases[alias].split("/"))
                moduleEnvMap[alias] = aliasPath
                console.log(`Alias configured: ${alias} -> ${aliasPath}`)
            } catch (error) {
                console.warn(`Failed to configure alias ${alias}:`, error.message)
            }
        }
        return moduleEnvMap
    }, {})
}

// Function to create environment variable definitions for the client
const getClientEnvVariables = () => {
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
const isBuild = process.env.VITE_BUILD_MODE === "true"

export default defineConfig({
    ssr: {
        noExternal: ["@tata1mg/slowboi-react", "@tata1mg/prefetch-core", "@tata1mg/prefetch-core/react"],
        optimizeDeps: {
            include: [
                "react",
                "react-dom",
                "invariant",
                "react-fast-compare",
                "shallowequal",
                "prop-types",
                "redux-thunk",
                "redux-logger",
                "@tata1mg/slowboi-react",
                "@tata1mg/prefetch-core",
                "@tata1mg/prefetch-core/react",
                "react-dom",
                "react-dom/server.node",
            ],
            exclude: ["catalyst-core/router/ClientRouter"],
            force: true,
            esbuildOptions: {
                format: "esm",
                target: "node2022",
            },
        },
    },
    plugins: [react()],
    resolve: {
        alias: alias(),
    },
    define: {
        ...getClientEnvVariables(),
    },

    // Production build configuration
    build: {
        outDir: path.join(process.env.src_path, "build"),
        emptyOutDir: true,
        sourcemap: !isProduction,
        minify: isProduction ? "esbuild" : false,
        rollupOptions: {
            input: {
                // Client entry point
                main: path.join(process.env.src_path, "client/index.jsx"),
                // Server entry point for SSR
                server: path.join(__dirname, "renderer/index.js"),
            },
            output: {
                format: "es",
                entryFileNames: (chunkInfo) => {
                    return chunkInfo.name === "server" ? "server/[name].js" : "public/assets/[name]-[hash].js"
                },
                chunkFileNames: "public/assets/[name]-[hash].js",
                assetFileNames: (assetInfo) => {
                    const extType = assetInfo.name.split(".").pop()
                    if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(extType)) {
                        return "public/assets/images/[name]-[hash][extname]"
                    }
                    if (/woff2?|eot|ttf|otf/i.test(extType)) {
                        return "public/assets/fonts/[name]-[hash][extname]"
                    }
                    if (/css/i.test(extType)) {
                        return "public/assets/css/[name]-[hash][extname]"
                    }
                    return "public/assets/[name]-[hash][extname]"
                },
            },
            external: isBuild ? [] : ["react", "react-dom"],
        },
        ssr: isBuild ? path.join(__dirname, "renderer/index.js") : false,
        manifest: true,
        ssrManifest: isBuild,
    },

    optimizeDeps: {
        include: [
            "invariant",
            "react-fast-compare",
            "shallowequal",
            "prop-types",
            "redux-thunk",
            "redux-logger",
        ],
        exclude: ["catalyst-core/router/ClientRouter"],
        force: true,
        esbuildOptions: {
            format: "esm",
            target: "node2022",
        },
    },

    css: {
        modules: {
            localsConvention: "camelCase",
            generateScopedName: isProduction ? "[hash:base64:8]" : "[name]__[local]___[hash:base64:5]",
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
