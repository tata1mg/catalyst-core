import webpack from "webpack"
import merge from "webpack-merge"
import WebpackDevServer from "webpack-dev-server"
import LoadablePlugin from "@loadable/webpack-plugin"
import MiniCssExtractPlugin from "mini-css-extract-plugin"
import ReactRefreshWebpackPlugin from "@pmmmwh/react-refresh-webpack-plugin"
import path from "path"

import catalystConfig from "@catalyst/root/config.json"
import baseConfig from "@catalyst/webpack/base.babel.js"
import customWebpackConfig from "@catalyst/template/webpackConfig.js"

const { WEBPACK_DEV_SERVER_PORT, WEBPACK_DEV_SERVER_HOSTNAME } = process.env

// Create client config
const webpackClientConfig = merge(baseConfig, {
    // Use eval-cheap-module-source-map for better performance and lower memory usage
    devtool: "eval-cheap-module-source-map",
    stats: "none",
    infrastructureLogging: {
        level: "none",
    },
    plugins: [
        new LoadablePlugin({
            filename: "loadable-stats.json",
            writeToDisk: {
                filename: path.join(__dirname, "../.."),
            },
        }),
        new ReactRefreshWebpackPlugin({
            overlay: {
                entry: false,
            },
        }),
        new MiniCssExtractPlugin({
            filename: catalystConfig.cssChunkFileName,
            ignoreOrder: true,
        }),
        ...customWebpackConfig.developmentPlugins,
    ].filter(Boolean),
    optimization: {
        runtimeChunk: "single",
        moduleIds: "deterministic",
        splitChunks: customWebpackConfig.splitChunksConfig
            ? customWebpackConfig.splitChunksConfig
            : {
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
                                  .split("node_modules")?.[1]
                                  ?.split("/")
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
              },
    },
})

// Create dev server for client-side only
// Note: SSR compiler now runs in a separate process (ssr.watcher.js) for better memory management
let devServer = new WebpackDevServer(
    {
        port: WEBPACK_DEV_SERVER_PORT,
        host: WEBPACK_DEV_SERVER_HOSTNAME,
        static: {
            publicPath: webpackClientConfig.output.publicPath,
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
    webpack(webpackClientConfig)
)

devServer.startCallback(() => {
    console.log("Catalyst is compiling your files.")
    console.log("Please wait until bundling is finished.\n")
})

// Cleanup on exit
const cleanup = () => {
    console.log("[Client] Shutting down client dev server...")
    devServer.stop().then(() => {
        process.exit()
    })
}

// Handle various ways the process might exit
process.on("SIGINT", cleanup) // Ctrl+C
process.on("SIGTERM", cleanup) // kill
