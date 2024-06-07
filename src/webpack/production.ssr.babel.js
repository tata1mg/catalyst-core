/* eslint-disable */
import _registerAliases from "../scripts/registerAliases.js"
import path from "path"
import nodeExternals from "webpack-node-externals"
const { mergeWithCustomize, customizeArray, customizeObject } = require("webpack-merge")

import rootWorkspacePath from "app-root-path"
import plugins from "@template/webpackConfig.js"
import baseConfig from "@catalyst/webpack/base.babel"
import catalystConfig from "@catalyst/root/config.json"
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
        alias: Object.keys(_moduleAliases || {}).reduce((moduleEnvMap, alias) => {
            if (alias.includes("@template")) {
                moduleEnvMap[alias] = path.join(process.env.src_path, _moduleAliases[alias])
            }
            if (alias.includes("@catalyst")) {
                moduleEnvMap[alias] = path.join(__dirname, "../", _moduleAliases[alias])
            }
            return moduleEnvMap
        }, {}),
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
