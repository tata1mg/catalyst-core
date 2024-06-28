import webpack from "webpack"
import merge from "webpack-merge"
import WebpackDevServer from "webpack-dev-server"
import MiniCssExtractPlugin from "mini-css-extract-plugin"
import ReactRefreshWebpackPlugin from "@pmmmwh/react-refresh-webpack-plugin"

import catalystConfig from "@catalyst/root/config.json"
import baseConfig from "@catalyst/webpack/base.babel.js"
import plugins from "@catalyst/template/webpackConfig.js"

const { WEBPACK_DEV_SERVER_PORT, WEBPACK_DEV_SERVER_HOSTNAME } = process.env

const webpackConfig = merge(baseConfig, {
    devtool: "inline-source-map",
    stats: "none",
    infrastructureLogging: {
        level: "none",
    },
    plugins: [
        new ReactRefreshWebpackPlugin({
            overlay: {
                entry: false,
            },
        }),
        new MiniCssExtractPlugin({
            filename: catalystConfig.cssChunkFileName,
            ignoreOrder: true,
        }),
        ...plugins.developmentPlugins,
    ].filter(Boolean),
    optimization: {
        runtimeChunk: "single",
        moduleIds: "deterministic",
        splitChunks: {
            cacheGroups: {
                commonVendor: {
                    test: /[\\/]node_modules[\\/](react|react-dom|react-redux|react-router|react-router-dom|redux|redux-thunk|axios|react-loadable-visibility|react-helmet-async|react-fast-compare|react-async-script|babel|@loadable\/component|catalyst)[\\/]/,
                    name: "commonVendor",
                    minSize: 30000,
                },
                utilityVendor: {
                    maxInitialRequests: Infinity,
                    chunks: "all",
                    // minSize: 0, // Enable to replicate stand alone chunking for all packages
                    reuseExistingChunk: true, // Disable to replicate stand alone chunking for all packages
                    minRemainingSize: 1000, // Disable to replicate stand alone chunking for all packages
                    test: /[\\/]node_modules[\\/]/,
                    name(module) {
                        const moduleFileName = module
                            .identifier()
                            .split("/")
                            .reduceRight((item) => item)
                        return `npm.${moduleFileName}`
                    },
                },
            },
        },
    },
})

let devServer = new WebpackDevServer(
    {
        port: WEBPACK_DEV_SERVER_PORT,
        host: WEBPACK_DEV_SERVER_HOSTNAME,
        static: {
            publicPath: webpackConfig.output.publicPath,
        },
        hot: true,
        historyApiFallback: true,
        headers: { "Access-Control-Allow-Origin": "*" },
        client: {
            logging: "error",
            overlay: {
                errors: false,
                warnings: false,
                runtimeErrors: false,
            },
            reconnect: true,
        },
    },
    webpack(webpackConfig)
)

devServer.startCallback(() => {
    console.log("Catalyst is compiling your files.")
    console.log("Please wait until bundling is finished.\n")
})
