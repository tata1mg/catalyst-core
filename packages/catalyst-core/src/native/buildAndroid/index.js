"use strict"

const path = require("path")
const { displayPath } = require("../../cli/theme.js")
const fs = require("fs")
const { execFileSync } = require("child_process")
const { runCommand, runInteractiveCommand, isInteractive, select } = require("../utils.js")
const { buildFailure } = require("../../cli/diagnostic.js")
const TerminalProgress = require("../terminalProgress.js").default
const { composeAndroidPlugins } = require("../pluginComposerAndroid.js")
const { resolvePluginConfig, resolveInternalPluginsRoot } = require("../internalPluginUtils.js")

const createConfigPhase = require("./config.js")
const createAssetsPhase = require("./assets.js")
const createBuildPhase = require("./build.js")
const { resolveAndroidSigning, exportUploadCertificate, legacyKeystorePath } = require("./signing.js")
const { parseAdbDevices, chooseAndroidTarget, reachDevServer } = require("./devices.js")
const { releaseOutputDir, releaseArtifactPaths } = require("./output.js")
const { DEFAULT_VERSION_NAME, assertReleaseFolderFree } = require("../releaseOutput.js")
const { applyJavaHome, ensureAndroidSdk, ensureJava, resolveSdkPath } = require("../androidToolchain.js")
const { getLastTarget, saveLastTarget } = require("../localState.js")
const { ensureDevServer, migrateLanAddresses, devServerPorts, readHmrPort } = require("../setupServer.js")

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
const pwd = path.join(catalystCorePath, "dist/native")

const ANDROID_PACKAGE = "io.yourname.androidproject"

const steps = {
    server: "Start dev server",
    config: "Initialize configuration",
    tools: "Check Java and the Android SDK",
    signing: "Resolve upload key",
    emulator: "Prepare the device",
    copyAssets: "Copy build assets",
    build: "Build and install application",
    aab: "Build signed AAB",
}

/**
 * @param {object} config - { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } from config.json
 * @param {object} [options] - parseNativeArgs()
 * @param {boolean} [options.release] - `--release`: build the signed AAB whatever android.buildType says
 * @param {string} [options.url] - `--url`: the release's production URL, over WEBVIEW_CONFIG.url
 * @param {boolean} [options.device] - `--device`: run on the connected phone, not the emulator
 * @param {boolean} [options.yes] - `--yes`: allow JDK/SDK/emulator installs without a terminal
 * @param {boolean} [options.acceptLicenses] - `--accept-licenses`
 */
function createAndroidBuild(
    config,
    {
        release: releaseFlag = false,
        url,
        device: wantDevice = false,
        yes = false,
        acceptLicenses = false,
    } = {}
) {
    const flags = { yes, acceptLicenses }
    const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = config

    const configPath = `${process.cwd()}/config/config.json`
    const publicPath = `${process.cwd()}/public`

    const progress = new TerminalProgress(steps, "catalyst buildApp", { subject: "android" })

    const ctx = {
        WEBVIEW_CONFIG,
        BUILD_OUTPUT_PATH,
        configPath,
        publicPath,
        pwd,
        progress,
        ANDROID_PACKAGE,
        runCommand,
        runInteractiveCommand,
    }

    const { initializeConfig, validateAndroidTools } = createConfigPhase(ctx)
    const {
        copyBuildAssets,
        copySplashscreenAssets,
        copyOfflinePage,
        copySplashHtml,
        copyIconAssets,
        configureAppName,
        processNotifications,
    } = createAssetsPhase(ctx)
    const { handleEmulatorSetup, buildApp, launchApp, buildSignedAAB } = createBuildPhase(ctx)

    function syncAIPackageIfEnabled(wvConfig, progress) {
        const aiEnabled = wvConfig?.ai?.enabled === true
        if (!aiEnabled) return

        const appNodeModules = path.join(process.cwd(), "node_modules")
        const aiPackageSrc = path.join(appNodeModules, "catalyst-ai")
        if (!fs.existsSync(aiPackageSrc)) {
            progress.log(
                "ai.enabled=true but catalyst-ai not found in node_modules — skipping native AI sync",
                "warning"
            )
            return
        }

        const destDir = path.join(pwd, "node_modules", "catalyst-ai")
        fs.mkdirSync(destDir, { recursive: true })
        copyDirSync(aiPackageSrc, destDir)
        progress.log("catalyst-ai synced to dist/native/node_modules for Gradle", "success")
    }

    function copyDirSync(src, dest) {
        fs.mkdirSync(dest, { recursive: true })
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name === ".git") continue
            const s = path.join(src, entry.name) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            const d = path.join(dest, entry.name) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            entry.isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d)
        }
    }

    /** adb on one SDK, with a bound: a wedged adb server never answers. */
    function adbRunner(ADB_PATH) {
        return (args) =>
            execFileSync(ADB_PATH, args, {
                encoding: "utf8",
                timeout: 15000,
                stdio: ["ignore", "pipe", "pipe"],
            })
    }

    function listDevices(ADB_PATH) {
        if (!fs.existsSync(ADB_PATH)) return []
        try {
            return parseAdbDevices(adbRunner(ADB_PATH)(["devices", "-l"]))
        } catch (error) {
            progress.log(`adb devices failed: ${error.message}`, "warning")
            return []
        }
    }

    async function buildAndroidApp() {
        let androidConfig = null
        let targetDevice = null
        let resolved = null
        let signing = null
        let artifactPath = null
        let certificatePath = null

        try {
            const log = (message, type) => progress.log(message, type)
            const appRoot = process.cwd()
            // Older setups saved this machine's LAN address in config.json.
            // Put localhost back once, before the config is read (never for
            // a release or in CI).
            migrateLanAddresses({ cwd: appRoot, release: releaseFlag, platform: "android", log })

            progress.start("config")
            resolved = await initializeConfig({ release: releaseFlag, url })
            const { WEBVIEW_CONFIG: wvConfig, version, applicationId } = resolved
            androidConfig = wvConfig.android
            const release = resolved.release
            const buildOptimisation = !!androidConfig.buildOptimisation || false
            progress.log(
                `Version ${version.versionName || DEFAULT_VERSION_NAME} (${version.buildNumber}), ${applicationId}`,
                "info"
            )
            // Before any tooling runs: a second release in the same minute
            // would overwrite the first one's bundle.
            if (release)
                assertReleaseFolderFree(releaseOutputDir({ appRoot, androidConfig, version }), [".aab"])
            progress.complete("config")

            // One-command dev: a debug build starts the dev server when
            // nothing answers on its port, and waits until it does.
            if (resolved.usesDevServer) {
                progress.start("server")
                await ensureDevServer({ cwd: appRoot, log })
                progress.complete("server")
            }

            progress.start("tools")
            // Gradle and keytool get JDK 17 to 23 through this process's
            // environment; no shell profile is involved. Missing pieces are
            // installed after a yes (or --yes); the SDK path is read, never written.
            const java = await ensureJava({ flags, log })
            applyJavaHome(java)
            progress.log(`Java ${java.version} from ${java.source}`, "info")
            androidConfig.sdkPath = resolveSdkPath(androidConfig)
            const adbPath = path.join(androidConfig.sdkPath, "platform-tools", "adb")

            // Where a debug build runs: the emulator unless --device, or a
            // person here picks a connected phone.
            const last = getLastTarget("android", { cwd: appRoot })
            let target = null
            const pickTarget = async () =>
                chooseAndroidTarget({
                    wantDevice,
                    devices: listDevices(adbPath),
                    last,
                    isTTY: isInteractive(),
                    select,
                    emulatorHint:
                        androidConfig.emulatorName || (last?.target === "emulator" ? last.avd : undefined),
                })
            // Without --device the choice comes first, so a picked phone
            // skips the emulator install. With it, adb may need installing first.
            if (!release && !wantDevice) target = await pickTarget()
            const needEmulator = !release && !wantDevice && target?.target === "emulator"

            const sdk = await ensureAndroidSdk({
                sdkPath: androidConfig.sdkPath,
                emulatorName: androidConfig.emulatorName,
                preferredAvd: last?.target === "emulator" ? last.avd : undefined,
                needEmulator,
                flags,
                log,
            })
            if (sdk.installed.length) progress.log(`Installed ${sdk.installed.join(", ")}`, "success")
            if (sdk.createdAvd) progress.log(`Created the "${sdk.emulatorName}" emulator`, "success")
            if (sdk.emulatorName) androidConfig.emulatorName = sdk.emulatorName
            const { ADB_PATH, EMULATOR_PATH } = validateAndroidTools(androidConfig, { needEmulator })
            if (!release && wantDevice) target = await pickTarget()
            progress.complete("tools")

            if (release) {
                progress.start("signing")
                signing = await resolveAndroidSigning({
                    appRoot,
                    androidConfig,
                    isTTY: isInteractive(),
                    log,
                    // Named from the config as written: appId and appName
                    // overwrite packageName and android.appName in androidConfig.
                    legacyKeystorePath: legacyKeystorePath(resolved.config?.WEBVIEW_CONFIG?.android, {
                        cwd: appRoot,
                    }),
                    commonName: androidConfig.appName,
                })
                progress.log(`Upload key: ${signing.source} (alias ${signing.keyAlias})`, "info")
                progress.complete("signing")
            } else {
                progress.start("emulator")
                if (target.target === "device") {
                    targetDevice = {
                        type: "physical",
                        id: target.serial,
                        model: target.model || target.serial,
                    }
                    progress.log(`Using the connected phone ${targetDevice.model}`, "success")
                    saveLastTarget("android", { target: "device", serial: target.serial }, { cwd: appRoot })
                } else {
                    const emulator = await handleEmulatorSetup(ADB_PATH, EMULATOR_PATH, androidConfig)
                    targetDevice = { ...emulator, id: emulator.serial }
                    saveLastTarget("android", { target: "emulator", avd: emulator.name }, { cwd: appRoot })
                }
                progress.complete("emulator")
            }

            progress.start("copyAssets")
            await copyBuildAssets(androidConfig, buildOptimisation)
            await copySplashscreenAssets()
            await copyOfflinePage()
            await copySplashHtml()
            await copyIconAssets(androidConfig)
            await configureAppName(androidConfig)
            const pluginConfig = resolvePluginConfig(wvConfig)
            composeAndroidPlugins({
                corePluginsRoot: resolveInternalPluginsRoot(catalystCorePath),
                androidProjectPath: `${pwd}/androidProject`,
                pluginConfig,
                log: (message, status = "info") => progress.log(message, status),
            })
            await processNotifications(wvConfig)
            progress.log(`Build optimization: ${buildOptimisation ? "Enabled" : "Disabled"}`, "info")
            syncAIPackageIfEnabled(wvConfig, progress)
            progress.complete("copyAssets")

            const gradleOptions = { configPath: resolved.resolvedConfigPath, applicationId, version }
            if (release) {
                progress.start("aab")
                const outputDir = releaseOutputDir({ appRoot, androidConfig, version })
                const names = releaseArtifactPaths(
                    outputDir,
                    androidConfig.newProjectName || androidConfig.appName || "app"
                )
                const aab = await buildSignedAAB(androidConfig, {
                    ...gradleOptions,
                    signing,
                    buildOptimisation,
                    finalAabPath: names.aab,
                })
                artifactPath = aab?.finalAabPath || names.aab
                // The upload certificate beside the bundle (#508): Play asks
                // for it when an upload key is registered or reset.
                certificatePath = exportUploadCertificate(signing, names.certificate)
                progress.complete("aab")
            } else {
                progress.start("build")
                await buildApp(androidConfig, buildOptimisation, targetDevice.id, gradleOptions)
                // Debug builds load http://localhost:<port>; on the device that
                // is the device itself. Forward every port the app uses to this
                // machine, after the install and before the launch, every run.
                const packageName = `${applicationId}.debug`
                const ports = devServerPorts(resolved.config, {
                    hmrPort: await readHmrPort({ cwd: appRoot }),
                })
                reachDevServer(adbRunner(ADB_PATH), targetDevice.id, packageName, ports)
                progress.log(`Forwarded ports ${ports.join(", ")} to this machine (adb reverse)`, "info")
                launchApp(ADB_PATH, targetDevice.id, packageName)
                progress.complete("build")
            }

            // Aligned key/value rows, matching the Config tree the setup
            // commands print. printTreeContent draws the branch glyphs.
            const deviceName =
                targetDevice?.type === "physical"
                    ? targetDevice.model
                    : `${androidConfig.emulatorName} emulator`
            const summaryItems = release ? [] : [{ text: `device     ${deviceName}`, color: "gray" }]
            if (artifactPath) {
                summaryItems.push({ text: `artifact   ${displayPath(artifactPath, appRoot)}`, color: "gray" })
            }
            if (certificatePath) {
                summaryItems.push({
                    text: `cert       ${displayPath(certificatePath, appRoot)}`,
                    color: "gray",
                })
            }
            summaryItems.push({
                text: `version    ${version.versionName || DEFAULT_VERSION_NAME} (${version.buildNumber})`,
                color: "gray",
            })
            summaryItems.push({
                text: `build      ${release ? "release" : "debug"}${buildOptimisation ? ", optimised" : ""}`,
                color: "gray",
            })

            progress.printTreeContent("Build", summaryItems)
            if (release) {
                progress.summary("Built the signed AAB", "Upload it to Google Play")
            } else {
                progress.summary(`Running on ${deviceName}`, "Edit your app; the dev server reloads it")
            }
        } catch (error) {
            // Mark the step, then show what actually broke. The old handler
            // printed a generic "check your SDK" checklist here, which is
            // noise when the real Kotlin error is sitting in the output.
            // The ✗ line carries no message: the diagnostic below is the message.
            if (progress.currentStep) progress.fail(progress.currentStep.id)

            process.stderr.write(
                buildFailure({ error, stage: error.stage || "Android build", code: "ANDROID-000" })
            )

            throw error
        } finally {
            // The unpacked CI credentials and the resolved config are temp files.
            signing?.cleanup()
            resolved?.cleanup()
        }
    }

    async function buildAndroidForTesting() {
        try {
            const { WEBVIEW_CONFIG: wvConfig, cleanup } = await initializeConfig()
            cleanup()
            const androidConfig = wvConfig.android
            const buildOptimisation = !!androidConfig.buildOptimisation || false

            await copyBuildAssets(androidConfig, buildOptimisation)
            await copySplashscreenAssets()
            await copyOfflinePage()
            await copySplashHtml()
            await copyIconAssets()
            await configureAppName(androidConfig)

            const pluginConfig = resolvePluginConfig(wvConfig)
            composeAndroidPlugins({
                corePluginsRoot: resolveInternalPluginsRoot(catalystCorePath),
                androidProjectPath: `${pwd}/androidProject`,
                pluginConfig,
                log: (message, status = "info") => progress.log(message, status),
            })
            await processNotifications(wvConfig)
            syncAIPackageIfEnabled(wvConfig, progress)

            progress.log("buildAndroidForTesting complete — project ready for gradlew test", "success")
            return { success: true }
        } catch (error) {
            progress.log("buildAndroidForTesting failed: " + error.message, "error")
            throw error
        }
    }

    return {
        buildAndroidApp,
        buildAndroidForTesting,
        progress,
        WEBVIEW_CONFIG,
    }
}

module.exports = { createAndroidBuild, pwd }
