module.exports = (api) => {
    api.cache(true)

    const EXPERIMENTS = JSON.parse(process.env.EXPERIMENTS || "{}")

    return {
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
