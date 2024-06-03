export default {
    babelrc: false,
    presets: [
        [
            "@babel/preset-env",
            {
                targets: {
                    browsers: "last 2 versions",
                },
            },
        ],
        "@babel/preset-react",
    ],
    plugins: ["@loadable/babel-plugin"],
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
