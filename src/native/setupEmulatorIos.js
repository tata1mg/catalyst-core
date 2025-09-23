import { execSync } from "child_process"
import fs from "fs"
import { runCommand, promptUser, validateAndCompleteConfig } from "./utils.js"
import TerminalProgress from "./TerminalProgress.js"

const configPath = `${process.env.PWD}/config/config.json`
const { setupServer } = require("./setupServer.js")

const ITEMS_PER_PAGE = 10

const steps = {
    platform: "Check Platform Compatibility",
    config: "Initialize Configuration",
    simulator: "Configure iOS Simulator",
    launch: "Launch iOS Simulator",
    saveConfig: "Saving configuration",
    setupServer: "Setup Server",
}
const progressPaddingConfig = {
    titlePaddingTop: 2,
    titlePaddingBottom: 1,
    stepPaddingLeft: 4,
    stepSpacing: 1,
    errorPaddingLeft: 6,
    bottomMargin: 2,
}

const progress = new TerminalProgress(steps, "Catalyst Universal Ios Setup", progressPaddingConfig)
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
            progress.log("iOS Simulator is only available on macOS.")
            process.exit(1)
        }
        progress.complete("platform")

        progress.start("config")
        const { WEBVIEW_CONFIG } = await initializeConfig()
        progress.complete("config")

        progress.start("setupServer")
        await setupServer(configPath)
        progress.complete("config")
        progress.start("setupServer")

        progress.start("simulator")
        await configureSimulator(WEBVIEW_CONFIG)
        progress.complete("simulator")

        progress.start("launch")
        await launchIOSSimulator(WEBVIEW_CONFIG.ios.simulatorName)
        progress.complete("launch")

        progress.start("saveConfig")
        const config = await validateAndCompleteConfig("ios", configPath)
        progress.complete("saveConfig")

        progress.printTreeContent("Configuration Explanation", [
            "WEBVIEW_CONFIG: Main configuration object for the WebView setup",
            { text: "port: Port number for the WebView server", indent: 1, prefix: "├─ ", color: "gray" },
            { text: "ios: iOS-specific configuration", indent: 1, prefix: "└─ ", color: "gray" },
            { text: "buildType: Build type (debug/release)", indent: 2, prefix: "├─ ", color: "gray" },
            {
                text: "appBundleId: iOS application bundle identifier",
                indent: 2,
                prefix: "├─ ",
                color: "gray",
            },
            { text: "simulatorName: Selected iOS simulator name", indent: 2, prefix: "└─ ", color: "gray" },
        ])

        progress.printTreeContent("Final Configuration", [JSON.stringify(config, null, 2)])
        process.exit(0)
    } catch (error) {
        if (progress.currentStep) {
            progress.fail(progress.currentStep.id, error.message)
        }
        process.exit(1)
    }
}

async function displayPaginatedList(items, startIndex) {
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, items.length)

    for (let i = startIndex; i < endIndex; i++) {
        console.log(`${i + 1}. ${items[i]}`)
    }

    if (endIndex < items.length) {
        console.log(`\nShowing ${startIndex + 1}-${endIndex} of ${items.length} items`)
        console.log('Type "more" to see more items, or enter your selection: ')
        return true
    }

    return false
}

async function getRuntime() {
    const runtimesOutput = execSync("xcrun simctl list runtimes -j").toString()
    const parsedRuntimes = JSON.parse(runtimesOutput).runtimes

    const availableRuntime = parsedRuntimes.find(
        (runtime) =>
            runtime.isAvailable ||
            runtime.availability === "(available)" ||
            runtime.availability === "available"
    )

    if (!availableRuntime) {
        const runningSimulators = execSync("xcrun simctl list devices booted").toString()
        if (runningSimulators.includes("(Booted)") && parsedRuntimes.length > 0) {
            console.log(`Using runtime: ${parsedRuntimes[0].name}`)
            return parsedRuntimes[0]
        }

        console.error("No available iOS runtime found. Please install one through Xcode.")
        process.exit(1)
    }

    console.log(`Using runtime: ${availableRuntime.name}`)
    return availableRuntime
}

async function configureSimulator(config) {
    progress.pause()

    // Get the current runtime first
    const runtime = await getRuntime()

    // Get simulators specifically for this runtime
    const simulatorsJson = JSON.parse(execSync("xcrun simctl list devices -j").toString())
    const runtimeSimulators = simulatorsJson.devices[runtime.identifier] || []

    // Filter for available simulators only
    const availableSimulators = runtimeSimulators
        .filter((sim) => sim.availability === "(available)" || sim.isAvailable)
        .map((sim) => `${sim.name} (${sim.udid})`)

    if (availableSimulators.length === 0) {
        progress.log(`No available simulators found for runtime: ${runtime.name}`, "error")
        progress.resume()
        process.exit(1)
        return
    }

    let startIndex = 0
    console.log(`\nAvailable simulators for ${runtime.name} (or type 'new' to create a new one):`)

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const hasMore = await displayPaginatedList(availableSimulators, startIndex)
        const simulatorChoice = await promptUser(hasMore ? "" : "\nEnter selection: ")

        if (simulatorChoice.toLowerCase() === "more" && hasMore) {
            startIndex += ITEMS_PER_PAGE
            continue
        }

        if (simulatorChoice.toLowerCase() === "new") {
            const deviceTypes = JSON.parse(
                execSync("xcrun simctl list devicetypes --json").toString()
            ).devicetypes
            const simulatorName = await promptUser("Enter a name for the new simulator: ")

            // Use iPhone 15 Pro as default device type
            const defaultDevice =
                deviceTypes.find((dt) => dt.name.includes("iPhone 15 Pro")) || deviceTypes[0]

            try {
                runCommand(
                    `xcrun simctl create "${simulatorName}" "${defaultDevice.identifier}" "${runtime.identifier}"`
                )
                console.log(`Simulator "${simulatorName}" created successfully.`)
                config.ios.simulatorName = simulatorName
            } catch (error) {
                console.log(`Failed to create simulator "${simulatorName}". Error: ${error.message}`)
                process.exit(1)
            }
            break
        } else {
            const index = parseInt(simulatorChoice) - 1
            if (index >= 0 && index < availableSimulators.length) {
                const selectedSimulator = availableSimulators[index]
                // Extract only the simulator name without ID and state
                const simulatorName = selectedSimulator.split(" (")[0]
                config.ios.simulatorName = simulatorName
                break
            } else {
                console.log("Invalid selection. Please try again.")
            }
        }
    }

    progress.resume()
    await saveConfig({ WEBVIEW_CONFIG: config })
}

// async function createDefaultSimulator(config, runtime) {
//     const deviceTypes = JSON.parse(execSync("xcrun simctl list devicetypes --json").toString()).devicetypes
//     const defaultDevice = deviceTypes.find((dt) => dt.name.includes("iPhone 15 Pro")) || deviceTypes[0]
//     const simulatorName = `Default ${defaultDevice.name.split(" (")[0]}`

//     try {
//         runCommand(
//             `xcrun simctl create "${simulatorName}" "${defaultDevice.identifier}" "${runtime.identifier}"`
//         )
//         console.log(`Default simulator "${simulatorName}" created successfully.`)
//         config.ios.simulatorName = simulatorName
//         await saveConfig({ WEBVIEW_CONFIG: config })
//     } catch (error) {
//         console.log(`Failed to create default simulator. Error: ${error.message}`)
//         process.exit(1)
//     }
// }

async function launchIOSSimulator(simulatorName) {
    progress.log("Launching iOS Simulator...")
    try {
        // Get all simulators including both available and booted ones
        const allSimulatorInfo = execSync("xcrun simctl list devices -j").toString()
        const simulatorsJson = JSON.parse(allSimulatorInfo)

        // Search through all runtimes and their devices
        let foundSimulator = null
        let foundSimulatorId = null
        let isBooted = false

        // Iterate through all runtimes and their devices
        Object.values(simulatorsJson.devices).forEach((devices) => {
            devices.forEach((device) => {
                if (device.name === simulatorName) {
                    foundSimulator = device
                    foundSimulatorId = device.udid
                    isBooted = device.state === "Booted"
                }
            })
        })

        if (!foundSimulator) {
            console.log(`Configured simulator "${simulatorName}" not found.`)
            return
        }

        if (!isBooted) {
            console.log(`Booting simulator: ${simulatorName}`)
            runCommand(`xcrun simctl boot ${foundSimulatorId}`)
        } else {
            console.log(`Simulator ${simulatorName} is already booted`)
        }

        // Open Simulator.app and focus
        progress.log("Opening Simulator.app...")
        runCommand("open -a Simulator")

        // Give the simulator a moment to open/focus
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Activate the Simulator.app window to bring it to front
        runCommand("osascript -e 'tell application \"Simulator\" to activate'")

        console.log("iOS Simulator launched successfully.")
    } catch (error) {
        console.error("Failed to launch iOS Simulator. Error:", error.message)
    }
    // process.exit(0);
}

// Execute the main setup
setupIOSEnvironment()
