/* eslint-disable */
import _registerAliases, { catalystResultMap } from "../scripts/registerAliases.js"
import "../scripts/loadScriptsBeforeServerStarts.js"
import path from "path"
import nodeExternals from "webpack-node-externals"
import LoadablePlugin from "@loadable/webpack-plugin"
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
    plugins: [
        ...customWebpackConfig.ssrPlugins,
        new LoadablePlugin({
            filename: "loadable-stats.json",
            writeToDisk: {
                filename: path.join(__dirname, "../.."),
            },
        }),
    ],
    target: "node",
    entry: {
        handler: path.resolve(__dirname, "..", "./server/renderer/handler.js"),
    },
    externals: [
        // images are handled by isomorphic webpack.
        // html files are required directly
        /\.(html|png|gif|jpg)$/,
        // OpenTelemetry is an opt-in peer dependency that may not be installed.
        // Always treat it (and @grpc/grpc-js, pulled in by the gRPC exporters) as
        // external so the build never tries to resolve it; the lazy import() in
        // src/otel.js then only requires it at runtime when OTEL_ENABLE=true.
        /^@opentelemetry\//,
        "@grpc/grpc-js",
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
