"use strict"

const path = require("path")
const fs = require("fs")
const { runCommand, runInteractiveCommand } = require("../utils.js")
const { buildFailure } = require("../../cli/diagnostic.js")
const TerminalProgress = require("../terminalProgress.js").default
const { composeAndroidPlugins } = require("../pluginComposerAndroid.js")
const { resolvePluginConfig, resolveInternalPluginsRoot } = require("../internalPluginUtils.js")

const createConfigPhase = require("./config.js")
const createAssetsPhase = require("./assets.js")
const createBuildPhase = require("./build.js")

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
const pwd = path.join(catalystCorePath, "dist/native")

const ANDROID_PACKAGE = "io.yourname.androidproject"

const steps = {
    config: "Initialize configuration",
    tools: "Validate Android tools",
    emulator: "Check and start emulator",
    copyAssets: "Copy build assets",
    build: "Build and install application",
    aab: "Build signed AAB",
}

function createAndroidBuild(config) {
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

        try {
            progress.start("config")
            const { WEBVIEW_CONFIG: wvConfig, BUILD_OUTPUT_PATH: bop } = await initializeConfig()
            androidConfig = wvConfig.android
            const buildType = androidConfig.buildType || "debug"
            const buildOptimisation = !!androidConfig.buildOptimisation || false
            progress.complete("config")

            progress.start("tools")
            const { ADB_PATH, EMULATOR_PATH } = validateAndroidTools(androidConfig)
            progress.complete("tools")

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
            progress.log(`Build optimization: ${buildOptimisation ? "Enabled" : "Disabled"}`, "info")
            syncAIPackageIfEnabled(wvConfig, progress)
            progress.complete("copyAssets")

            let movedApkPath = null
            if (buildType === "release") {
                progress.start("aab")
                await buildSignedAAB(androidConfig)
                progress.complete("aab")
                movedApkPath = await moveApkToOutputPath(buildType, bop, androidConfig.appName)
            } else {
                progress.start("build")
                await buildApp(ADB_PATH, androidConfig, buildOptimisation, targetDevice)
                await launchApp(ADB_PATH, buildType, targetDevice)
                progress.complete("build")
                movedApkPath = await moveApkToOutputPath(buildType, bop, androidConfig.appName)
            }

            // Aligned key/value rows, matching the Config tree the setup
            // commands print. printTreeContent draws the branch glyphs.
            const summaryItems = [
                { text: `buildType      ${buildType}`, color: "gray" },
                { text: `sdkPath        ${androidConfig.sdkPath}`, color: "gray" },
                { text: `optimization   ${buildOptimisation ? "Enabled" : "Disabled"}`, color: "gray" },
            ]

            if (movedApkPath) {
                summaryItems.push({ text: `artifact       ${movedApkPath}`, color: "gray" })
            }
            if (buildType === "release") {
                summaryItems.push({ text: `output         Signed AAB in build-output/`, color: "gray" })
            }
            summaryItems.push({
                text:
                    targetDevice?.type === "physical"
                        ? `device         ${targetDevice.model} (physical)`
                        : `device         ${androidConfig.emulatorName} (emulator)`,
                color: "gray",
            })

            progress.printTreeContent("Build", summaryItems)
            progress.summary(
                targetDevice?.type === "physical" ? "Installed on device" : "Installed on emulator",
                "Run catalyst start to serve the app"
            )
        } catch (error) {
            // Mark the step, then show what actually broke. The old handler
            // printed a generic "check your SDK" checklist here, which is
            // noise when the real Kotlin error is sitting in the output.
            if (progress.currentStep) {
                progress.fail(progress.currentStep.id, error.message)
            }

            process.stderr.write(buildFailure({ error, stage: error.stage || "Android build" }))

            throw error
        }
    }

    async function buildAndroidForTesting() {
        try {
            const { WEBVIEW_CONFIG: wvConfig } = await initializeConfig()
            const androidConfig = wvConfig.android
            const buildOptimisation = !!androidConfig.buildOptimisation || false

            await copyBuildAssets(androidConfig, buildOptimisation)
            await copySplashscreenAssets()
            await copyOfflinePage()
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
