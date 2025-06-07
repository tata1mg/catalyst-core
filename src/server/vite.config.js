// vite.config.js
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react" // Assuming React, but works similar for other frameworks

import path from "path"
import fs from "fs"

const packageJsonConfig = path.resolve(process.env.src_path, "package.json")
const packageJsonContent = fs.readFileSync(packageJsonConfig, "utf8")

const _moduleAliases = JSON.parse(packageJsonContent)._moduleAliases
import { imageUrl, fontUrl } from "./scssParams.js"

const alias = () => {
    return Object.keys(_moduleAliases || {}).reduce((moduleEnvMap, alias) => {
        moduleEnvMap[alias] = path.join(process.env.src_path, ..._moduleAliases[alias].split("/"))

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

    return envVarDefinitions
}

export default defineConfig({
    ssr: {
        noExternal: ["@tata1mg/slowboi-react",
                "@tata1mg/prefetch-core","@tata1mg/prefetch-core/react"],
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
                "react-dom/server.node"
            ],
            exclude: ["catalyst-core/router/ClientRouter"],
            force: true,
            esbuildOptions: {
                // Apply client-like transforms
                format: 'esm',
                target: 'node14'
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
            // Apply client-like transforms
            format: 'esm',
            target: 'node14'
        },
    },

    css: {
        modules: {
            localsConvention: "camelCase",
            generateScopedName: "[name]__[local]___[hash:base64:5]",
        },
        preprocessorOptions: {
            scss: {
                additionalData: `@import "@css/resources/index.scss"; $font_url: ${fontUrl()}  ;$url_for: ${imageUrl()}; `,
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
})
