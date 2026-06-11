const { createAndroidBuild, pwd } = require("./buildAndroid/index.js")

const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = require(`${process.cwd()}/config/config.json`)

async function main() {
    const build = createAndroidBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH })
    const { buildAndroidApp } = build

    try {
        await buildAndroidApp()
    } catch (error) {
        process.exit(1)
    }
    process.exit(0)
}

if (require.main === module) {
    main()
}

// Legacy re-exports for any tooling that imports from this file directly
module.exports = { createAndroidBuild, pwd }
