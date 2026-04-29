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
        compact: true,
        plugins: ["@loadable/babel-plugin"],
        env: {
            test: {
                presets: ["@babel/preset-react"],
            },
        },
        ignore: ["__TEST__"],
    }
}
