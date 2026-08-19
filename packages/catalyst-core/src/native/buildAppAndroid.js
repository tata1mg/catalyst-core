const { createAndroidBuild, pwd } = require("./buildAndroid/index.js")
const { formatBuildError } = require("./buildErrorFormat.js")

const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = require(`${process.cwd()}/config/config.json`)

async function main() {
    const build = createAndroidBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH })
    const { buildAndroidApp } = build

    try {
        await buildAndroidApp()
    } catch (error) {
        console.error(formatBuildError({ code: "ANDROID-000", category: "ANDROID", upstreamName: "Gradle", error }))
        process.exit(1)
    }
    process.exit(0)
}

if (require.main === module) {
    main()
}

// Legacy re-exports for any tooling that imports from this file directly
module.exports = { createAndroidBuild, pwd }
