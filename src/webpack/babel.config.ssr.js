import customWebpackConfig from "@catalyst/template/webpackConfig.js"

const EXPERIMENTS = JSON.parse(process.env.EXPERIMENTS || "{}")

export default {
    babelrc: false,
    presets: [
        [
            "@babel/preset-typescript",
            {
                isTSX: true,
                allExtensions: true,
            },
        ],
        [
            "@babel/preset-env",
            {
                targets: {
                    node: "current",
                },
            },
        ],
        ["@babel/preset-react", { runtime: "automatic" }],
    ],
    plugins: [
        ...(EXPERIMENTS?.ENABLE_COMPILER
            ? [["babel-plugin-react-compiler", customWebpackConfig.reactCompilerConfig || { target: "18" }]]
            : []),
        "@loadable/babel-plugin",
    ],
    env: {
        development: {
            plugins: ["react-refresh/babel"],
        },
        production: {
            plugins: [
                require("./babel-plugins/remove-client.plugin").default,
                "transform-react-remove-prop-types",
            ],
        },
    },
    ignore: ["__TEST__"],
}
