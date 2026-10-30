import loadEnvironmentVariables from "../scripts/loadEnvironmentVariables.js"
loadEnvironmentVariables()
import { defineConfig } from "vite"
import baseConfig, { getClientEnvVariables } from "./vite.config.js"
import path from "path"
import { manifestCategorizationPlugin } from "./manifest-categorization-plugin.js"
import { injectCacheKeyPlugin } from "./inject-cache-key-plugin.js"

const buildConfigPath = path.join(process.env.src_path, "buildConfig.js")
const customViteConfig = await import(buildConfigPath)

// Each vendor chunk gets its own [hash] from chunkFileNames,
// so a change in one group does not bust caches for the others.
// Keep CSS out of vendor chunks so cssCodeSplit works correctly.
function getVendorChunkName(id) {
    if (/\.(css|scss|sass|less|styl)(\?.*)?$/.test(id)) {
        return undefined
    }
    if (!/[\\/]node_modules[\\/]/.test(id)) {
        return undefined
    }
    if (
        /[\\/]node_modules[\\/](react|react-dom|scheduler|react-fast-compare|react-side-effect|react-helmet-async)[\\/]/.test(
            id
        )
    ) {
        return "vendor-react"
    }
    if (/[\\/]node_modules[\\/](react-router(?:-dom|-config)?|history)[\\/]/.test(id)) {
        return "vendor-router"
    }
    if (/[\\/]node_modules[\\/]axios[\\/]/.test(id)) {
        return "vendor-network"
    }
    if (/[\\/]node_modules[\\/]lottie[^\\/]*[\\/]/.test(id)) {
        return "vendor-lottie"
    }
    if (/[\\/]node_modules[\\/](react-google-recaptcha|react-async-script|react-dfp)[\\/]/.test(id)) {
        return "vendor-ads"
    }
    if (
        /[\\/]node_modules[\\/](react-loadable-visibility|react-detect-offline|normalize\.css)[\\/]/.test(id)
    ) {
        return "vendor-ui"
    }
    if (/[\\/]node_modules[\\/]catalyst-core[\\/]/.test(id)) {
        return "app"
    }
    // Other node_modules → let Vite pack them with the chunks that use them.
    return undefined
}

// Rolldown groups also pull in each captured module's dependencies, and a higher-priority group
// claims shared modules first. Eager vendor libs rank above "app" (catalyst-core) so it cannot
// swallow react-router/axios; lazy vendor libs rank below it so they cannot take deps that "app"
// shares (e.g. prop-types) and turn into a static import of every page.
const VENDOR_CHUNK_NAMES = [
    "vendor-react",
    "vendor-router",
    "vendor-network",
    "app",
    "vendor-lottie",
    "vendor-ads",
    "vendor-ui",
]
const vendorChunkGroups = VENDOR_CHUNK_NAMES.map((name, i) => ({
    name,
    test: (id) => getVendorChunkName(id) === name,
    priority: VENDOR_CHUNK_NAMES.length - i,
}))

const clientConfig = defineConfig({
    ...baseConfig,
    mode: "production",
    base: `${process.env.PUBLIC_STATIC_ASSET_URL || ""}${process.env.PUBLIC_STATIC_ASSET_PATH || "/"}`,

    plugins: [
        ...(baseConfig.plugins || []),
        manifestCategorizationPlugin({
            outputFile: "asset-categories.json",
            publicPath: `${process.env.PUBLIC_STATIC_ASSET_URL}${process.env.PUBLIC_STATIC_ASSET_PATH}/client/assets/`,
        }),
        injectCacheKeyPlugin(),
        ...(customViteConfig?.clientPlugins || []),
    ],

    build: {
        target: "esnext",
        // Oxc minifies JS (drops legal comments too). CSS stays on esbuild so CSS output, and the
        // CSS inlined by SSR, is unchanged; moving to Lightning CSS is a separate step.
        minify: "oxc",
        cssMinify: "esbuild",
        sourcemap: true,
        manifest: true,
        ssrManifest: true,
        outDir: path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build"),

        // cssCodeSplit: true (default) — each chunk gets its own CSS file.
        // Since ALL CSS is served via external <link> tags (never inlined),
        // per-chunk CSS is fine — more files but each is small and cacheable.

        rolldownOptions: {
            input: {
                main: path.join(process.env.src_path, "client/index.js"),
            },
            output: {
                format: "es",
                entryFileNames: (chunkInfo) => {
                    return chunkInfo.name === "server" ? "server/[name].js" : "client/assets/[name]-[hash].js"
                },
                chunkFileNames: "client/assets/[name]-[hash].js",
                assetFileNames: (assetInfo) => {
                    // Rolldown deprecates `name` in favour of `names`
                    const extType = (assetInfo.name ?? assetInfo.names?.[0] ?? "").split(".").pop()
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

                codeSplitting: { groups: vendorChunkGroups },
            },
        },

        modulePreload: false,
        chunkSizeWarningLimit: 2000,
    },

    define: {
        ...getClientEnvVariables(),
        __DEV__: false,
        "process.env.NODE_ENV": JSON.stringify("production"),
    },
})

export default clientConfig
