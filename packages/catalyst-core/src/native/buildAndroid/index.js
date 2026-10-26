"use strict"

const path = require("path")
const { displayPath } = require("../../cli/theme.js")
const fs = require("fs")
const { runCommand, runInteractiveCommand } = require("../utils.js")
const { buildFailure } = require("../../cli/diagnostic.js")
const TerminalProgress = require("../terminalProgress.js").default
const { composeAndroidPlugins } = require("../pluginComposerAndroid.js")
const { resolvePluginConfig, resolveInternalPluginsRoot } = require("../internalPluginUtils.js")

const createConfigPhase = require("./config.js")
const createAssetsPhase = require("./assets.js")
const createBuildPhase = require("./build.js")
const { resolveAndroidSigning } = require("./signing.js")
const { resolveJavaHome, applyJavaHome } = require("../androidToolchain.js")
const { ensureDevServer, shouldEnsureDevServer } = require("../setupServer.js")

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
const pwd = path.join(catalystCorePath, "dist/native")

const ANDROID_PACKAGE = "io.yourname.androidproject"

const steps = {
    server: "Start dev server",
    config: "Initialize configuration",
    tools: "Validate Android tools",
    signing: "Resolve upload key",
    emulator: "Check and start emulator",
    copyAssets: "Copy build assets",
    build: "Build and install application",
    aab: "Build signed AAB",
}

/**
 * @param {object} config - { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } from config.json
 * @param {object} [options]
 * @param {boolean} [options.release] - `--release`: build the signed AAB whatever android.buildType says
 * @param {string} [options.buildNumber] - `--build-number`
 */
function createAndroidBuild(config, { release: releaseFlag = false, buildNumber } = {}) {
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
    const {
        detectPhysicalDevice,
        testPhysicalDeviceInstallation,
        handleEmulatorSetup,
        buildApp,
        launchApp,
        legacyKeystorePath,
        moveApkToOutputPath,
        buildSignedAAB,
    } = createBuildPhase(ctx)

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

    async function buildAndroidApp() {
        let androidConfig = null
        let targetDevice = null
        let resolved = null
        let signing = null

        try {
            // One-command dev: a debug build starts the dev server (and points
            // the config at this machine's LAN address) when nothing is serving
            // on the configured port. Done before the config is read, because
            // setupServer rewrites it.
            if (shouldEnsureDevServer("android", WEBVIEW_CONFIG, { release: releaseFlag })) {
                progress.start("server")
                await ensureDevServer(configPath, (message, type) => progress.log(message, type))
                progress.complete("server")
            }

            progress.start("config")
            resolved = await initializeConfig({ release: releaseFlag, buildNumber })
            const { WEBVIEW_CONFIG: wvConfig, BUILD_OUTPUT_PATH: bop, version, applicationId } = resolved
            androidConfig = wvConfig.android
            const buildType = androidConfig.buildType || "debug"
            const buildOptimisation = !!androidConfig.buildOptimisation || false
            progress.log(
                `Version ${version.versionName || "(template default)"} (${version.buildNumber}), ${applicationId}`,
                "info"
            )
            progress.complete("config")

            progress.start("tools")
            // Gradle and keytool get JDK 17+ through this process's
            // environment; no shell profile is involved.
            const java = resolveJavaHome()
            if (java) {
                applyJavaHome(java)
                progress.log(`Java ${java.version} from ${java.source}`, "info")
            } else {
                progress.log(
                    "No JDK 17+ found in JAVA_HOME, java_home or Android Studio; Gradle will use the java on PATH. Run catalyst setupEmulator:android to set one up.",
                    "warning"
                )
            }
            const { ADB_PATH, EMULATOR_PATH } = validateAndroidTools(androidConfig)
            progress.complete("tools")

            if (buildType === "release") {
                progress.start("signing")
                signing = await resolveAndroidSigning({
                    appRoot: process.cwd(),
                    androidConfig,
                    log: (message, type) => progress.log(message, type),
                    legacyKeystorePath: legacyKeystorePath(androidConfig),
                    commonName: androidConfig.appName,
                })
                progress.log(`Upload key: ${signing.source} (alias ${signing.keyAlias})`, "info")
                progress.complete("signing")
            }

            if (buildType !== "release") {
                progress.start("emulator")

                const physicalDevice = await detectPhysicalDevice(ADB_PATH)

                if (physicalDevice) {
                    progress.log(
                        `Found physical device: ${physicalDevice.model} (${physicalDevice.id})`,
                        "success"
                    )

                    const canInstallOnPhysical = await testPhysicalDeviceInstallation(
                        ADB_PATH,
                        physicalDevice.id
                    )

                    if (canInstallOnPhysical) {
                        targetDevice = {
                            type: "physical",
                            id: physicalDevice.id,
                            model: physicalDevice.model,
                        }
                        progress.log(`Using physical device: ${physicalDevice.model}`, "success")
                    } else {
                        progress.log(
                            "Physical device installation test failed, falling back to emulator",
                            "warning"
                        )
                        targetDevice = await handleEmulatorSetup(ADB_PATH, EMULATOR_PATH, androidConfig)
                    }
                } else {
                    targetDevice = await handleEmulatorSetup(ADB_PATH, EMULATOR_PATH, androidConfig)
                }

                progress.complete("emulator")
            } else {
                progress.log("Skipping device setup for release build", "info")
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
            let movedApkPath = null
            if (buildType === "release") {
                progress.start("aab")
                const aab = await buildSignedAAB(androidConfig, {
                    ...gradleOptions,
                    signing,
                    buildOptimisation,
                })
                progress.complete("aab")
                movedApkPath = aab?.finalAabPath || null
            } else {
                progress.start("build")
                await buildApp(ADB_PATH, androidConfig, buildOptimisation, targetDevice, gradleOptions)
                await launchApp(ADB_PATH, buildType, targetDevice, applicationId)
                progress.complete("build")
                movedApkPath = await moveApkToOutputPath(buildType, bop, androidConfig.appName)
            }

            // Aligned key/value rows, matching the Config tree the setup
            // commands print. printTreeContent draws the branch glyphs.
            const deviceName =
                targetDevice?.type === "physical"
                    ? targetDevice.model
                    : `${androidConfig.emulatorName} emulator`
            const summaryItems =
                buildType === "release" ? [] : [{ text: `device     ${deviceName}`, color: "gray" }]
            if (movedApkPath) {
                summaryItems.push({
                    text: `artifact   ${displayPath(movedApkPath, process.cwd())}`,
                    color: "gray",
                })
            }
            summaryItems.push({
                text: `version    ${version.versionName || "default"} (${version.buildNumber})`,
                color: "gray",
            })
            summaryItems.push({
                text: `build      ${buildType}${buildOptimisation ? ", optimised" : ""}`,
                color: "gray",
            })

            progress.printTreeContent("Build", summaryItems)
            if (buildType === "release") {
                progress.summary("Built the signed AAB", "Upload it to Google Play")
            } else {
                progress.summary(`Installed on ${deviceName}`, "Run catalyst start to serve the app")
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
            // The decoded CI keystore and the resolved config are temp files.
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
