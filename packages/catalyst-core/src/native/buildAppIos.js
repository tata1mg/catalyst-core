const path = require("path")
const { createIosBuild, pwd } = require("./buildIos/index.js")
const { composeIosPlugins } = require("./pluginComposerIos.js")
const { resolveInternalPluginsRoot, resolvePluginConfig } = require("./internalPluginUtils.js")

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
        // src/native is a CJS-only subtree (see src/native/package.json) and cannot
        // synchronously require() the ESM errors/index.js module under Node 20, so
        // we format inline here rather than reconstructing that module system boundary.
        // Code IOS-000 = generic "upstream Xcode/CocoaPods toolchain error" wrapper —
        // see errors/IOS/IOS-000.md. We never reinterpret the underlying message.
        progress.log(`[IOS-000] Build failed (upstream: Xcode/CocoaPods)\n→ ${error.message}`, "error")
        process.exit(1)
    }
    process.exit(0)
}

if (require.main === module) {
    main()
}

// Legacy re-exports for any tooling that imports from this file directly
module.exports = { createIosBuild, pwd }
