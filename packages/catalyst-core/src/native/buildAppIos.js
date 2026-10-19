const path = require("path")
const { createIosBuild, pwd } = require("./buildIos/index.js")
const { composeIosPlugins } = require("./pluginComposerIos.js")
const { resolveInternalPluginsRoot, resolvePluginConfig, resolveAIPluginSource } = require("./internalPluginUtils.js")
const { formatBuildError, resolveOutputMode } = require("./buildErrorFormat.js")
const { loadAppConfig } = require("../cli/appConfig.js")

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = loadAppConfig()

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
        const aiPlugin = resolveAIPluginSource(WEBVIEW_CONFIG, process.cwd(), (message, status = "info") =>
            progress.log(message, status)
        )
        const pluginConfig = { ...resolvePluginConfig(WEBVIEW_CONFIG), ...aiPlugin.toggles }
        const pluginComposition = composeIosPlugins({
            corePluginsRoot: resolveInternalPluginsRoot(catalystCorePath),
            externalPluginRoots: aiPlugin.roots,
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
        // buildForIOS already reported this through the progress tree, so the
        // default mode does not repeat it. --verbose/--debug add the registry's
        // boxed report, printed with console.error rather than progress.log,
        // which would prefix every border line and break the box.
        if (resolveOutputMode() !== "default") {
            console.error(formatBuildError({ code: "IOS-000", category: "IOS", upstreamName: "Xcode/CocoaPods", error }))
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
module.exports = { createIosBuild, pwd }
