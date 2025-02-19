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
                    browsers: "last 2 versions",
                },
            },
        ],
        ["@babel/preset-react", { runtime: "automatic" }],
    ],
    plugins: [
        ...(EXPERIMENTS?.ENABLE_COMPILER ? [["babel-plugin-react-compiler", { target: "18" }]] : []),
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
