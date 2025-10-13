const { exec, execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const TerminalProgress = require("./TerminalProgress.js").default

const pwd = `${process.cwd()}/node_modules/catalyst-core/dist/native`
const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = require(`${process.env.PWD}/config/config.json`)

// Configuration constants
const iosConfig = WEBVIEW_CONFIG.ios

const protocol = WEBVIEW_CONFIG.useHttps ? "https" : "http"
const ip = WEBVIEW_CONFIG.LOCAL_IP || "localhost"
const port = WEBVIEW_CONFIG.port ? (WEBVIEW_CONFIG.useHttps ? 443 : WEBVIEW_CONFIG.port) : null
let url = port ? `${protocol}://${ip}:${port}` : `${protocol}://${ip}`

const PROJECT_DIR = `${pwd}/iosnativeWebView`
const SCHEME_NAME = "iosnativeWebView"
const APP_BUNDLE_ID = iosConfig.appBundleId || "com.debug.webview"
const PROJECT_NAME = path.basename(PROJECT_DIR)
const IPHONE_MODEL = iosConfig.simulatorName

// Define build steps for progress tracking
const steps = {
    config: "Generating Required Configuration for build",
    deviceDetection: "Detecting Physical Device",
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

// Utility function to run shell commands
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
        const listCommand = "xcrun simctl list devices --json"
        const simulatorList = JSON.parse(execSync(listCommand).toString())

        for (const runtime in simulatorList.devices) {
            const devices = simulatorList.devices[runtime]
            for (const device of devices) {
                if (device.state === "Booted") {
                    return {
                        udid: device.udid,
                        name: device.name,
                        runtime: runtime
                    }
                }
            }
        }
        return null
    } catch (error) {
        console.log("Failed to get booted simulator info:", error.message)
        return null
    }
}
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

// Function to convert JSON value to Swift property
function generateSwiftProperty(key, value, indent = '    ') {
    if (value === null || value === undefined) {
        return `${indent}static let ${key}: String? = nil`;
    }

    // Special handling for cachePattern - always convert to array
    if (key === 'cachePattern') {
        if (typeof value === 'string') {
            // Convert single string to array
            return `${indent}static let ${key}: [String] = ["${value}"]`;
        } else if (Array.isArray(value)) {
            const arrayValues = value.map(v => `"${v}"`).join(", ");
            return `${indent}static let ${key}: [String] = [${arrayValues}]`;
        }
    }

    if (typeof value === 'string') {
        return `${indent}static let ${key} = "${value}"`;
    }

    if (typeof value === 'number') {
        return Number.isInteger(value) ?
            `${indent}static let ${key} = ${value}` :
            `${indent}static let ${key} = ${value}`;
    }

    if (typeof value === 'boolean') {
        return `${indent}static let ${key} = ${value}`;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return `${indent}static let ${key}: [String] = []`;
        }

        // Determine array type from first element
        const firstElement = value[0];
        if (typeof firstElement === 'string') {
            const arrayValues = value.map(v => `"${v}"`).join(", ");
            return `${indent}static let ${key}: [String] = [${arrayValues}]`;
        } else if (typeof firstElement === 'number') {
            const arrayType = Number.isInteger(firstElement) ? 'Int' : 'Double';
            const arrayValues = value.join(", ");
            return `${indent}static let ${key}: [${arrayType}] = [${arrayValues}]`;
        } else if (typeof firstElement === 'boolean') {
            const arrayValues = value.join(", ");
            return `${indent}static let ${key}: [Bool] = [${arrayValues}]`;
        } else {
            // Mixed array - convert to strings
            const arrayValues = value.map(v => `"${v}"`).join(", ");
            return `${indent}static let ${key}: [String] = [${arrayValues}]`;
        }
    }

    if (typeof value === 'object' && value !== null) {
        // Generate nested enum for objects
        let nestedContent = `${indent}enum ${key.charAt(0).toUpperCase() + key.slice(1)} {\n`;

        for (const [nestedKey, nestedValue] of Object.entries(value)) {
            nestedContent += generateSwiftProperty(nestedKey, nestedValue, indent + '    ') + '\n';
        }

        nestedContent += `${indent}}`;
        return nestedContent;
    }

    // Fallback to string
    return `${indent}static let ${key} = "${value}"`;
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

        // Track keys already added to avoid duplicates
        const addedKeys = new Set();

        // Process all properties from WEBVIEW_CONFIG
        if (WEBVIEW_CONFIG && typeof WEBVIEW_CONFIG === 'object') {
            for (const [key, value] of Object.entries(WEBVIEW_CONFIG)) {
                // Skip 'ios' and 'android' keys to avoid duplication
                if (key === 'ios' || key === 'android') continue;

                configContent += '\n' + generateSwiftProperty(key, value);
                addedKeys.add(key);
            }
        }

        // Process iOS-specific config
        if (iosConfig && typeof iosConfig === 'object') {
            configContent += '\n    \n    // iOS-specific configuration';
            for (const [key, value] of Object.entries(iosConfig)) {
                // Skip if key was already added from WEBVIEW_CONFIG
                if (addedKeys.has(key)) continue;

                configContent += '\n' + generateSwiftProperty(key, value);
            }
        }

        // Add URL whitelisting configuration if it exists
        if (iosConfig.accessControl) {
            const accessControl = iosConfig.accessControl

            configContent += `
    static let accessControlEnabled = ${accessControl.enabled || false}`

            if (accessControl.allowedUrls && Array.isArray(accessControl.allowedUrls)) {
                const allowedUrls = accessControl.allowedUrls.map((url) => `"${url}"`).join(", ")

                configContent += `
    static let allowedUrls: [String] = [${allowedUrls}]`
            } else if (accessControl.allowedUrls && typeof accessControl.allowedUrls === "string") {
                // Handle comma-separated string format
                const allowedUrls = accessControl.allowedUrls
                    .split(",")
                    .map((url) => url.trim())
                    .filter((url) => url.length > 0)
                    .map((url) => `"${url}"`)
                    .join(", ")

                configContent += `
    static let allowedUrls: [String] = [${allowedUrls}]`
            }
        } else {
            // Default values when no access control is configured
            configContent += `
    static let accessControlEnabled = false
    static let allowedUrls: [String] = []`
        }
        // Add splash screen configuration from WEBVIEW_CONFIG.splashScreen
        const splashConfig = WEBVIEW_CONFIG.splashScreen
        if (splashConfig) {
            configContent += `
    
    // Splash Screen Configuration
    static let splashScreenEnabled = true`

            if (splashConfig.duration) {
                // Convert milliseconds to seconds for iOS TimeInterval
                const durationInSeconds = splashConfig.duration / 1000.0
                configContent += `
    static let splashScreenDuration: TimeInterval? = ${durationInSeconds}`
            } else {
                configContent += `
    static let splashScreenDuration: TimeInterval? = nil`
            }

            if (splashConfig.backgroundColor) {
                configContent += `
    static let splashScreenBackgroundColor = "${splashConfig.backgroundColor}"`
            } else {
                configContent += `
    static let splashScreenBackgroundColor = "#ffffff"`
            }

            // Add splash screen image styling configuration
            const imageWidth = splashConfig.imageWidth || 120
            const imageHeight = splashConfig.imageHeight || 120
            const cornerRadius = splashConfig.cornerRadius || 20

            configContent += `
    static let splashScreenImageWidth: CGFloat = ${imageWidth}
    static let splashScreenImageHeight: CGFloat = ${imageHeight}
    static let splashScreenCornerRadius: CGFloat = ${cornerRadius}`
        } else {
            configContent += `
    
    // Splash Screen Configuration
    static let splashScreenEnabled = false
    static let splashScreenDuration: TimeInterval? = nil
    static let splashScreenBackgroundColor = "#ffffff"
    static let splashScreenImageWidth: CGFloat = 120
    static let splashScreenImageHeight: CGFloat = 120
    static let splashScreenCornerRadius: CGFloat = 20`
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

// Physical Device Detection Functions
async function detectPhysicalDevices() {
    progress.start('deviceDetection');
    try {
        progress.log('Scanning for connected physical devices...', 'info');

        let physicalDevices = [];

        // Priority 1: Check if UDID is specified in config
        const configuredUDID = iosConfig.deviceUDID;

        if (configuredUDID) {
            progress.log(`Using configured device UDID: ${configuredUDID}`, 'info');

            // Verify the configured device is actually connected
            try {
                const instrumentsOutput = execSync('instruments -s devices').toString();

                if (instrumentsOutput.includes(configuredUDID)) {
                    // Extract device name from instruments output
                    const deviceLine = instrumentsOutput.split('\n').find(line => line.includes(configuredUDID));
                    if (deviceLine) {
                        const nameMatch = deviceLine.match(/^(.+?)\s+\(/);
                        const versionMatch = deviceLine.match(/\((\d+\.\d+(?:\.\d+)?)\)/);
                        const deviceName = nameMatch ? nameMatch[1].trim() : "Physical Device";
                        const deviceVersion = versionMatch ? versionMatch[1] : 'Unknown';

                        progress.log(`✅ Found configured physical device: ${deviceName} (${deviceVersion})`, 'success');
                        physicalDevices.push({
                            name: deviceName,
                            version: deviceVersion,
                            udid: configuredUDID,
                            type: 'physical'
                        });

                        progress.complete('deviceDetection');
                        return physicalDevices[0];
                    }
                } else {
                    progress.log(`⚠️  Configured device UDID not found in connected devices`, 'warning');
                    progress.log('Falling back to auto-detection...', 'info');
                }
            } catch (error) {
                progress.log(`Error verifying configured device: ${error.message}`, 'warning');
                progress.log('Falling back to auto-detection...', 'info');
            }
        } else {
            progress.log('No device UDID configured, using auto-detection', 'info');
        }

        // Priority 2: Auto-detect using multiple fallback methods
        // Try instruments first
        try {
            const instrumentsOutput = execSync('instruments -s devices').toString();
            const lines = instrumentsOutput.split('\n');

            for (const line of lines) {
                // Match physical devices (have UDID but not simulator indicators)
                const deviceMatch = line.match(/^(.+?)\s+\((\d+\.\d+(?:\.\d+)?)\)\s+\[([A-F0-9-]{36})\](?:\s+\(Simulator\))?$/);

                if (deviceMatch && !line.includes('(Simulator)')) {
                    const [, name, version, udid] = deviceMatch;
                    physicalDevices.push({
                        name: name.trim(),
                        version: version,
                        udid: udid,
                        type: 'physical'
                    });
                }
            }

            if (physicalDevices.length > 0) {
                progress.log(`Found ${physicalDevices.length} physical device(s) via instruments`, 'success');
            }
        } catch (error) {
            progress.log('instruments command failed, trying xcodebuild...', 'warning');
        }

        // Fallback: Use xcodebuild to get available destinations
        if (physicalDevices.length === 0) {
            try {
                const xcodebuildOutput = execSync(`xcodebuild -scheme "${SCHEME_NAME}" -showdestinations`).toString();
                const lines = xcodebuildOutput.split('\n');

                progress.log('Scanning xcodebuild destinations for physical devices...', 'info');

                for (const line of lines) {
                    // Look for physical iOS devices in xcodebuild output
                    const physicalMatch = line.match(/\{\s*platform:iOS,\s*arch:(\w+),\s*id:([A-F0-9-]+),\s*name:(.+?)\s*\}/);

                    if (physicalMatch) {
                        const [, arch, udid, name] = physicalMatch;
                        progress.log(`Found device candidate: ${name.trim()} - ${udid}`, 'info');

                        // Filter out placeholder devices
                        if (!udid.includes('placeholder') && udid.length > 20) {
                            progress.log(`✅ Valid physical device: ${name.trim()}`, 'success');
                            physicalDevices.push({
                                name: name.trim(),
                                version: 'Unknown',
                                udid: udid,
                                arch: arch,
                                type: 'physical'
                            });
                        } else {
                            progress.log(`❌ Skipping placeholder: ${name.trim()}`, 'warning');
                        }
                    }
                }
            } catch (error) {
                progress.log('xcodebuild destinations failed, trying instruments...', 'warning');
                progress.log(`Error: ${error.message}`, 'error');
            }
        }

        // Fallback: Try instruments if xcodebuild didn't work
        if (physicalDevices.length === 0) {
            try {
                const instrumentsOutput = execSync('instruments -s devices').toString();
                const lines = instrumentsOutput.split('\n');

                for (const line of lines) {
                    // Match physical devices (have UDID but not simulator indicators)
                    const deviceMatch = line.match(/^(.+?)\s+\((\d+\.\d+(?:\.\d+)?)\)\s+\[([A-F0-9-]{36})\](?:\s+\(Simulator\))?$/);

                    if (deviceMatch && !line.includes('(Simulator)')) {
                        const [, name, version, udid] = deviceMatch;
                        physicalDevices.push({
                            name: name.trim(),
                            version: version,
                            udid: udid,
                            type: 'physical'
                        });
                    }
                }
            } catch (error) {
                progress.log('Instruments command also failed, trying devicectl...', 'warning');
            }
        }

        // Last fallback: Try using xcrun devicectl (iOS 17+)
        if (physicalDevices.length === 0) {
            try {
                const devicectlOutput = execSync('xcrun devicectl list devices').toString();
                const lines = devicectlOutput.split('\n');

                for (const line of lines) {
                    // Parse devicectl output format
                    if (line.includes('Connected') && !line.includes('Simulator')) {
                        const udidMatch = line.match(/([A-F0-9-]{36})/);
                        const nameMatch = line.match(/^(.+?)\s+\(/);

                        if (udidMatch && nameMatch) {
                            physicalDevices.push({
                                name: nameMatch[1].trim(),
                                version: 'Unknown',
                                udid: udidMatch[1],
                                type: 'physical'
                            });
                        }
                    }
                }
            } catch (error) {
                progress.log('devicectl command not available or failed', 'warning');
            }
        }

        if (physicalDevices.length > 0) {
            progress.log(`Found ${physicalDevices.length} physical device(s):`, 'success');
            physicalDevices.forEach(device => {
                progress.log(`  📱 ${device.name} (${device.version || 'Unknown iOS'}) - ${device.udid}`, 'info');
            });
            progress.complete('deviceDetection');
            return physicalDevices[0]; // Return first available device
        } else {
            progress.log('No physical devices detected', 'warning');
            progress.complete('deviceDetection');
            return null;
        }

    } catch (error) {
        progress.fail('deviceDetection', error.message);
        return null;
    }
}

async function buildProject(scheme, sdk, destination, bundleId, derivedDataPath, projectName) {
        // Get the booted device info first
        const bootedInfo = await getBootedSimulatorInfo();
        if (!bootedInfo) {
            throw new Error('No booted simulator found');
        }
        // Use specific UDID to avoid multiple device conflicts
        const destinationWithUDID = `platform=iOS Simulator,id=${bootedInfo.udid}`;
        console.log(`Building with destination: ${destinationWithUDID}`);


  const buildCommand = `xcodebuild \
        -scheme "${scheme}" \
        -sdk ${sdk} \
        -configuration Debug \
        -destination "${destinationWithUDID}" \
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
        build`;
  return runCommand(buildCommand, {
    maxBuffer: 1024 * 1024 * 10  });
}

// Physical Device Build Functions
async function buildProjectForPhysicalDevice(scheme, bundleId, derivedDataPath, projectName, device) {
    progress.log(`Building for physical device: ${device.name}`, 'info');
    progress.log('Using Xcode project signing configuration', 'info');
    progress.log(`Overriding bundle ID to: ${bundleId}`, 'info');
    progress.log(`Current directory: ${process.cwd()}`, 'info');
    progress.log(`Looking for .xcodeproj in: ${process.cwd()}`, 'info');

    // Check if we're in the right directory
    const projectPath = `${process.cwd()}/${projectName}.xcodeproj`;
    if (!require('fs').existsSync(projectPath)) {
        throw new Error(`Xcode project not found at: ${projectPath}. Current directory: ${process.cwd()}`);
    }

    // Working build command based on successful test (without extra BUILD_DIR params that might cause issues)
    const buildCommand = `xcodebuild \
        -scheme ${scheme} \
        -sdk iphoneos \
        -configuration Debug \
        -destination platform=iOS,id=${device.udid} \
        PRODUCT_BUNDLE_IDENTIFIER=${bundleId} \
        ONLY_ACTIVE_ARCH=YES \
        build`;

    progress.log('Building with Xcode project signing settings...', 'info');
    progress.log(`Executing command: ${buildCommand}`, 'info');
    return runCommand(buildCommand, { maxBuffer: 1024 * 1024 * 10 });
}

async function findPhysicalDeviceAppPath() {
    const DERIVED_DATA_DIR = path.join(
        process.env.HOME,
        "Library/Developer/Xcode/DerivedData"
    );

    let APP_PATH = "";

    try {
        // Search for app in proper Build/Products directory (not Index.noindex)
        APP_PATH = execSync(
            `find "${DERIVED_DATA_DIR}" -name "${PROJECT_NAME}.app" -path "*/Build/Products/Debug-iphoneos/*" -not -path "*/Index.noindex/*" -type d | head -n 1`
        )
            .toString()
            .trim();
    } catch (error) {
        progress.log('Primary app path search failed for physical device, trying fallback...', 'warning');
    }

    if (!APP_PATH) {
        try {
            // Fallback: search in our custom build directory
            APP_PATH = execSync(
                `find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-Build/Build/Products/Debug-iphoneos/${PROJECT_NAME}.app" -type d | head -n 1`
            )
                .toString()
                .trim();
        } catch (error) {
            progress.log('Fallback app path search also failed', 'warning');
        }
    }

    if (!APP_PATH) {
        throw new Error("No .app file found for physical device. Check if build completed successfully.");
    }

    progress.log(`Found app bundle: ${APP_PATH}`, 'success');
    return APP_PATH;
}

async function installAndLaunchOnPhysicalDevice(APP_PATH, device) {
    progress.start('install');
    try {
        progress.log(`Installing app on physical device: ${device.name}`, 'info');

        // Use xcrun devicectl (working method)
        try {
            await runCommand(`xcrun devicectl device install app --device ${device.udid} "${APP_PATH}"`);
            progress.log('App installed successfully using devicectl', 'success');
        } catch (devicectlError) {
            throw new Error(`devicectl installation failed: ${devicectlError.message}`);
        }

        progress.complete('install');

        progress.start('launch');
        try {
            // Try to launch the app using devicectl
            await runCommand(`xcrun devicectl device process launch --device ${device.udid} "${APP_BUNDLE_ID}"`);
            progress.log('App launched successfully using devicectl', 'success');
        } catch (launchError) {
            progress.log('App installation completed, but launch failed. You can manually launch the app on your device.', 'warning');
            progress.log(`To launch manually, look for the app with bundle ID: ${APP_BUNDLE_ID}`, 'info');
        }

        progress.complete('launch');

    } catch (error) {
        const currentStep = progress.currentStep.id;
        progress.fail(currentStep, error.message);

        progress.printTreeContent('Physical Device Installation Failed', [
            'Installation failed. Common solutions:',
            { text: 'Ensure device is connected and unlocked', indent: 1, prefix: '├─ ', color: 'yellow' },
            { text: 'Trust the development certificate on your device', indent: 1, prefix: '├─ ', color: 'yellow' },
            { text: 'Check that device is in developer mode', indent: 1, prefix: '├─ ', color: 'yellow' },
            { text: 'Verify app bundle is valid', indent: 1, prefix: '└─ ', color: 'yellow' },
            '',
            'Device Details:',
            { text: `Device: ${device.name}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `UDID: ${device.udid}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `App Bundle: ${APP_PATH}`, indent: 1, prefix: '└─ ', color: 'gray' }
        ]);

        throw error;
    }
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

// Separate build function with proper device routing
async function buildForIOS() {
    const originalDir = process.cwd();

    try {
        await generateConfigConstants();
        await copySplashscreenAssets()
        await copyAppIcon()
        progress.log('Changing directory to: ' + PROJECT_DIR, 'info');
        process.chdir(PROJECT_DIR);

        // Force physical device detection (bypass shouldUsePhysicalDevice check)
        const physicalDevice = await detectPhysicalDevices();

        let APP_PATH;
        let targetInfo;

        if (physicalDevice) {
            // Physical device workflow
            progress.log('🔥 Building for physical device workflow', 'success');
            targetInfo = {
                type: 'physical',
                name: physicalDevice.name,
                udid: physicalDevice.udid
            };

            await cleanBuildArtifacts();

            progress.start('build');
            try {
                await buildProjectForPhysicalDevice(
                    SCHEME_NAME,
                    APP_BUNDLE_ID,
                    path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData"),
                    PROJECT_NAME,
                    physicalDevice
                );
                progress.complete('build');
            } catch (error) {
                progress.fail('build', error.message);
                progress.printTreeContent('Physical Device Build Failed', [
                    'Build failed. Please check:',
                    { text: 'Code signing certificates are properly installed', indent: 1, prefix: '├─ ', color: 'yellow' },
                    { text: 'Provisioning profile matches your bundle ID', indent: 1, prefix: '├─ ', color: 'yellow' },
                    { text: 'Device is connected and trusted', indent: 1, prefix: '└─ ', color: 'yellow' }
                ]);
                throw error;
            }

            progress.start('findApp');
            try {
                APP_PATH = await findPhysicalDeviceAppPath();
                progress.log('Found app at: ' + APP_PATH, 'success');
                progress.complete('findApp');
            } catch (error) {
                progress.fail('findApp', error.message);
                throw error;
            }

            await installAndLaunchOnPhysicalDevice(APP_PATH, physicalDevice);

        } else {
            // Simulator workflow (with moveAppToBuildOutput improvement)
            progress.log('📱 Building for simulator workflow', 'info');
            targetInfo = {
                type: 'simulator',
                name: IPHONE_MODEL
            };

            await launchIOSSimulator(IPHONE_MODEL);
            await cleanBuildArtifacts();
            await buildXcodeProject();

            APP_PATH = await findAppPath();
            progress.log('Found app at: ' + APP_PATH, 'success');
            await installAndLaunchApp(APP_PATH);

            // Move app to organized build output directory
            const MOVED_APP_PATH = await moveAppToBuildOutput(APP_PATH);
            APP_PATH = MOVED_APP_PATH;
        }

        progress.printTreeContent('Build Summary', [
            'Build completed successfully:',
            { text: `Target: ${targetInfo.type === 'physical' ? '📱 Physical Device' : '📱 Simulator'}`, indent: 1, prefix: '├─ ', color: 'green' },
            { text: `Device: ${targetInfo.name}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `App Path: ${APP_PATH}`, indent: 1, prefix: '├─ ', color: 'gray' },
            { text: `URL: ${url}`, indent: 1, prefix: '└─ ', color: 'gray' }
        ]);

        return { success: true, targetInfo, appPath: APP_PATH };

    } catch (error) {
        progress.log('Build failed: ' + error.message, 'error');
        throw error;
    } finally {
        process.chdir(originalDir);
    }
}


async function copySplashscreenAssets() {
    try {
        const publicDir = `${process.env.PWD}/public/ios`
        const assetsDir = `${PROJECT_DIR}/${PROJECT_NAME}/Assets.xcassets`

        // Check if splash screen is configured
        if (!WEBVIEW_CONFIG.splashScreen) {
            progress.log("No splash screen configuration found, skipping asset copy", "info")
            return
        }

        // Look for splash screen image in public folder (similar to Android)
        const imageExtensions = ["png", "jpg", "jpeg"]
        let splashImageFound = false

        for (const ext of imageExtensions) {
            const sourcePath = `${publicDir}/splashscreen.${ext}`

            if (fs.existsSync(sourcePath)) {
                // Create launchscreen.imageset directory in Assets.xcassets
                const imagesetDir = `${assetsDir}/launchscreen.imageset`
                if (!fs.existsSync(imagesetDir)) {
                    fs.mkdirSync(imagesetDir, { recursive: true })
                }

                // Copy the image to the imageset with a standard name
                const destinationPath = `${imagesetDir}/launchscreen.${ext}`
                fs.copyFileSync(sourcePath, destinationPath)

                // Create Contents.json for the imageset
                const contentsJson = {
                    images: [
                        {
                            filename: `launchscreen.${ext}`,
                            idiom: "universal",
                            scale: "1x",
                        },
                    ],
                    info: {
                        author: "xcode",
                        version: 1,
                    },
                }

                fs.writeFileSync(`${imagesetDir}/Contents.json`, JSON.stringify(contentsJson, null, 2))

                progress.log(`Created launch screen imageset: launchscreen.${ext}`, "success")
                splashImageFound = true
                break
            }
        }

        if (!splashImageFound) {
            progress.log("No custom splash screen image found in public folder", "info")
            progress.log("Supported formats: splashscreen.png, splashscreen.jpg, splashscreen.jpeg", "info")
        }
    } catch (error) {
        progress.log(`Warning: Error copying splash screen assets: ${error.message}`, "warning")
    }
}

async function copyAppIcon() {
    try {
        const publicDir = `${process.env.PWD}/public/iosIcons`
        const assetsDir = `${PROJECT_DIR}/${PROJECT_NAME}/Assets.xcassets`
        const iconSetDir = `${assetsDir}/AppIcon.appiconset`

        // Check if public directory exists
        if (!fs.existsSync(publicDir)) {
            progress.log("Public directory not found, skipping app icon copy", "info")
            return
        }

        // Define iPhone icon sizes with their configurations
        const iconSizes = [
            { size: "20x20", idiom: "iphone", scale: "2x" },
            { size: "20x20", idiom: "iphone", scale: "3x" },
            { size: "29x29", idiom: "iphone", scale: "2x" },
            { size: "29x29", idiom: "iphone", scale: "3x" },
            { size: "40x40", idiom: "iphone", scale: "2x" },
            { size: "40x40", idiom: "iphone", scale: "3x" },
            { size: "60x60", idiom: "iphone", scale: "2x" },
            { size: "60x60", idiom: "iphone", scale: "3x" },
            { size: "1024x1024", idiom: "ios-marketing", scale: "1x" },
        ]

        const imageExtensions = ["png", "jpg", "jpeg"]

        // Recursively find all image files in a directory
        const findImagesRecursively = (dir, extensions) => {
            let results = []

            try {
                const items = fs.readdirSync(dir)

                for (const item of items) {
                    const fullPath = path.join(dir, item)
                    const stat = fs.statSync(fullPath)

                    if (stat.isDirectory()) {
                        results = results.concat(findImagesRecursively(fullPath, extensions))
                    } else if (stat.isFile()) {
                        const ext = path.extname(item).toLowerCase().slice(1)
                        if (extensions.includes(ext)) {
                            results.push(fullPath)
                        }
                    }
                }
            } catch (err) {
                // Ignore directory read errors
            }

            return results
        }

        // Get all image files from public directory
        const allImages = findImagesRecursively(publicDir, imageExtensions)
        const foundIcons = []

        // Create icon set directory
        if (!fs.existsSync(iconSetDir)) {
            fs.mkdirSync(iconSetDir, { recursive: true })
        }

        // Load existing Contents.json or create new
        const contentsPath = `${iconSetDir}/Contents.json`
        let contents
        if (fs.existsSync(contentsPath)) {
            try {
                contents = JSON.parse(fs.readFileSync(contentsPath, "utf8"))
            } catch {
                contents = null
            }
        }

        if (!contents || !Array.isArray(contents.images)) {
            contents = { images: [], info: { author: "xcode", version: 1 } }
        }

        // Map to track which icons we've added
        const addedIcons = new Set()

        // Search for icons matching the expected sizes
        for (const iconConfig of iconSizes) {
            const { size, idiom, scale } = iconConfig

            // Expected filename pattern: icon-{size}-{scale}
            // Example: icon-20x20-2x.png, icon-60x60-3x.png, icon-1024x1024-1x.png
            const expectedName = `icon-${size}-${scale}`
            let foundImage = null

            // Search for matching file with any supported extension
            for (const ext of imageExtensions) {
                const matchingImage = allImages.find((imgPath) => {
                    const basename = path.basename(imgPath, `.${ext}`)
                    return basename === expectedName
                })

                if (matchingImage) {
                    foundImage = { path: matchingImage, ext }
                    break
                }
            }

            if (foundImage) {
                const filename = `${expectedName}.${foundImage.ext}`
                const destinationPath = `${iconSetDir}/${filename}`

                // Copy the icon
                fs.copyFileSync(foundImage.path, destinationPath)
                foundIcons.push({ size, scale, filename, idiom })

                // Create unique key for this icon entry
                const iconKey = `${size}-${idiom}-${scale}`
                addedIcons.add(iconKey)

                // Remove existing entry with same size/idiom/scale
                contents.images = contents.images.filter(
                    (img) => `${img.size}-${img.idiom}-${img.scale}` !== iconKey
                )

                // Add new entry
                contents.images.push({
                    size,
                    idiom,
                    scale,
                    filename,
                })
            }
        }

        if (foundIcons.length > 0) {
            // Write updated Contents.json
            fs.writeFileSync(contentsPath, JSON.stringify(contents, null, 2))

            progress.log(`Updated AppIcon.appiconset with ${foundIcons.length} icon(s):`, "success")
            foundIcons.forEach((icon) => {
                progress.log(`  • ${icon.size} @${icon.scale} (${icon.idiom})`, "info")
            })
        } else {
            progress.log("No app icon files found in public folder", "info")
            progress.log("Expected naming pattern: icon-{size}-{scale}.{ext}", "info")
            progress.log("Example: icon-20x20-2x.png, icon-60x60-3x.png, icon-1024x1024-1x.png", "info")
        }
    } catch (error) {
        progress.log(`Warning: Error copying app icons: ${error.message}`, "warning")
    }
}

async function main() {
    try {
        progress.log('Starting build process...', 'info');
        await generateConfigConstants()
        await updateInfoPlist()
        await buildForIOS()
        
    } catch (error) {
        progress.log("Build failed: " + error.message, "error")
        process.exit(1)
    }
    process.exit(0);
}

main()
