import webpack from "webpack"
import chokidar from "chokidar"
import merge, { mergeWithCustomize, customizeArray, customizeObject } from "webpack-merge"
import WebpackDevServer from "webpack-dev-server"
import MiniCssExtractPlugin from "mini-css-extract-plugin"
import ReactRefreshWebpackPlugin from "@pmmmwh/react-refresh-webpack-plugin"
import path from "path"
import nodeExternals from "webpack-node-externals"
import rootWorkspacePath from "app-root-path"
// Import the catalystResultMap for SSR support
import { catalystResultMap } from "../scripts/registerAliases.js"

import catalystConfig from "@catalyst/root/config.json"
import baseConfig from "@catalyst/webpack/base.babel.js"
import customWebpackConfig from "@catalyst/template/webpackConfig.js"

const { WEBPACK_DEV_SERVER_PORT, WEBPACK_DEV_SERVER_HOSTNAME } = process.env

// Create client config
const webpackClientConfig = merge(baseConfig, {
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
                                  .split("/")
                                  .reduceRight((item) => item)
                              return `npm.${moduleFileName}`
                          },
                      },
                  },
              },
    },
})

// Create SSR config
const webpackSSRConfig = mergeWithCustomize({
    customizeArray: customizeArray({
        entry: "replace",
        optimization: "replace",
        plugins: "prepend",
    }),
    customizeObject: customizeObject({
        entry: "replace",
        optimization: "replace",
        plugins: "prepend",
    }),
})(baseConfig, {
    mode: "development",
    stats: "none",
    target: "node",
    entry: {
        handler: path.resolve(__dirname, "..", "./server/renderer/handler.js"),
    },
    externals: [
        /\.(html|png|gif|jpg)$/,
        nodeExternals({
            modulesDir: path.resolve(process.env.src_path, "./node_modules"),
            allowlist: customWebpackConfig.transpileModules ? customWebpackConfig.transpileModules : [],
        }),
        nodeExternals({
            modulesDir: path.join(rootWorkspacePath.path, "./node_modules"),
            allowlist: customWebpackConfig.transpileModules ? customWebpackConfig.transpileModules : [],
        }),
    ],
    resolve: {
        alias: catalystResultMap,
    },
    output: {
        path: path.join(__dirname, "../..", ".catalyst-dev", "/server", "/renderer"),
        chunkFilename: catalystConfig.chunkFileName,
        filename: "handler.development.js",
        libraryTarget: "commonjs",
    },
    plugins: [...customWebpackConfig.ssrPlugins].filter(Boolean),
})

// Create separate compiler for SSR that writes to disk
const handlerPath = path.join(
    __dirname,
    "../..",
    ".catalyst-dev",
    "/server",
    "/renderer",
    "handler.development.js"
)
const ssrCompiler = webpack(webpackSSRConfig)
const watchInstance = ssrCompiler.watch({}, (err, stats) => {
    if (err) {
        console.error(err)
        return
    }
    console.log("SSR bundle recompiled")
})
const handlerWatcher = chokidar.watch(handlerPath)

// Cleanup on exit
const cleanup = () => {
    // Close webpack watch
    watchInstance.close(() => {
        // Delete the development handler file
        try {
            // Delete the file
            require("fs").unlinkSync(handlerPath)
            // Try to remove the renderer directory
            require("fs").rmdirSync(path.join(process.env.src_path, ".catalyst-dev", "/renderer"))
            // Try to remove the parent directory
            require("fs").rmdirSync(path.join(process.env.src_path, ".catalyst-dev"))
        } catch (err) {
            // Ignore errors during cleanup
        }
        process.exit()
    })
}

// Handle various ways the process might exit
process.on("SIGINT", cleanup) // Ctrl+C
process.on("SIGTERM", cleanup) // kill
process.on("exit", cleanup) // normal exit

handlerWatcher.on("add", () => {
    handlerWatcher.close()
    // Create dev server for client-side only
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
})
