const path = require("path")
const { createIosBuild, pwd } = require("./buildIos/index.js")
const { composeIosPlugins } = require("./pluginComposerIos.js")
const { resolveInternalPluginsRoot, resolvePluginConfig } = require("./internalPluginUtils.js")
const { formatBuildError } = require("./buildErrorFormat.js")

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = require(`${process.cwd()}/config/config.json`)

async function main() {
    const build = createIosBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH })
    const {
        progress,
        generateConfigConstants,
        updateInfoPlist,
        updateEntitlements,
        syncPluginResources,
        buildForIOS,
        PROJECT_DIR,
    } = build

    try {
        progress.log("Starting build process...", "info")
        const pluginConfig = resolvePluginConfig(WEBVIEW_CONFIG)
        const pluginComposition = composeIosPlugins({
            corePluginsRoot: resolveInternalPluginsRoot(catalystCorePath),
            iosProjectPath: PROJECT_DIR,
            pluginConfig,
            log: (message, status = "info") => progress.log(message, status),
        })
        await generateConfigConstants()
        await updateInfoPlist(pluginComposition)
        await updateEntitlements(pluginComposition)
        await syncPluginResources(pluginComposition)
        await buildForIOS(pluginComposition)
    } catch (error) {
        // progress.log() prefixes every call with an icon/color and does a
        // single console.log per invocation — it's built for single-line
        // status messages, not our multi-line boxed verbose/debug output
        // (piping a box through it would prefix an icon onto every border
        // line and break the box shape). Bypass it here and use plain
        // console.error instead, matching buildAppAndroid.js; progress.log
        // is unaffected everywhere else in this build.
        console.error(formatBuildError({ code: "IOS-000", category: "IOS", upstreamName: "Xcode/CocoaPods", error }))
        process.exit(1)
    }
    process.exit(0)
}

if (require.main === module) {
    main()
}

// Legacy re-exports for any tooling that imports from this file directly
module.exports = { createIosBuild, pwd }
