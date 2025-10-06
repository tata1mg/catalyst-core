const { exec, execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const TerminalProgress = require("./TerminalProgress.js").default

const pwd = `${process.cwd()}/node_modules/catalyst-core/dist/native`
const publicPath = `${process.env.PWD}/public`
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

async function generateConfigConstants() {
    progress.start("config")
    try {
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

// async function handleGoogleServicesPlist() {
//     try {
//         const rootGoogleServicesPath = `${process.env.PWD}/GoogleService-Info.plist`
//         const iosGoogleServicesPath = `${PROJECT_DIR}/${PROJECT_NAME}/GoogleService-Info.plist`

//         // Check if GoogleService-Info.plist exists in the root directory
//         if (fs.existsSync(rootGoogleServicesPath)) {
//             progress.log("Found GoogleService-Info.plist in root directory", "info")

//             // Create the directory if it doesn't exist
//             const targetDir = path.dirname(iosGoogleServicesPath)
//             if (!fs.existsSync(targetDir)) {
//                 fs.mkdirSync(targetDir, { recursive: true })
//             }

//             // Copy the file to the iOS project
//             fs.copyFileSync(rootGoogleServicesPath, iosGoogleServicesPath)
//             progress.log("Copied GoogleService-Info.plist to iOS project", "success")

//             return true
//         } else if (fs.existsSync(iosGoogleServicesPath)) {
//             progress.log("GoogleService-Info.plist already exists in iOS project", "info")
//             return true
//         } else {
//             progress.log(
//                 "GoogleService-Info.plist not found - Firebase push notifications will not work",
//                 "warning"
//             )
//             progress.log(
//                 "Place GoogleService-Info.plist in project root or src/native/iosnativeWebView/iosnativeWebView/",
//                 "info"
//             )
//             return false
//         }
//     } catch (error) {
//         // Critical error if file exists but can't be copied
//         if (error.code === "EACCES" && fs.existsSync(rootGoogleServicesPath)) {
//             throw new Error(`Permission denied copying GoogleService-Info.plist: ${error.message}`)
//         }
//         progress.log(`Warning: Error handling GoogleService-Info.plist: ${error.message}`, "warning")
//         return false
//     }
// }

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
        if (!fs.existsSync(publicPath)) {
            progress.log(`Public directory not found at ${publicPath}`, "info")
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
                const iconImagePath = `${publicPath}/${icon.sourceName}.${format}`
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
        if (!fs.existsSync(publicPath)) {
            progress.log(`Public directory not found at ${publicPath}`, "info")
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
                const soundPath = `${publicPath}/${sound.sourceName}.${format}`
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
        const iosGoogleServicesPath = `${bundlePath}/GoogleService-Info.plist`
        if (fs.existsSync(iosGoogleServicesPath)) {
            fs.unlinkSync(iosGoogleServicesPath)
            progress.log("Removed GoogleService-Info.plist from iOS project", "info")
        }

        progress.log("Cleaned up notification assets", "success")
    } catch (error) {
        progress.log(`Warning: Error cleaning notification assets: ${error.message}`, "warning")
    }
}

// async function addGoogleServicesCopyScript(isEnabled) {
//     const projectPath = `${PROJECT_DIR}/${PROJECT_NAME}.xcodeproj/project.pbxproj`

//     try {
//         let projectContent = fs.readFileSync(projectPath, "utf8")
//         const originalContent = projectContent

//         // Marker comment to identify our script
//         const scriptMarker = "Copy GoogleService-Info.plist to bundle"

//         if (isEnabled) {
//             // Check if script already exists
//             if (projectContent.includes(scriptMarker)) {
//                 progress.log("GoogleService-Info.plist copy script already configured", "info")
//                 return
//             }

//             progress.log("Adding Run Script to copy GoogleService-Info.plist to bundle...", "info")

//             // Generate UUIDs for the build phase (96 hex chars like Xcode)
//             const generateUUID = () => {
//                 return Array.from({ length: 24 }, () =>
//                     Math.floor(Math.random() * 16)
//                         .toString(16)
//                         .toUpperCase()
//                 ).join("")
//             }

//             const scriptPhaseUUID = generateUUID()

//             // The shell script to copy GoogleService-Info.plist
//             const shellScript = `# ${scriptMarker}
// PLIST_PATH="$PROJECT_DIR/$PROJECT_NAME/GoogleService-Info.plist"
// if [ -f "$PLIST_PATH" ]; then
//   cp "$PLIST_PATH" "$\{BUILT_PRODUCTS_DIR\}/$\{PRODUCT_NAME\}.app/"
//   echo "Copied GoogleService-Info.plist to app bundle"
// else
//   echo "Warning: GoogleService-Info.plist not found at $PLIST_PATH"
// fi`

//             // Create the PBXShellScriptBuildPhase section entry
//             const scriptPhaseEntry = `\t\t${scriptPhaseUUID} /* ShellScript */ = {
// \t\t\tisa = PBXShellScriptBuildPhase;
// \t\t\tbuildActionMask = 2147483647;
// \t\t\tfiles = (
// \t\t\t);
// \t\t\tinputFileListPaths = (
// \t\t\t);
// \t\t\tinputPaths = (
// \t\t\t);
// \t\t\tname = "Copy GoogleService-Info.plist";
// \t\t\toutputFileListPaths = (
// \t\t\t);
// \t\t\toutputPaths = (
// \t\t\t);
// \t\t\trunOnlyForDeploymentPostprocessing = 0;
// \t\t\tshellPath = /bin/sh;
// \t\t\tshellScript = "${shellScript.replace(/\n/g, "\\n").replace(/"/g, '\\"')}";
// \t\t};`

//             // Find the main target's buildPhases array
//             const targetBuildPhasesRegex =
//                 /buildPhases = \(\n(\t\t\t\t[A-F0-9]+ \/\* Sources \*\/,\n)(\t\t\t\t[A-F0-9]+ \/\* Frameworks \*\/,\n)(\t\t\t\t[A-F0-9]+ \/\* Resources \*\/,\n)/

//             const match = projectContent.match(targetBuildPhasesRegex)
//             if (!match) {
//                 throw new Error("Could not find main target buildPhases array in project.pbxproj")
//             }

//             // Insert the script phase UUID before Resources phase
//             const updatedBuildPhases = `buildPhases = (\n${match[1]}${match[2]}\t\t\t\t${scriptPhaseUUID} /* ShellScript */,\n${match[3]}`
//             projectContent = projectContent.replace(targetBuildPhasesRegex, updatedBuildPhases)

//             // Add the script phase entry to the PBXShellScriptBuildPhase section
//             // Find where to insert it - look for the end of PBXResourcesBuildPhase section
//             const shellScriptSectionRegex = /\/\* End PBXShellScriptBuildPhase section \*\//
//             if (shellScriptSectionRegex.test(projectContent)) {
//                 // Section exists, add to it
//                 projectContent = projectContent.replace(
//                     shellScriptSectionRegex,
//                     `${scriptPhaseEntry}\n/* End PBXShellScriptBuildPhase section */`
//                 )
//             } else {
//                 // Section doesn't exist, create it
//                 const resourcesSectionEnd = /\/\* End PBXResourcesBuildPhase section \*\//
//                 projectContent = projectContent.replace(
//                     resourcesSectionEnd,
//                     `/* End PBXResourcesBuildPhase section */\n\n/* Begin PBXShellScriptBuildPhase section */\n${scriptPhaseEntry}\n/* End PBXShellScriptBuildPhase section */`
//                 )
//             }

//             if (projectContent !== originalContent) {
//                 fs.writeFileSync(projectPath, projectContent, "utf8")
//                 progress.log(
//                     "Successfully added Run Script phase to copy GoogleService-Info.plist",
//                     "success"
//                 )
//             }
//         } else {
//             // Remove the script if it exists
//             if (!projectContent.includes(scriptMarker)) {
//                 progress.log(
//                     "GoogleService-Info.plist copy script not found (already removed or never added)",
//                     "info"
//                 )
//                 return
//             }

//             progress.log("Removing GoogleService-Info.plist copy script from project...", "info")

//             // Find and remove the script phase UUID from buildPhases array
//             const scriptUUIDRegex = /\t\t\t\t([A-F0-9]+) \/\* ShellScript \*\/,\n/g
//             let scriptUUID = null
//             let tempContent = projectContent

//             // Find the UUID by looking for the script content
//             const scriptSectionRegex =
//                 /([A-F0-9]+) \/\* ShellScript \*\/ = \{[^}]*Copy GoogleService-Info\.plist[^}]*\};/
//             const scriptMatch = projectContent.match(scriptSectionRegex)
//             if (scriptMatch) {
//                 scriptUUID = scriptMatch[1]

//                 // Remove from buildPhases array
//                 projectContent = projectContent.replace(
//                     new RegExp(`\\t\\t\\t\\t${scriptUUID} /\\* ShellScript \\*/,\\n`),
//                     ""
//                 )

//                 // Remove the script phase entry
//                 projectContent = projectContent.replace(
//                     new RegExp(`\\t\\t${scriptUUID} /\\* ShellScript \\*/ = \\{[^}]*\\};\\n`),
//                     ""
//                 )

//                 // If PBXShellScriptBuildPhase section is now empty, remove it
//                 const emptyShellScriptSection =
//                     /\/\* Begin PBXShellScriptBuildPhase section \*\/\n\/\* End PBXShellScriptBuildPhase section \*\//
//                 projectContent = projectContent.replace(emptyShellScriptSection, "")
//                 // Also remove the extra newline
//                 projectContent = projectContent.replace(/\n\n\n/g, "\n\n")
//             }

//             if (projectContent !== originalContent) {
//                 fs.writeFileSync(projectPath, projectContent, "utf8")
//                 progress.log("GoogleService-Info.plist copy script removed from project", "success")
//             } else {
//                 progress.log("No changes made to project", "info")
//             }
//         }
//     } catch (error) {
//         progress.log(
//             `Warning: Could not manage GoogleService-Info.plist copy script: ${error.message}`,
//             "warning"
//         )
//     }
// }

// Note: Firebase packages should be managed manually via Xcode
// We don't automatically add/remove them to avoid project file corruption
// The Swift code uses canImport(FirebaseCore) to handle optional Firebase

async function processNotificationAssets(webviewConfig) {
    const hasNotificationConfig = !!webviewConfig.notifications?.enabled

    try {
        // Always clean up notification assets first
        await cleanupNotificationAssets()

        // Manage GoogleService-Info.plist copy script
        // await addGoogleServicesCopyScript(hasNotificationConfig)

        if (!hasNotificationConfig) {
            progress.log("Notifications disabled - skipped asset processing", "info")
            return
        }

        // Handle GoogleService-Info.plist file for Firebase
        // const hasGoogleServices = await handleGoogleServicesPlist()
        // if (!hasGoogleServices) {
        //     progress.log("Continuing without Firebase - only local notifications will work", "warning")
        // }

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
// function getLocalIPAddress() {
//     try {
//         const command = `ifconfig | grep "inet " | grep -v 127.0.0.1 | head -n 1 | awk '{print $2}'`
//         return execSync(command).toString().trim()
//     } catch (error) {
//         console.error("Error getting local IP:", error)
//         return "localhost"
//     }
// }

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

    // Notifications are now controlled via canImport() - no need for compilation flags
    const isNotificationsEnabled = WEBVIEW_CONFIG.notifications?.enabled ?? false

    if (isNotificationsEnabled) {
        progress.log("Building with notifications enabled (using canImport(Firebase))", "info")
    } else {
        progress.log("Building with notifications disabled (Firebase packages removed)", "info")
    }

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

        // Process notification assets
        progress.start("assets")
        await processNotificationAssets(WEBVIEW_CONFIG)
        progress.complete("assets")

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
