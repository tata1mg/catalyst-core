import path from "path"
import webpack from "webpack"
import MiniCssExtractPlugin from "mini-css-extract-plugin"
import { BundleAnalyzerPlugin } from "webpack-bundle-analyzer"

import catalystConfig from "@catalyst/root/config.json"
import { _moduleAliases } from "@catalyst/template/package.json"
import { imageUrl, fontUrl } from "@catalyst/webpack/scssParams"
import babelOptsServer from "@catalyst/webpack/babel.config.ssr"
import babelOptsClient from "@catalyst/webpack/babel.config.client"
import loadEnvironmentVariables from "@catalyst/scripts/loadEnvironmentVariables"
import { CLIENT_ENV_VARIABLES as clientEnv, ANALYZE_BUNDLE } from "@catalyst/template/config/config.json"

loadEnvironmentVariables()

const isDev = process.env.NODE_ENV === "development"
const isSSR = !!process.env.SSR || false

export const basePlugins = [
    // Expose only the whitelisted env vars to the client bundle
    new webpack.DefinePlugin({
        "process.env": (
            [
                ...clientEnv,
                "BUILD_OUTPUT_PATH",
                "PUBLIC_STATIC_ASSET_PATH",
                "PUBLIC_STATIC_ASSET_URL",
                "src_path",
                "PWD",
                "SENTRY_CONFIG",
            ] || []
        ).reduce((clientEnvMap, env) => {
            clientEnvMap[env] = JSON.stringify(process.env[env])
            return clientEnvMap
        }, {}),
    }),

    ANALYZE_BUNDLE &&
        new BundleAnalyzerPlugin({
            generateStatsFile: ANALYZE_BUNDLE,
        }),
    new webpack.IgnorePlugin({
        resourceRegExp: /^\.\/locale$/,
        contextRegExp: /moment$/,
    }),
]

const {
    IS_DEV_COMMAND,
    PUBLIC_STATIC_ASSET_URL,
    PUBLIC_STATIC_ASSET_PATH,
    WEBPACK_DEV_SERVER_HOSTNAME,
    WEBPACK_DEV_SERVER_PORT,
    NODE_SERVER_HOSTNAME,
    NODE_SERVER_PORT,
} = process.env

let publicPath = isDev
    ? `http://${WEBPACK_DEV_SERVER_HOSTNAME}:${WEBPACK_DEV_SERVER_PORT}/`
    : `${PUBLIC_STATIC_ASSET_URL}${PUBLIC_STATIC_ASSET_PATH}`

// serves assets from local on running devBuild and devServe command

if (IS_DEV_COMMAND === "true" && !isDev) {
    publicPath = `http://${NODE_SERVER_HOSTNAME}:${NODE_SERVER_PORT}/assets/`
}

export default {
    context: path.resolve(process.env.src_path),
    mode: isDev ? "development" : "production",
    // Use filesystem cache to reduce memory pressure and improve rebuild performance
    cache: isDev
        ? {
              type: "filesystem",
              buildDependencies: {
                  config: [__filename],
              },
              cacheDirectory: path.join(process.env.src_path, "node_modules/catalyst-core/.cache/webpack"),
          }
        : false,
    entry: {
        app: [path.resolve(process.env.src_path, "./client/index.js")],
    },
    output: {
        path: path.join(process.env.src_path, `${process.env.BUILD_OUTPUT_PATH}/public`),
        filename: process.env.NODE_ENV === "development" ? "[name].bundle.js" : "[name].[contenthash].js",
        chunkFilename:
            process.env.NODE_ENV === "development" ? "[name].bundle.js" : "[name].[contenthash].js",
        publicPath: publicPath,
    },
    resolve: {
        fallback: { url: require.resolve("url") },
        extensions: [".js", ".jsx", ".scss", ".ts", ".tsx"],
        alias: Object.keys(_moduleAliases || {}).reduce((moduleEnvMap, alias) => {
            moduleEnvMap[alias] = path.join(process.env.src_path, ..._moduleAliases[alias].split("/"))

            return moduleEnvMap
        }, {}),
    },
    plugins: basePlugins,
    module: {
        rules: [
            {
                test: /\.jsx$|\.js$/,
                exclude: path.resolve(process.env.src_path, "./node_modules"),
                use: {
                    loader: "babel-loader",
                    options: isSSR ? babelOptsServer : babelOptsClient,
                },
            },
            {
                test: /\.tsx$|\.ts$/,
                exclude: path.resolve(process.env.src_path, "./node_modules"),
                use: {
                    loader: "babel-loader",
                    options: isSSR ? babelOptsServer : babelOptsClient,
                },
            },
            {
                // CSS Modules for component-scoped styles; excludes node_modules and global base styles
                test: /\.scss$/,
                exclude: [
                    path.resolve(process.env.src_path, "./node_modules"),
                    path.resolve(process.env.src_path, "./src/static/css/base"),
                ],
                use: [
                    !isSSR && MiniCssExtractPlugin.loader,
                    {
                        loader: "css-loader",
                        options: {
                            modules: {
                                mode: "local",
                                exportOnlyLocals: !isDev && isSSR,
                                localIdentName: isDev
                                    ? catalystConfig.cssModulesIdentifierDev
                                    : catalystConfig.cssModulesIdentifierProd,
                            },
                        },
                    },
                    { loader: "postcss-loader" },
                    {
                        loader: "sass-loader",
                        options: {
                            additionalData: "$font_url: " + fontUrl() + ";" + "$url_for: " + imageUrl() + ";",
                        },
                    },
                    {
                        loader: "sass-resources-loader",
                        options: {
                            resources: [
                                path.resolve(process.env.src_path, "./src/static/css/resources/*.scss"),
                            ],
                        },
                    },
                ],
            },
            {
                // Global styles (node_modules + base CSS): not modularized, served by dev-server in dev / inlined by server in prod
                test: /\.scss$/,
                include: [
                    path.resolve(process.env.src_path, "./node_modules"),
                    path.resolve(process.env.src_path, "./src/static/css/base"),
                ],
                use: [
                    !isSSR && MiniCssExtractPlugin.loader,
                    { loader: "css-loader" },
                    { loader: "postcss-loader" },
                    {
                        loader: "sass-loader",
                        options: {
                            additionalData: "$font_url: " + fontUrl() + ";" + "$url_for: " + imageUrl() + ";",
                        },
                    },
                    {
                        loader: "sass-resources-loader",
                        options: {
                            resources: [
                                path.resolve(process.env.src_path, "./src/static/css/resources/*.scss"),
                            ],
                        },
                    },
                ],
            },
            {
                test: /\.css$/,
                use: [!isSSR && MiniCssExtractPlugin.loader, "css-loader", "postcss-loader"],
            },
            {
                test: /\.(png|jpg|gif|jpeg|ico?)$/,
                use: ["url-loader?limit=10240", "img-loader"],
            },
            {
                test: /\.svg$/i,
                issuer: /\.[jt]sx?$/,
                use: ["@svgr/webpack", "url-loader?limit=10240", "img-loader"],
            },
            {
                test: /\.(ttf|eot|woff2?)$/,
                use: [
                    {
                        loader: "url-loader",
                        options: {
                            limit: 10240,
                            outputPath: [path.resolve(process.env.src_path, "./src/static/fonts/")],
                        },
                    },
                    "file-loader",
                ],
            },
            {
                test: /\.html$/,
                use: [
                    {
                        loader: "html-loader",
                        options: {
                            minimize: {
                                minifyJS: true,
                                minifyCSS: true,
                                removeComments: false,
                                collapseWhitespace: true,
                            },
                        },
                    },
                ],
            },
        ],
    },
}
