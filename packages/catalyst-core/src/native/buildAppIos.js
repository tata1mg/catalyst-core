const path = require("path")
const { createIosBuild, pwd } = require("./buildIos/index.js")
const { composeIosPlugins } = require("./pluginComposerIos.js")
const {
    resolveInternalPluginsRoot,
    resolvePluginConfig,
    resolveAIPluginSource,
} = require("./internalPluginUtils.js")
const { formatBuildError, resolveOutputMode } = require("./buildErrorFormat.js")
const { buildFailure } = require("../cli/diagnostic.js")
const { loadAppConfig } = require("../cli/appConfig.js")
const { ensureDevServer, shouldEnsureDevServer } = require("./setupServer.js")

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
let { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = loadAppConfig()

async function main() {
    let build = createIosBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH })

    // One-command dev: a debug build starts the dev server when nothing is
    // serving on the port. setupServer rewrites the config's addresses, and the
    // build bakes them in when it is created, so it is created again after.
    if (shouldEnsureDevServer("ios", WEBVIEW_CONFIG)) {
        const { progress } = build
        try {
            progress.start("server")
            const server = await ensureDevServer(
                path.join(process.cwd(), "config", "config.json"),
                (message, type) => progress.log(message, type)
            )
            progress.complete("server")
            if (server.started) {
                ;({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = loadAppConfig())
                build = createIosBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH }, { progress })
            }
        } catch (error) {
            progress.fail("server")
            process.stderr.write(buildFailure({ error, stage: "Starting the dev server", code: "IOS-000" }))
            process.exit(1)
        }
    }

    const {
        progress,
        generateConfigConstants,
        updateInfoPlist,
        updateEntitlements,
        syncPluginResources,
        buildForIOS,
        PROJECT_DIR,
    } = build

    let building = false
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
        building = true
        await buildForIOS(pluginComposition)
    } catch (error) {
        // buildForIOS already reported this through the progress tree, so the
        // default mode does not repeat it. The steps before it report nothing
        // themselves; without this their failure exited 1 with no output.
        if (!building) {
            if (progress.currentStep) progress.fail(progress.currentStep.id)
            process.stderr.write(buildFailure({ error, stage: error?.stage || "iOS build", code: "IOS-000" }))
        }
        // --verbose/--debug add the registry's boxed report, printed with
        // console.error rather than progress.log, which would prefix every
        // border line and break the box.
        if (resolveOutputMode() !== "default") {
            console.error(
                formatBuildError({ code: "IOS-000", category: "IOS", upstreamName: "Xcode/CocoaPods", error })
            )
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
