const { exec, execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const TerminalProgress = require("./TerminalProgress.js").default

const pwd = `${process.cwd()}/node_modules/catalyst-core/dist/native`
const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH, NODE_SERVER_HOSTNAME } = require(
    `${process.env.PWD}/config/config.json`
)

// Configuration constants
const iosConfig = WEBVIEW_CONFIG.ios
const url = `http://${NODE_SERVER_HOSTNAME}:${WEBVIEW_CONFIG.port}`
const PROJECT_DIR = `${pwd}/iosnativeWebView`
const SCHEME_NAME = "iosnativeWebView"
const APP_BUNDLE_ID = iosConfig.appBundleId || "com.debug.webview"
const PROJECT_NAME = path.basename(PROJECT_DIR)
const IPHONE_MODEL = iosConfig.simulatorName

// Define build steps for progress tracking
const steps = {
    config: "Generating Required Configuration for build",
    launchSimulator: "Launch iOS Simulator",
    clean: "Clean Build Artifacts",
    build: "Build IOS Project",
    findApp: "Locate Built Application",
    install: "Install Application",
    launch: "Launch Application",
}

// Configure progress display
const progressConfig = {
    titlePaddingTop: 2,
    titlePaddingBottom: 1,
    stepPaddingLeft: 4,
    stepSpacing: 1,
    errorPaddingLeft: 6,
    bottomMargin: 2,
}

const progress = new TerminalProgress(steps, "Catalyst iOS Build", progressConfig)

async function updateInfoPlist() {
    try {
        const infoPlistPath = path.join(PROJECT_DIR, PROJECT_NAME, "Info.plist")

        if (fs.existsSync(infoPlistPath)) {
            let plistContent = fs.readFileSync(infoPlistPath, "utf8")

            // Add CFBundleDisplayName if it doesn't exist
            if (!plistContent.includes("CFBundleDisplayName")) {
                const insertPoint = plistContent.lastIndexOf("</dict>")
                const newEntry = `\t<key>CFBundleDisplayName</key>\n\t<string>${iosConfig.appName || "Catalyst Application"}</string>\n`
                plistContent = plistContent.slice(0, insertPoint) + newEntry + plistContent.slice(insertPoint)
                fs.writeFileSync(infoPlistPath, plistContent, "utf8")
            } else {
                // Update existing CFBundleDisplayName with new appName
                const displayNameRegex = /(<key>CFBundleDisplayName<\/key>\s*<string>)([^<]*)(<\/string>)/
                if (displayNameRegex.test(plistContent)) {
                    plistContent = plistContent.replace(
                        displayNameRegex,
                        `$1${iosConfig.appName || "Catalyst Application"}$3`
                    )
                    fs.writeFileSync(infoPlistPath, plistContent, "utf8")
                }
            }
        }
    } catch (err) {
        progress.fail("config", err)
        process.exit(1)
    }
}

async function generateConfigConstants() {
    progress.start("config")
    try {
        // Update ConfigConstants.swift
        const configOutputPath = path.join(PROJECT_DIR, PROJECT_NAME, "ConfigConstants.swift")

        const configDir = path.dirname(configOutputPath)
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true })
        }

        // Initialize base config with required URL
        let configContent = `// This file is auto-generated. Do not edit.
import Foundation

enum ConfigConstants {
    static let url = "${url}"`

        // Only add cachePattern if it exists and is not empty
        if (iosConfig.cachePattern && iosConfig.cachePattern.trim()) {
            // Convert comma-separated string to Swift array format
            const patterns = iosConfig.cachePattern
                .split(",")
                .map((pattern) => pattern.trim())
                .map((pattern) => `"${pattern}"`)
                .join(", ")

            configContent += `
    static let cachePattern: [String] = [${patterns}]`
        }

        // Close the enum
        configContent += `
}`

        fs.writeFileSync(configOutputPath, configContent, "utf8")
        progress.log("Configuration constants generated successfully", "success")
        progress.complete("config")
    } catch (error) {
        progress.fail("config", error.message)
        process.exit(1)
    }
}

async function cleanBuildArtifacts() {
    progress.start("clean")
    try {
        const xcuserdataPath = path.join(`${PROJECT_NAME}.xcodeproj`, `project.xcworkspace`, "xcuserdata")
        if (fs.existsSync(xcuserdataPath)) {
            await runCommand(`rm -rf "${xcuserdataPath}"`)
        }

        const derivedDataPath = path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData")
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
        process.exit(1)
    }
}

async function buildXcodeProject() {
    progress.start("build")
    try {
        const derivedDataPath = path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData")

        try {
            progress.log("Building for specified simulator...", "info")
            await buildProject(
                SCHEME_NAME,
                "iphonesimulator",
                `platform=iOS Simulator,name=${IPHONE_MODEL}`,
                APP_BUNDLE_ID,
                derivedDataPath,
                PROJECT_NAME
            )
        } catch (buildError) {
            progress.log("Initial build failed, attempting fallback...", "warning")
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
        progress.printTreeContent("Troubleshooting Guide", [
            "Build failed. Please try the following steps:",
            {
                text: 'Run "npm run setupEmulator:ios" to reconfigure iOS settings',
                indent: 1,
                prefix: "├─ ",
                color: "yellow",
            },
            {
                text: "Check if Xcode is properly installed and updated",
                indent: 1,
                prefix: "├─ ",
                color: "yellow",
            },
            { text: "Verify selected simulator exists", indent: 1, prefix: "└─ ", color: "yellow" },
            "\nVerify Configuration:",
            { text: `Selected Simulator: ${IPHONE_MODEL}`, indent: 1, prefix: "├─ ", color: "gray" },
            { text: `Server URL: ${url}`, indent: 1, prefix: "└─ ", color: "gray" },
        ])
        process.exit(1)
    }
}

async function findAppPath() {
    progress.start("findApp")
    try {
        const DERIVED_DATA_DIR = path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData")
        let APP_PATH = ""

        try {
            APP_PATH = execSync(
                `find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-*" -prune -not -path "*/Index.noindex*" -path "*/Build/Products/Debug-iphonesimulator/${PROJECT_NAME}.app" -type d | head -n 1`
            )
                .toString()
                .trim()
        } catch (error) {
            progress.log("Primary app path search failed, trying fallback...", "warning")
        }

        if (!APP_PATH) {
            try {
                APP_PATH = execSync(
                    `find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-*" -name "${PROJECT_NAME}.app" -type d -not -path "*/Index.noindex*" | head -n 1`
                )
                    .toString()
                    .trim()
            } catch (error) {
                throw new Error("Could not locate built application")
            }
        }

        if (!APP_PATH) {
            progress.fail("findApp", "No .app file found")
            process.exit(1)
        }

        progress.complete("findApp")
        return APP_PATH
    } catch (error) {
        progress.fail("findApp", error.message)
        throw error
    }
}

async function moveAppToBuildOutput(APP_PATH) {
    try {
        const buildType = iosConfig.buildType || "debug"
        const appName = iosConfig.appName || "app"

        const currentDate = new Date().toLocaleDateString("en-GB").replace(/\//g, "-") // DD-MM-YYYY format
        const currentTime = new Date()
            .toLocaleTimeString("en-US", {
                hour12: true,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            })
            .replace(/:/g, ":") // HH-MM-SS AM/PM format
        const destinationDir = path.join(
            process.env.PWD,
            BUILD_OUTPUT_PATH,
            "native",
            "ios",
            currentDate,
            buildType
        )
        const destinationPath = path.join(destinationDir, `${appName}-${currentTime}.app`)

        // Create destination directory if it doesn't exist
        if (!fs.existsSync(destinationDir)) {
            fs.mkdirSync(destinationDir, { recursive: true })
        }

        // Copy the app to the destination using shell command
        await runCommand(`cp -R "${APP_PATH}" "${destinationPath}"`)

        return destinationPath
    } catch (error) {
        console.error("Error moving app to build output:", error.message)
        throw error
    }
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
        process.exit(1)
    }
}

async function uninstallExistingApp() {
    console.log("Uninstalling the app if it exists...")
    await runCommand(`xcrun simctl uninstall booted "${APP_BUNDLE_ID}"`)
}

async function installApp(APP_PATH) {
    console.log("Installing the app...")
    try {
        await runCommand(`xcrun simctl install booted "${APP_PATH}"`)
    } catch (error) {
        console.error("Error installing the app:", error)
        process.exit(1)
    }
}
async function waitForInstallation() {
    console.log("Waiting for the app to be fully installed...")
    for (let i = 0; i < 30; i++) {
        try {
            execSync(`xcrun simctl get_app_container booted "${APP_BUNDLE_ID}"`)
            console.log("App installed successfully.")
            break
        } catch (error) {
            if (i === 29) {
                console.log("Timeout: App installation took too long.")
                process.exit(1)
            }
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }
    }
}

async function launchAndVerifyApp() {
    console.log("Launching the app...")
    try {
        await runCommand(`xcrun simctl launch booted "${APP_BUNDLE_ID}"`)
        await verifyAppLaunch()
    } catch (error) {
        await handleLaunchError(error)
    }
}

async function verifyAppLaunch() {
    console.log("Waiting for the app to launch...")
    for (let i = 0; i < 10; i++) {
        try {
            const launchResult = execSync(`xcrun simctl launch booted "${APP_BUNDLE_ID}"`).toString()
            if (launchResult.includes("already launched")) {
                console.log("App launched successfully.")
                break
            }
        } catch (error) {
            if (i === 9) {
                console.log("Warning: App launch might have failed or taken too long.")
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
    }
}

async function handleLaunchError(error) {
    console.error("Error launching the app:", error)
    console.log("Checking app container...")
    try {
        await runCommand(`xcrun simctl get_app_container booted "${APP_BUNDLE_ID}"`)
    } catch (containerError) {
        console.log("App container not found")
    }
    process.exit(1)
}

async function focusSimulator() {
    console.log("Focusing on Simulator...")
    await runCommand(`osascript -e 'tell application "Simulator" to activate'`)
}

// Utility functions (kept from original file)
function getLocalIPAddress() {
    try {
        const command = `ifconfig | grep "inet " | grep -v 127.0.0.1 | head -n 1 | awk '{print $2}'`
        return execSync(command).toString().trim()
    } catch (error) {
        console.error("Error getting local IP:", error)
        return "localhost"
    }
}

function runCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
        // eslint-disable-next-line security/detect-child-process
        exec(command, { maxBuffer: 1024 * 1024 * 10, ...options }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Command failed: ${command}`)
                console.error(`Error: ${error.message}`)
                console.error(`stderr: ${stderr}`)
                reject(error)
                return
            }
            if (stderr) {
                console.warn(`Warning: ${stderr}`)
            }
            resolve(stdout.trim())
        })
    })
}

async function getBootedSimulatorUUID(modelName) {
    try {
        // First try to find a booted simulator of the specified model
        let command = `xcrun simctl list devices | grep "${modelName}" | grep "Booted" | grep -E -o -i "([0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12})" | head -n 1`
        let uuid = execSync(command).toString().trim()

        if (uuid) {
            console.log(`Found booted simulator of model ${modelName}`)
            return uuid
        }

        // If no booted simulator of the specified model is found, check any booted simulator
        console.log(`No booted simulator of model ${modelName} found, checking for any booted simulator...`)
        command = `xcrun simctl list devices | grep "Booted" | grep -E -o -i "([0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12})" | head -n 1`
        uuid = execSync(command).toString().trim()

        if (uuid) {
            console.log("Found another booted simulator, will use it instead")
            return uuid
        }

        return null
    } catch (error) {
        console.log("No booted simulators found")
        return null
    }
}

async function getBootedSimulatorInfo() {
    try {
        // Get the list of all devices with their details
        const listCommand = "xcrun simctl list devices --json"
        const simulatorList = JSON.parse(execSync(listCommand).toString())

        // Find booted device and its runtime
        let bootedDevice = null
        let runtime = null

        // Look through all runtimes and their devices
        Object.entries(simulatorList.devices).forEach(([runtimeId, devices]) => {
            devices.forEach((device) => {
                if (device.state === "Booted") {
                    bootedDevice = device
                    runtime = runtimeId
                }
            })
        })

        if (bootedDevice && runtime) {
            // Extract iOS version from runtime ID (e.g., "com.apple.CoreSimulator.SimRuntime.iOS-18-0")
            const version = runtime.match(/iOS-(\d+)-(\d+)/)
            if (version) {
                const iosVersion = `${version[1]}.${version[2]}`
                console.log(`Found booted device: ${bootedDevice.name} with iOS ${iosVersion}`)
                return {
                    udid: bootedDevice.udid,
                    version: iosVersion,
                }
            }
        }

        return null
    } catch (error) {
        console.error("Error getting simulator info:", error)
        return null
    }
}

async function buildProject(scheme, sdk, destination, bundleId, derivedDataPath, projectName) {
    // Get the booted device info first
    const bootedInfo = await getBootedSimulatorInfo()
    if (!bootedInfo) {
        throw new Error("No booted simulator found")
    }
    // Add runtime version to destination
    const destinationWithRuntime = `${destination},OS=${bootedInfo.version}`
    console.log(`Building with destination: ${destinationWithRuntime}`)

    const buildCommand = `xcodebuild \
        -scheme "${scheme}" \
        -sdk ${sdk} \
        -configuration Debug \
        -destination "${destinationWithRuntime}" \
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
        build`
    return runCommand(buildCommand, {
        maxBuffer: 1024 * 1024 * 10,
    })
}

async function launchIOSSimulator(simulatorName) {
    progress.start("launchSimulator")
    try {
        progress.log("Launching iOS Simulator...")

        // Get all simulators including both available and booted ones
        const allSimulatorInfo = execSync("xcrun simctl list devices -j").toString()
        const simulatorsJson = JSON.parse(allSimulatorInfo)

        // Search through all runtimes and their devices
        let foundSimulator = null
        let foundSimulatorId = null
        let isBooted = false
        let foundDevices = []

        // Iterate through all runtimes and their devices
        Object.entries(simulatorsJson.devices).forEach(([runtime, devices]) => {
            devices.forEach((device) => {
                if (device.name === simulatorName) {
                    foundDevices.push({
                        name: device.name,
                        state: device.state,
                        udid: device.udid,
                        runtime: runtime,
                    })

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
            progress.log(`Attempting to boot simulator: ${simulatorName} (${foundSimulatorId})`, "warning")

            // Check if the simulator is in a valid state to be booted
            if (foundSimulator.state === "Shutdown") {
                progress.log(`Simulator is shutdown, attempting to boot...`, "info")
                try {
                    await runCommand(`xcrun simctl boot ${foundSimulatorId}`)
                    progress.log(`Successfully booted simulator`, "success")
                } catch (bootError) {
                    progress.log(`Boot failed: ${bootError.message}`, "error")

                    // Try to find an alternative booted simulator
                    progress.log(`Looking for any booted simulator as fallback...`, "info")
                    const fallbackUUID = await getBootedSimulatorUUID(simulatorName)
                    if (fallbackUUID) {
                        progress.log(`Found fallback booted simulator: ${fallbackUUID}`, "success")
                        foundSimulatorId = fallbackUUID
                    } else {
                        throw new Error(
                            `Failed to boot simulator and no fallback available: ${bootError.message}`
                        )
                    }
                }
            } else {
                progress.log(
                    `Simulator state is '${foundSimulator.state}', not 'Shutdown'. Checking if we can use it...`,
                    "warning"
                )
                if (foundSimulator.state === "Booted") {
                    progress.log(`Wait, simulator is actually booted! Using it.`, "success")
                } else {
                    throw new Error(`Simulator is in unexpected state: ${foundSimulator.state}`)
                }
            }
        } else {
            progress.log(`Simulator ${simulatorName} is already booted`, "success")
        }

        // Open Simulator.app and focus
        progress.log("Opening Simulator.app...")
        await runCommand("open -a Simulator")

        // Give the simulator a moment to open/focus
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Activate the Simulator.app window to bring it to front
        await runCommand("osascript -e 'tell application \"Simulator\" to activate'")

        progress.log("iOS Simulator launched successfully.", "success")
        progress.complete("launchSimulator")
    } catch (error) {
        progress.fail("launchSimulator", error.message)

        // Show detailed troubleshooting info
        progress.printTreeContent("Simulator Troubleshooting", [
            "iOS Simulator failed to launch. Common solutions:",
            { text: "Delete and recreate the simulator in Xcode", indent: 1, prefix: "├─ ", color: "yellow" },
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

        console.error("Failed to launch iOS Simulator. Error:", error.message)
        process.exit(1)
    }
}

async function main() {
    try {
        const originalDir = process.cwd()
        progress.log("Starting build process from: " + originalDir, "info")

        await generateConfigConstants()
        await updateInfoPlist()

        progress.log("Changing directory to: " + PROJECT_DIR, "info")
        process.chdir(PROJECT_DIR)

        await launchIOSSimulator(IPHONE_MODEL)

        await cleanBuildArtifacts()
        await buildXcodeProject()

        const APP_PATH = await findAppPath()
        await installAndLaunchApp(APP_PATH)

        process.chdir(originalDir)

        const MOVED_APP_PATH = await moveAppToBuildOutput(APP_PATH)

        progress.printTreeContent("Build Summary", [
            "Build completed successfully:",
            { text: `App Path: ${MOVED_APP_PATH}`, indent: 1, prefix: "├─ ", color: "gray" },
            { text: `Simulator: ${IPHONE_MODEL}`, indent: 1, prefix: "├─ ", color: "gray" },
            { text: `URL: ${url}`, indent: 1, prefix: "└─ ", color: "gray" },
        ])
    } catch (error) {
        progress.log("Build failed: " + error.message, "error")
        process.exit(1)
    }
    process.exit(1)
}

main()
