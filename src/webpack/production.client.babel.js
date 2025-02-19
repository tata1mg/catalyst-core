/* eslint-disable */
import _registerAliases, { catalystResultMap } from "../scripts/registerAliases.js"
import path from "path"
import LoadablePlugin from "@loadable/webpack-plugin"
import MiniCssExtractPlugin from "mini-css-extract-plugin"
import { mergeWithCustomize, customizeArray, customizeObject } from "webpack-merge"

import baseConfig from "@catalyst/webpack/base.babel"
import catalystConfig from "@catalyst/root/config.json"
import customWebpackConfig from "@catalyst/template/webpackConfig.js"
import { _moduleAliases } from "@catalyst/root/package.json"

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
    resolve: {
        alias: catalystResultMap,
    },
    optimization: {
        runtimeChunk: "single",
        moduleIds: "deterministic",
        splitChunks: customWebpackConfig.splitChunksConfig
            ? customWebpackConfig.splitChunksConfig
            : {
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
        new LoadablePlugin({
            filename: "loadable-stats.json",
            writeToDisk: {
                filename: path.join(__dirname, "../.."),
            },
        }),
        new MiniCssExtractPlugin({
            filename: catalystConfig.cssChunkFileName,
            ignoreOrder: true,
        }),
        ...customWebpackConfig.clientPlugins,
    ],
})

export default clientConfig
