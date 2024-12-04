import path from "path"
import webpack from "webpack"
import LoadablePlugin from "@loadable/webpack-plugin"
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
    new LoadablePlugin({
        filename: "loadable-stats.json",
        writeToDisk: {
            filename: path.join(__dirname, "../.."),
        },
    }),

    // **This loads process.env variable during webpack build process
    new webpack.DefinePlugin({
        "process.env": ([...clientEnv, "src_path","PWD"] || []).reduce((clientEnvMap, env) => {
            clientEnvMap[env] = JSON.stringify(process.env[env])
            return clientEnvMap
        }, {}),
    }),

    // ** This is used to analyze bundle size.
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
if (IS_DEV_COMMAND && !isDev) {
    publicPath = `http://${NODE_SERVER_HOSTNAME}:${NODE_SERVER_PORT}/assets/`
}

export default {
    context: path.resolve(process.env.src_path),
    mode: isDev ? "development" : "production",
    entry: {
        app: [path.resolve(process.env.src_path, "./client/index.js")],
    },
    output: {
        path: path.join(process.env.src_path, `${process.env.BUILD_OUTPUT_PATH}/public`),
               filename:             process.env.NODE_ENV === "development"
                ? "[name].bundle.js"
                : "[name].[contenthash].js",
        chunkFilename:
            process.env.NODE_ENV === "development"
                ? "[name].bundle.js"
                : "[name].[contenthash].js",
        publicPath: publicPath,
    },
    resolve: {
        fallback: { url: require.resolve("url") },
        extensions: [".js", ".jsx", ".scss"],
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
                // This loader processes all the .scss files that should be modularized. This should exclude anything inside node_modules and everything inside src/css/base since they should be globally scoped.
                test: /\.scss$/,
                exclude: [
                    path.resolve(process.env.src_path, "./node_modules"),
                    path.resolve(process.env.src_path, "./src/static/css/base"),
                ],
                use: [
                    isDev && "css-hot-loader",
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
                // In development mode, client request app.css ,which has all the css in node_modules and src/static/css/base, This is served by webpack-dev-server. However in prod this css is injected in the doc sent from the server and needs to be global, so we don't pass the files through css-loader to be modularized.
                test: /\.scss$/,
                include: [
                    path.resolve(process.env.src_path, "./node_modules"),
                    path.resolve(process.env.src_path, "./src/static/css/base"),
                ],
                use: [
                    isDev && "css-hot-loader",
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
                // This loader loads fonts in src/static/fonts using file-loader
                test: /\.(ttf|eot|woff2|json?)$/,
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
                // This loader loads html files
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
