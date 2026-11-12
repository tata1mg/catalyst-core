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
const {
    askReleaseConfig,
    ensureDevServer,
    migrateLanAddresses,
    writeConfigKeys,
} = require("./setupServer.js")
const { isInteractive, parseNativeArgs } = require("./utils.js")
const { ensureXcodeReady, prepareIosDebugTarget } = require("./iosToolchain.js")
const {
    createProfileScanner,
    isReleaseBuildType,
    planSigningForConfig,
    readIosCredentials,
    resolveExportMethod,
    settleInstalledProfile,
    settleXcodeTeam,
} = require("./buildIos/signing.js")
const { resolveNativeConfig } = require("./nativeConfig.js")
const { resolveCredentials } = require("./credentials.js")
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

/**
 * askReleaseConfig for this build: true when it saved an answer. Its errors
 * are left for createIosBuild, which resolves the config again and reports
 * them the usual way; only a failure to read or write the file is worth a line here.
 */
async function askAndSave(options) {
    try {
        return (await askReleaseConfig("ios", options)).changes.length > 0
    } catch (error) {
        if (!/^NATIVE-\d{3}$/.test(error?.code)) {
            options.log(`Could not read or update config/config.json: ${error.message}`, "warning")
        }
        return false
    }
}

/**
 * A release that will sign with the Apple account in Xcode needs
 * ios.developmentTeam, and so does a debug build for an iPhone (`device`).
 * When it is unset, use the one team Xcode has that can sign this export
 * (or ask which, in a terminal); a debug build takes a personal team too.
 * A release that auto-picked an installed App Store profile pins it as
 * ios.provisioningProfile. In a terminal the team or profile is saved to
 * config/config.json; without one it is used for this build only. Plans
 * with planSigningForConfig, the same function createIosBuild signs with.
 * Returns the appConfig to build with.
 *
 * Config and credential errors are left for createIosBuild, which reports
 * them the usual way.
 */
async function ensureSigningTeam({ appConfig, release, device = false, url, cwd, log, scanProfiles }) {
    let plan
    let exportMethod
    let found = null
    try {
        const resolved = resolveNativeConfig("ios", { release, url, config: appConfig, cwd })
        resolved.cleanup()
        exportMethod = resolveExportMethod(resolved.WEBVIEW_CONFIG.ios || {})
        found = resolveCredentials("ios", { cwd })
        plan = planSigningForConfig({
            WEBVIEW_CONFIG: resolved.WEBVIEW_CONFIG,
            credentials: readIosCredentials(found.dir),
            release,
            exportMethod,
            scanProfiles,
        })
    } catch (error) {
        return appConfig
    } finally {
        found?.cleanup()
    }
    const file = path.join(cwd, "config", "config.json")
    const profile = settleInstalledProfile({
        plan,
        log,
        save: (name) => writeConfigKeys(file, { "WEBVIEW_CONFIG.ios.provisioningProfile": name }, { log }),
    })
    if (profile?.saved) return loadAppConfig()
    const team = await settleXcodeTeam({
        plan,
        release,
        device,
        exportMethod,
        log,
        save: (teamId) => writeConfigKeys(file, { "WEBVIEW_CONFIG.ios.developmentTeam": teamId }, { log }),
    })
    if (!team) return appConfig
    if (team.saved) return loadAppConfig()
    const WEBVIEW_CONFIG = appConfig.WEBVIEW_CONFIG || {}
    return {
        ...appConfig,
        WEBVIEW_CONFIG: {
            ...WEBVIEW_CONFIG,
            ios: { ...(WEBVIEW_CONFIG.ios || {}), developmentTeam: team.teamId },
        },
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
        let appConfig = migration.changes.length ? loadAppConfig() : { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH }
        for (const change of migration.changes) {
            log(`config.json ${change.path}: ${change.from} -> ${change.to}`, "note")
        }
        const release = flags.release || isReleaseBuildType(appConfig.WEBVIEW_CONFIG?.ios?.buildType)
        // A store build in a terminal asks once for a missing app id or
        // website and saves the answers, then reads the config again.
        if (release && isInteractive()) {
            const answered = await askAndSave({ release, url: flags.url, cwd, log })
            if (answered) appConfig = loadAppConfig()
        }
        let target
        // One scan of the installed profiles for the team step and the build.
        const scanProfiles = createProfileScanner()
        if (process.platform === "darwin") {
            progress.start("toolchain")
            const developerDir = await ensureXcodeReady({ flags, log })
            progress.log(`Using ${developerDir}`, "info")
            progress.complete("toolchain")
            // Before createIosBuild, which is synchronous: picking a team can ask.
            if (release) {
                appConfig = await ensureSigningTeam({
                    appConfig,
                    release,
                    url: flags.url,
                    cwd,
                    log,
                    scanProfiles,
                })
            }
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
                // An iPhone needs a team to sign for; the simulator never signs.
                if (target.target === "device") {
                    appConfig = await ensureSigningTeam({
                        appConfig,
                        release,
                        device: true,
                        cwd,
                        log,
                        scanProfiles,
                    })
                }
            }
        }
        build = createIosBuild(appConfig, { ...flags, devHost, target, progress, appRoot: cwd, scanProfiles })
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
