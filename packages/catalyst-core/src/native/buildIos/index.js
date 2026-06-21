"use strict"

const { execFile, execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const TerminalProgress = require("../TerminalProgress.js").default

const createConfigPhase = require("./config.js")
const createPluginsPhase = require("./plugins.js")
const createAssetsPhase = require("./assets.js")
const createBuildPhase = require("./build.js")

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
const pwd = path.join(catalystCorePath, "dist/native")

const MANAGED_BASELINE_SUFFIX = ".catalyst-base"
const shellCommand = process.platform === "win32" ? "cmd.exe" : "sh"
const shellArgs = (command) => (process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command])

function createIosBuild(config) {
    const { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } = config

    const iosConfig = WEBVIEW_CONFIG.ios
    const isGoogleSignInEnabled = WEBVIEW_CONFIG.googleSignIn?.enabled ?? false

    const protocol = WEBVIEW_CONFIG.useHttps ? "https" : "http"
    const ip = WEBVIEW_CONFIG.LOCAL_IP || "localhost"
    const port = WEBVIEW_CONFIG.port ? (WEBVIEW_CONFIG.useHttps ? 443 : WEBVIEW_CONFIG.port) : null
    const url = port ? `${protocol}://${ip}:${port}` : `${protocol}://${ip}`

    const PUBLIC_PATH = `${process.cwd()}/public`
    const PROJECT_DIR = `${pwd}/iosnativeWebView`
    const SCHEME_NAME = iosConfig.scheme || "iosnativeWebView"
    const APP_BUNDLE_ID = iosConfig.appBundleId || "com.debug.webview"
    const PROJECT_NAME = path.basename(PROJECT_DIR)
    const IPHONE_MODEL = iosConfig.simulatorName

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

    const progressConfig = {
        titlePaddingTop: 2, titlePaddingBottom: 1, stepPaddingLeft: 4,
        stepSpacing: 1, errorPaddingLeft: 6, bottomMargin: 2,
    }

    const progress = new TerminalProgress(steps, "Catalyst iOS Build", progressConfig)

    // ─── Low-level helpers shared across modules ──────────────────────────────

    function runCommand(command, options = {}) {
        return new Promise((resolve, reject) => {
            execFile(shellCommand, shellArgs(command), { maxBuffer: 1024 * 1024 * 10, ...options }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Command failed: ${command}`)
                    console.error(`Error: ${error.message}`)
                    console.error(`stderr: ${stderr}`)
                    reject(error)
                    return
                }
                if (stderr) console.warn(`Warning: ${stderr}`)
                resolve(stdout.trim())
            })
        })
    }

    function getXcodeProjectFilePath() {
        return path.join(PROJECT_DIR, `${PROJECT_NAME}.xcodeproj`, "project.pbxproj")
    }

    function ensureManagedBaseline(filePath) {
        const baselinePath = `${filePath}${MANAGED_BASELINE_SUFFIX}`
        if (!fs.existsSync(baselinePath)) {
            if (!fs.existsSync(filePath)) throw new Error(`Managed baseline source file not found: ${filePath}`)
            fs.copyFileSync(filePath, baselinePath)
        }
        return baselinePath
    }

    function restoreManagedFileFromBaseline(filePath) {
        const baselinePath = ensureManagedBaseline(filePath)
        fs.copyFileSync(baselinePath, filePath)
    }

    function readPlistObject(filePath) {
        const output = execFileSync("plutil", ["-convert", "json", "-o", "-", filePath], { encoding: "utf8" })
        return JSON.parse(output)
    }

    function writePlistObject(filePath, value) {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - The generated filename uses path.basename and stays under the fixed project directory.
        const tempPath = path.join(PROJECT_DIR, `.catalyst-${path.basename(filePath)}-${process.pid}.json`)
        fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8")
        try {
            execFileSync("plutil", ["-convert", "xml1", "-o", filePath, tempPath])
        } finally {
            fs.rmSync(tempPath, { force: true })
        }
    }

    // ─── Shared context passed to all phase modules ───────────────────────────

    const ctx = {
        WEBVIEW_CONFIG, BUILD_OUTPUT_PATH, iosConfig, isGoogleSignInEnabled,
        PROJECT_DIR, PROJECT_NAME, SCHEME_NAME, APP_BUNDLE_ID, IPHONE_MODEL,
        url, PUBLIC_PATH, progress,
        runCommand, getXcodeProjectFilePath,
        ensureManagedBaseline, restoreManagedFileFromBaseline,
        readPlistObject, writePlistObject,
    }

    // ─── Instantiate phase modules ────────────────────────────────────────────

    const { generateConfigConstants, generateXCConfig, updateInfoPlist, updateEntitlements } = createConfigPhase(ctx)
    const { generatePackageSwift, updateXcodeProjectPackageDependencies, syncPluginResources } = createPluginsPhase(ctx)
    const { processNotificationAssets, copyOfflinePage, copySplashscreenAssets, copyAppIcon } = createAssetsPhase(ctx)
    const {
        cleanBuildArtifacts, buildXcodeProject, buildProjectForTesting,
        findAppPath, moveAppToBuildOutput, installAndLaunchApp,
        detectPhysicalDevices, buildProjectForPhysicalDevice, findPhysicalDeviceAppPath,
        installAndLaunchOnPhysicalDevice, launchIOSSimulator, getBootedSimulatorUUID,
    } = createBuildPhase(ctx)

    // ─── Orchestrated build flows ─────────────────────────────────────────────

    async function buildForIOS(pluginComposition = {}) {
        const originalDir = process.cwd()
        try {
            await generatePackageSwift(pluginComposition.iosDependencies)
            await updateXcodeProjectPackageDependencies()
            progress.start("assets")
            await processNotificationAssets(WEBVIEW_CONFIG)
            await copyOfflinePage()
            progress.complete("assets")
            await generateXCConfig()
            await copySplashscreenAssets()
            await copyAppIcon()
            progress.log("Changing directory to: " + PROJECT_DIR, "info")
            process.chdir(PROJECT_DIR)
            const physicalDevice = await detectPhysicalDevices()
            let APP_PATH, targetInfo
            if (physicalDevice) {
                progress.log("🔥 Building for physical device workflow", "success")
                targetInfo = { type: "physical", name: physicalDevice.name, udid: physicalDevice.udid }
                await cleanBuildArtifacts()
                progress.start("build")
                try { await buildProjectForPhysicalDevice(SCHEME_NAME, APP_BUNDLE_ID, path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData"), PROJECT_NAME, physicalDevice); progress.complete("build") }
                catch (error) {
                    progress.fail("build", error.message)
                    progress.printTreeContent("Physical Device Build Failed", [
                        "Build failed. Please check:",
                        { text: "Code signing certificates are properly installed", indent: 1, prefix: "├─ ", color: "yellow" },
                        { text: "Provisioning profile matches your bundle ID", indent: 1, prefix: "├─ ", color: "yellow" },
                        { text: "Device is connected and trusted", indent: 1, prefix: "└─ ", color: "yellow" },
                    ])
                    throw error
                }
                progress.start("findApp")
                try { APP_PATH = await findPhysicalDeviceAppPath(); progress.log("Found app at: " + APP_PATH, "success"); progress.complete("findApp") }
                catch (error) { progress.fail("findApp", error.message); throw error }
                await installAndLaunchOnPhysicalDevice(APP_PATH, physicalDevice)
            } else {
                progress.log("📱 Building for simulator workflow", "info")
                targetInfo = { type: "simulator", name: IPHONE_MODEL }
                await launchIOSSimulator(IPHONE_MODEL)
                await cleanBuildArtifacts()
                await buildXcodeProject()
                APP_PATH = await findAppPath()
                progress.log("Found app at: " + APP_PATH, "success")
                await installAndLaunchApp(APP_PATH)
                const MOVED_APP_PATH = await moveAppToBuildOutput(APP_PATH)
                APP_PATH = MOVED_APP_PATH
            }
            progress.printTreeContent("Build Summary", [
                "Build completed successfully:",
                { text: `Target: ${targetInfo.type === "physical" ? "📱 Physical Device" : "📱 Simulator"}`, indent: 1, prefix: "├─ ", color: "green" },
                { text: `Device: ${targetInfo.name}`, indent: 1, prefix: "├─ ", color: "gray" },
                { text: `App Path: ${APP_PATH}`, indent: 1, prefix: "├─ ", color: "gray" },
                { text: `URL: ${url}`, indent: 1, prefix: "└─ ", color: "gray" },
            ])
            return { success: true, targetInfo, appPath: APP_PATH }
        } catch (error) {
            progress.log("Build failed: " + error.message, "error")
            throw error
        } finally {
            process.chdir(originalDir)
        }
    }

    async function buildIosForTesting(pluginComposition = {}) {
        const originalDir = process.cwd()
        try {
            await generateConfigConstants()
            await updateInfoPlist(pluginComposition)
            await updateEntitlements(pluginComposition)
            await syncPluginResources(pluginComposition)

            await generatePackageSwift(pluginComposition.iosDependencies)
            await updateXcodeProjectPackageDependencies()
            await processNotificationAssets(WEBVIEW_CONFIG)
            await copyOfflinePage()
            await generateXCConfig()
            await copySplashscreenAssets()
            await copyAppIcon()

            progress.log("Changing directory to: " + PROJECT_DIR, "info")
            process.chdir(PROJECT_DIR)

            await cleanBuildArtifacts()

            const derivedDataPath = path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData")
            progress.start("build")
            try {
                await buildProjectForTesting(SCHEME_NAME, "iphonesimulator", `platform=iOS Simulator,name=${IPHONE_MODEL}`, APP_BUNDLE_ID, derivedDataPath, PROJECT_NAME)
                progress.complete("build")
            } catch (buildError) {
                progress.log("build-for-testing failed, attempting fallback with booted simulator...", "warning")
                const bootedUUID = await getBootedSimulatorUUID(IPHONE_MODEL)
                if (bootedUUID) {
                    await buildProjectForTesting(SCHEME_NAME, "iphonesimulator", `platform=iOS Simulator,id=${bootedUUID}`, APP_BUNDLE_ID, derivedDataPath, PROJECT_NAME)
                    progress.complete("build")
                } else {
                    progress.fail("build", buildError.message)
                    throw buildError
                }
            }

            progress.log("✅ build-for-testing complete — test bundle ready for xctest runner", "success")
            return { success: true }
        } catch (error) {
            progress.log("buildIosForTesting failed: " + error.message, "error")
            throw error
        } finally {
            process.chdir(originalDir)
        }
    }

    return {
        generateConfigConstants,
        updateInfoPlist,
        updateEntitlements,
        syncPluginResources,
        generatePackageSwift,
        updateXcodeProjectPackageDependencies,
        processNotificationAssets,
        copyOfflinePage,
        generateXCConfig,
        copySplashscreenAssets,
        copyAppIcon,
        buildForIOS,
        buildIosForTesting,
        progress,
        WEBVIEW_CONFIG,
        PROJECT_DIR,
        SCHEME_NAME,
    }
}

module.exports = { createIosBuild, pwd }
