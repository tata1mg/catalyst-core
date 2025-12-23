/* eslint-disable no-extra-semi */
"use strict"

var _child_process = require("child_process")
var _fs = _interopRequireDefault(require("fs"))
var _path = _interopRequireDefault(require("path"))
var _utils = require("./utils.js")
var _TerminalProgress = _interopRequireDefault(require("./TerminalProgress.js"))

// Import the AAB builder
import { buildAndroidAAB } from "./renameAndroidProject.js"

function _interopRequireDefault(e) {
    return e && e.__esModule ? e : { default: e }
}

const configPath = `${process.env.PWD}/config/config.json`
const publicPath = `${process.env.PWD}/public`
const pwd = `${process.cwd()}/node_modules/catalyst-core/dist/native`
const ANDROID_PACKAGE = "io.yourname.androidproject"

// Default values for AAB building
const DEFAULT_PROJECT_PATH = `${pwd}/androidProject`
const DEFAULT_DEPLOYMENT_PATH = "./deployment"
const DEFAULT_OLD_PROJECT_NAME = "androidProject" // Use actual project name in catalyst
const DEFAULT_OVERWRITE_EXISTING = true

const steps = {
    config: "Initialize Configuration",
    tools: "Validate Android Tools",
    emulator: "Check and Start Emulator",
    copyAssets: "Copy Build Assets",
    build: "Build and Install Application",
    aab: "Build Signed AAB",
}

const progressConfig = {
    titlePaddingTop: 2,
    titlePaddingBottom: 1,
    stepPaddingLeft: 4,
    stepSpacing: 1,
    errorPaddingLeft: 6,
    bottomMargin: 2,
}

const progress = new _TerminalProgress.default(steps, "Catalyst Android Build", progressConfig)

async function initializeConfig() {
    const configFile = _fs.default.readFileSync(configPath, "utf8")
    const config = JSON.parse(configFile)
    const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = config

    if (!WEBVIEW_CONFIG || Object.keys(WEBVIEW_CONFIG).length === 0) {
        throw new Error("WebView Config missing in " + configPath)
    }

    if (!WEBVIEW_CONFIG.android) {
        throw new Error("Android config missing in WebView Config")
    }

    // Log build type information
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

    if (!_fs.default.existsSync(ANDROID_SDK)) {
        throw new Error(`Android SDK path does not exist: ${ANDROID_SDK}`)
    }

    if (!_fs.default.existsSync(ADB_PATH)) {
        throw new Error(`ADB not found at: ${ADB_PATH}`)
    }

    try {
        ;(0, _utils.runCommand)(`${ADB_PATH} version`)
        progress.log("ADB validation successful", "success")
    } catch (error) {
        throw new Error(`ADB is not working properly: ${error.message}`)
    }

    // Skip emulator validation for release builds
    const buildType = androidConfig.buildType || "debug"
    if (buildType !== "release") {
        if (!_fs.default.existsSync(EMULATOR_PATH)) {
            throw new Error(`Emulator not found at: ${EMULATOR_PATH}`)
        }

        try {
            ;(0, _utils.runCommand)(`${EMULATOR_PATH} -version`)
            progress.log("Emulator validation successful", "success")
        } catch (error) {
            throw new Error(`Emulator is not working properly: ${error.message}`)
        }

        try {
            const avdOutput = (0, _utils.runCommand)(`${EMULATOR_PATH} -list-avds`)
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

async function detectPhysicalDevice(ADB_PATH) {
    try {
        progress.log("Detecting physical devices...", "info")
        const devices = (0, _utils.runCommand)(`${ADB_PATH} devices -l`)
        const lines = devices.split("\n").filter((line) => line.trim() && !line.includes("List of devices"))

        for (const line of lines) {
            const parts = line.trim().split(/\s+/)
            if (parts.length >= 2 && parts[1] === "device") {
                const deviceId = parts[0]

                // Check if it's a physical device (not emulator)
                if (!deviceId.startsWith("emulator-")) {
                    try {
                        // Double-check it's not an emulator using device properties
                        const qemuCheck = (0, _utils.runCommand)(
                            `${ADB_PATH} -s ${deviceId} shell getprop ro.kernel.qemu`
                        )
                        if (!qemuCheck.trim()) {
                            // Empty means physical device
                            progress.log(`Physical device detected: ${deviceId}`, "success")

                            // Get device model/name for better logging
                            let deviceModel = "Unknown Device"
                            try {
                                const model = (0, _utils.runCommand)(
                                    `${ADB_PATH} -s ${deviceId} shell getprop ro.product.model`
                                )
                                deviceModel = model.trim() || deviceModel
                            } catch (e) {
                                // Ignore model detection errors
                            }

                            return { id: deviceId, model: deviceModel }
                        }
                    } catch (error) {
                        // If we can't check properties, skip this device
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

        // Test 1: Basic ADB connection
        const connectionTest = (0, _utils.runCommand)(`${ADB_PATH} -s ${deviceId} shell echo "test"`)
        if (!connectionTest.includes("test")) {
            progress.log("Device connection test failed", "error")
            return false
        }

        // Test 2: Check if developer options are enabled
        try {
            const developerOptions = (0, _utils.runCommand)(
                `${ADB_PATH} -s ${deviceId} shell settings get global development_settings_enabled`
            )
            if (developerOptions.trim() !== "1") {
                progress.log("Developer options not enabled on device", "warning")
                return false
            }
        } catch (error) {
            progress.log("Cannot verify developer options status", "warning")
        }

        // Test 3: Check USB debugging status
        try {
            const usbDebugging = (0, _utils.runCommand)(
                `${ADB_PATH} -s ${deviceId} shell settings get global adb_enabled`
            )
            if (usbDebugging.trim() !== "1") {
                progress.log("USB debugging not enabled on device", "warning")
                return false
            }
        } catch (error) {
            progress.log("Cannot verify USB debugging status", "warning")
        }

        // Test 4: Check if we can access package manager
        try {
            ;(0, _utils.runCommand)(`${ADB_PATH} -s ${deviceId} shell pm list packages -3 | head -1`)
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
        const devices = (0, _utils.runCommand)(`${ADB_PATH} devices`)
        return devices.includes("emulator")
    } catch (error) {
        progress.log("Error checking emulator status: " + error.message, "error")
        return false
    }
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

async function startEmulator(EMULATOR_PATH, androidConfig) {
    progress.log(`Starting emulator: ${androidConfig.emulatorName}...`, "info")
    return new Promise((resolve, reject) => {
        ;(0, _child_process.exec)(
            `${EMULATOR_PATH} -avd ${androidConfig.emulatorName} -read-only > /dev/null &`,
            (error) => {
                if (error) {
                    progress.log("Error starting emulator: " + error.message, "error")
                    reject(error)
                } else {
                    progress.log("Emulator started successfully", "success")
                    resolve()
                }
            }
        )
    })
}

async function copyBuildAssets(androidConfig, buildOptimisation = false) {
    if (!buildOptimisation) return

    progress.log("Copying build assets to Android project...", "info")
    try {
        // Define source and destination paths
        const sourcePath = `${process.env.PWD}/build/`
        const destPath = `${pwd}/androidProject/app/src/main/assets/build/`

        // Create destination directory if it doesn't exist
        ;(0, _utils.runCommand)(`mkdir -p ${destPath}`)

        // Clear existing destination to avoid conflicts
        ;(0, _utils.runCommand)(`rm -rf ${destPath}/*`)

        // Files to exclude from copying
        const excludePatterns = ["route-manifest.json.gz", "route-manifest.json.br"]

        if (buildOptimisation) {
            progress.log("Running with build optimization...", "info")
            const excludeParams = excludePatterns.map((pattern) => `--exclude="${pattern}"`).join(" ")
            const rsyncCommand = `rsync -av ${excludeParams} ${sourcePath} ${destPath}`
            progress.log("Executing rsync command with exclusions...", "info")
            ;(0, _utils.runCommand)(rsyncCommand)

            // Verify excluded files don't exist in destination
            for (const pattern of excludePatterns) {
                const checkCommand = `find ${destPath} -name "${pattern}" | wc -l`
                const count = parseInt((0, _utils.runCommand)(checkCommand).trim(), 10)
                if (count > 0) {
                    progress.log(`Warning: Found ${count} instances of excluded file ${pattern}`, "warning")
                    ;(0, _utils.runCommand)(`find ${destPath} -name "${pattern}" -delete`)
                }
            }
            progress.log(
                "Build assets copied with optimization (excluded route-manifest JSON files)",
                "success"
            )
        } else {
            progress.log("Running without build optimization...", "info")
            const exclusions = excludePatterns.map((pattern) => `-not -name "${pattern}"`).join(" ")
            const copyCommand = `find ${sourcePath} -type f ${exclusions} -exec cp --parents {} ${destPath} \\;`
            progress.log(`Executing copy command with exclusions...`, "info")
            ;(0, _utils.runCommand)(copyCommand)
            progress.log("Build assets copied successfully!", "success")
        }
    } catch (error) {
        throw new Error("Error copying build assets: " + error.message)
    }
}

async function buildApp(ADB_PATH, androidConfig, buildOptimisation, targetDevice = null) {
    progress.log("Building and installing app...", "info")
    try {
        // Build command without monkey launch
        let buildCommand = `cd ${pwd}/androidProject && ./gradlew generateWebViewConfig -PconfigPath=${configPath} -PbuildOptimisation=${buildOptimisation} && ./gradlew clean installDebug -PconfigPath=${configPath} --quiet --console=rich`

        // Add device-specific install target if physical device
        if (targetDevice && targetDevice.type === "physical") {
            buildCommand = buildCommand.replace(
                "installDebug",
                `installDebug -Pandroid.injected.target.device=${targetDevice.id}`
            )
        }

        await (0, _utils.runInteractiveCommand)("sh", ["-c", buildCommand], { "BUILD SUCCESSFUL": "" })
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

    // Launch on emulator
    try {
        progress.log("Launching app on emulator...", "info")
        const packageName = `${ANDROID_PACKAGE}${buildType === "debug" ? ".debug" : ""}`
        const launchCommand = `${ADB_PATH} shell monkey -p ${packageName} 1`
        await (0, _utils.runInteractiveCommand)("sh", ["-c", launchCommand], {})
        progress.log("App launched successfully on emulator!", "success")
    } catch (error) {
        progress.log(`Warning: Could not auto-launch app: ${error.message}`, "warning")
        progress.log("App was installed successfully, but auto-launch failed", "info")
    }
}

async function copySplashscreenAssets() {
    try {
        const destPath = `${pwd}/androidProject/app/src/main/res`
        const configFile = _fs.default.readFileSync(configPath, "utf8")
        const config = JSON.parse(configFile)
        const { WEBVIEW_CONFIG = {} } = config

        if (!WEBVIEW_CONFIG.splashScreen) return

        const androidPublicPath = `${process.env.PWD}/public/android`
        const imageFormats = ["png", "jpg", "jpeg", "gif", "bmp", "webp"]

        // Copy splash screen image if exists
        if (_fs.default.existsSync(androidPublicPath)) {
            const drawableDir = `${destPath}/drawable`
            if (!_fs.default.existsSync(drawableDir)) {
                _fs.default.mkdirSync(drawableDir, { recursive: true })
            }

            for (const format of imageFormats) {
                const existingPath = `${destPath}/drawable/splashscreen.${format}`
                if (_fs.default.existsSync(existingPath)) {
                    _fs.default.unlinkSync(existingPath)
                }
            }

            for (const format of imageFormats) {
                const sourcePath = `${androidPublicPath}/splashscreen.${format}`
                if (_fs.default.existsSync(sourcePath)) {
                    _fs.default.copyFileSync(sourcePath, `${destPath}/drawable/splashscreen.${format}`)
                    break
                }
            }
        }

        // Update theme background color
        const backgroundColor = WEBVIEW_CONFIG.splashScreen.backgroundColor || "#ffffff"
        const themeFiles = [`${destPath}/values/themes.xml`, `${destPath}/values-night/themes.xml`]

        for (const themesFile of themeFiles) {
            if (_fs.default.existsSync(themesFile)) {
                let content = _fs.default.readFileSync(themesFile, "utf8")

                // Replace windowBackground - matches any color value
                content = content.replace(
                    /<item name="android:windowBackground">.*?<\/item>/,
                    `<item name="android:windowBackground">${backgroundColor}</item>`
                )

                // Replace splash screen background - matches any color value
                content = content.replace(
                    /<item name="android:windowSplashScreenBackground" tools:targetApi="31">.*?<\/item>/,
                    `<item name="android:windowSplashScreenBackground" tools:targetApi="31">${backgroundColor}</item>`
                )

                _fs.default.writeFileSync(themesFile, content)
            }
        }
    } catch (error) {
        progress.log(`Error processing splash screen: ${error.message}`, "warning")
    }
}

async function copyOfflinePage() {
    try {
        const sourcePath = `${process.env.PWD}/public/offline.html`
        const destDir = `${pwd}/androidProject/app/src/main/assets/offline`
        const destPath = `${destDir}/offline.html`

        if (!_fs.default.existsSync(sourcePath)) {
            progress.log("offline.html not found in public/; skipping offline asset copy", "warning")
            return
        }

        // Ensure destination directory exists
        ;(0, _utils.runCommand)(`mkdir -p ${destDir}`)

        _fs.default.copyFileSync(sourcePath, destPath)
        progress.log("offline.html copied to Android assets", "success")
    } catch (error) {
        progress.log(`Warning: Error copying offline.html: ${error.message}`, "warning")
    }
}

async function copyIconAssets() {
    try {
        const destPath = `${pwd}/androidProject/app/src/main/res`
        const manifestPath = `${pwd}/androidProject/app/src/main/AndroidManifest.xml`
        const androidIconDir = _path.default.join(publicPath, "android", "appIcons")
        const fallbackIconPath = _path.default.join(__dirname, "assets", "catalyst.png")
        const fallbackExists = _fs.default.existsSync(fallbackIconPath)
        const extensions = ["png", "jpg", "jpeg"]

        if (!_fs.default.existsSync(publicPath)) {
            progress.log(`Warning: Public directory not found at ${publicPath}`, "warning")
            return
        }

        const densities = [
            { key: "mdpi", dir: "mipmap-mdpi" },
            { key: "hdpi", dir: "mipmap-hdpi" },
            { key: "xhdpi", dir: "mipmap-xhdpi" },
            { key: "xxhdpi", dir: "mipmap-xxhdpi" },
            { key: "xxxhdpi", dir: "mipmap-xxxhdpi" },
        ]

        const hasIconDirectory =
            _fs.default.existsSync(androidIconDir) && _fs.default.lstatSync(androidIconDir).isDirectory()

        const cleanDensityDir = (dir) => {
            if (!_fs.default.existsSync(dir)) {
                return
            }
            for (const file of _fs.default.readdirSync(dir)) {
                if (file.startsWith("icon.")) {
                    _fs.default.unlinkSync(_path.default.join(dir, file))
                }
            }
        }

        const findIconForDensity = (densityKey) => {
            if (!hasIconDirectory) {
                return null
            }

            for (const ext of extensions) {
                const candidate = _path.default.join(androidIconDir, `icon-${densityKey}.${ext}`)
                if (_fs.default.existsSync(candidate)) {
                    return { path: candidate, ext }
                }
            }

            return null
        }

        let hasCustomIcons = false
        let usedFallback = false

        for (const density of densities) {
            const targetDir = _path.default.join(destPath, density.dir)
            const source = findIconForDensity(density.key)

            cleanDensityDir(targetDir)

            if (source) {
                _fs.default.mkdirSync(targetDir, { recursive: true })
                const destination = _path.default.join(targetDir, `icon.${source.ext}`)
                _fs.default.copyFileSync(source.path, destination)
                hasCustomIcons = true
            }
        }

        if (!hasCustomIcons && fallbackExists) {
            const targetDir = _path.default.join(destPath, "mipmap-xxxhdpi")
            _fs.default.mkdirSync(targetDir, { recursive: true })
            cleanDensityDir(targetDir)
            const destination = _path.default.join(targetDir, "icon.png")
            _fs.default.copyFileSync(fallbackIconPath, destination)
            usedFallback = true
        }

        const setManifestIcons = (iconValue, roundIconValue) => {
            if (!_fs.default.existsSync(manifestPath)) return

            const current = _fs.default.readFileSync(manifestPath, "utf8")
            const updated = current
                .replace(/android:icon="[^"]*"/g, `android:icon="${iconValue}"`)
                .replace(/android:roundIcon="[^"]*"/g, `android:roundIcon="${roundIconValue}"`)

            if (updated !== current) {
                _fs.default.writeFileSync(manifestPath, updated)
            }
        }

        if (!hasCustomIcons && !usedFallback) {
            progress.log("No custom Android icons found; using default template icons.", "info")

            setManifestIcons("@mipmap/ic_launcher", "@mipmap/ic_launcher_round")

            return
        }

        setManifestIcons("@mipmap/icon", "@mipmap/icon")

        if (hasCustomIcons) {
            progress.log("Applied Android launcher icons from public/android/appIcons.", "success")
        }

        if (usedFallback) {
            progress.log("Used bundled Catalyst fallback icon for launcher.", "info")
        }
    } catch (error) {
        progress.log(`Warning: Error copying app icon assets: ${error.message}`, "warning")
    }
}

async function configureAppName(androidConfig) {
    try {
        const destPath = `${pwd}/androidProject/app/src/main/res`
        const stringsFile = `${destPath}/values/strings.xml`

        let stringsContent = _fs.default.readFileSync(stringsFile, "utf8")

        // Check if androidConfig.appName exists
        if (androidConfig.appName) {
            stringsContent = stringsContent.replace(
                /<string name="app_name">.*?<\/string>/,
                `<string name="app_name">${androidConfig.appName}</string>`
            )

            _fs.default.writeFileSync(stringsFile, stringsContent)
            progress.log(`App display name configured: ${androidConfig.appName}`, "success")
        } else {
            // No appName configured, revert to default
            stringsContent = stringsContent.replace(
                /<string name="app_name">.*?<\/string>/,
                `<string name="app_name">Catalyst Application</string>`
            )

            _fs.default.writeFileSync(stringsFile, stringsContent)
            progress.log("App display name reverted to default: Catalyst Application", "info")
        }
    } catch (error) {
        progress.log(`Warning: Error configuring app name: ${error.message}`, "warning")
    }
}

async function handleGoogleServicesJson() {
    try {
        const rootGoogleServicesPath = `${process.env.PWD}/google-services.json`
        const androidGoogleServicesPath = `${pwd}/androidProject/app/google-services.json`

        // Check if google-services.json exists in the root directory
        if (_fs.default.existsSync(rootGoogleServicesPath)) {
            progress.log("Found google-services.json in root directory", "info")

            // Create the app directory if it doesn't exist
            const appDir = `${pwd}/androidProject/app`
            if (!_fs.default.existsSync(appDir)) {
                _fs.default.mkdirSync(appDir, { recursive: true })
            }

            // Copy the file to the Android project
            _fs.default.copyFileSync(rootGoogleServicesPath, androidGoogleServicesPath)
            progress.log("Copied google-services.json to androidProject/app/", "success")

            return true
        } else if (_fs.default.existsSync(androidGoogleServicesPath)) {
            progress.log("google-services.json already exists in androidProject/app/", "info")
            return true
        } else {
            progress.log(
                "google-services.json not found - Firebase push notifications will not work",
                "warning"
            )
            progress.log(
                "Place google-services.json in project root or src/native/androidProject/app/",
                "info"
            )
            return false
        }
    } catch (error) {
        progress.log(`Warning: Error handling google-services.json: ${error.message}`, "warning")
        return false
    }
}

async function processNotifications(WEBVIEW_CONFIG) {
    const hasNotificationConfig = !!WEBVIEW_CONFIG.notifications?.enabled

    try {
        // Always clean up notification configurations first (regardless of config)
        await cleanupNotificationPermissions()
        await cleanupNotificationResources()
        await cleanupNotificationMetadata()
        await cleanupNotificationAssets()

        if (!hasNotificationConfig) {
            progress.log("Notifications disabled - cleaned up notification configurations", "info")
            return
        }

        // Handle google-services.json file for Firebase
        const hasGoogleServices = await handleGoogleServicesJson()
        if (!hasGoogleServices) {
            progress.log("Continuing without Firebase - only local notifications will work", "warning")
        }

        // Only add configurations if notifications are enabled
        await addNotificationPermissions()
        await generateNotificationResources(WEBVIEW_CONFIG.notifications)
        await addNotificationMetadata()
        await processNotificationAssets()
        progress.log("Notification configuration completed successfully!", "success")
    } catch (error) {
        progress.log(`Warning: Error processing notifications: ${error.message}`, "warning")
    }
}

async function addNotificationPermissions() {
    try {
        const manifestPath = `${pwd}/androidProject/app/src/main/AndroidManifest.xml`
        let manifestContent = _fs.default.readFileSync(manifestPath, "utf8")

        const permissionsXml = `    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />`

        manifestContent = manifestContent.replace(
            /(<uses-permission[^>]*>[\s\S]*?)(\s*<uses-feature)/,
            `$1\n${permissionsXml}$2`
        )

        _fs.default.writeFileSync(manifestPath, manifestContent)
        progress.log("Added notification permissions to AndroidManifest.xml", "success")
    } catch (error) {
        throw new Error(`Failed to add notification permissions: ${error.message}`)
    }
}

async function generateNotificationResources(notificationConfig) {
    try {
        const colorsPath = `${pwd}/androidProject/app/src/main/res/values/colors.xml`
        let colorsContent = _fs.default.readFileSync(colorsPath, "utf8")

        const notificationColorXml = `    <color name="notification_color">${notificationConfig.color || "#007AFF"}</color>`

        if (!colorsContent.includes('name="notification_color"')) {
            colorsContent = colorsContent.replace(/(<\/resources>)/, `${notificationColorXml}\n$1`)
            _fs.default.writeFileSync(colorsPath, colorsContent)
            progress.log("Added notification color to colors.xml", "success")
        }
    } catch (error) {
        throw new Error(`Failed to generate notification resources: ${error.message}`)
    }
}

async function addNotificationMetadata() {
    try {
        const manifestPath = `${pwd}/androidProject/app/src/main/AndroidManifest.xml`
        let manifestContent = _fs.default.readFileSync(manifestPath, "utf8")

        const metadataXml = `
        <!-- Default notification configuration -->
        <meta-data
            android:name="default_notification_channel_id"
            android:value="default_notifications" />
        <meta-data
            android:name="default_notification_icon"
            android:resource="@drawable/ic_notification" />
        <meta-data
            android:name="default_notification_color"
            android:resource="@color/notification_color" />

        <!-- Firebase default notification configuration -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_channel_id"
            android:value="fcm_default_channel" />
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@drawable/ic_notification" />

        <!-- Push Notification Service -->
        <service
            android:name="io.yourname.androidproject.utils.PushNotificationUtils"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>`

        manifestContent = manifestContent.replace(/(\s*<\/application>)/, `${metadataXml}\n$1`)
        _fs.default.writeFileSync(manifestPath, manifestContent)
        progress.log(
            "Added notification metadata and push notification service to AndroidManifest.xml",
            "success"
        )
    } catch (error) {
        throw new Error(`Failed to add notification metadata: ${error.message}`)
    }
}

async function processNotificationAssets() {
    try {
        const destPath = `${pwd}/androidProject/app/src/main/res`
        const imageFormats = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"]
        const audioFormats = ["mp3", "wav", "ogg"]

        let assetsProcessed = 0

        // Define notification icons to process
        const notificationIcons = [
            { sourceName: "notification-icon", resourceName: "ic_notification" },
            { sourceName: "notification-large", resourceName: "ic_notification_large" },
        ]

        // Define notification sounds to process
        const notificationSounds = [
            { sourceName: "notification-sound-default", resourceName: "notification_sound_default" },
            { sourceName: "notification-sound-urgent", resourceName: "notification_sound_urgent" },
        ]

        // Remove existing notification icons to avoid conflicts
        for (const icon of notificationIcons) {
            for (const format of imageFormats) {
                const existingIconPath = `${destPath}/drawable/${icon.resourceName}.${format}`
                if (_fs.default.existsSync(existingIconPath)) {
                    _fs.default.unlinkSync(existingIconPath)
                    progress.log(`Removed existing ${icon.resourceName}.${format}`, "info")
                }
            }
        }

        // Remove existing notification sounds to avoid conflicts
        for (const sound of notificationSounds) {
            for (const format of audioFormats) {
                const existingSoundPath = `${destPath}/raw/${sound.resourceName}.${format}`
                if (_fs.default.existsSync(existingSoundPath)) {
                    _fs.default.unlinkSync(existingSoundPath)
                    progress.log(`Removed existing ${sound.resourceName}.${format}`, "info")
                }
            }
        }

        // Process notification icons
        let iconFound = false
        for (const icon of notificationIcons) {
            for (const format of imageFormats) {
                const iconImagePath = `${publicPath}/${icon.sourceName}.${format}`
                if (_fs.default.existsSync(iconImagePath)) {
                    const destImagePath = `${destPath}/drawable/${icon.resourceName}.${format}`
                    _fs.default.copyFileSync(iconImagePath, destImagePath)
                    progress.log(
                        `Notification icon copied: ${icon.sourceName}.${format} -> ${icon.resourceName}.${format}`,
                        "success"
                    )
                    assetsProcessed++

                    // Track if we found the main notification icon
                    if (icon.sourceName === "notification-icon") {
                        iconFound = true
                    }
                    break
                }
            }
        }

        // Generate default notification icon if not found
        if (!iconFound) {
            generateNotificationIconDrawable("ic_notification", destPath)
            progress.log("Generated default notification icon", "info")
        }

        // Create raw directory if it doesn't exist
        const rawDir = `${destPath}/raw`
        if (!_fs.default.existsSync(rawDir)) {
            _fs.default.mkdirSync(rawDir, { recursive: true })
        }

        // Process notification sounds
        for (const sound of notificationSounds) {
            for (const format of audioFormats) {
                const soundImagePath = `${publicPath}/${sound.sourceName}.${format}`
                if (_fs.default.existsSync(soundImagePath)) {
                    const destSoundPath = `${destPath}/raw/${sound.resourceName}.${format}`
                    _fs.default.copyFileSync(soundImagePath, destSoundPath)
                    progress.log(
                        `Notification sound copied: ${sound.sourceName}.${format} -> ${sound.resourceName}.${format}`,
                        "success"
                    )
                    assetsProcessed++
                    break
                }
            }
        }

        if (assetsProcessed > 0) {
            progress.log(`Processed ${assetsProcessed} notification assets from public/`, "success")
        } else {
            progress.log("No notification assets found in public/ - using defaults", "info")
        }
    } catch (error) {
        throw new Error(`Failed to process notification assets: ${error.message}`)
    }
}

function generateNotificationIconDrawable(iconName, destPath) {
    // Create vector drawable for notification icon as fallback
    const iconXml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="?attr/colorOnPrimary">
  <path
      android:fillColor="@android:color/white"
      android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.9,2 2,2zM18,16v-5c0,-3.07 -1.64,-5.64 -4.5,-6.32V4c0,-0.83 -0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.63,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z"/>
</vector>`

    _fs.default.writeFileSync(`${destPath}/drawable/${iconName}.xml`, iconXml)
}

// Cleanup functions to remove notification configurations
async function cleanupNotificationPermissions() {
    try {
        const manifestPath = `${pwd}/androidProject/app/src/main/AndroidManifest.xml`
        let manifestContent = _fs.default.readFileSync(manifestPath, "utf8")

        // Remove notification permissions
        const notificationPermissions = [
            "android.permission.POST_NOTIFICATIONS",
            "android.permission.VIBRATE",
            "android.permission.WAKE_LOCK",
            "android.permission.RECEIVE_BOOT_COMPLETED",
        ]

        notificationPermissions.forEach((permission) => {
            const permissionRegex = new RegExp(
                `\\s*<uses-permission android:name="${permission}"[^>]*/>`,
                "g"
            )
            manifestContent = manifestContent.replace(permissionRegex, "")
        })

        _fs.default.writeFileSync(manifestPath, manifestContent)
    } catch (error) {
        // Don't throw error for cleanup operations, just log
        progress.log(`Warning: Error cleaning notification permissions: ${error.message}`, "warning")
    }
}

async function cleanupNotificationResources() {
    try {
        const colorsPath = `${pwd}/androidProject/app/src/main/res/values/colors.xml`
        let colorsContent = _fs.default.readFileSync(colorsPath, "utf8")

        // Remove notification color
        const existingColorLine = colorsContent
            .split("\n")
            .find((line) => line.includes('name="notification_color"'))

        if (existingColorLine) {
            colorsContent = colorsContent.replace(existingColorLine, "")
            _fs.default.writeFileSync(colorsPath, colorsContent)
        }
    } catch (error) {
        progress.log(`Warning: Error cleaning notification resources: ${error.message}`, "warning")
    }
}

async function cleanupNotificationMetadata() {
    try {
        const manifestPath = `${pwd}/androidProject/app/src/main/AndroidManifest.xml`
        let manifestContent = _fs.default.readFileSync(manifestPath, "utf8")

        // Remove notification metadata entries
        const metadataNames = [
            "default_notification_channel_id",
            "default_notification_icon",
            "default_notification_color",
            "com.google.firebase.messaging.default_notification_channel_id",
            "com.google.firebase.messaging.default_notification_icon",
        ]

        metadataNames.forEach((metadataName) => {
            // Remove the meta-data block including comments
            const metadataRegex = new RegExp(
                `\\s*<!--[^>]*notification[^>]*-->\\s*<meta-data[^>]*android:name="${metadataName}"[\\s\\S]*?/>|\\s*<meta-data[^>]*android:name="${metadataName}"[\\s\\S]*?/>`,
                "gi"
            )
            manifestContent = manifestContent.replace(metadataRegex, "")
        })

        // Remove Push Notification Service
        const serviceRegex =
            /\s*<!--\s*Push Notification Service\s*-->\s*<service[^>]*android:name="[^"]*PushNotificationUtils"[\s\S]*?<\/service>/gi
        manifestContent = manifestContent.replace(serviceRegex, "")

        // Clean up any standalone notification comments
        manifestContent = manifestContent.replace(/\s*<!--\s*Default notification configuration\s*-->/gi, "")
        manifestContent = manifestContent.replace(
            /\s*<!--\s*Firebase default notification configuration\s*-->/gi,
            ""
        )
        manifestContent = manifestContent.replace(/\s*<!--\s*Push Notification Service\s*-->/gi, "")

        _fs.default.writeFileSync(manifestPath, manifestContent)
    } catch (error) {
        progress.log(`Warning: Error cleaning notification metadata: ${error.message}`, "warning")
    }
}

async function cleanupNotificationAssets() {
    try {
        const destPath = `${pwd}/androidProject/app/src/main/res`
        const imageFormats = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "xml"]
        const audioFormats = ["mp3", "wav", "ogg"]

        // Define notification icons to clean up
        const notificationIcons = ["ic_notification", "ic_notification_large"]

        // Define notification sounds to clean up
        const notificationSounds = ["notification_sound_default", "notification_sound_urgent"]

        // Remove existing notification icons
        for (const icon of notificationIcons) {
            for (const format of imageFormats) {
                const iconPath = `${destPath}/drawable/${icon}.${format}`
                if (_fs.default.existsSync(iconPath)) {
                    _fs.default.unlinkSync(iconPath)
                }
            }
        }

        // Remove existing notification sounds
        const rawDir = `${destPath}/raw`
        if (_fs.default.existsSync(rawDir)) {
            for (const sound of notificationSounds) {
                for (const format of audioFormats) {
                    const soundPath = `${rawDir}/${sound}.${format}`
                    if (_fs.default.existsSync(soundPath)) {
                        _fs.default.unlinkSync(soundPath)
                    }
                }
            }
        }
    } catch (error) {
        progress.log(`Warning: Error cleaning notification assets: ${error.message}`, "warning")
    }
}

// Legacy function for backward compatibility
// async function installApp(ADB_PATH, androidConfig, buildOptimisation, buildType = "debug") {
//     await buildApp(ADB_PATH, androidConfig, buildOptimisation, buildType)
//     await launchApp(ADB_PATH, buildType, { type: "emulator" })
// }

async function createAABConfig(androidConfig) {
    // Create AAB configuration based on WebView config with defaults applied
    const aabConfig = {
        // Apply defaults here in buildAppAndroid.js
        projectPath: androidConfig.projectPath || DEFAULT_PROJECT_PATH,
        deploymentPath: DEFAULT_DEPLOYMENT_PATH,
        oldProjectName: DEFAULT_OLD_PROJECT_NAME,
        overwriteExisting:
            androidConfig.overwriteExisting !== undefined
                ? androidConfig.overwriteExisting
                : DEFAULT_OVERWRITE_EXISTING,

        // Required field - use configured value or derive from other config
        newProjectName:
            androidConfig.newProjectName ||
            androidConfig.appName ||
            androidConfig.packageName?.split(".").pop() ||
            "catalystapp",

        // IMPORTANT: Pass packageName for renaming
        packageName: androidConfig.packageName || null,

        // AAB specific settings
        createSignedAAB: true,
        outputPath: androidConfig.outputPath || `${process.env.PWD}/build-output`,
    }

    // Add keystore configuration if available
    if (androidConfig.keystoreConfig) {
        aabConfig.keystoreConfig = androidConfig.keystoreConfig
    } else if (androidConfig.keystore) {
        // Map old keystore format to new format
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

    // Log the configuration being used
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
        // Check if required environment variables are set
        if (!process.env.PWD || !BUILD_OUTPUT_PATH) {
            progress.log(
                "Environment variables PWD or BUILD_OUTPUT_PATH not set, skipping APK move",
                "warning"
            )
            return null
        }

        const currentDate = new Date().toLocaleDateString("en-GB").replace(/\//g, "-") // DD-MM-YYYY format
        const currentTime = new Date()
            .toLocaleTimeString("en-US", {
                hour12: true,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            })
            .replace(/:/g, ":") // HH-MM-SS AM/PM format
        let destinationApkFileName = ""
        // Construct source and destination paths
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

        const sourceApkPath = _path.default.join(
            pwd,
            "androidProject",
            "app",
            "build",
            "outputs",
            "apk",
            buildType,
            sourceApkFileName
        )
        const destinationDir = _path.default.join(
            process.env.PWD,
            BUILD_OUTPUT_PATH,
            "native",
            "android",
            currentDate,
            buildType
        )
        const destinationApkPath = _path.default.join(destinationDir, destinationApkFileName)

        // Check if source APK exists
        if (!_fs.default.existsSync(sourceApkPath)) {
            progress.log(`APK not found at source path: ${sourceApkPath}`, "warning")
            return null
        }

        // Create destination directory if it doesn't exist
        if (!_fs.default.existsSync(destinationDir)) {
            _fs.default.mkdirSync(destinationDir, { recursive: true })
        }

        // Copy APK to destination
        _fs.default.copyFileSync(sourceApkPath, destinationApkPath)
        return destinationApkPath
    } catch (error) {
        progress.log(`Error moving APK: ${error.message}`, "error")
        return null
    }
}

async function buildSignedAAB(androidConfig) {
    progress.log("Building signed AAB for release...", "info")

    try {
        // Generate webview config BEFORE creating AAB
        progress.log("Generating webview configuration for release...", "info")
        try {
            const generateConfigCommand = `cd ${pwd}/androidProject && ./gradlew generateWebViewConfig -PconfigPath=${configPath}`
            await (0, _utils.runInteractiveCommand)("sh", ["-c", generateConfigCommand], {
                "BUILD SUCCESSFUL": "",
            })
            progress.log("Webview config generated successfully", "success")
        } catch (configError) {
            progress.log(`Warning: Webview config generation failed: ${configError.message}`, "warning")
            throw new Error("Webview config generation is required for release builds")
        }

        // Create AAB configuration directly without temporary file
        const aabConfig = await createAABConfig(androidConfig)

        // Call the AAB builder directly with config object
        await buildAndroidAAB(aabConfig)

        progress.log("Signed AAB build completed successfully!", "success")
    } catch (error) {
        throw new Error("Error building signed AAB: " + error.message)
    }
}

async function buildAndroidApp() {
    // Initialize androidConfig outside try block to ensure it's available in catch
    let androidConfig = null
    let targetDevice = null

    try {
        // Initialize configuration
        progress.start("config")
        const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = await initializeConfig()
        androidConfig = WEBVIEW_CONFIG.android
        const buildType = androidConfig.buildType || "debug"
        const buildOptimisation = !!androidConfig.buildOptimisation || false
        progress.complete("config")

        // Validate tools and get paths
        progress.start("tools")
        const { ADB_PATH, EMULATOR_PATH } = await validateAndroidTools(androidConfig)
        progress.complete("tools")

        // Device detection and setup (skip for release builds)

        if (buildType !== "release") {
            progress.start("emulator")

            // Step 1: Check for physical device first
            const physicalDevice = await detectPhysicalDevice(ADB_PATH)

            if (physicalDevice) {
                progress.log(
                    `Found physical device: ${physicalDevice.model} (${physicalDevice.id})`,
                    "success"
                )

                // Test if we can install on physical device
                const canInstallOnPhysical = await testPhysicalDeviceInstallation(ADB_PATH, physicalDevice.id)

                if (canInstallOnPhysical) {
                    // Use physical device - skip emulator entirely
                    targetDevice = {
                        type: "physical",
                        id: physicalDevice.id,
                        model: physicalDevice.model,
                    }
                    progress.log(`Using physical device: ${physicalDevice.model}`, "success")
                } else {
                    // Physical device failed, fallback to emulator
                    progress.log(
                        "Physical device installation test failed, falling back to emulator",
                        "warning"
                    )
                    targetDevice = await handleEmulatorSetup(ADB_PATH, EMULATOR_PATH, androidConfig)
                }
            } else {
                // No physical device, use emulator (current behavior)
                targetDevice = await handleEmulatorSetup(ADB_PATH, EMULATOR_PATH, androidConfig)
            }

            progress.complete("emulator")
        } else {
            progress.log("Skipping device setup for release build", "info")
        }

        // Copy build assets
        progress.start("copyAssets")
        await copyBuildAssets(androidConfig, buildOptimisation)
        await copySplashscreenAssets()
        await copyOfflinePage()
        await copyIconAssets()
        await configureAppName(androidConfig)
        await processNotifications(WEBVIEW_CONFIG)
        progress.log(`Build optimization: ${buildOptimisation ? "Enabled" : "Disabled"}`, "info")
        progress.complete("copyAssets")

        // Build based on type
        let movedApkPath = null
        if (buildType === "release") {
            // Build signed AAB for release
            progress.start("aab")
            await buildSignedAAB(androidConfig)
            progress.complete("aab")
            // Move APK to output directory
            movedApkPath = await moveApkToOutputPath(buildType, BUILD_OUTPUT_PATH, androidConfig.appName)
        } else {
            // Install debug app for development
            progress.start("build")
            await buildApp(ADB_PATH, androidConfig, buildOptimisation, targetDevice)
            await launchApp(ADB_PATH, buildType, targetDevice)
            progress.complete("build")
            // Move APK to output directory
            movedApkPath = await moveApkToOutputPath(buildType, BUILD_OUTPUT_PATH, androidConfig.appName)
        }

        // Print build summary
        const summaryItems = [
            "Build completed successfully:",
            { text: `Build Type: ${buildType}`, indent: 1, prefix: "├─ ", color: "gray" },
            { text: `SDK Path: ${androidConfig.sdkPath}`, indent: 1, prefix: "├─ ", color: "gray" },
            {
                text: `Build Optimization: ${buildOptimisation ? "Enabled" : "Disabled"}`,
                indent: 1,
                prefix: "├─ ",
                color: "gray",
            },
        ]

        if (buildType === "release") {
            // Add APK path for release builds

            // Show moved APK location if move was successful
            if (movedApkPath) {
                summaryItems.push({
                    text: `APK Build Location: ${movedApkPath}`,
                    indent: 1,
                    prefix: "├─ ",
                    color: "green",
                })
            }

            summaryItems.push({
                text: `Output: Signed AAB generated in build-output/`,
                indent: 1,
                prefix: "└─ ",
                color: "green",
            })
        } else {
            // Add APK path for debug builds

            // Show moved APK location if move was successful
            if (movedApkPath) {
                summaryItems.push({
                    text: `APK Build Location: ${movedApkPath}`,
                    indent: 1,
                    prefix: "├─ ",
                    color: "green",
                })
            }

            if (targetDevice && targetDevice.type === "physical") {
                summaryItems.push({
                    text: `Target Device: ${targetDevice.model} (Physical)`,
                    indent: 1,
                    prefix: "└─ ",
                    color: "green",
                })
            } else {
                summaryItems.push({
                    text: `Target Device: ${androidConfig.emulatorName} (Emulator)`,
                    indent: 1,
                    prefix: "└─ ",
                    color: "gray",
                })
            }
        }

        progress.printTreeContent("Build Summary", summaryItems)
        process.exit(0)
    } catch (error) {
        if (progress.currentStep) {
            progress.fail(progress.currentStep.id, error.message)

            const troubleshootingItems = [
                "Build failed. Please try the following steps:",
                {
                    text: "Check if Android SDK is properly configured",
                    indent: 1,
                    prefix: "├─ ",
                    color: "yellow",
                },
                {
                    text: "Verify build assets exist in the source directory",
                    indent: 1,
                    prefix: "├─ ",
                    color: "yellow",
                },
            ]

            // Use androidConfig safely with null checks
            const buildType = androidConfig?.buildType || "debug"

            // Device-specific troubleshooting
            if (buildType !== "release") {
                // Check if error is related to device issues
                if (
                    error.message.includes("physical device") ||
                    error.message.includes("installation test")
                ) {
                    troubleshootingItems.push(
                        "\nPhysical Device Issues:",
                        {
                            text: "Enable Developer Options on your device",
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        },
                        {
                            text: "Enable USB Debugging in Developer Options",
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        },
                        {
                            text: 'Accept the "Allow USB Debugging" prompt on your device',
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        },
                        {
                            text: "Try disconnecting and reconnecting your device",
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        },
                        {
                            text: 'Check if "adb devices" shows your device as authorized',
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        }
                    )
                }

                if (buildType === "release") {
                    troubleshootingItems.push(
                        {
                            text: "Verify keystore configuration for release builds",
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        },
                        {
                            text: "Check that keystore passwords are properly set",
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        }
                    )
                } else {
                    troubleshootingItems.push(
                        {
                            text: "Verify that the emulator exists and is working",
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        },
                        {
                            text: "If using physical device, ensure it stays connected",
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        }
                    )
                }
            } else {
                troubleshootingItems.push(
                    {
                        text: "Verify keystore configuration for release builds",
                        indent: 1,
                        prefix: "├─ ",
                        color: "yellow",
                    },
                    {
                        text: "Check that keystore passwords are properly set",
                        indent: 1,
                        prefix: "├─ ",
                        color: "yellow",
                    }
                )
            }

            troubleshootingItems.push(
                {
                    text: 'Run "npm run setupEmulator:android" to reconfigure Android settings',
                    indent: 1,
                    prefix: "└─ ",
                    color: "yellow",
                },
                "\nVerify Configuration:"
            )

            // Add configuration details only if androidConfig is available
            if (androidConfig) {
                troubleshootingItems.push(
                    { text: `Build Type: ${buildType}`, indent: 1, prefix: "├─ ", color: "gray" },
                    {
                        text: `Android SDK Path: ${androidConfig.sdkPath || "Not configured"}`,
                        indent: 1,
                        prefix: "├─ ",
                        color: "gray",
                    }
                )

                if (buildType !== "release") {
                    // Show device information if available
                    if (targetDevice) {
                        troubleshootingItems.push({
                            text: `Target Device: ${targetDevice.type === "physical" ? `${targetDevice.model} (Physical)` : `${androidConfig.emulatorName} (Emulator)`}`,
                            indent: 1,
                            prefix: "└─ ",
                            color: "gray",
                        })
                    } else {
                        troubleshootingItems.push({
                            text: `Selected Emulator: ${androidConfig.emulatorName || "Not configured"}`,
                            indent: 1,
                            prefix: "└─ ",
                            color: "gray",
                        })
                    }
                } else {
                    troubleshootingItems.push({
                        text: `Output Path: ${androidConfig.outputPath || "build-output/"}`,
                        indent: 1,
                        prefix: "└─ ",
                        color: "gray",
                    })
                }
            } else {
                troubleshootingItems.push(
                    { text: "Configuration could not be loaded", indent: 1, prefix: "├─ ", color: "red" },
                    {
                        text: "Check if config/config.json exists and has valid Android configuration",
                        indent: 1,
                        prefix: "└─ ",
                        color: "red",
                    }
                )
            }

            progress.printTreeContent("Troubleshooting Guide", troubleshootingItems)
        }
        process.exit(1)
    }
}

// Execute the main build process
buildAndroidApp()
