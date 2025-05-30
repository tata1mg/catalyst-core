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
                    browsers: "last 2 versions",
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
        production: {
            plugins: [
                require("./babel-plugins/remove-ssr.plugin").default,
                "transform-react-remove-prop-types",
            ],
        },
        test: {
            presets: ["@babel/preset-react"],
        },
    },
    ignore: ["__TEST__"],
}
