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
const { parseNativeArgs } = require("./utils.js")

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
let { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = loadAppConfig()

/** A coded error (IOS-002 and on) is our own; anything else is the toolchain's. */
const reportCode = (error) => (/^IOS-\d{3}$/.test(error?.code) ? error.code : "IOS-000")

function reportVerbose(error) {
    // --verbose/--debug add the registry's boxed report, printed with
    // console.error rather than progress.log, which would prefix every
    // border line and break the box.
    if (resolveOutputMode() !== "default") {
        console.error(
            formatBuildError({
                code: reportCode(error),
                category: "IOS",
                upstreamName: "Xcode/CocoaPods",
                error,
            })
        )
    } else if (process.env.CATALYST_DEBUG && error.stack) {
        console.error(error.stack)
    }
}

async function main() {
    // --release / --build-number / --no-sign. A release resolves its config
    // (release block, start-URL guard, build number) when the build is
    // created, so those failures surface here, before Xcode runs.
    const flags = parseNativeArgs(process.argv.slice(2))
    let build
    try {
        build = createIosBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH }, flags)
    } catch (error) {
        process.stderr.write(buildFailure({ error, stage: "Resolving the iOS build", code: "IOS-000" }))
        reportVerbose(error)
        process.exit(1)
    }

    // One-command dev: a debug build starts the dev server when nothing is
    // serving on the port. setupServer rewrites the config's addresses, and the
    // build bakes them in when it is created, so it is created again after.
    if (shouldEnsureDevServer("ios", WEBVIEW_CONFIG, { release: build.release })) {
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
                build.cleanup()
                build = createIosBuild({ WEBVIEW_CONFIG, BUILD_OUTPUT_PATH }, { ...flags, progress })
            }
        } catch (error) {
            progress.fail("server")
            process.stderr.write(buildFailure({ error, stage: "Starting the dev server", code: "IOS-000" }))
            build.cleanup()
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
        buildReleaseForIOS,
        PROJECT_DIR,
    } = build
    // The merged release config when this is a release build.
    const wvConfig = build.WEBVIEW_CONFIG

    let building = false
    try {
        const aiPlugin = resolveAIPluginSource(wvConfig, process.cwd(), (message, status = "info") =>
            progress.log(message, status)
        )
        const pluginConfig = { ...resolvePluginConfig(wvConfig), ...aiPlugin.toggles }
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
        if (build.release) await buildReleaseForIOS(pluginComposition)
        else await buildForIOS(pluginComposition)
    } catch (error) {
        // buildForIOS already reported this through the progress tree, so the
        // default mode does not repeat it. The steps before it report nothing
        // themselves; without this their failure exited 1 with no output.
        if (!building) {
            if (progress.currentStep) progress.fail(progress.currentStep.id)
            process.stderr.write(buildFailure({ error, stage: error?.stage || "iOS build", code: "IOS-000" }))
        }
        reportVerbose(error)
        build.cleanup()
        process.exit(1)
    }
    build.cleanup()
    process.exit(0)
}

if (require.main === module) {
    main()
}

// Legacy re-exports for any tooling that imports from this file directly
module.exports = { createIosBuild, pwd }
