export default {
    babelrc: false,
    presets: [
        [
            "@babel/preset-env",
            {
                targets: {
                    node: "current",
                },
            },
        ],
        "@babel/preset-react",
    ],
    plugins: ["@loadable/babel-plugin"],
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
