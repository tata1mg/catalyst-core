const { createAndroidBuild, pwd } = require("./buildAndroid/index.js")
const { loadAppConfig } = require("../cli/appConfig.js")

const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = loadAppConfig()

async function main() {
    const build = createAndroidBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH })
    const { buildAndroidApp } = build

    try {
        await buildAndroidApp()
    } catch (error) {
        // buildAndroidApp already reported this through the progress tree and
        // the troubleshooting guide, so printing the message again here just
        // repeated it. Matches buildAppIos.js.
        if (process.env.CATALYST_DEBUG && error.stack) {
            console.error(error.stack)
        }
        process.exit(1)
    }
    process.exit(0)
}

if (require.main === module) {
    main()
}

// Legacy re-exports for any tooling that imports from this file directly
module.exports = { createAndroidBuild, pwd }
