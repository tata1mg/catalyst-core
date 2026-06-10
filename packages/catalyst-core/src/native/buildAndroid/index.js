"use strict"

const path = require("path")
const { runCommand, runInteractiveCommand } = require("../utils.js")
const TerminalProgress = require("../TerminalProgress.js").default
const { composeAndroidPlugins } = require("../pluginComposerAndroid.js")
const { resolvePluginConfig, resolveInternalPluginsRoot } = require("../internalPluginUtils.js")

const createConfigPhase = require("./config.js")
const createAssetsPhase = require("./assets.js")
const createBuildPhase = require("./build.js")

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
const pwd = path.join(catalystCorePath, "dist/native")

const ANDROID_PACKAGE = "io.yourname.androidproject"

const steps = {
    config: "Initialize Configuration",
    tools: "Validate Android Tools",
    emulator: "Check and Start Emulator",
    copyAssets: "Copy Build Assets",
    build: "Build and Install Application",
    aab: "Build Signed AAB",
}

const progressConfig = {
    titlePaddingTop: 2,
    titlePaddingBottom: 1,
    stepPaddingLeft: 4,
    stepSpacing: 1,
    errorPaddingLeft: 6,
    bottomMargin: 2,
}

function createAndroidBuild(config) {
    const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = config

    const configPath = `${process.cwd()}/config/config.json`
    const publicPath = `${process.cwd()}/public`

    const progress = new TerminalProgress(steps, "Catalyst Android Build", progressConfig)

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

                    const canInstallOnPhysical = await testPhysicalDeviceInstallation(ADB_PATH, physicalDevice.id)

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

            const summaryItems = [
                "Build completed successfully:",
                { text: `Build Type: ${buildType}`, indent: 1, prefix: "├─ ", color: "gray" },
                { text: `SDK Path: ${androidConfig.sdkPath}`, indent: 1, prefix: "├─ ", color: "gray" },
                {
                    text: `Build Optimization: ${buildOptimisation ? "Enabled" : "Disabled"}`,
                    indent: 1,
                    prefix: "├─ ",
                    color: "gray",
                },
            ]

            if (buildType === "release") {
                if (movedApkPath) {
                    summaryItems.push({
                        text: `APK Build Location: ${movedApkPath}`,
                        indent: 1,
                        prefix: "├─ ",
                        color: "green",
                    })
                }
                summaryItems.push({
                    text: `Output: Signed AAB generated in build-output/`,
                    indent: 1,
                    prefix: "└─ ",
                    color: "green",
                })
            } else {
                if (movedApkPath) {
                    summaryItems.push({
                        text: `APK Build Location: ${movedApkPath}`,
                        indent: 1,
                        prefix: "├─ ",
                        color: "green",
                    })
                }

                if (targetDevice && targetDevice.type === "physical") {
                    summaryItems.push({
                        text: `Target Device: ${targetDevice.model} (Physical)`,
                        indent: 1,
                        prefix: "└─ ",
                        color: "green",
                    })
                } else {
                    summaryItems.push({
                        text: `Target Device: ${androidConfig.emulatorName} (Emulator)`,
                        indent: 1,
                        prefix: "└─ ",
                        color: "gray",
                    })
                }
            }

            progress.printTreeContent("Build Summary", summaryItems)
        } catch (error) {
            if (progress.currentStep) {
                progress.fail(progress.currentStep.id, error.message)

                const troubleshootingItems = [
                    "Build failed. Please try the following steps:",
                    {
                        text: "Check if Android SDK is properly configured",
                        indent: 1,
                        prefix: "├─ ",
                        color: "yellow",
                    },
                    {
                        text: "Verify build assets exist in the source directory",
                        indent: 1,
                        prefix: "├─ ",
                        color: "yellow",
                    },
                ]

                const buildType = androidConfig?.buildType || "debug"

                if (buildType !== "release") {
                    if (
                        error.message.includes("physical device") ||
                        error.message.includes("installation test")
                    ) {
                        troubleshootingItems.push(
                            "\nPhysical Device Issues:",
                            {
                                text: "Enable Developer Options on your device",
                                indent: 1,
                                prefix: "├─ ",
                                color: "yellow",
                            },
                            {
                                text: "Enable USB Debugging in Developer Options",
                                indent: 1,
                                prefix: "├─ ",
                                color: "yellow",
                            },
                            {
                                text: 'Accept the "Allow USB Debugging" prompt on your device',
                                indent: 1,
                                prefix: "├─ ",
                                color: "yellow",
                            },
                            {
                                text: "Try disconnecting and reconnecting your device",
                                indent: 1,
                                prefix: "├─ ",
                                color: "yellow",
                            },
                            {
                                text: 'Check if "adb devices" shows your device as authorized',
                                indent: 1,
                                prefix: "├─ ",
                                color: "yellow",
                            }
                        )
                    }

                    troubleshootingItems.push(
                        {
                            text: "Verify that the emulator exists and is working",
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        },
                        {
                            text: "If using physical device, ensure it stays connected",
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        }
                    )
                } else {
                    troubleshootingItems.push(
                        {
                            text: "Verify keystore configuration for release builds",
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        },
                        {
                            text: "Check that keystore passwords are properly set",
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        }
                    )
                }

                troubleshootingItems.push(
                    {
                        text: 'Run "npm run setupEmulator:android" to reconfigure Android settings',
                        indent: 1,
                        prefix: "└─ ",
                        color: "yellow",
                    },
                    "\nVerify Configuration:"
                )

                if (androidConfig) {
                    troubleshootingItems.push(
                        { text: `Build Type: ${buildType}`, indent: 1, prefix: "├─ ", color: "gray" },
                        {
                            text: `Android SDK Path: ${androidConfig.sdkPath || "Not configured"}`,
                            indent: 1,
                            prefix: "├─ ",
                            color: "gray",
                        }
                    )

                    if (buildType !== "release") {
                        if (targetDevice) {
                            troubleshootingItems.push({
                                text: `Target Device: ${targetDevice.type === "physical" ? `${targetDevice.model} (Physical)` : `${androidConfig.emulatorName} (Emulator)`}`,
                                indent: 1,
                                prefix: "└─ ",
                                color: "gray",
                            })
                        } else {
                            troubleshootingItems.push({
                                text: `Selected Emulator: ${androidConfig.emulatorName || "Not configured"}`,
                                indent: 1,
                                prefix: "└─ ",
                                color: "gray",
                            })
                        }
                    } else {
                        troubleshootingItems.push({
                            text: `Output Path: ${androidConfig.outputPath || "build-output/"}`,
                            indent: 1,
                            prefix: "└─ ",
                            color: "gray",
                        })
                    }
                } else {
                    troubleshootingItems.push(
                        { text: "Configuration could not be loaded", indent: 1, prefix: "├─ ", color: "red" },
                        {
                            text: "Check if config/config.json exists and has valid Android configuration",
                            indent: 1,
                            prefix: "└─ ",
                            color: "red",
                        }
                    )
                }

                progress.printTreeContent("Troubleshooting Guide", troubleshootingItems)
            }
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

            progress.log("✅ buildAndroidForTesting complete — project ready for gradlew test", "success")
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
