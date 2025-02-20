module.exports = (api) => {
    api.cache(true)

    const EXPERIMENTS = JSON.parse(process.env.EXPERIMENTS || "{}")

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
        plugins: [
            ...(EXPERIMENTS?.ENABLE_COMPILER ? [["babel-plugin-react-compiler", { target: "18" }]] : []),
            "@loadable/babel-plugin",
        ],
        env: {
            test: {
                presets: ["@babel/preset-react"],
            },
        },
        ignore: ["__TEST__"],
    }
}
