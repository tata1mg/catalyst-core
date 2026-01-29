module.exports = (api) => {
    api.cache(true)

    const isESM = process.env.BABEL_MODULE_FORMAT === 'esm'

    return {
        presets: [
            [
                "@babel/preset-env",
                {
                    targets: {
                        node: "16",
                    },
                    modules: isESM ? false : 'commonjs',
                },
            ],
            [
                "@babel/preset-react",
                {
                    runtime: "automatic",
                },
            ],
        ],
        plugins: [],
        // Generate source maps for better debugging
        sourceMaps: true,
        // Keep original filenames for better error tracking
        retainLines: false,
    }
}