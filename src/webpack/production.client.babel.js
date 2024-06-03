import baseConfig from "./base.babel"
import MiniCssExtractPlugin from "mini-css-extract-plugin"
const { mergeWithCustomize, customizeArray, customizeObject } = require("webpack-merge")
import path from "path"

const plugins = require(path.join(process.env.src_path, "webpackConfig.js"))

const catalystConfig = require(path.resolve(__dirname, "..", "config.json"))

const clientConfig = mergeWithCustomize({
    customizeArray: customizeArray({
        entry: "prepend",
        plugins: "append",
        module: "prepend",
    }),
    customizeObject: customizeObject({
        entry: "prepend",
        plugins: "append",
        module: "prepend",
    }),
})(baseConfig, {
    mode: "production",
    stats: "errors-only",
    optimization: {
        runtimeChunk: "single",
        moduleIds: "deterministic",
        splitChunks: {
            cacheGroups: {
                commonVendor: {
                    chunks: "all",
                    test: /[\\/]node_modules[\\/](react|react-dom|react-redux|react-router|react-router-dom|redux|redux-thunk|axios|react-loadable-visibility|react-helmet-async|react-fast-compare|react-async-script|babel|@loadable\/component|catalyst)[\\/]/,
                    name: "commonVendor",
                    minSize: 400000,
                    maxSize: 400000,
                },
                utilityVendor: {
                    maxInitialRequests: Infinity,
                    chunks: "all",
                    // minSize: 0, // Enable to replicate stand alone chunking for all packages
                    reuseExistingChunk: true, // Disable to replicate stand alone chunking for all packages
                    minRemainingSize: 1000, // Disable to replicate stand alone chunking for all packages
                    minSize: 1000,
                    maxSize: 120000,
                    test: /[\\/]node_modules[\\/]/,
                    name(module) {
                        const moduleFileName = module
                            .identifier()
                            .split("/")
                            .reverse()
                            .slice(0, 3)
                            .reduce((item, current) => {
                                item = current + "." + item
                                return item
                            }, [])
                        return `npm.${moduleFileName}`
                    },
                },
            },
            chunks: "all",
            name(module) {
                const moduleFileName = module
                    .identifier()
                    .split("/")
                    .reverse()
                    .slice(0, 3)
                    .reduce((item, current) => {
                        item = current + "." + item
                        return item
                    }, [])
                return `npm.${moduleFileName}`
            },
        },
    },
    plugins: [
        new MiniCssExtractPlugin({
            filename: catalystConfig.cssChunkFileName,
            ignoreOrder: true,
        }),
        ...plugins.clientPlugins,
    ],
})

export default clientConfig
