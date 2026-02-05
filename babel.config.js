module.exports = (api) => {
    api.cache(true)

    return {
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
            [
                "@babel/plugin-transform-runtime",
                {
                    helpers: true,
                    regenerator: true,
                },
            ],
            "@loadable/babel-plugin",
        ],
        compact: true,
        env: {
            test: {
                presets: ["@babel/preset-react"],
            },
        },
        ignore: ["__TEST__"],
    }
}
