import customWebpackConfig from "@catalyst/template/webpackConfig.js"

const isCompilerEnabled = !!customWebpackConfig.reactCompiler

const reactCompilerOptions =
    typeof customWebpackConfig.reactCompiler === "object"
        ? customWebpackConfig.reactCompiler
        : { target: "18" }

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
        ...(isCompilerEnabled ? [["babel-plugin-react-compiler", reactCompilerOptions]] : []),
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
