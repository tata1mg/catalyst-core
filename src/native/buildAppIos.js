const { exec, execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const TerminalProgress = require("./TerminalProgress.js").default

const pwd = `${process.cwd()}/node_modules/catalyst-core/dist/native`
const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = require(`${process.env.PWD}/config/config.json`)

// Configuration constants
const iosConfig = WEBVIEW_CONFIG.ios

const protocol = WEBVIEW_CONFIG.useHttps ? "https" : "http"
const ip = WEBVIEW_CONFIG.LOCAL_IP ?? null
const port = WEBVIEW_CONFIG.port ? (WEBVIEW_CONFIG.useHttps ? 403 : WEBVIEW_CONFIG.port) : null
let url = port ? `${protocol}://${ip}:${port}` : `${protocol}://${ip}`

const PUBLIC_PATH = `${process.env.PWD}/public`
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
    assets: "Process Notification Assets",
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
                        runtime: runtime,
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
async function generatePackageSwift() {
    try {
        const crypto = require("crypto")
        const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false

        progress.log(`🔧 Generating Package.swift (notifications: ${isNotificationsEnabled})`, "info")

        // Create hash of current config to detect changes
        const configHash = crypto
            .createHash("md5")
            .update(JSON.stringify({ notifications: isNotificationsEnabled }))
            .digest("hex")

        const hashFilePath = path.join(PROJECT_DIR, ".package-config-hash")
        const targetPath = path.join(PROJECT_DIR, "Package.swift")
        let shouldUpdate = true

        // Check if we need to update based on config change
        if (fs.existsSync(hashFilePath)) {
            const previousHash = fs.readFileSync(hashFilePath, "utf8")
            if (previousHash === configHash) {
                shouldUpdate = false
                progress.log("Package.swift already up to date", "info")
            }
        }

        // Ensure Package.swift exists even if hash matches
        if (!fs.existsSync(targetPath)) {
            shouldUpdate = true
            progress.log("Package.swift missing, will generate it now", "info")
        }

        if (shouldUpdate) {
            progress.log("Generating Package.swift dynamically", "info")

            // Build the Package.swift content dynamically
            let packageContent = `// swift-tools-version: 5.9
// Auto-generated Package.swift - DO NOT EDIT MANUALLY
// Generated based on config: notifications.enabled = ${isNotificationsEnabled}
import PackageDescription

let package = Package(
    name: "iosnativeWebView",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "CatalystCore", targets: ["CatalystCore"])`

            // Add CatalystNotifications product only if enabled
            if (isNotificationsEnabled) {
                packageContent += `,
        .library(name: "CatalystNotifications", targets: ["CatalystNotifications"])`
            }

            packageContent += `
    ],
    dependencies: [
        .package(url: "https://github.com/kylef/JSONSchema.swift", from: "0.6.0")`

            // Add Firebase dependency only if notifications enabled
            if (isNotificationsEnabled) {
                packageContent += `,
        .package(url: "https://github.com/firebase/firebase-ios-sdk", from: "12.3.0")`
            }

            packageContent += `
    ],
    targets: [
        // Core functionality (WebView, bridge, utils, constants)
        // App-level files (AppDelegate, ContentView) are in iosnativeWebView/ directory
        .target(
            name: "CatalystCore",
            dependencies: [
                .product(name: "JSONSchema", package: "JSONSchema.swift")
            ],
            path: "Sources/Core"
        )`

            // Add CatalystNotifications target only if enabled
            if (isNotificationsEnabled) {
                packageContent += `,
        // Notifications functionality (optional, includes Firebase)
        .target(
            name: "CatalystNotifications",
            dependencies: [
                "CatalystCore",
                .product(name: "FirebaseCore", package: "firebase-ios-sdk"),
                .product(name: "FirebaseMessaging", package: "firebase-ios-sdk")
            ],
            path: "Sources/CatalystNotifications"
        )`
            }

            packageContent += `
    ]
)
`

            // Write the generated Package.swift
            fs.writeFileSync(targetPath, packageContent, "utf8")
            progress.log(
                `Generated Package.swift with ${isNotificationsEnabled ? "notifications enabled" : "notifications disabled"}`,
                "success"
            )

            // Save hash for future comparison
            fs.writeFileSync(hashFilePath, configHash)

            // Force Xcode to re-resolve packages (clean caches to avoid stale pins)
            progress.log("Resolving package dependencies...", "info")
            try {
                // Clear SPM build and resolution caches
                execSync(`cd "${PROJECT_DIR}" && rm -rf .build`, { stdio: "ignore" })
                try {
                    fs.rmSync(path.join(PROJECT_DIR, "Package.resolved"), { force: true })
                } catch {
                    progress.log("")
                }
                execSync(`cd "${PROJECT_DIR}" && rm -rf .swiftpm`, { stdio: "ignore" })

                // Resolve using -project flag to ensure correct project context
                const projectPath = path.join(PROJECT_DIR, `${PROJECT_NAME}.xcodeproj`)
                execSync(
                    `cd "${PROJECT_DIR}" && xcodebuild -resolvePackageDependencies -project "${projectPath}" -scheme "${SCHEME_NAME}"`,
                    {
                        stdio: "inherit",
                    }
                )
                progress.log("Package dependencies resolved successfully", "success")
            } catch (error) {
                // Critical error for notifications-enabled builds
                if (isNotificationsEnabled) {
                    progress.log(
                        `❌ CRITICAL: Package resolution failed. Firebase dependencies required for notifications could not be resolved.`,
                        "error"
                    )
                    throw new Error(
                        `Package resolution failed: ${error.message}. This is required when notifications are enabled.`
                    )
                } else {
                    progress.log(`Warning: Package resolution may have failed: ${error.message}`, "warning")
                }
            }
        }

        progress.log("✅ Package.swift ready", "success")
    } catch (error) {
        progress.log(`❌ Failed to generate Package.swift: ${error.message}`, "error")
        throw error
    }
}

async function updateXcodeProjectPackageDependencies() {
    try {
        const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false
        const projectFilePath = path.join(PROJECT_DIR, `${PROJECT_NAME}.xcodeproj`, "project.pbxproj")

        progress.log(
            `🔧 Updating Xcode package dependencies (notifications: ${isNotificationsEnabled})`,
            "info"
        )

        if (!fs.existsSync(projectFilePath)) {
            throw new Error(`Xcode project file not found at: ${projectFilePath}`)
        }

        let projectContent = fs.readFileSync(projectFilePath, "utf8")

        // Use deterministic IDs for CatalystNotifications entries
        const NOTIF_BUILD_FILE_ID = "C99974352E97D56900C25611"
        const NOTIF_PRODUCT_ID = "C99974362E97D56900C25611"

        // Check if CatalystNotifications is already in the project
        const hasNotifications = projectContent.includes("/* CatalystNotifications */")

        if (isNotificationsEnabled && !hasNotifications) {
            progress.log("Adding CatalystNotifications to Xcode project", "info")

            // 1. Add to PBXBuildFile section (after CatalystCore)
            projectContent = projectContent.replace(
                /(C99974342E97D56900C25611 \/\* CatalystCore in Frameworks \*\/ = {isa = PBXBuildFile; productRef = C99974332E97D56900C25611 \/\* CatalystCore \*\/; };)/,
                `$1\n\t\t${NOTIF_BUILD_FILE_ID} /* CatalystNotifications in Frameworks */ = {isa = PBXBuildFile; productRef = ${NOTIF_PRODUCT_ID} /* CatalystNotifications */; };`
            )

            // 2. Add to PBXFrameworksBuildPhase files array
            projectContent = projectContent.replace(
                /(C99974342E97D56900C25611 \/\* CatalystCore in Frameworks \*\/,)/,
                `$1\n\t\t\t\t${NOTIF_BUILD_FILE_ID} /* CatalystNotifications in Frameworks */,`
            )

            // 3. Add to packageProductDependencies array
            projectContent = projectContent.replace(
                /(packageProductDependencies = \(\s*C99974332E97D56900C25611 \/\* CatalystCore \*\/,)/,
                `$1\n\t\t\t\t${NOTIF_PRODUCT_ID} /* CatalystNotifications */,`
            )

            // 4. Add to XCSwiftPackageProductDependency section
            projectContent = projectContent.replace(
                /(\/\* End XCSwiftPackageProductDependency section \*\/)/,
                `\t\t${NOTIF_PRODUCT_ID} /* CatalystNotifications */ = {\n\t\t\tisa = XCSwiftPackageProductDependency;\n\t\t\tpackage = C99974322E97D56900C25611 /* XCLocalSwiftPackageReference "." */;\n\t\t\tproductName = CatalystNotifications;\n\t\t};\n$1`
            )

            fs.writeFileSync(projectFilePath, projectContent, "utf8")
            progress.log("✅ CatalystNotifications added to Xcode project", "success")
        } else if (!isNotificationsEnabled && hasNotifications) {
            progress.log("Removing CatalystNotifications from Xcode project", "info")

            // Remove all CatalystNotifications entries
            projectContent = projectContent.replace(
                /\t\t[A-F0-9]+ \/\* CatalystNotifications in Frameworks \*\/ = {isa = PBXBuildFile; productRef = [A-F0-9]+ \/\* CatalystNotifications \*\/; };\n/g,
                ""
            )
            projectContent = projectContent.replace(
                /\t\t\t\t[A-F0-9]+ \/\* CatalystNotifications in Frameworks \*\/,\n/g,
                ""
            )
            projectContent = projectContent.replace(
                /\t\t\t\t[A-F0-9]+ \/\* CatalystNotifications \*\/,\n/g,
                ""
            )
            projectContent = projectContent.replace(
                /\t\t[A-F0-9]+ \/\* CatalystNotifications \*\/ = {\n\t\t\tisa = XCSwiftPackageProductDependency;\n\t\t\tpackage = [A-F0-9]+ \/\* XCLocalSwiftPackageReference "." \*\/;\n\t\t\tproductName = CatalystNotifications;\n\t\t};\n/g,
                ""
            )

            fs.writeFileSync(projectFilePath, projectContent, "utf8")
            progress.log("✅ CatalystNotifications removed from Xcode project", "success")
        } else {
            progress.log("Package dependencies already correct", "info")
        }
    } catch (error) {
        progress.log(`❌ Failed to update package dependencies: ${error.message}`, "error")
        throw error
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
function generateSwiftProperty(key, value, indent = "    ") {
    if (value === null || value === undefined) {
        return `${indent}static let ${key}: String? = nil`
    }

    // Special handling for cachePattern - always convert to array
    if (key === "cachePattern") {
        if (typeof value === "string") {
            // Convert single string to array
            return `${indent}static let ${key}: [String] = ["${value}"]`
        } else if (Array.isArray(value)) {
            const arrayValues = value.map((v) => `"${v}"`).join(", ")
            return `${indent}static let ${key}: [String] = [${arrayValues}]`
        }
    }

    if (typeof value === "string") {
        return `${indent}static let ${key} = "${value}"`
    }

    if (typeof value === "number") {
        return Number.isInteger(value)
            ? `${indent}static let ${key} = ${value}`
            : `${indent}static let ${key} = ${value}`
    }

    if (typeof value === "boolean") {
        return `${indent}static let ${key} = ${value}`
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return `${indent}static let ${key}: [String] = []`
        }

        // Determine array type from first element
        const firstElement = value[0]
        if (typeof firstElement === "string") {
            const arrayValues = value.map((v) => `"${v}"`).join(", ")
            return `${indent}static let ${key}: [String] = [${arrayValues}]`
        } else if (typeof firstElement === "number") {
            const arrayType = Number.isInteger(firstElement) ? "Int" : "Double"
            const arrayValues = value.join(", ")
            return `${indent}static let ${key}: [${arrayType}] = [${arrayValues}]`
        } else if (typeof firstElement === "boolean") {
            const arrayValues = value.join(", ")
            return `${indent}static let ${key}: [Bool] = [${arrayValues}]`
        } else {
            // Mixed array - convert to strings
            const arrayValues = value.map((v) => `"${v}"`).join(", ")
            return `${indent}static let ${key}: [String] = [${arrayValues}]`
        }
    }

    if (typeof value === "object" && value !== null) {
        // Generate nested enum for objects
        let nestedContent = `${indent}public enum ${key.charAt(0).toUpperCase() + key.slice(1)} {\n`

        for (const [nestedKey, nestedValue] of Object.entries(value)) {
            nestedContent +=
                "    public " +
                generateSwiftProperty(nestedKey, nestedValue, indent + "    ").trimStart() +
                "\n"
        }

        nestedContent += `${indent}}`
        return nestedContent
    }

    // Fallback to string
    return `${indent}static let ${key} = "${value}"`
}

async function generateConfigConstants() {
    progress.start("config")
    try {
        // Write ConfigConstants to both locations:
        // 1. Sources/Core/Constants - For CatalystCore module to use at compile time
        // 2. iosnativeWebView/ - For app target (both will have identical content)
        const spmConfigPath = path.join(PROJECT_DIR, "Sources/Core/Constants", "ConfigConstants.swift")
        const appConfigPath = path.join(PROJECT_DIR, PROJECT_NAME, "ConfigConstants.swift")

        // Ensure both directories exist
        const spmConfigDir = path.dirname(spmConfigPath)
        if (!fs.existsSync(spmConfigDir)) {
            fs.mkdirSync(spmConfigDir, { recursive: true })
        }

        const appConfigDir = path.dirname(appConfigPath)
        if (!fs.existsSync(appConfigDir)) {
            fs.mkdirSync(appConfigDir, { recursive: true })
        }

        // Initialize base config with required URL
        let configContent = `// This file is auto-generated. Do not edit.
import Foundation

public enum ConfigConstants {
    public static let url = "${url}"`

        // Track keys already added to avoid duplicates
        const addedKeys = new Set()

        // Process all properties from WEBVIEW_CONFIG
        if (WEBVIEW_CONFIG && typeof WEBVIEW_CONFIG === "object") {
            for (const [key, value] of Object.entries(WEBVIEW_CONFIG)) {
                // Skip 'ios' and 'android' keys to avoid duplication
                if (key === "ios" || key === "android") continue

                if (key === "notifications") {
                    progress.log(`Processing notifications config: ${JSON.stringify(value)}`, "info")
                }
                configContent += "\n" + generateSwiftProperty(key, value)
                addedKeys.add(key)
            }
        }

        // Process iOS-specific config
        if (iosConfig && typeof iosConfig === "object") {
            configContent += "\n    \n    // iOS-specific configuration"
            for (const [key, value] of Object.entries(iosConfig)) {
                // Skip if key was already added from WEBVIEW_CONFIG
                if (addedKeys.has(key)) continue

                configContent += "\n" + generateSwiftProperty(key, value)
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

        // Ensure Notifications.enabled always exists (default to false if not configured)
        if (!addedKeys.has("notifications")) {
            progress.log("Notifications not found in config, adding default (false)", "info")
            configContent +=
                "\n    public enum Notifications {\n        public static let enabled = false\n    }"
            addedKeys.add("notifications")
        } else {
            progress.log("Notifications config was processed from WEBVIEW_CONFIG", "info")
        }

        // Close the enum
        configContent += `
}`

        // Write to both locations (keeps them in sync)
        fs.writeFileSync(spmConfigPath, configContent, "utf8")
        fs.writeFileSync(appConfigPath, configContent, "utf8")
        progress.log("Configuration constants generated successfully (CatalystCore + App)", "success")
        progress.complete("config")
    } catch (error) {
        progress.fail("config", error.message)
        process.exit(1)
    }
}
// MARK: - Notification Asset Processing

// Notification asset definitions
const NOTIFICATION_ICONS = [
    { sourceName: "notification-icon", resourceName: "NotificationIcon" },
    { sourceName: "notification-large", resourceName: "NotificationLargeIcon" },
]

const NOTIFICATION_SOUNDS = [
    { sourceName: "notification-sound-default", resourceName: "notification_sound_default" },
    { sourceName: "notification-sound-urgent", resourceName: "notification_sound_urgent" },
]

async function handleGoogleServicesPlist() {
    try {
        const rootGoogleServicesPath = `${process.env.PWD}/GoogleService-Info.plist`
        const iosGoogleServicesPath = `${PROJECT_DIR}/${PROJECT_NAME}/GoogleService-Info.plist`

        // Check if GoogleService-Info.plist exists in the root directory
        if (fs.existsSync(rootGoogleServicesPath)) {
            progress.log("Found GoogleService-Info.plist in root directory", "info")

            // Create the directory if it doesn't exist
            const targetDir = path.dirname(iosGoogleServicesPath)
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true })
            }

            // Copy the file to the iOS project
            fs.copyFileSync(rootGoogleServicesPath, iosGoogleServicesPath)
            progress.log("Copied GoogleService-Info.plist to iOS project", "success")

            return true
        } else if (fs.existsSync(iosGoogleServicesPath)) {
            progress.log("GoogleService-Info.plist already exists in iOS project", "info")
            return true
        } else {
            progress.log(
                "GoogleService-Info.plist not found - Firebase push notifications will not work",
                "warning"
            )
            progress.log(
                "Place GoogleService-Info.plist in project root or src/native/iosnativeWebView/iosnativeWebView/",
                "info"
            )
            return false
        }
    } catch (error) {
        // Critical error if file exists but can't be copied
        const rootGoogleServicesPath = `${process.env.PWD}/GoogleService-Info.plist`
        if (error.code === "EACCES" && fs.existsSync(rootGoogleServicesPath)) {
            throw new Error(`Permission denied copying GoogleService-Info.plist: ${error.message}`)
        }
        progress.log(`Warning: Error handling GoogleService-Info.plist: ${error.message}`, "warning")
        return false
    }
}

async function validateNotificationAsset(filePath, assetType) {
    const stats = fs.statSync(filePath)
    const fileSizeKB = stats.size / 1024

    if (assetType === "icon") {
        // Warn if icon is too large (recommended <100KB)
        if (fileSizeKB > 100) {
            progress.log(
                `Warning: Notification icon ${path.basename(filePath)} is ${fileSizeKB.toFixed(1)}KB (recommended <100KB for optimal performance)`,
                "warning"
            )
        }
    } else if (assetType === "sound") {
        // Warn if sound is too large (recommended <1MB)
        if (fileSizeKB > 1024) {
            progress.log(
                `Warning: Notification sound ${path.basename(filePath)} is ${fileSizeKB.toFixed(1)}KB (recommended <1MB)`,
                "warning"
            )
        }
    }
}

async function processNotificationIcons() {
    try {
        const assetsPath = `${PROJECT_DIR}/${PROJECT_NAME}/Assets.xcassets`
        const imageFormats = ["png", "jpg", "jpeg", "webp"]

        let iconsProcessed = 0

        // Ensure public directory exists
        if (!fs.existsSync(PUBLIC_PATH)) {
            progress.log(`Public directory not found at ${PUBLIC_PATH}`, "info")
            return 0
        }

        // Create Assets.xcassets if it doesn't exist
        if (!fs.existsSync(assetsPath)) {
            fs.mkdirSync(assetsPath, { recursive: true })
        }

        // Remove existing notification icon imagesets to avoid conflicts when assets are updated
        for (const icon of NOTIFICATION_ICONS) {
            const imagesetPath = `${assetsPath}/${icon.resourceName}.imageset`
            if (fs.existsSync(imagesetPath)) {
                fs.rmSync(imagesetPath, { recursive: true, force: true })
                progress.log(`Removed existing ${icon.resourceName}.imageset`, "info")
            }
        }

        // Process notification icons
        for (const icon of NOTIFICATION_ICONS) {
            for (const format of imageFormats) {
                const iconImagePath = `${PUBLIC_PATH}/${icon.sourceName}.${format}`
                if (fs.existsSync(iconImagePath)) {
                    // Validate asset size
                    validateNotificationAsset(iconImagePath, "icon")

                    // Create imageset directory
                    const imagesetPath = `${assetsPath}/${icon.resourceName}.imageset`
                    if (!fs.existsSync(imagesetPath)) {
                        fs.mkdirSync(imagesetPath, { recursive: true })
                    }

                    // Copy icon
                    const destImagePath = `${imagesetPath}/${icon.sourceName}.${format}`
                    fs.copyFileSync(iconImagePath, destImagePath)

                    // Create Contents.json for the imageset
                    const contentsJson = {
                        images: [
                            {
                                filename: `${icon.sourceName}.${format}`,
                                idiom: "universal",
                                scale: "1x",
                            },
                            {
                                idiom: "universal",
                                scale: "2x",
                            },
                            {
                                idiom: "universal",
                                scale: "3x",
                            },
                        ],
                        info: {
                            author: "xcode",
                            version: 1,
                        },
                    }

                    fs.writeFileSync(`${imagesetPath}/Contents.json`, JSON.stringify(contentsJson, null, 2))

                    progress.log(
                        `Notification icon copied: ${icon.sourceName}.${format} -> ${icon.resourceName}`,
                        "success"
                    )
                    iconsProcessed++
                    break
                }
            }
        }

        if (iconsProcessed > 0) {
            progress.log(`Processed ${iconsProcessed} notification icon(s) from public/`, "success")
        } else {
            progress.log("No notification icons found in public/ - using default bell icon", "info")
        }

        return iconsProcessed
    } catch (error) {
        // Distinguish between critical and non-critical errors
        if (error.code === "EACCES") {
            throw new Error(
                `Permission denied accessing notification icons: ${error.message}. Check directory permissions.`
            )
        } else if (error.code === "ENOSPC") {
            throw new Error(`Insufficient disk space to process notification icons: ${error.message}`)
        } else {
            progress.log(`Warning: Could not process notification icons: ${error.message}`, "warning")
            return 0
        }
    }
}

async function processNotificationSounds() {
    try {
        const bundlePath = `${PROJECT_DIR}/${PROJECT_NAME}`
        const audioFormats = ["mp3", "wav", "m4a", "caf"]

        let soundsProcessed = 0

        // Ensure public directory exists
        if (!fs.existsSync(PUBLIC_PATH)) {
            progress.log(`Public directory not found at ${PUBLIC_PATH}`, "info")
            return 0
        }

        // Remove existing notification sounds to avoid conflicts
        for (const sound of NOTIFICATION_SOUNDS) {
            for (const format of audioFormats) {
                const existingSoundPath = `${bundlePath}/${sound.resourceName}.${format}`
                if (fs.existsSync(existingSoundPath)) {
                    fs.unlinkSync(existingSoundPath)
                    progress.log(`Removed existing ${sound.resourceName}.${format}`, "info")
                }
            }
        }

        // Process notification sounds
        for (const sound of NOTIFICATION_SOUNDS) {
            for (const format of audioFormats) {
                const soundPath = `${PUBLIC_PATH}/${sound.sourceName}.${format}`
                if (fs.existsSync(soundPath)) {
                    // Validate asset size
                    validateNotificationAsset(soundPath, "sound")

                    const destSoundPath = `${bundlePath}/${sound.resourceName}.${format}`
                    fs.copyFileSync(soundPath, destSoundPath)
                    progress.log(
                        `Notification sound copied: ${sound.sourceName}.${format} -> ${sound.resourceName}.${format}`,
                        "success"
                    )
                    soundsProcessed++
                    break
                }
            }
        }

        if (soundsProcessed > 0) {
            progress.log(`Processed ${soundsProcessed} notification sound(s) from public/`, "success")
        } else {
            progress.log("No notification sounds found in public/ - using system default sounds", "info")
        }

        return soundsProcessed
    } catch (error) {
        // Distinguish between critical and non-critical errors
        if (error.code === "EACCES") {
            throw new Error(
                `Permission denied accessing notification sounds: ${error.message}. Check directory permissions.`
            )
        } else if (error.code === "ENOSPC") {
            throw new Error(`Insufficient disk space to process notification sounds: ${error.message}`)
        } else {
            progress.log(`Warning: Could not process notification sounds: ${error.message}`, "warning")
            return 0
        }
    }
}

async function cleanupNotificationAssets() {
    try {
        const assetsPath = `${PROJECT_DIR}/${PROJECT_NAME}/Assets.xcassets`
        const bundlePath = `${PROJECT_DIR}/${PROJECT_NAME}`
        const audioFormats = ["mp3", "wav", "m4a", "caf"]

        // Remove existing notification icon imagesets
        for (const icon of NOTIFICATION_ICONS) {
            const imagesetPath = `${assetsPath}/${icon.resourceName}.imageset`
            if (fs.existsSync(imagesetPath)) {
                fs.rmSync(imagesetPath, { recursive: true, force: true })
                progress.log(`Removed ${icon.resourceName}.imageset`, "info")
            }
        }

        // Remove existing notification sounds
        for (const sound of NOTIFICATION_SOUNDS) {
            for (const format of audioFormats) {
                const soundPath = `${bundlePath}/${sound.resourceName}.${format}`
                if (fs.existsSync(soundPath)) {
                    fs.unlinkSync(soundPath)
                    progress.log(`Removed ${sound.resourceName}.${format}`, "info")
                }
            }
        }

        // Remove GoogleService-Info.plist when notifications are disabled
        // NOTE: Commented out - GoogleService-Info.plist is managed in Xcode project
        // const iosGoogleServicesPath = `${bundlePath}/GoogleService-Info.plist`
        // if (fs.existsSync(iosGoogleServicesPath)) {
        //     fs.unlinkSync(iosGoogleServicesPath)
        //     progress.log("Removed GoogleService-Info.plist from iOS project", "info")
        // }

        progress.log("Cleaned up notification assets", "success")
    } catch (error) {
        progress.log(`Warning: Error cleaning notification assets: ${error.message}`, "warning")
    }
}

async function processNotificationAssets(webviewConfig) {
    const hasNotificationConfig = !!webviewConfig.notifications?.enabled

    try {
        // Always clean up notification assets first
        await cleanupNotificationAssets()

        if (!hasNotificationConfig) {
            progress.log("Notifications disabled - skipped asset processing", "info")
            return
        }

        // Handle GoogleService-Info.plist file for Firebase
        const hasGoogleServices = await handleGoogleServicesPlist()
        if (!hasGoogleServices) {
            progress.log("Continuing without Firebase - only local notifications will work", "warning")
        }

        // Process notification assets
        const iconsProcessed = await processNotificationIcons()
        const soundsProcessed = await processNotificationSounds()

        const totalAssets = iconsProcessed + soundsProcessed
        if (totalAssets > 0) {
            progress.log(
                `Notification asset processing completed: ${totalAssets} asset(s) processed`,
                "success"
            )
        } else {
            progress.log("No notification assets found - using system defaults", "info")
        }
    } catch (error) {
        progress.log(`Warning: Error processing notifications: ${error.message}`, "warning")
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
                prefix: "â”œâ”€ ",
                color: "yellow",
            },
            {
                text: "Check if Xcode is properly installed and updated",
                indent: 1,
                prefix: "â”œâ”€ ",
                color: "yellow",
            },
            { text: "Verify selected simulator exists", indent: 1, prefix: "â””â”€ ", color: "yellow" },
            "\nVerify Configuration:",
            { text: `Selected Simulator: ${IPHONE_MODEL}`, indent: 1, prefix: "â”œâ”€ ", color: "gray" },
            { text: `Server URL: ${url}`, indent: 1, prefix: "â””â”€ ", color: "gray" },
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
    progress.start("deviceDetection")
    try {
        progress.log("Scanning for connected physical devices...", "info")

        let physicalDevices = []

        // Simple method: Look for your known device UDID directly
        const KNOWN_DEVICE_UDID = "00008020-0012791A1E33002E"

        // First check if we can detect the known working device
        try {
            const instrumentsOutput = execSync("instruments -s devices").toString()
            progress.log("Checking instruments output for known device...", "info")

            if (instrumentsOutput.includes(KNOWN_DEVICE_UDID)) {
                // Extract device name from instruments output
                const deviceLine = instrumentsOutput
                    .split("\n")
                    .find((line) => line.includes(KNOWN_DEVICE_UDID))
                if (deviceLine) {
                    const nameMatch = deviceLine.match(/^(.+?)\s+\(/)
                    const deviceName = nameMatch ? nameMatch[1].trim() : "Physical Device"

                    progress.log(`âœ… Found known physical device: ${deviceName}`, "success")
                    physicalDevices.push({
                        name: deviceName,
                        version: "Unknown",
                        udid: KNOWN_DEVICE_UDID,
                        type: "physical",
                    })
                }
            }
        } catch (error) {
            progress.log("instruments command failed, trying xcodebuild...", "warning")
        }

        // Fallback: Use xcodebuild to get available destinations
        if (physicalDevices.length === 0) {
            try {
                const xcodebuildOutput = execSync(
                    `xcodebuild -scheme "${SCHEME_NAME}" -showdestinations`
                ).toString()
                const lines = xcodebuildOutput.split("\n")

                progress.log("Scanning xcodebuild destinations for physical devices...", "info")

                for (const line of lines) {
                    // Look for physical iOS devices in xcodebuild output
                    const physicalMatch = line.match(
                        /\{\s*platform:iOS,\s*arch:(\w+),\s*id:([A-F0-9-]+),\s*name:(.+?)\s*\}/
                    )

                    if (physicalMatch) {
                        const [, arch, udid, name] = physicalMatch
                        progress.log(`Found device candidate: ${name.trim()} - ${udid}`, "info")

                        // Filter out placeholder devices
                        if (!udid.includes("placeholder") && udid.length > 20) {
                            progress.log(`âœ… Valid physical device: ${name.trim()}`, "success")
                            physicalDevices.push({
                                name: name.trim(),
                                version: "Unknown",
                                udid: udid,
                                arch: arch,
                                type: "physical",
                            })
                        } else {
                            progress.log(`âŒ Skipping placeholder: ${name.trim()}`, "warning")
                        }
                    }
                }
            } catch (error) {
                progress.log("xcodebuild destinations failed, trying instruments...", "warning")
                progress.log(`Error: ${error.message}`, "error")
            }
        }

        // Fallback: Try instruments if xcodebuild didn't work
        if (physicalDevices.length === 0) {
            try {
                const instrumentsOutput = execSync("instruments -s devices").toString()
                const lines = instrumentsOutput.split("\n")

                for (const line of lines) {
                    // Match physical devices (have UDID but not simulator indicators)
                    const deviceMatch = line.match(
                        /^(.+?)\s+\((\d+\.\d+(?:\.\d+)?)\)\s+\[([A-F0-9-]{36})\](?:\s+\(Simulator\))?$/
                    )

                    if (deviceMatch && !line.includes("(Simulator)")) {
                        const [, name, version, udid] = deviceMatch
                        physicalDevices.push({
                            name: name.trim(),
                            version: version,
                            udid: udid,
                            type: "physical",
                        })
                    }
                }
            } catch (error) {
                progress.log("Instruments command also failed, trying devicectl...", "warning")
            }
        }

        // Last fallback: Try using xcrun devicectl (iOS 17+)
        if (physicalDevices.length === 0) {
            try {
                const devicectlOutput = execSync("xcrun devicectl list devices").toString()
                const lines = devicectlOutput.split("\n")

                for (const line of lines) {
                    // Parse devicectl output format
                    if (line.includes("Connected") && !line.includes("Simulator")) {
                        const udidMatch = line.match(/([A-F0-9-]{36})/)
                        const nameMatch = line.match(/^(.+?)\s+\(/)

                        if (udidMatch && nameMatch) {
                            physicalDevices.push({
                                name: nameMatch[1].trim(),
                                version: "Unknown",
                                udid: udidMatch[1],
                                type: "physical",
                            })
                        }
                    }
                }
            } catch (error) {
                progress.log("devicectl command not available or failed", "warning")
            }
        }

        if (physicalDevices.length > 0) {
            progress.log(`Found ${physicalDevices.length} physical device(s):`, "success")
            physicalDevices.forEach((device) => {
                progress.log(
                    `  ðŸ“± ${device.name} (${device.version || "Unknown iOS"}) - ${device.udid}`,
                    "info"
                )
            })
            progress.complete("deviceDetection")
            return physicalDevices[0] // Return first available device
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

async function buildProject(scheme, sdk, destination, bundleId, derivedDataPath, projectName) {
    // Get the booted device info first
    const bootedInfo = await getBootedSimulatorInfo()
    if (!bootedInfo) {
        throw new Error("No booted simulator found")
    }
    // Use specific UDID to avoid multiple device conflicts
    const destinationWithUDID = `platform=iOS Simulator,id=${bootedInfo.udid}`
    console.log(`Building with destination: ${destinationWithUDID}`)

    // Notifications are controlled via Package.swift - canImport() detects availability
    const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false

    if (isNotificationsEnabled) {
        progress.log("Building with notifications enabled (CatalystNotifications module included)", "info")
    } else {
        progress.log("Building without notifications (Firebase excluded)", "info")
    }

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
        build`
    return runCommand(buildCommand, {
        maxBuffer: 1024 * 1024 * 10,
    })
}

// Physical Device Build Functions
async function buildProjectForPhysicalDevice(scheme, bundleId, derivedDataPath, projectName, device) {
    progress.log(`Building for physical device: ${device.name}`, "info")
    progress.log("Using Xcode project signing configuration", "info")
    progress.log(`Overriding bundle ID to: ${bundleId}`, "info")
    progress.log(`Current directory: ${process.cwd()}`, "info")
    progress.log(`Looking for .xcodeproj in: ${process.cwd()}`, "info")

    // Check if we're in the right directory
    const projectPath = `${process.cwd()}/${projectName}.xcodeproj`
    if (!require("fs").existsSync(projectPath)) {
        throw new Error(`Xcode project not found at: ${projectPath}. Current directory: ${process.cwd()}`)
    }

    // Notifications are controlled via Package.swift - canImport() detects availability
    const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false

    if (isNotificationsEnabled) {
        progress.log("Building with notifications enabled (CatalystNotifications module included)", "info")
    } else {
        progress.log("Building without notifications (Firebase excluded)", "info")
    }

    // Working build command based on successful test (without extra BUILD_DIR params that might cause issues)
    const buildCommand = `xcodebuild \
        -scheme ${scheme} \
        -sdk iphoneos \
        -configuration Debug \
        -destination platform=iOS,id=${device.udid} \
        PRODUCT_BUNDLE_IDENTIFIER=${bundleId} \
        ONLY_ACTIVE_ARCH=YES \
        build`

    progress.log("Building with Xcode project signing settings...", "info")
    progress.log(`Executing command: ${buildCommand}`, "info")
    return runCommand(buildCommand, { maxBuffer: 1024 * 1024 * 10 })
}

async function findPhysicalDeviceAppPath() {
    const DERIVED_DATA_DIR = path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData")

    let APP_PATH = ""

    try {
        // Search for app in proper Build/Products directory (not Index.noindex)
        APP_PATH = execSync(
            `find "${DERIVED_DATA_DIR}" -name "${PROJECT_NAME}.app" -path "*/Build/Products/Debug-iphoneos/*" -not -path "*/Index.noindex/*" -type d | head -n 1`
        )
            .toString()
            .trim()
    } catch (error) {
        progress.log("Primary app path search failed for physical device, trying fallback...", "warning")
    }

    if (!APP_PATH) {
        try {
            // Fallback: search in our custom build directory
            APP_PATH = execSync(
                `find "${DERIVED_DATA_DIR}" -path "*${PROJECT_NAME}-Build/Build/Products/Debug-iphoneos/${PROJECT_NAME}.app" -type d | head -n 1`
            )
                .toString()
                .trim()
        } catch (error) {
            progress.log("Fallback app path search also failed", "warning")
        }
    }

    if (!APP_PATH) {
        throw new Error("No .app file found for physical device. Check if build completed successfully.")
    }

    progress.log(`Found app bundle: ${APP_PATH}`, "success")
    return APP_PATH
}

async function installAndLaunchOnPhysicalDevice(APP_PATH, device) {
    progress.start("install")
    try {
        progress.log(`Installing app on physical device: ${device.name}`, "info")

        // Use xcrun devicectl (working method)
        try {
            await runCommand(`xcrun devicectl device install app --device ${device.udid} "${APP_PATH}"`)
            progress.log("App installed successfully using devicectl", "success")
        } catch (devicectlError) {
            throw new Error(`devicectl installation failed: ${devicectlError.message}`)
        }

        progress.complete("install")

        progress.start("launch")
        try {
            // Try to launch the app using devicectl
            await runCommand(
                `xcrun devicectl device process launch --device ${device.udid} "${APP_BUNDLE_ID}"`
            )
            progress.log("App launched successfully using devicectl", "success")
        } catch (launchError) {
            progress.log(
                "App installation completed, but launch failed. You can manually launch the app on your device.",
                "warning"
            )
            progress.log(`To launch manually, look for the app with bundle ID: ${APP_BUNDLE_ID}`, "info")
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
                prefix: "â”œâ”€ ",
                color: "yellow",
            },
            {
                text: "Trust the development certificate on your device",
                indent: 1,
                prefix: "â”œâ”€ ",
                color: "yellow",
            },
            { text: "Check that device is in developer mode", indent: 1, prefix: "â”œâ”€ ", color: "yellow" },
            { text: "Verify app bundle is valid", indent: 1, prefix: "â””â”€ ", color: "yellow" },
            "",
            "Device Details:",
            { text: `Device: ${device.name}`, indent: 1, prefix: "â”œâ”€ ", color: "gray" },
            { text: `UDID: ${device.udid}`, indent: 1, prefix: "â”œâ”€ ", color: "gray" },
            { text: `App Bundle: ${APP_PATH}`, indent: 1, prefix: "â””â”€ ", color: "gray" },
        ])

        throw error
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
            {
                text: "Delete and recreate the simulator in Xcode",
                indent: 1,
                prefix: "â”œâ”€ ",
                color: "yellow",
            },
            {
                text: "Reset simulator content: Device > Erase All Content and Settings",
                indent: 1,
                prefix: "â”œâ”€ ",
                color: "yellow",
            },
            {
                text: "Check available simulators: xcrun simctl list devices",
                indent: 1,
                prefix: "â”œâ”€ ",
                color: "yellow",
            },
            { text: "Restart Xcode and Simulator app", indent: 1, prefix: "â””â”€ ", color: "yellow" },
            "",
            "Error Details:",
            { text: `Simulator: ${simulatorName}`, indent: 1, prefix: "â”œâ”€ ", color: "gray" },
            { text: `Error: ${error.message}`, indent: 1, prefix: "â””â”€ ", color: "red" },
        ])

        console.error("Failed to launch iOS Simulator. Error:", error.message)
        process.exit(1)
    }
}

// Separate build function with proper device routing
async function buildForIOS() {
    const originalDir = process.cwd()

    try {
        // Generate Package.swift first (before config, so package resolution happens early)
        await generatePackageSwift()
        await updateXcodeProjectPackageDependencies()
        await generateConfigConstants()

        // Process notification assets
        progress.start("assets")
        await processNotificationAssets(WEBVIEW_CONFIG)
        progress.complete("assets")

        progress.log("Changing directory to: " + PROJECT_DIR, "info")
        process.chdir(PROJECT_DIR)

        // Force physical device detection (bypass shouldUsePhysicalDevice check)
        const physicalDevice = await detectPhysicalDevices()

        let APP_PATH
        let targetInfo

        if (physicalDevice) {
            // Physical device workflow
            progress.log("ðŸ”¥ Building for physical device workflow", "success")
            targetInfo = {
                type: "physical",
                name: physicalDevice.name,
                udid: physicalDevice.udid,
            }

            await cleanBuildArtifacts()

            progress.start("build")
            try {
                await buildProjectForPhysicalDevice(
                    SCHEME_NAME,
                    APP_BUNDLE_ID,
                    path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData"),
                    PROJECT_NAME,
                    physicalDevice
                )
                progress.complete("build")
            } catch (error) {
                progress.fail("build", error.message)
                progress.printTreeContent("Physical Device Build Failed", [
                    "Build failed. Please check:",
                    {
                        text: "Code signing certificates are properly installed",
                        indent: 1,
                        prefix: "â”œâ”€ ",
                        color: "yellow",
                    },
                    {
                        text: "Provisioning profile matches your bundle ID",
                        indent: 1,
                        prefix: "â”œâ”€ ",
                        color: "yellow",
                    },
                    {
                        text: "Device is connected and trusted",
                        indent: 1,
                        prefix: "â””â”€ ",
                        color: "yellow",
                    },
                ])
                throw error
            }

            progress.start("findApp")
            try {
                APP_PATH = await findPhysicalDeviceAppPath()
                progress.log("Found app at: " + APP_PATH, "success")
                progress.complete("findApp")
            } catch (error) {
                progress.fail("findApp", error.message)
                throw error
            }

            await installAndLaunchOnPhysicalDevice(APP_PATH, physicalDevice)
        } else {
            // Simulator workflow (with moveAppToBuildOutput improvement)
            progress.log("ðŸ“± Building for simulator workflow", "info")
            targetInfo = {
                type: "simulator",
                name: IPHONE_MODEL,
            }

            await launchIOSSimulator(IPHONE_MODEL)
            await cleanBuildArtifacts()
            await buildXcodeProject()

            APP_PATH = await findAppPath()
            progress.log("Found app at: " + APP_PATH, "success")
            await installAndLaunchApp(APP_PATH)

            // Move app to organized build output directory
            const MOVED_APP_PATH = await moveAppToBuildOutput(APP_PATH)
            APP_PATH = MOVED_APP_PATH
        }

        progress.printTreeContent("Build Summary", [
            "Build completed successfully:",
            {
                text: `Target: ${targetInfo.type === "physical" ? "ðŸ“± Physical Device" : "ðŸ“± Simulator"}`,
                indent: 1,
                prefix: "â”œâ”€ ",
                color: "green",
            },
            { text: `Device: ${targetInfo.name}`, indent: 1, prefix: "â”œâ”€ ", color: "gray" },
            { text: `App Path: ${APP_PATH}`, indent: 1, prefix: "â”œâ”€ ", color: "gray" },
            { text: `URL: ${url}`, indent: 1, prefix: "â””â”€ ", color: "gray" },
        ])

        return { success: true, targetInfo, appPath: APP_PATH }
    } catch (error) {
        progress.log("Build failed: " + error.message, "error")
        throw error
    } finally {
        process.chdir(originalDir)
    }
}

async function main() {
    try {
        progress.log("Starting build process...", "info")
        await generateConfigConstants()
        await updateInfoPlist()
        await buildForIOS()
    } catch (error) {
        progress.log("Build failed: " + error.message, "error")
        process.exit(1)
    }
    process.exit(0)
}

main()
