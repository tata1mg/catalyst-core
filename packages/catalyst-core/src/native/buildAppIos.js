const path = require("path")
const { createIosBuild, pwd } = require("./buildIos/index.js")
const { composeIosPlugins } = require("./pluginComposerIos.js")
const { resolveInternalPluginsRoot, resolvePluginConfig } = require("./internalPluginUtils.js")

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = require(`${process.cwd()}/config/config.json`)

async function main() {
    const build = createIosBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH })
    const { progress, generateConfigConstants, updateInfoPlist, updateEntitlements, syncPluginResources, buildForIOS, PROJECT_DIR } = build

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
        progress.log("Build failed: " + error.message, "error")
        process.exit(1)
    }
    process.exit(0)
}

if (require.main === module) {
    main()
}

// Legacy re-exports for any tooling that imports from this file directly
module.exports = { createIosBuild, pwd }
