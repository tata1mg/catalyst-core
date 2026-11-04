const path = require("path")
const { createIosBuild, IOS_BUILD_STEPS, pwd } = require("./buildIos/index.js")
const { composeIosPlugins } = require("./pluginComposerIos.js")
const {
    resolveInternalPluginsRoot,
    resolvePluginConfig,
    resolveAIPluginSource,
} = require("./internalPluginUtils.js")
const { formatBuildError, resolveOutputMode } = require("./buildErrorFormat.js")
const { buildFailure } = require("../cli/diagnostic.js")
const { loadAppConfig } = require("../cli/appConfig.js")
const { ensureDevServer, migrateLanAddresses } = require("./setupServer.js")
const { parseNativeArgs } = require("./utils.js")
const { ensureXcodeReady, prepareIosDebugTarget } = require("./iosToolchain.js")
const { isReleaseBuildType } = require("./buildIos/signing.js")
const TerminalProgress = require("./terminalProgress.js").default

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = loadAppConfig()

/** A coded error (IOS-002 and on, NATIVE-*) is our own; anything else is the toolchain's. */
const reportCode = (error) => (/^(IOS|NATIVE)-\d{3}$/.test(error?.code) ? error.code : "IOS-000")

function reportVerbose(error) {
    // --verbose/--debug add the registry's boxed report, printed with
    // console.error rather than progress.log, which would prefix every
    // border line and break the box.
    if (resolveOutputMode() !== "default") {
        console.error(
            formatBuildError({
                code: reportCode(error),
                category: reportCode(error).split("-")[0],
                upstreamName: "Xcode/CocoaPods",
                error,
            })
        )
    } else if (process.env.CATALYST_DEBUG && error.stack) {
        console.error(error.stack)
    }
}

async function main() {
    // --release / --url / --device / --yes / --accept-licenses. Xcode is
    // checked, the simulator or iPhone chosen and the config resolved (start
    // URL and its guard, app id, version, signing files) before Xcode
    // builds, so those failures surface first.
    const cwd = process.cwd()
    const progress = new TerminalProgress(IOS_BUILD_STEPS, "catalyst buildApp", { subject: "ios" })
    const log = (message, type) => progress.log(message, type)
    let flags
    let build
    let devHost = "localhost"
    try {
        flags = parseNativeArgs(process.argv.slice(2))
        // Older setups saved this machine's LAN address in config.json. Put
        // localhost back once (never for a release or in CI), then read the
        // config again.
        const migration = migrateLanAddresses({ cwd, release: flags.release, platform: "ios" })
        const appConfig = migration.changes.length ? loadAppConfig() : { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH }
        for (const change of migration.changes) {
            log(`config.json ${change.path}: ${change.from} -> ${change.to}`, "info")
        }
        const release = flags.release || isReleaseBuildType(appConfig.WEBVIEW_CONFIG?.ios?.buildType)
        let target
        if (process.platform === "darwin") {
            progress.start("toolchain")
            const developerDir = await ensureXcodeReady({ flags, log })
            progress.log(`Using ${developerDir}`, "info")
            progress.complete("toolchain")
            // A release archives for any iOS device: no simulator, no phone.
            if (!release) {
                progress.start("target")
                ;({ target, devHost } = await prepareIosDebugTarget({
                    flags,
                    iosConfig: appConfig.WEBVIEW_CONFIG?.ios || {},
                    cwd,
                    log,
                }))
                progress.log(
                    target.target === "device" ? `iPhone ${target.name}` : `Simulator ${target.name}`,
                    "info"
                )
                progress.complete("target")
            }
        }
        build = createIosBuild(appConfig, { ...flags, devHost, target, progress, appRoot: cwd })
    } catch (error) {
        if (progress.currentStep) progress.fail(progress.currentStep.id)
        process.stderr.write(
            buildFailure({ error, stage: "Resolving the iOS build", code: reportCode(error) })
        )
        reportVerbose(error)
        process.exit(1)
    }

    // One-command dev: a debug build starts the dev server when nothing
    // answers on its port, and waits until it does. Only on macOS, the one
    // place an iOS build can run. An iPhone reaches it on devHost, so the
    // server listens beyond localhost then.
    if (build.usesDevServer && process.platform === "darwin") {
        try {
            progress.start("server")
            await ensureDevServer({ host: devHost, cwd, log })
            progress.complete("server")
        } catch (error) {
            progress.fail("server")
            process.stderr.write(
                buildFailure({ error, stage: "Starting the dev server", code: reportCode(error) })
            )
            build.cleanup()
            process.exit(1)
        }
    }

    const {
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
