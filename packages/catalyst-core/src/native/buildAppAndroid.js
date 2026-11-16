const { createAndroidBuild, pwd } = require("./buildAndroid/index.js")
const { formatBuildError, resolveOutputMode } = require("./buildErrorFormat.js")
const { loadAppConfig } = require("../cli/appConfig.js")
const { buildFailure } = require("../cli/diagnostic.js")
const { askReleaseConfig } = require("./setupServer.js")
const { isInteractive, parseNativeArgs } = require("./utils.js")

const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = loadAppConfig()

async function main() {
    let flags
    try {
        flags = parseNativeArgs(process.argv.slice(2))
    } catch (error) {
        // `--url` without a value (NATIVE-004), before any build step ran.
        process.stderr.write(buildFailure({ error, stage: "Reading the flags", code: "ANDROID-000" }))
        process.exit(1)
    }
    // The build reads config.json from disk when it starts (initializeConfig),
    // so answers saved below reach it; the config passed here is not read again.
    const { buildAndroidApp, progress } = createAndroidBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH }, flags)

    // A store build in a terminal asks once for a missing app id or website
    // and saves the answers. Its errors are left for the build, which
    // resolves the config again and reports them the usual way.
    if (isInteractive()) {
        const log = (message, type) => progress.log(message, type)
        try {
            await askReleaseConfig("android", { release: flags.release, url: flags.url, log })
        } catch (error) {
            if (!/^NATIVE-\d{3}$/.test(error?.code)) {
                log(`Could not read or update config/config.json: ${error.message}`, "warning")
            }
        }
    }

    try {
        await buildAndroidApp()
    } catch (error) {
        // buildAndroidApp already reported this through the progress tree and
        // the troubleshooting guide, so the default mode does not repeat it.
        // --verbose/--debug add the registry's boxed report on top.
        if (resolveOutputMode() !== "default") {
            // A coded error (ANDROID-005 and on, NATIVE-*) is our own; anything else is Gradle's.
            const code = /^(ANDROID|NATIVE)-\d{3}$/.test(error?.code) ? error.code : "ANDROID-000"
            const category = code.split("-")[0]
            console.error(formatBuildError({ code, category, upstreamName: "Gradle", error }))
        } else if (process.env.CATALYST_DEBUG && error.stack) {
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
