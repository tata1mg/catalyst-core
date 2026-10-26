import { execSync } from "child_process"
import fs from "fs"
import { runCommand, validateAndCompleteConfig, parseNativeArgs } from "./utils.js"
import { ensureXcodeReady, ensureIosRuntime, chooseSimulator, simctlJson } from "./iosToolchain.js"
import TerminalProgress from "./terminalProgress.js"
import { buildFailure } from "../cli/diagnostic.js"

const configPath = `${process.env.PWD}/config/config.json`
const { setupServer } = require("./setupServer.js")
const flags = parseNativeArgs(process.argv.slice(2))

const steps = {
    platform: "Check platform compatibility",
    xcode: "Check Xcode",
    config: "Initialize configuration",
    runtime: "Check iOS simulator runtime",
    simulator: "Configure iOS simulator",
    launch: "Launch iOS simulator",
    saveConfig: "Save configuration",
    setupServer: "Set up server",
}

const progress = new TerminalProgress(steps, "catalyst setupEmulator", { subject: "ios" })
const log = (message, type = "info") => progress.log(message, type)

async function initializeConfig() {
    const configFile = fs.readFileSync(configPath, "utf8")
    const config = JSON.parse(configFile)
    const { WEBVIEW_CONFIG } = config

    if (!WEBVIEW_CONFIG || Object.keys(WEBVIEW_CONFIG).length === 0) {
        progress.log("WebView Config missing in " + configPath, "error")
        process.exit(1)
    }

    if (!WEBVIEW_CONFIG.ios) {
        WEBVIEW_CONFIG.ios = {}
    }

    return { WEBVIEW_CONFIG }
}

async function saveConfig(newConfig) {
    try {
        // Read the existing config
        const existingConfigFile = fs.readFileSync(configPath, "utf8")
        const existingConfig = JSON.parse(existingConfigFile)

        // Merge the new WEBVIEW_CONFIG with existing config
        const updatedConfig = {
            ...existingConfig, // Preserve all existing keys
            WEBVIEW_CONFIG: {
                ...existingConfig.WEBVIEW_CONFIG,
                ios: newConfig.WEBVIEW_CONFIG.ios,
            }, // Update only WEBVIEW_CONFIG
        }

        // Save the merged config
        fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2))
        progress.log("Configuration saved successfully", "success")
    } catch (error) {
        progress.log("Failed to save configuration: " + error.message, "error")
        process.exit(1)
    }
}

async function setupIOSEnvironment() {
    try {
        progress.start("platform")
        if (process.platform !== "darwin") {
            progress.log("iOS Simulator is only available on macOS.", "error")
            process.exit(1)
        }
        progress.complete("platform")

        progress.start("xcode")
        const developerDir = await ensureXcodeReady({ log })
        progress.log(`Using ${developerDir}`, "info")
        progress.complete("xcode")

        progress.start("config")
        const { WEBVIEW_CONFIG } = await initializeConfig()
        progress.complete("config")

        progress.start("runtime")
        const runtime = await ensureIosRuntime({ yes: flags.yes, log })
        progress.log(`Runtime ${runtime.name}`, "info")
        progress.complete("runtime")

        progress.start("simulator")
        await configureSimulator(WEBVIEW_CONFIG, runtime)
        progress.complete("simulator")

        progress.start("launch")
        await launchIOSSimulator(WEBVIEW_CONFIG.ios.simulatorName)
        progress.complete("launch")

        progress.start("saveConfig")
        const config = await validateAndCompleteConfig("ios", configPath)
        progress.complete("saveConfig")

        progress.start("setupServer")
        await setupServer(configPath, (message) => progress.log(message, "info"))
        progress.complete("setupServer")

        const iosCfg = config.ios || {}
        progress.printTreeContent("Config  config/config.json", [
            { text: `port            ${config.port ?? ""}`, color: "gray" },
            { text: `appBundleId     ${iosCfg.appBundleId ?? ""}`, color: "gray" },
            { text: `simulatorName   ${iosCfg.simulatorName ?? ""}`, color: "gray" },
        ])
        progress.summary("Ready", "Run catalyst buildApp:ios to install the app")
        process.exit(0)
    } catch (error) {
        // A coded error (ANDROID-007, IOS-003, ...) gets the full diagnostic:
        // code, hint and doc link. Anything else keeps the one-line failure.
        const coded = /^[A-Z]+-\d{3}$/.test(String(error?.code || ""))
        if (progress.currentStep) {
            progress.fail(progress.currentStep.id, coded ? undefined : error.message)
        }
        if (coded) process.stderr.write(buildFailure({ error, stage: "iOS setup" }))
        else progress.hint(error.hint)
        process.exit(1)
    }
}

async function configureSimulator(config, runtime) {
    // If a simulator is already configured, skip the picker
    if (config.ios.simulatorName) {
        progress.log(`Using configured simulator: ${config.ios.simulatorName}`)
        return
    }

    progress.pause()
    let choice
    try {
        choice = await chooseSimulator({
            runtime,
            devicesJson: simctlJson(["list", "devices"]),
            deviceTypesJson: simctlJson(["list", "devicetypes"]),
            yes: flags.yes,
        })
    } finally {
        progress.resume()
    }
    if (choice.created) progress.log(`Created simulator "${choice.name}"`, "success")
    config.ios.simulatorName = choice.name
    await saveConfig({ WEBVIEW_CONFIG: config })
}

// Xcode 27 replaced the standalone Simulator.app (com.apple.iphonesimulator)
// with DeviceHub.app (com.apple.dt.Devices); older Xcode installs still ship
// the former. Resolve whichever is actually installed instead of hardcoding
// the app name, which no longer resolves via `open -a` on either app.
function resolveSimulatorAppBundleId() {
    const candidates = ["com.apple.dt.Devices", "com.apple.iphonesimulator"]
    for (const bundleId of candidates) {
        try {
            execSync(`osascript -e 'id of app id "${bundleId}"'`, { stdio: "ignore" })
            return bundleId
        } catch {
            // Not installed under this bundle id; try the next candidate.
        }
    }
    return null
}

// Text mirrors errors/registry.js ERROR_DEFINITIONS[IOS-001] (see
// errors/IOS/IOS-001.md) — this CJS subtree can't import the ESM error
// registry (see native/buildErrorFormat.js), so the message is duplicated
// here rather than imported. This condition is recoverable (the simulator
// can still boot headlessly via simctl) so callers log it as a warning
// instead of throwing.
const SIMULATOR_APP_NOT_FOUND_WARNING =
    "[IOS-001] Could not find an installed iOS Simulator app (checked DeviceHub.app and the legacy Simulator.app). " +
    "The simulator is booted but its window may not be visible. Suggested action: confirm a full Xcode.app is installed and selected via xcode-select -p, then open it once from Spotlight."

async function launchIOSSimulator(simulatorName) {
    progress.status("launching simulator")
    try {
        // Get all simulators including both available and booted ones
        const allSimulatorInfo = execSync("xcrun simctl list devices -j").toString()
        const simulatorsJson = JSON.parse(allSimulatorInfo)

        const runtimesOutput = execSync("xcrun simctl list runtimes -j").toString()
        const availableRuntimeIds = new Set(
            JSON.parse(runtimesOutput)
                .runtimes.filter(
                    (r) => r.isAvailable || r.availability === "(available)" || r.availability === "available"
                )
                .map((r) => r.identifier)
        )

        // Search through all runtimes and their devices
        let foundSimulator = null
        let foundSimulatorId = null
        let isBooted = false

        // Prefer devices under an available runtime; fall back to already-booted ones
        Object.entries(simulatorsJson.devices).forEach(([runtimeId, devices]) => {
            const isAvailableRuntime = availableRuntimeIds.has(runtimeId)
            devices.forEach((device) => {
                if (device.name === simulatorName) {
                    const alreadyBooted = device.state === "Booted"
                    // Take this match if: no match yet, or this runtime is available and current isn't, or device is already booted
                    if (
                        !foundSimulator ||
                        (isAvailableRuntime && !foundSimulator._fromAvailableRuntime) ||
                        alreadyBooted
                    ) {
                        foundSimulator = { ...device, _fromAvailableRuntime: isAvailableRuntime }
                        foundSimulatorId = device.udid
                        isBooted = alreadyBooted
                    }
                }
            })
        })

        if (!foundSimulator) {
            progress.log(`Configured simulator "${simulatorName}" not found`, "warning")
            return
        }

        if (!isBooted) {
            progress.status(`booting ${simulatorName}`)
            runCommand(`xcrun simctl boot ${foundSimulatorId}`)
        } else {
            progress.status("already booted")
        }

        // Open the simulator UI (DeviceHub on Xcode 27+, Simulator.app on older Xcode) and focus it
        const simulatorAppBundleId = resolveSimulatorAppBundleId()
        if (simulatorAppBundleId) {
            progress.status("opening simulator")
            runCommand(`open -b ${simulatorAppBundleId}`)

            // Give the simulator a moment to open/focus
            await new Promise((resolve) => setTimeout(resolve, 1000))

            // Activate the simulator UI window to bring it to front
            runCommand(`osascript -e 'tell application id "${simulatorAppBundleId}" to activate'`)
        } else {
            progress.log(SIMULATOR_APP_NOT_FOUND_WARNING, "warning")
        }
    } catch (error) {
        progress.log(`Failed to launch iOS Simulator: ${error.message}`, "error")
    }
    // process.exit(0);
}

// Execute the main setup
setupIOSEnvironment()
