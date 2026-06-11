"use strict"

const fs = require("fs")

function createConfigPhase(ctx) {
    const { configPath, progress } = ctx

    async function initializeConfig() {
        const configFile = fs.readFileSync(configPath, "utf8")
        const config = JSON.parse(configFile)
        const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = config

        if (!WEBVIEW_CONFIG || Object.keys(WEBVIEW_CONFIG).length === 0) {
            throw new Error("WebView Config missing in " + configPath)
        }

        if (!WEBVIEW_CONFIG.android) {
            throw new Error("Android config missing in WebView Config")
        }

        const buildType = WEBVIEW_CONFIG.android.buildType || "debug"
        progress.log(`Build Type: ${buildType}`, "info")

        if (buildType === "release") {
            progress.log("Release build detected - AAB will be generated", "info")
        }

        return { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH }
    }

    function validateAndroidTools(androidConfig) {
        const ANDROID_SDK = androidConfig.sdkPath
        const ADB_PATH = `${ANDROID_SDK}/platform-tools/adb`
        const EMULATOR_PATH = `${ANDROID_SDK}/emulator/emulator`

        progress.log("Validating Android tools...", "info")

        if (!ANDROID_SDK) {
            throw new Error("Android SDK path is not configured")
        }

        if (!fs.existsSync(ANDROID_SDK)) {
            throw new Error(`Android SDK path does not exist: ${ANDROID_SDK}`)
        }

        if (!fs.existsSync(ADB_PATH)) {
            throw new Error(`ADB not found at: ${ADB_PATH}`)
        }

        try {
            ctx.runCommand(`${ADB_PATH} version`)
            progress.log("ADB validation successful", "success")
        } catch (error) {
            throw new Error(`ADB is not working properly: ${error.message}`)
        }

        const buildType = androidConfig.buildType || "debug"
        if (buildType !== "release") {
            if (!fs.existsSync(EMULATOR_PATH)) {
                throw new Error(`Emulator not found at: ${EMULATOR_PATH}`)
            }

            try {
                ctx.runCommand(`${EMULATOR_PATH} -version`)
                progress.log("Emulator validation successful", "success")
            } catch (error) {
                throw new Error(`Emulator is not working properly: ${error.message}`)
            }

            try {
                const avdOutput = ctx.runCommand(`${EMULATOR_PATH} -list-avds`)
                if (!avdOutput.includes(androidConfig.emulatorName)) {
                    throw new Error(
                        `Specified emulator "${androidConfig.emulatorName}" not found in available AVDs`
                    )
                }
                progress.log(`Emulator "${androidConfig.emulatorName}" exists`, "success")
            } catch (error) {
                throw new Error(`Error checking emulator AVD: ${error.message}`)
            }
        } else {
            progress.log("Skipping emulator validation for release build", "info")
        }

        progress.log("Android tools validation completed successfully!", "success")
        return { ANDROID_SDK, ADB_PATH, EMULATOR_PATH }
    }

    return { initializeConfig, validateAndroidTools }
}

module.exports = createConfigPhase
