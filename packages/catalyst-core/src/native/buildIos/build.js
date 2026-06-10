"use strict"

const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")
const { runInteractiveCommand } = require("../utils.js")

module.exports = function createBuildPhase(ctx) {
    const { WEBVIEW_CONFIG, PROJECT_NAME, SCHEME_NAME, APP_BUNDLE_ID, IPHONE_MODEL, url, progress, runCommand } = ctx

    // ─── Simulator helpers ────────────────────────────────────────────────────

    async function getBootedSimulatorUUID(modelName) {
        const UUID_RE = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i
        try {
            const output = await runInteractiveCommand("xcrun", ["simctl", "list", "devices"], {})
            const lines = output.split("\n")
            for (const line of lines) {
                if (line.includes(modelName) && line.includes("Booted")) {
                    const m = line.match(UUID_RE)
                    if (m) { console.log(`Found booted simulator of model ${modelName}`); return m[0] }
                }
            }
            console.log(`No booted simulator of model ${modelName} found, checking for any booted simulator...`)
            for (const line of lines) {
                if (line.includes("Booted")) {
                    const m = line.match(UUID_RE)
                    if (m) { console.log("Found another booted simulator, will use it instead"); return m[0] }
                }
            }
            return null
        } catch (error) {
            console.log("No booted simulators found")
            return null
        }
    }

    async function getBootedSimulatorInfo() {
        try {
            const simulatorList = JSON.parse(execSync("xcrun simctl list devices --json").toString())
            for (const runtime in simulatorList.devices) {
                for (const device of simulatorList.devices[runtime]) {
                    if (device.state === "Booted") return { udid: device.udid, name: device.name, runtime }
                }
            }
            return null
        } catch (error) {
            console.log("Failed to get booted simulator info:", error.message)
            return null
        }
    }

    // ─── Clean ────────────────────────────────────────────────────────────────

    async function cleanBuildArtifacts() {
        progress.start("clean")
        try {
            const xcuserdataPath = path.join(`${PROJECT_NAME}.xcodeproj`, `project.xcworkspace`, "xcuserdata")
            if (fs.existsSync(xcuserdataPath)) await runCommand(`rm -rf "${xcuserdataPath}"`)
            const derivedDataPath = path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData")
            await runCommand(`rm -rf "${derivedDataPath}/${PROJECT_NAME}-*"`)
            try { await runCommand(`xcodebuild clean -scheme "${SCHEME_NAME}" -sdk iphonesimulator -configuration Debug`) }
            catch (error) { progress.log("Warning: Clean command returned non-zero exit code", "warning") }
            progress.complete("clean")
        } catch (error) {
            progress.fail("clean", error.message)
            throw error
        }
    }

    // ─── Build commands ───────────────────────────────────────────────────────

    function makeBuildCommand(scheme, sdk, bundleId, derivedDataPath, projectName, udid, action) {
        return `xcodebuild \
        -scheme "${scheme}" \
        -sdk ${sdk} \
        -configuration Debug \
        -destination "platform=iOS Simulator,id=${udid}" \
        PRODUCT_BUNDLE_IDENTIFIER="${bundleId}" \
        DEVELOPMENT_TEAM="" \
        CODE_SIGN_IDENTITY="" \
        CODE_SIGNING_REQUIRED=NO \
        CODE_SIGNING_ALLOWED=NO \
        ONLY_ACTIVE_ARCH=YES \
        BUILD_DIR="${derivedDataPath}/${projectName}-Build/Build/Products" \
        CONFIGURATION_BUILD_DIR="${derivedDataPath}/${projectName}-Build/Build/Products/Debug-iphonesimulator" \
        OS_ACTIVITY_MODE=debug \
        SWIFT_DEBUG_LOG=1 \
        ${action}`
    }

    async function buildProject(scheme, sdk, destination, bundleId, derivedDataPath, projectName) {
        const bootedInfo = await getBootedSimulatorInfo()
        if (!bootedInfo) throw new Error("No booted simulator found")
        console.log(`Building with destination: platform=iOS Simulator,id=${bootedInfo.udid}`)
        const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false
        progress.log(isNotificationsEnabled ? "Building with notifications enabled (CatalystNotifications module included)" : "Building without notifications (Firebase excluded)", "info")
        return runCommand(makeBuildCommand(scheme, sdk, bundleId, derivedDataPath, projectName, bootedInfo.udid, "build"), { maxBuffer: 1024 * 1024 * 10 })
    }

    async function buildProjectForTesting(scheme, sdk, destination, bundleId, derivedDataPath, projectName) {
        const bootedInfo = await getBootedSimulatorInfo()
        if (!bootedInfo) throw new Error("No booted simulator found")
        console.log(`Building for testing with destination: platform=iOS Simulator,id=${bootedInfo.udid}`)
        const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false
        progress.log(isNotificationsEnabled ? "Building for testing with notifications enabled" : "Building for testing without notifications", "info")
        return runCommand(makeBuildCommand(scheme, sdk, bundleId, derivedDataPath, projectName, bootedInfo.udid, "build-for-testing"), { maxBuffer: 1024 * 1024 * 10 })
    }

    async function buildXcodeProject() {
        progress.start("build")
        try {
            const derivedDataPath = path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData")
            try {
                progress.log("Building for specified simulator...", "info")
                await buildProject(SCHEME_NAME, "iphonesimulator", `platform=iOS Simulator,name=${IPHONE_MODEL}`, APP_BUNDLE_ID, derivedDataPath, PROJECT_NAME)
            } catch (buildError) {
                progress.log("Initial build failed, attempting fallback...", "warning")
                const bootedUUID = await getBootedSimulatorUUID(IPHONE_MODEL)
                if (bootedUUID) {
                    progress.log(`Found booted simulator, retrying build...`, "info")
                    await buildProject(SCHEME_NAME, "iphonesimulator", `platform=iOS Simulator,id=${bootedUUID}`, APP_BUNDLE_ID, derivedDataPath, PROJECT_NAME)
                } else {
                    throw buildError
                }
            }
            progress.complete("build")
        } catch (error) {
            progress.fail("build", error.message)
            progress.printTreeContent("Troubleshooting Guide", [
                "Build failed. Please try the following steps:",
                { text: 'Run "npm run setupEmulator:ios" to reconfigure iOS settings', indent: 1, prefix: "├─ ", color: "yellow" },
                { text: "Check if Xcode is properly installed and updated", indent: 1, prefix: "├─ ", color: "yellow" },
                { text: "Verify selected simulator exists", indent: 1, prefix: "└─ ", color: "yellow" },
                "\nVerify Configuration:",
                { text: `Selected Simulator: ${IPHONE_MODEL}`, indent: 1, prefix: "├─ ", color: "gray" },
                { text: `Server URL: ${url}`, indent: 1, prefix: "└─ ", color: "gray" },
            ])
            throw error
        }
    }

    // ─── Find / install / launch ──────────────────────────────────────────────

    async function findAppPath() {
        progress.start("findApp")
        try {
            const DERIVED_DATA_DIR = path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData")
            let APP_PATH = ""
            try {
                APP_PATH = execSync(`find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-*" -prune -not -path "*/Index.noindex*" -path "*/Build/Products/Debug-iphonesimulator/${PROJECT_NAME}.app" -type d | head -n 1`).toString().trim()
            } catch (error) { progress.log("Primary app path search failed, trying fallback...", "warning") }
            if (!APP_PATH) {
                try {
                    APP_PATH = execSync(`find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-*" -name "${PROJECT_NAME}.app" -type d -not -path "*/Index.noindex*" | head -n 1`).toString().trim()
                } catch (error) { throw new Error("Could not locate built application") }
            }
            if (!APP_PATH) throw new Error("No .app file found")
            progress.complete("findApp")
            return APP_PATH
        } catch (error) {
            progress.fail("findApp", error.message)
            throw error
        }
    }

    async function moveAppToBuildOutput(APP_PATH) {
        const { BUILD_OUTPUT_PATH, iosConfig } = ctx
        try {
            const buildType = iosConfig.buildType || "debug"
            const appName = iosConfig.appName || "app"
            const currentDate = new Date().toLocaleDateString("en-GB").replace(/\//g, "-")
            const currentTime = new Date().toLocaleTimeString("en-US", { hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/:/g, ":")
            const destinationDir = path.join(process.cwd(), BUILD_OUTPUT_PATH, "native", "ios", currentDate, buildType)
            const destinationPath = path.join(destinationDir, `${appName}-${currentTime}.app`)
            if (!fs.existsSync(destinationDir)) fs.mkdirSync(destinationDir, { recursive: true })
            await runCommand(`cp -R "${APP_PATH}" "${destinationPath}"`)
            return destinationPath
        } catch (error) {
            console.error("Error moving app to build output:", error.message)
            throw error
        }
    }

    async function uninstallExistingApp() {
        console.log("Uninstalling the app if it exists...")
        await runCommand(`xcrun simctl uninstall booted "${APP_BUNDLE_ID}"`)
    }

    async function installApp(APP_PATH) {
        console.log("Installing the app...")
        try { await runCommand(`xcrun simctl install booted "${APP_PATH}"`) }
        catch (error) { console.error("Error installing the app:", error); throw error }
    }

    async function waitForInstallation() {
        console.log("Waiting for the app to be fully installed...")
        for (let i = 0; i < 30; i++) {
            try { execSync(`xcrun simctl get_app_container booted "${APP_BUNDLE_ID}"`); console.log("App installed successfully."); break }
            catch (error) {
                if (i === 29) throw new Error("Timeout: App installation took too long.")
                await new Promise((resolve) => setTimeout(resolve, 1000))
            }
        }
    }

    async function handleLaunchError(error) {
        console.error("Error launching the app:", error)
        console.log("Checking app container...")
        try { await runCommand(`xcrun simctl get_app_container booted "${APP_BUNDLE_ID}"`) } catch { console.log("App container not found") }
        throw error
    }

    async function verifyAppLaunch() {
        console.log("Waiting for the app to launch...")
        for (let i = 0; i < 10; i++) {
            try {
                const launchResult = execSync(`xcrun simctl launch booted "${APP_BUNDLE_ID}"`).toString()
                if (launchResult.includes("already launched")) { console.log("App launched successfully."); break }
            } catch (error) { if (i === 9) console.log("Warning: App launch might have failed or taken too long.") }
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }
    }

    async function launchAndVerifyApp() {
        console.log("Launching the app...")
        try { await runCommand(`xcrun simctl launch booted "${APP_BUNDLE_ID}"`); await verifyAppLaunch() }
        catch (error) { await handleLaunchError(error) }
    }

    async function focusSimulator() {
        console.log("Focusing on Simulator...")
        await runCommand(`osascript -e 'tell application "Simulator" to activate'`)
    }

    async function installAndLaunchApp(APP_PATH) {
        progress.start("install")
        try {
            await uninstallExistingApp()
            await installApp(APP_PATH)
            await waitForInstallation()
            progress.complete("install")
            progress.start("launch")
            await launchAndVerifyApp()
            await focusSimulator()
            progress.complete("launch")
        } catch (error) {
            const currentStep = progress.currentStep.id
            progress.fail(currentStep, error.message)
            throw error
        }
    }

    // ─── Physical device ──────────────────────────────────────────────────────

    async function detectPhysicalDevices() {
        progress.start("deviceDetection")
        const { iosConfig } = ctx
        try {
            progress.log("Scanning for connected physical devices...", "info")
            let physicalDevices = []
            const configuredUDID = iosConfig.deviceUDID
            if (configuredUDID) {
                progress.log(`Using configured device UDID: ${configuredUDID}`, "info")
                try {
                    const instrumentsOutput = execSync("instruments -s devices").toString()
                    if (instrumentsOutput.includes(configuredUDID)) {
                        const deviceLine = instrumentsOutput.split("\n").find((line) => line.includes(configuredUDID))
                        if (deviceLine) {
                            const nameMatch = deviceLine.match(/^(.+?)\s+\(/)
                            const versionMatch = deviceLine.match(/\((\d+\.\d+(?:\.\d+)?)\)/)
                            const deviceName = nameMatch ? nameMatch[1].trim() : "Physical Device"
                            const deviceVersion = versionMatch ? versionMatch[1] : "Unknown"
                            progress.log(`✅ Found configured physical device: ${deviceName} (${deviceVersion})`, "success")
                            physicalDevices.push({ name: deviceName, version: deviceVersion, udid: configuredUDID, type: "physical" })
                            progress.complete("deviceDetection")
                            return physicalDevices[0]
                        }
                    } else {
                        progress.log(`⚠️  Configured device UDID not found in connected devices`, "warning")
                        progress.log("Falling back to auto-detection...", "info")
                    }
                } catch (error) { progress.log(`Error verifying configured device: ${error.message}`, "warning"); progress.log("Falling back to auto-detection...", "info") }
            } else {
                progress.log("No device UDID configured, using auto-detection", "info")
            }

            const tryInstruments = () => {
                try {
                    const out = execSync("instruments -s devices").toString()
                    return out.split("\n").filter((line) => {
                        const m = line.match(/^(.+?)\s+\((\d+\.\d+(?:\.\d+)?)\)\s+\[([A-F0-9-]{36})\](?:\s+\(Simulator\))?$/)
                        return m && !line.includes("(Simulator)")
                    }).map((line) => {
                        const [, name, version, udid] = line.match(/^(.+?)\s+\((\d+\.\d+(?:\.\d+)?)\)\s+\[([A-F0-9-]{36})\]/)
                        return { name: name.trim(), version, udid, type: "physical" }
                    })
                } catch { return [] }
            }

            physicalDevices = tryInstruments()
            if (physicalDevices.length > 0) progress.log(`Found ${physicalDevices.length} physical device(s) via instruments`, "success")

            if (physicalDevices.length === 0) {
                try {
                    const xcodebuildOutput = execSync(`xcodebuild -scheme "${SCHEME_NAME}" -showdestinations`).toString()
                    progress.log("Scanning xcodebuild destinations for physical devices...", "info")
                    for (const line of xcodebuildOutput.split("\n")) {
                        const m = line.match(/\{\s*platform:iOS,\s*arch:(\w+),\s*id:([A-F0-9-]+),\s*name:(.+?)\s*\}/)
                        if (m) {
                            const [, arch, udid, name] = m
                            progress.log(`Found device candidate: ${name.trim()} - ${udid}`, "info")
                            if (!udid.includes("placeholder") && udid.length > 20) {
                                progress.log(`✅ Valid physical device: ${name.trim()}`, "success")
                                physicalDevices.push({ name: name.trim(), version: "Unknown", udid, arch, type: "physical" })
                            } else {
                                progress.log(`❌ Skipping placeholder: ${name.trim()}`, "warning")
                            }
                        }
                    }
                } catch (error) { progress.log("xcodebuild destinations failed", "warning"); progress.log(`Error: ${error.message}`, "error") }
            }

            if (physicalDevices.length === 0) physicalDevices = tryInstruments()

            if (physicalDevices.length === 0) {
                try {
                    for (const line of execSync("xcrun devicectl list devices").toString().split("\n")) {
                        if (line.includes("Connected") && !line.includes("Simulator")) {
                            const udidMatch = line.match(/([A-F0-9-]{36})/)
                            const nameMatch = line.match(/^(.+?)\s+\(/)
                            if (udidMatch && nameMatch) physicalDevices.push({ name: nameMatch[1].trim(), version: "Unknown", udid: udidMatch[1], type: "physical" })
                        }
                    }
                } catch { progress.log("devicectl command not available or failed", "warning") }
            }

            if (physicalDevices.length > 0) {
                progress.log(`Found ${physicalDevices.length} physical device(s):`, "success")
                physicalDevices.forEach((d) => progress.log(`  📱 ${d.name} (${d.version || "Unknown iOS"}) - ${d.udid}`, "info"))
                progress.complete("deviceDetection")
                return physicalDevices[0]
            } else {
                progress.log("No physical devices detected", "warning")
                progress.complete("deviceDetection")
                return null
            }
        } catch (error) {
            progress.fail("deviceDetection", error.message)
            return null
        }
    }

    async function buildProjectForPhysicalDevice(scheme, bundleId, derivedDataPath, projectName, device) {
        progress.log(`Building for physical device: ${device.name}`, "info")
        const projectPath = `${process.cwd()}/${projectName}.xcodeproj`
        if (!fs.existsSync(projectPath)) throw new Error(`Xcode project not found at: ${projectPath}. Current directory: ${process.cwd()}`)
        const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false
        progress.log(isNotificationsEnabled ? "Building with notifications enabled" : "Building without notifications", "info")
        const buildCommand = `xcodebuild \
        -scheme ${scheme} \
        -sdk iphoneos \
        -configuration Debug \
        -destination platform=iOS,id=${device.udid} \
        PRODUCT_BUNDLE_IDENTIFIER=${bundleId} \
        ONLY_ACTIVE_ARCH=YES \
        build`
        progress.log(`Executing command: ${buildCommand}`, "info")
        return runCommand(buildCommand, { maxBuffer: 1024 * 1024 * 10 })
    }

    async function findPhysicalDeviceAppPath() {
        const DERIVED_DATA_DIR = path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData")
        let APP_PATH = ""
        try {
            APP_PATH = execSync(`find "${DERIVED_DATA_DIR}" -name "${PROJECT_NAME}.app" -path "*/Build/Products/Debug-iphoneos/*" -not -path "*/Index.noindex/*" -type d | head -n 1`).toString().trim()
        } catch { progress.log("Primary app path search failed for physical device, trying fallback...", "warning") }
        if (!APP_PATH) {
            try { APP_PATH = execSync(`find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-Build/Build/Products/Debug-iphoneos/${PROJECT_NAME}.app" -type d | head -n 1`).toString().trim() }
            catch { progress.log("Fallback app path search also failed", "warning") }
        }
        if (!APP_PATH) throw new Error("No .app file found for physical device. Check if build completed successfully.")
        progress.log(`Found app bundle: ${APP_PATH}`, "success")
        return APP_PATH
    }

    async function installAndLaunchOnPhysicalDevice(APP_PATH, device) {
        progress.start("install")
        try {
            progress.log(`Installing app on physical device: ${device.name}`, "info")
            try { await runCommand(`xcrun devicectl device install app --device ${device.udid} "${APP_PATH}"`); progress.log("App installed successfully using devicectl", "success") }
            catch (devicectlError) { throw new Error(`devicectl installation failed: ${devicectlError.message}`) }
            progress.complete("install")
            progress.start("launch")
            try { await runCommand(`xcrun devicectl device process launch --device ${device.udid} "${APP_BUNDLE_ID}"`); progress.log("App launched successfully using devicectl", "success") }
            catch (launchError) {
                progress.log("App installation completed, but launch failed. You can manually launch the app on your device.", "warning")
                progress.log(`To launch manually, look for the app with bundle ID: ${APP_BUNDLE_ID}`, "info")
            }
            progress.complete("launch")
        } catch (error) {
            const currentStep = progress.currentStep.id
            progress.fail(currentStep, error.message)
            progress.printTreeContent("Physical Device Installation Failed", [
                "Installation failed. Common solutions:",
                { text: "Ensure device is connected and unlocked", indent: 1, prefix: "├─ ", color: "yellow" },
                { text: "Trust the development certificate on your device", indent: 1, prefix: "├─ ", color: "yellow" },
                { text: "Check that device is in developer mode", indent: 1, prefix: "├─ ", color: "yellow" },
                { text: "Verify app bundle is valid", indent: 1, prefix: "└─ ", color: "yellow" },
                "", "Device Details:",
                { text: `Device: ${device.name}`, indent: 1, prefix: "├─ ", color: "gray" },
                { text: `UDID: ${device.udid}`, indent: 1, prefix: "├─ ", color: "gray" },
                { text: `App Bundle: ${APP_PATH}`, indent: 1, prefix: "└─ ", color: "gray" },
            ])
            throw error
        }
    }

    // ─── Launch simulator ─────────────────────────────────────────────────────

    async function launchIOSSimulator(simulatorName) {
        progress.start("launchSimulator")
        try {
            progress.log("Launching iOS Simulator...")
            const simulatorsJson = JSON.parse(execSync("xcrun simctl list devices -j").toString())
            let foundSimulator = null, foundSimulatorId = null, isBooted = false
            Object.entries(simulatorsJson.devices).forEach(([, devices]) => {
                devices.forEach((device) => {
                    if (device.name === simulatorName) { foundSimulator = device; foundSimulatorId = device.udid; isBooted = device.state === "Booted" }
                })
            })
            if (!foundSimulator) { console.log(`Configured simulator "${simulatorName}" not found.`); return }
            if (!isBooted) {
                progress.log(`Attempting to boot simulator: ${simulatorName} (${foundSimulatorId})`, "warning")
                if (foundSimulator.state === "Shutdown") {
                    progress.log(`Simulator is shutdown, attempting to boot...`, "info")
                    try { await runCommand(`xcrun simctl boot ${foundSimulatorId}`); progress.log(`Successfully booted simulator`, "success") }
                    catch (bootError) {
                        progress.log(`Boot failed: ${bootError.message}`, "error")
                        progress.log(`Looking for any booted simulator as fallback...`, "info")
                        const fallbackUUID = await getBootedSimulatorUUID(simulatorName)
                        if (fallbackUUID) { progress.log(`Found fallback booted simulator: ${fallbackUUID}`, "success"); foundSimulatorId = fallbackUUID }
                        else throw new Error(`Failed to boot simulator and no fallback available: ${bootError.message}`)
                    }
                } else {
                    progress.log(`Simulator state is '${foundSimulator.state}', not 'Shutdown'. Checking if we can use it...`, "warning")
                    if (foundSimulator.state === "Booted") progress.log(`Wait, simulator is actually booted! Using it.`, "success")
                    else throw new Error(`Simulator is in unexpected state: ${foundSimulator.state}`)
                }
            } else {
                progress.log(`Simulator ${simulatorName} is already booted`, "success")
            }
            progress.log("Opening Simulator.app...")
            await runCommand("open -a Simulator")
            await new Promise((resolve) => setTimeout(resolve, 1000))
            await runCommand("osascript -e 'tell application \"Simulator\" to activate'")
            progress.log("iOS Simulator launched successfully.", "success")
            progress.complete("launchSimulator")
        } catch (error) {
            progress.fail("launchSimulator", error.message)
            progress.printTreeContent("Simulator Troubleshooting", [
                "iOS Simulator failed to launch. Common solutions:",
                { text: "Delete and recreate the simulator in Xcode", indent: 1, prefix: "├─ ", color: "yellow" },
                { text: "Reset simulator content: Device > Erase All Content and Settings", indent: 1, prefix: "├─ ", color: "yellow" },
                { text: "Check available simulators: xcrun simctl list devices", indent: 1, prefix: "├─ ", color: "yellow" },
                { text: "Restart Xcode and Simulator app", indent: 1, prefix: "└─ ", color: "yellow" },
                "", "Error Details:",
                { text: `Simulator: ${simulatorName}`, indent: 1, prefix: "├─ ", color: "gray" },
                { text: `Error: ${error.message}`, indent: 1, prefix: "└─ ", color: "red" },
            ])
            throw error
        }
    }

    return {
        cleanBuildArtifacts,
        buildXcodeProject,
        buildProjectForTesting,
        findAppPath,
        moveAppToBuildOutput,
        installAndLaunchApp,
        detectPhysicalDevices,
        buildProjectForPhysicalDevice,
        findPhysicalDeviceAppPath,
        installAndLaunchOnPhysicalDevice,
        launchIOSSimulator,
        getBootedSimulatorUUID,
    }
}
