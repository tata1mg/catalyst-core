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

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: alias(),
    },
    optimizeDeps: {
        include: ["invariant", "react-fast-compare", "shallowequal", "prop-types"],
        exclude: ["@tata1mg/router", "catalyst-core/router/ClientRouter"],
        force: true,
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
