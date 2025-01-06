/* eslint-disable */
import _registerAliases, { catalystResultMap } from "../scripts/registerAliases.js"
import path from "path"
import nodeExternals from "webpack-node-externals"
const { mergeWithCustomize, customizeArray, customizeObject } = require("webpack-merge")

import rootWorkspacePath from "app-root-path"
import baseConfig from "@catalyst/webpack/base.babel"
import catalystConfig from "@catalyst/root/config.json"
import customWebpackConfig from "@catalyst/template/webpackConfig.js"
import { _moduleAliases } from "@catalyst/root/package.json"

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
    resolve: {
        alias: catalystResultMap,
    },
    plugins: [...customWebpackConfig.ssrPlugins],
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
            allowlist: customWebpackConfig.transpileModules ? customWebpackConfig.transpileModules : [],
        }),
        nodeExternals({
            modulesDir: path.join(rootWorkspacePath.path, "./node_modules"),
            allowlist: customWebpackConfig.transpileModules ? customWebpackConfig.transpileModules : [],
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
