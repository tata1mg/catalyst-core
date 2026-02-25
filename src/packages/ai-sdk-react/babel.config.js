module.exports = function (api) {
    api.cache(true);

    const moduleFormat = process.env.BABEL_MODULE_FORMAT || 'cjs';

    return {
        presets: [
            [
                '@babel/preset-env',
                {
                    modules: moduleFormat === 'esm' ? false : 'commonjs',
                    targets: {
                        node: '16'
                    }
                }
            ],
            '@babel/preset-react'
        ],
        plugins: []
    };
};