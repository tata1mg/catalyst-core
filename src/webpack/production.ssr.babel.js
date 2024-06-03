import nodeExternals from "webpack-node-externals"
const { mergeWithCustomize, customizeArray, customizeObject } = require("webpack-merge")
import path from "path"

import baseConfig from "./base.babel"
const rootWorkspacePath = require("app-root-path")

const catalystConfig = require(path.resolve(__dirname, "..", "config.json"))
const plugins = require(path.join(process.env.src_path, "webpackConfig.js"))

const ssrConfig = mergeWithCustomize({
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
    mode: "production",
    stats: "errors-only",
    optimization: {
        splitChunks: {
            chunks: "all",
            minSize: 10000000,
            name: false,
        },
    },
    plugins: [...plugins.ssrPlugins],
    target: "node",
    entry: {
        handler: path.resolve(__dirname, "..", "./server/renderer/handler.js"),
    },
    externals: [
        // images are handled by isomorphic webpack.
        // html files are required directly
        /\.(html|png|gif|jpg)$/,
        // treat all node modules as external to keep this bundle small
        nodeExternals({
            modulesDir: path.resolve(process.env.src_path, "./node_modules"),
        }),
        nodeExternals({
            modulesDir: path.join(rootWorkspacePath.path, "./node_modules"),
        }),
    ],
    output: {
        path: path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH, "/renderer"),
        chunkFilename: catalystConfig.chunkFileNameProd,
        filename: "handler.js",
        libraryTarget: "commonjs",
    },
})

export default ssrConfig
