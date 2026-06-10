"use strict"

const fs = require("fs")
const path = require("path")
const { buildAndroidAAB } = require("../renameAndroidProject.js")

const DEFAULT_DEPLOYMENT_PATH = "./deployment"
const DEFAULT_OLD_PROJECT_NAME = "androidProject"
const DEFAULT_OVERWRITE_EXISTING = true

function createBuildPhase(ctx) {
    const { configPath, pwd, progress, ANDROID_PACKAGE } = ctx

    async function detectPhysicalDevice(ADB_PATH) {
        try {
            progress.log("Detecting physical devices...", "info")
            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - ADB_PATH is derived from androidConfig.sdkPath, a trusted internal config value.
            const devices = ctx.runCommand(`${ADB_PATH} devices -l`)
            const lines = devices.split("\n").filter((line) => line.trim() && !line.includes("List of devices"))

            for (const line of lines) {
                const parts = line.trim().split(/\s+/)
                if (parts.length >= 2 && parts[1] === "device") {
                    const deviceId = parts[0]

                    if (!deviceId.startsWith("emulator-")) {
                        try {
                            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - deviceId comes from adb devices output, not user input.
                            const qemuCheck = ctx.runCommand(
                                `${ADB_PATH} -s ${deviceId} shell getprop ro.kernel.qemu`
                            )
                            if (!qemuCheck.trim()) {
                                progress.log(`Physical device detected: ${deviceId}`, "success")

                                let deviceModel = "Unknown Device"
                                try {
                                    // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - deviceId comes from adb devices output, not user input.
                                    const model = ctx.runCommand(
                                        `${ADB_PATH} -s ${deviceId} shell getprop ro.product.model`
                                    )
                                    deviceModel = model.trim() || deviceModel
                                } catch (e) {
                                    // Ignore model detection errors
                                }

                                return { id: deviceId, model: deviceModel }
                            }
                        } catch (error) {
                            continue
                        }
                    }
                }
            }

            progress.log("No physical devices detected", "info")
            return null
        } catch (error) {
            progress.log("Error detecting physical devices: " + error.message, "error")
            return null
        }
    }

    async function testPhysicalDeviceInstallation(ADB_PATH, deviceId) {
        try {
            progress.log(`Testing installation capability on device ${deviceId}...`, "info")

            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - deviceId comes from adb devices output, not user input.
            const connectionTest = ctx.runCommand(`${ADB_PATH} -s ${deviceId} shell echo "test"`)
            if (!connectionTest.includes("test")) {
                progress.log("Device connection test failed", "error")
                return false
            }

            try {
                // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - deviceId comes from adb devices output, not user input.
                const developerOptions = ctx.runCommand(
                    `${ADB_PATH} -s ${deviceId} shell settings get global development_settings_enabled`
                )
                if (developerOptions.trim() !== "1") {
                    progress.log("Developer options not enabled on device", "warning")
                    return false
                }
            } catch (error) {
                progress.log("Cannot verify developer options status", "warning")
            }

            try {
                // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - deviceId comes from adb devices output, not user input.
                const usbDebugging = ctx.runCommand(
                    `${ADB_PATH} -s ${deviceId} shell settings get global adb_enabled`
                )
                if (usbDebugging.trim() !== "1") {
                    progress.log("USB debugging not enabled on device", "warning")
                    return false
                }
            } catch (error) {
                progress.log("Cannot verify USB debugging status", "warning")
            }

            try {
                // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - deviceId comes from adb devices output, not user input.
                ctx.runCommand(`${ADB_PATH} -s ${deviceId} shell pm list packages -3 | head -1`)
            } catch (error) {
                progress.log("Cannot access package manager on device", "error")
                return false
            }

            progress.log(`Device ${deviceId} is ready for installation`, "success")
            return true
        } catch (error) {
            progress.log(`Installation capability test failed: ${error.message}`, "error")
            return false
        }
    }

    async function checkEmulator(ADB_PATH) {
        try {
            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - ADB_PATH is derived from androidConfig.sdkPath, a trusted internal config value.
            const devices = ctx.runCommand(`${ADB_PATH} devices`)
            return devices.includes("emulator")
        } catch (error) {
            progress.log("Error checking emulator status: " + error.message, "error")
            return false
        }
    }

    async function startEmulator(EMULATOR_PATH, androidConfig) {
        progress.log(`Starting emulator: ${androidConfig.emulatorName}...`, "info")
        // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - EMULATOR_PATH is derived from androidConfig.sdkPath, a trusted internal config value.
        return ctx.runInteractiveCommand(
            EMULATOR_PATH,
            ["-avd", androidConfig.emulatorName, "-read-only"],
            {}
        )
            .then(() => {
                progress.log("Emulator started successfully", "success")
            })
            .catch((error) => {
                progress.log("Error starting emulator: " + error.message, "error")
                throw error
            })
    }

    async function handleEmulatorSetup(ADB_PATH, EMULATOR_PATH, androidConfig) {
        progress.log("Setting up emulator...", "info")
        const emulatorRunning = await checkEmulator(ADB_PATH)
        if (!emulatorRunning) {
            progress.log("No emulator running, attempting to start one...", "info")
            await startEmulator(EMULATOR_PATH, androidConfig)
            await new Promise((resolve) => setTimeout(resolve, 5000))
        } else {
            progress.log("Emulator already running", "success")
        }
        return { type: "emulator", name: androidConfig.emulatorName }
    }

    async function buildApp(ADB_PATH, androidConfig, buildOptimisation, targetDevice = null) {
        progress.log("Building and installing app...", "info")
        try {
            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - pwd and configPath are internal resolved paths, not user input.
            let buildCommand = `cd ${pwd}/androidProject && ./gradlew generateWebViewConfig -PconfigPath=${configPath} -PbuildOptimisation=${buildOptimisation} && ./gradlew clean installDebug -PconfigPath=${configPath} --quiet --console=rich`

            if (targetDevice && targetDevice.type === "physical") {
                buildCommand = buildCommand.replace(
                    "installDebug",
                    `installDebug -Pandroid.injected.target.device=${targetDevice.id}`
                )
            }

            await ctx.runInteractiveCommand("sh", ["-c", buildCommand], { "BUILD SUCCESSFUL": "" })
            progress.log("App build and installation completed successfully!", "success")
        } catch (error) {
            throw new Error("Error building/installing app: " + error.message)
        }
    }

    async function launchApp(ADB_PATH, buildType = "debug", targetDevice = null) {
        if (!targetDevice) {
            progress.log("No target device specified, skipping launch", "warning")
            return
        }

        if (targetDevice.type === "physical") {
            progress.log(`App installed on physical device: ${targetDevice.model}`, "success")
            progress.log("Manual launch required - check your device to open the app", "info")
            return
        }

        try {
            progress.log("Launching app on emulator...", "info")
            const packageName = `${ANDROID_PACKAGE}${buildType === "debug" ? ".debug" : ""}`
            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - ADB_PATH is derived from androidConfig.sdkPath, a trusted internal config value.
            const launchCommand = `${ADB_PATH} shell monkey -p ${packageName} 1`
            await ctx.runInteractiveCommand("sh", ["-c", launchCommand], {})
            progress.log("App launched successfully on emulator!", "success")
        } catch (error) {
            progress.log(`Warning: Could not auto-launch app: ${error.message}`, "warning")
            progress.log("App was installed successfully, but auto-launch failed", "info")
        }
    }

    async function createAABConfig(androidConfig) {
        const DEFAULT_PROJECT_PATH = `${pwd}/androidProject`

        const aabConfig = {
            projectPath: androidConfig.projectPath || DEFAULT_PROJECT_PATH,
            deploymentPath: DEFAULT_DEPLOYMENT_PATH,
            oldProjectName: DEFAULT_OLD_PROJECT_NAME,
            overwriteExisting:
                androidConfig.overwriteExisting !== undefined
                    ? androidConfig.overwriteExisting
                    : DEFAULT_OVERWRITE_EXISTING,

            newProjectName:
                androidConfig.newProjectName ||
                androidConfig.appName ||
                androidConfig.packageName?.split(".").pop() ||
                "catalystapp",

            packageName: androidConfig.packageName || null,

            createSignedAAB: true,
            outputPath: androidConfig.outputPath || `${process.cwd()}/build-output`,
        }

        if (androidConfig.keystoreConfig) {
            aabConfig.keystoreConfig = androidConfig.keystoreConfig
        } else if (androidConfig.keystore) {
            aabConfig.keystoreConfig = {
                keyAlias: androidConfig.keystore.alias || "release",
                storePassword: androidConfig.keystore.storePassword,
                keyPassword: androidConfig.keystore.keyPassword,
                validityYears: 25,
                organizationInfo: {
                    companyName: androidConfig.keystore.organizationName || "YourCompany",
                    city: androidConfig.keystore.city || "YourCity",
                    state: androidConfig.keystore.state || "YourState",
                    countryCode: androidConfig.keystore.countryCode || "US",
                },
            }
        }

        progress.log(`AAB Configuration:`, "info")
        progress.log(
            `  Project Path: ${aabConfig.projectPath} ${aabConfig.projectPath === DEFAULT_PROJECT_PATH ? "(default)" : "(configured)"}`,
            "info"
        )
        progress.log(
            `  Deployment Path: ${aabConfig.deploymentPath} ${aabConfig.deploymentPath === DEFAULT_DEPLOYMENT_PATH ? "(default)" : "(configured)"}`,
            "info"
        )
        progress.log(
            `  Old Project Name: ${aabConfig.oldProjectName} ${aabConfig.oldProjectName === DEFAULT_OLD_PROJECT_NAME ? "(default)" : "(configured)"}`,
            "info"
        )
        progress.log(`  New Project Name: ${aabConfig.newProjectName}`, "info")
        progress.log(
            `  Overwrite Existing: ${aabConfig.overwriteExisting} ${aabConfig.overwriteExisting === DEFAULT_OVERWRITE_EXISTING ? "(default)" : "(configured)"}`,
            "info"
        )
        progress.log(`  Output Path: ${aabConfig.outputPath}`, "info")

        return aabConfig
    }

    async function moveApkToOutputPath(buildType, BUILD_OUTPUT_PATH, appName) {
        try {
            if (!BUILD_OUTPUT_PATH) {
                progress.log("BUILD_OUTPUT_PATH not set, skipping APK move", "warning")
                return null
            }

            const currentDate = new Date().toLocaleDateString("en-GB").replace(/\//g, "-")
            const currentTime = new Date()
                .toLocaleTimeString("en-US", {
                    hour12: true,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                })
                .replace(/:/g, ":")
            let destinationApkFileName = ""

            if (appName) {
                destinationApkFileName =
                    buildType === "release"
                        ? `${appName}-${currentTime}.release.apk`
                        : `${appName}-${currentTime}.debug.apk`
            } else {
                destinationApkFileName =
                    buildType === "release" ? `app-${currentTime}.release.apk` : `app-${currentTime}.debug.apk`
            }

            const sourceApkFileName = buildType === "release" ? `app.apk` : `app-debug.apk`

            const sourceApkPath = path.join(pwd, "androidProject", "app", "build", "outputs", "apk", buildType, sourceApkFileName) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - pwd is an internal resolved path; buildType is "debug"/"release" from config; sourceApkFileName is derived from buildType.
            const destinationDir = path.join(process.cwd(), BUILD_OUTPUT_PATH, "native", "android", currentDate, buildType) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - BUILD_OUTPUT_PATH is from trusted config; buildType and currentDate are internal values.
            const destinationApkPath = path.join(destinationDir, destinationApkFileName) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - destinationDir and destinationApkFileName are derived from internal config values, not user input.

            if (!fs.existsSync(sourceApkPath)) {
                progress.log(`APK not found at source path: ${sourceApkPath}`, "warning")
                return null
            }

            if (!fs.existsSync(destinationDir)) {
                fs.mkdirSync(destinationDir, { recursive: true })
            }

            fs.copyFileSync(sourceApkPath, destinationApkPath)
            return destinationApkPath
        } catch (error) {
            progress.log(`Error moving APK: ${error.message}`, "error")
            return null
        }
    }

    async function buildSignedAAB(androidConfig) {
        progress.log("Building signed AAB for release...", "info")

        try {
            progress.log("Generating webview configuration for release...", "info")
            try {
                // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - pwd and configPath are internal resolved paths, not user input.
                const generateConfigCommand = `cd ${pwd}/androidProject && ./gradlew generateWebViewConfig -PconfigPath=${configPath}`
                await ctx.runInteractiveCommand("sh", ["-c", generateConfigCommand], {
                    "BUILD SUCCESSFUL": "",
                })
                progress.log("Webview config generated successfully", "success")
            } catch (configError) {
                progress.log(`Warning: Webview config generation failed: ${configError.message}`, "warning")
                throw new Error("Webview config generation is required for release builds")
            }

            const aabConfig = await createAABConfig(androidConfig)
            await buildAndroidAAB(aabConfig)

            progress.log("Signed AAB build completed successfully!", "success")
        } catch (error) {
            throw new Error("Error building signed AAB: " + error.message)
        }
    }

    return {
        detectPhysicalDevice,
        testPhysicalDeviceInstallation,
        checkEmulator,
        handleEmulatorSetup,
        startEmulator,
        buildApp,
        launchApp,
        createAABConfig,
        moveApkToOutputPath,
        buildSignedAAB,
    }
}

module.exports = createBuildPhase
