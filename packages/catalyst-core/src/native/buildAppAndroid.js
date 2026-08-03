const { createAndroidBuild, pwd } = require("./buildAndroid/index.js")

const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = require(`${process.cwd()}/config/config.json`)

async function main() {
    const build = createAndroidBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH })
    const { buildAndroidApp } = build

    try {
        await buildAndroidApp()
    } catch (error) {
        // src/native is a CJS-only subtree (see src/native/package.json) and cannot
        // synchronously require() the ESM errors/index.js module under Node 20, so
        // we format inline here. Code ANDROID-000 = generic "upstream Gradle error"
        // wrapper — see errors/ANDROID/ANDROID-000.md. Message was previously
        // swallowed entirely; now preserved verbatim, not reinterpreted.
        console.error(`[ANDROID-000] Build failed (upstream: Gradle)\n→ ${error.message}`)
        process.exit(1)
    }
    process.exit(0)
}

if (require.main === module) {
    main()
}

// Legacy re-exports for any tooling that imports from this file directly
module.exports = { createAndroidBuild, pwd }
