"use strict"

const fs = require("fs")
const os = require("os")
const path = require("path")
const { execSync, execFileSync } = require("child_process")
const { runInteractiveCommand } = require("../utils.js")
const { xcodeAuthArgs } = require("./signing.js")

module.exports = function createBuildPhase(ctx) {
    const {
        WEBVIEW_CONFIG,
        PROJECT_NAME,
        SCHEME_NAME,
        APP_BUNDLE_ID,
        IPHONE_MODEL,
        progress,
        runCommand,
        runCommandStreaming,
    } = ctx

    // ─── Simulator helpers ────────────────────────────────────────────────────

    // The simulator buildAppIos.js chose (its udid), else whichever is booted.
    // The udid goes into shell strings, so only hex digits and hyphens pass.
    const simulatorUdid = () =>
        ctx.target?.target === "simulator" && /^[A-Fa-f0-9-]+$/.test(String(ctx.target.udid || ""))
            ? ctx.target.udid
            : null
    const simctlDevice = () => simulatorUdid() || "booted"

    async function getBootedSimulatorUUID(modelName) {
        const UUID_RE = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i
        try {
            const output = await runInteractiveCommand("xcrun", ["simctl", "list", "devices"], {})
            const lines = output.split("\n")
            for (const line of lines) {
                if (line.includes(modelName) && line.includes("Booted")) {
                    const m = line.match(UUID_RE)
                    if (m) {
                        return m[0]
                    }
                }
            }
            progress.status("looking for any booted simulator")
            for (const line of lines) {
                if (line.includes("Booted")) {
                    const m = line.match(UUID_RE)
                    if (m) {
                        return m[0]
                    }
                }
            }
            return null
        } catch (error) {
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
            return null
        }
    }

    // Xcode 27 replaced the standalone Simulator.app (com.apple.iphonesimulator)
    // with DeviceHub.app (com.apple.dt.Devices); older Xcode installs still ship
    // the former. Resolve whichever is actually installed instead of hardcoding
    // the app name, which no longer resolves via `open -a` on either app.
    function resolveSimulatorAppBundleId() {
        const candidates = ["com.apple.dt.Devices", "com.apple.iphonesimulator"]
        for (const bundleId of candidates) {
            try {
                execSync(`osascript -e 'id of app id "${bundleId}"'`, { stdio: "ignore" }) // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - bundleId is a fixed internal candidate list, not user input.
                return bundleId
            } catch {
                // Not installed under this bundle id; try the next candidate.
            }
        }
        return null
    }

    // Text mirrors errors/registry.js ERROR_DEFINITIONS[IOS-001] (see
    // errors/IOS/IOS-001.md) — this CJS subtree can't import the ESM error
    // registry (see buildErrorFormat.js), so the message is duplicated here
    // rather than imported. This condition is recoverable (the simulator can
    // still boot headlessly via simctl) so callers log it as a warning
    // instead of throwing.
    const SIMULATOR_APP_NOT_FOUND_WARNING =
        "[IOS-001] Could not find an installed iOS Simulator app (checked DeviceHub.app and the legacy Simulator.app). " +
        "The simulator is booted but its window may not be visible. Suggested action: confirm a full Xcode.app is installed and selected via xcode-select -p, then open it once from Spotlight."

    // ─── Clean ────────────────────────────────────────────────────────────────

    async function cleanBuildArtifacts() {
        progress.start("clean")
        try {
            const xcuserdataPath = path.join(`${PROJECT_NAME}.xcodeproj`, `project.xcworkspace`, "xcuserdata") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            if (fs.existsSync(xcuserdataPath)) await runCommand(`rm -rf "${xcuserdataPath}"`)
            const derivedDataPath = path.join(os.homedir(), "Library/Developer/Xcode/DerivedData")
            await runCommand(`rm -rf "${derivedDataPath}/${PROJECT_NAME}-*"`)
            try {
                await runCommand(
                    `xcodebuild clean -scheme "${SCHEME_NAME}" -sdk iphonesimulator -configuration Debug`
                )
            } catch (error) {
                progress.log("Warning: Clean command returned non-zero exit code", "warning")
            }
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
        const bootedInfo = simulatorUdid() ? { udid: simulatorUdid() } : await getBootedSimulatorInfo()
        if (!bootedInfo) throw new Error("No booted simulator found")
        progress.status(`simulator ${bootedInfo.udid.slice(0, 8)}`)
        const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false
        progress.log(
            isNotificationsEnabled
                ? "Building with notifications enabled (CatalystNotifications module included)"
                : "Building without notifications (Firebase excluded)",
            "info"
        )
        // Streamed: xcodebuild runs for minutes, and buffered output made that
        // look like a hang with nothing on screen until it finished.
        return runCommandStreaming(
            makeBuildCommand(scheme, sdk, bundleId, derivedDataPath, projectName, bootedInfo.udid, "build")
        )
    }

    async function buildProjectForTesting(scheme, sdk, destination, bundleId, derivedDataPath, projectName) {
        const bootedInfo = await getBootedSimulatorInfo()
        if (!bootedInfo) throw new Error("No booted simulator found")
        progress.status(`simulator ${bootedInfo.udid.slice(0, 8)}`)
        const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false
        progress.log(
            isNotificationsEnabled
                ? "Building for testing with notifications enabled"
                : "Building for testing without notifications",
            "info"
        )
        return runCommandStreaming(
            makeBuildCommand(
                scheme,
                sdk,
                bundleId,
                derivedDataPath,
                projectName,
                bootedInfo.udid,
                "build-for-testing"
            )
        )
    }

    async function buildXcodeProject() {
        progress.start("build")
        try {
            const derivedDataPath = path.join(os.homedir(), "Library/Developer/Xcode/DerivedData")
            try {
                progress.status("building for specified simulator")
                await buildProject(
                    SCHEME_NAME,
                    "iphonesimulator",
                    // Several runtimes can each have a simulator with this
                    // name; the udid buildAppIos.js chose is unambiguous.
                    simulatorUdid()
                        ? `platform=iOS Simulator,id=${simulatorUdid()}`
                        : `platform=iOS Simulator,name=${IPHONE_MODEL}`,
                    APP_BUNDLE_ID,
                    derivedDataPath,
                    PROJECT_NAME
                )
            } catch (buildError) {
                progress.log("Initial build failed, attempting fallback...", "info")
                const bootedUUID = await getBootedSimulatorUUID(IPHONE_MODEL)
                if (bootedUUID) {
                    progress.log(`Found booted simulator, retrying build...`, "info")
                    await buildProject(
                        SCHEME_NAME,
                        "iphonesimulator",
                        `platform=iOS Simulator,id=${bootedUUID}`,
                        APP_BUNDLE_ID,
                        derivedDataPath,
                        PROJECT_NAME
                    )
                } else {
                    throw buildError
                }
            }
            progress.complete("build")
        } catch (error) {
            progress.fail("build", error.message)
            throw error
        }
    }

    // ─── Find / install / launch ──────────────────────────────────────────────

    async function findAppPath() {
        progress.start("findApp")
        try {
            const DERIVED_DATA_DIR = path.join(os.homedir(), "Library/Developer/Xcode/DerivedData")
            let APP_PATH = ""
            try {
                APP_PATH = execSync(
                    `find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-*" -prune -not -path "*/Index.noindex*" -path "*/Build/Products/Debug-iphonesimulator/${PROJECT_NAME}.app" -type d | head -n 1` // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - DERIVED_DATA_DIR and PROJECT_NAME are internal iOS build paths.
                )
                    .toString()
                    .trim()
            } catch (error) {
                progress.log("Primary app path search failed, trying fallback...", "info")
            }
            if (!APP_PATH) {
                try {
                    APP_PATH = execSync(
                        `find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-*" -name "${PROJECT_NAME}.app" -type d -not -path "*/Index.noindex*" | head -n 1` // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - DERIVED_DATA_DIR and PROJECT_NAME are internal iOS build paths.
                    )
                        .toString()
                        .trim()
                } catch (error) {
                    throw new Error("Could not locate built application")
                }
            }
            if (!APP_PATH) throw new Error("No .app file found")
            progress.complete("findApp")
            return APP_PATH
        } catch (error) {
            progress.fail("findApp", error.message)
            throw error
        }
    }

    async function uninstallExistingApp() {
        progress.status("uninstalling previous build")
        await runCommand(`xcrun simctl uninstall ${simctlDevice()} "${APP_BUNDLE_ID}"`)
    }

    async function installApp(APP_PATH) {
        progress.status("installing")
        await runCommand(`xcrun simctl install ${simctlDevice()} "${APP_PATH}"`)
    }

    async function waitForInstallation() {
        progress.status("waiting for install")
        for (let i = 0; i < 30; i++) {
            try {
                // No shell: the bundle id is passed as an argv entry, never interpolated.
                execFileSync("xcrun", ["simctl", "get_app_container", simctlDevice(), APP_BUNDLE_ID], {
                    stdio: ["ignore", "pipe", "ignore"],
                })
                break
            } catch (error) {
                if (i === 29) throw new Error("Timeout: App installation took too long.")
                await new Promise((resolve) => setTimeout(resolve, 1000))
            }
        }
    }

    async function handleLaunchError(error) {
        progress.status("checking app container")
        try {
            await runCommand(`xcrun simctl get_app_container ${simctlDevice()} "${APP_BUNDLE_ID}"`)
        } catch {
            progress.log("App container not found", "warning")
        }
        throw error
    }

    async function verifyAppLaunch() {
        progress.status("waiting for launch")
        for (let i = 0; i < 10; i++) {
            try {
                const launchResult = execFileSync("xcrun", ["simctl", "launch", simctlDevice(), APP_BUNDLE_ID], {
                    stdio: ["ignore", "pipe", "ignore"],
                }).toString()
                if (launchResult.includes("already launched")) {
                    break
                }
            } catch (error) {
                if (i === 9) progress.log("App launch may have failed or timed out", "warning")
            }
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }
    }

    async function launchAndVerifyApp() {
        progress.status("launching")
        try {
            await runCommand(`xcrun simctl launch ${simctlDevice()} "${APP_BUNDLE_ID}"`)
            await verifyAppLaunch()
        } catch (error) {
            await handleLaunchError(error)
        }
    }

    async function focusSimulator() {
        progress.status("focusing simulator")
        const simulatorAppBundleId = resolveSimulatorAppBundleId()
        if (!simulatorAppBundleId) {
            progress.log(SIMULATOR_APP_NOT_FOUND_WARNING, "warning")
            return
        }
        await runCommand(`osascript -e 'tell application id "${simulatorAppBundleId}" to activate'`)
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

    async function buildProjectForPhysicalDevice(scheme, bundleId, derivedDataPath, projectName, device) {
        progress.log(`Building for physical device: ${device.name}`, "info")
        const projectPath = `${process.cwd()}/${projectName}.xcodeproj`
        if (!fs.existsSync(projectPath))
            throw new Error(`Xcode project not found at: ${projectPath}. Current directory: ${process.cwd()}`)
        const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false
        progress.log(
            isNotificationsEnabled ? "Building with notifications enabled" : "Building without notifications",
            "info"
        )
        // Automatic signing may create or fetch the development certificate
        // and profile and register this device: with the App Store Connect
        // key when one is configured, else with the Apple account signed in
        // to Xcode. A manual profile (ios.provisioningProfile) needs neither.
        const signingArgs = ctx.signingPlan?.style === "manual" ? [] : xcodeAuthArgs(ctx.apiKey)
        // The streamed output is what tells you how it is going; argv, not a
        // shell string, so a key path with spaces needs no quoting.
        return runCommandStreaming("xcodebuild", [
            "-scheme",
            scheme,
            "-sdk",
            "iphoneos",
            "-configuration",
            "Debug",
            "-destination",
            `platform=iOS,id=${device.udid}`,
            `PRODUCT_BUNDLE_IDENTIFIER=${bundleId}`,
            "ONLY_ACTIVE_ARCH=YES",
            ...signingArgs,
            "build",
        ])
    }

    async function findPhysicalDeviceAppPath() {
        const DERIVED_DATA_DIR = path.join(os.homedir(), "Library/Developer/Xcode/DerivedData")
        let APP_PATH = ""
        try {
            APP_PATH = execSync(
                `find "${DERIVED_DATA_DIR}" -name "${PROJECT_NAME}.app" -path "*/Build/Products/Debug-iphoneos/*" -not -path "*/Index.noindex/*" -type d | head -n 1` // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - DERIVED_DATA_DIR and PROJECT_NAME are internal iOS build paths.
            )
                .toString()
                .trim()
        } catch {
            progress.log("Primary app path search failed for physical device, trying fallback...", "info")
        }
        if (!APP_PATH) {
            try {
                APP_PATH = execSync(
                    `find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-Build/Build/Products/Debug-iphoneos/${PROJECT_NAME}.app" -type d | head -n 1` // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - DERIVED_DATA_DIR and PROJECT_NAME are internal iOS build paths.
                )
                    .toString()
                    .trim()
            } catch {
                progress.log("Fallback app path search also failed", "warning")
            }
        }
        if (!APP_PATH)
            throw new Error("No .app file found for physical device. Check if build completed successfully.")
        progress.log(`Found app bundle: ${APP_PATH}`, "success")
        return APP_PATH
    }

    async function installAndLaunchOnPhysicalDevice(APP_PATH, device) {
        progress.start("install")
        try {
            progress.log(`Installing app on physical device: ${device.name}`, "info")
            try {
                await runCommand(`xcrun devicectl device install app --device ${device.udid} "${APP_PATH}"`)
                progress.log("App installed successfully using devicectl", "success")
            } catch (devicectlError) {
                throw new Error(`devicectl installation failed: ${devicectlError.message}`)
            }
            progress.complete("install")
            progress.start("launch")
            try {
                await runCommand(
                    `xcrun devicectl device process launch --device ${device.udid} "${APP_BUNDLE_ID}"`
                )
                progress.log("App launched successfully using devicectl", "success")
            } catch (launchError) {
                progress.log(
                    "App installation completed, but launch failed. You can manually launch the app on your device.",
                    "warning"
                )
                progress.log(`To launch manually, look for the app with bundle ID: ${APP_BUNDLE_ID}`, "note")
            }
            progress.complete("launch")
        } catch (error) {
            const currentStep = progress.currentStep.id
            progress.fail(currentStep, error.message)
            progress.printTreeContent("Physical Device Installation Failed", [
                "Installation failed. Common solutions:",
                {
                    text: "Ensure device is connected and unlocked",
                    indent: 1,
                    prefix: "├─ ",
                    color: "yellow",
                },
                {
                    text: "Trust the development certificate on your device",
                    indent: 1,
                    prefix: "├─ ",
                    color: "yellow",
                },
                { text: "Check that device is in developer mode", indent: 1, prefix: "├─ ", color: "yellow" },
                { text: "Verify app bundle is valid", indent: 1, prefix: "└─ ", color: "yellow" },
                "",
                "Device Details:",
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
            progress.status("launching simulator")
            const simulatorsJson = JSON.parse(execSync("xcrun simctl list devices -j").toString())
            // Multiple devices can share a name across runtimes (e.g. leftover devices
            // from an old Xcode install after an upgrade) — simctl marks the ones whose
            // runtime bundle is gone as isAvailable: false, and those fail to boot with
            // "cannot determine the runtime bundle". Don't let iteration order silently
            // pick one of those over the available device: prefer an available match,
            // and among available matches prefer one that's already booted.
            const isDeviceAvailable = (device) => device.isAvailable !== false
            let foundSimulator = null,
                foundSimulatorId = null,
                isBooted = false
            Object.entries(simulatorsJson.devices).forEach(([, devices]) => {
                devices.forEach((device) => {
                    // The chosen udid when there is one: stock simulators share
                    // names across runtimes.
                    if (simulatorUdid() ? device.udid !== simulatorUdid() : device.name !== simulatorName)
                        return
                    const available = isDeviceAvailable(device)
                    const alreadyBooted = device.state === "Booted"
                    const isBetterMatch =
                        !foundSimulator ||
                        (available && !isDeviceAvailable(foundSimulator)) ||
                        (available === isDeviceAvailable(foundSimulator) && alreadyBooted && !isBooted)
                    if (isBetterMatch) {
                        foundSimulator = device
                        foundSimulatorId = device.udid
                        isBooted = alreadyBooted
                    }
                })
            })
            if (!foundSimulator) {
                progress.log(`Configured simulator "${simulatorName}" not found`, "warning")
                return
            }
            if (!isBooted) {
                progress.log(
                    `Attempting to boot simulator: ${simulatorName} (${foundSimulatorId})`,
                    "info"
                )
                if (foundSimulator.state === "Shutdown") {
                    progress.log(`Simulator is shutdown, attempting to boot...`, "info")
                    try {
                        await runCommand(`xcrun simctl boot ${foundSimulatorId}`)
                        progress.log(`Successfully booted simulator`, "success")
                    } catch (bootError) {
                        progress.log(`Boot failed: ${bootError.message}`, "error")
                        progress.log(`Looking for any booted simulator as fallback...`, "info")
                        const fallbackUUID = await getBootedSimulatorUUID(simulatorName)
                        if (fallbackUUID) {
                            progress.log(`Found fallback booted simulator: ${fallbackUUID}`, "success")
                            foundSimulatorId = fallbackUUID
                        } else
                            throw new Error(
                                `Failed to boot simulator and no fallback available: ${bootError.message}`
                            )
                    }
                } else {
                    progress.log(
                        `Simulator state is '${foundSimulator.state}', not 'Shutdown'. Checking if we can use it...`,
                        "warning"
                    )
                    if (foundSimulator.state === "Booted")
                        progress.log(`Wait, simulator is actually booted! Using it.`, "success")
                    else throw new Error(`Simulator is in unexpected state: ${foundSimulator.state}`)
                }
            } else {
                progress.log(`Simulator ${simulatorName} is already booted`, "success")
            }
            const simulatorAppBundleId = resolveSimulatorAppBundleId()
            if (simulatorAppBundleId) {
                progress.status("opening simulator")
                await runCommand(`open -b ${simulatorAppBundleId}`)
                await new Promise((resolve) => setTimeout(resolve, 1000))
                await runCommand(`osascript -e 'tell application id "${simulatorAppBundleId}" to activate'`)
            } else {
                progress.log(SIMULATOR_APP_NOT_FOUND_WARNING, "warning")
            }
            progress.complete("launchSimulator")
        } catch (error) {
            progress.fail("launchSimulator", error.message)
            progress.printTreeContent("Simulator Troubleshooting", [
                "iOS Simulator failed to launch. Common solutions:",
                {
                    text: "Delete and recreate the simulator in Xcode",
                    indent: 1,
                    prefix: "├─ ",
                    color: "yellow",
                },
                {
                    text: "Reset simulator content: Device > Erase All Content and Settings",
                    indent: 1,
                    prefix: "├─ ",
                    color: "yellow",
                },
                {
                    text: "Check available simulators: xcrun simctl list devices",
                    indent: 1,
                    prefix: "├─ ",
                    color: "yellow",
                },
                { text: "Restart Xcode and Simulator app", indent: 1, prefix: "└─ ", color: "yellow" },
                "",
                "Error Details:",
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
        installAndLaunchApp,
        buildProjectForPhysicalDevice,
        findPhysicalDeviceAppPath,
        installAndLaunchOnPhysicalDevice,
        launchIOSSimulator,
        getBootedSimulatorUUID,
    }
}
