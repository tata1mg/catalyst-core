"use strict"

const { execFile, execFileSync, spawn } = require("child_process")
const fs = require("fs")
const path = require("path")
const TerminalProgress = require("../terminalProgress.js").default
const { buildFailure } = require("../../cli/diagnostic.js")

const createConfigPhase = require("./config.js")
const createPluginsPhase = require("./plugins.js")
const createAssetsPhase = require("./assets.js")
const createBuildPhase = require("./build.js")

// Matches runInteractiveCommand: keep the tail, not the whole transcript.
const MAX_STREAMED_OUTPUT_BYTES = 1024 * 1024

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
        config: "Generate build configuration",
        deviceDetection: "Detect physical device",
        launchSimulator: "Launch iOS simulator",
        clean: "Clean build artifacts",
        assets: "Process notification assets",
        build: "Build iOS project",
        findApp: "Locate built application",
        install: "Install application",
        launch: "Launch application",
    }

    const progress = new TerminalProgress(steps, "catalyst buildApp", { subject: "ios" })

    // ─── Low-level helpers shared across modules ──────────────────────────────

    function runCommand(command, options = {}) {
        return new Promise((resolve, reject) => {
            execFile(
                shellCommand,
                shellArgs(command),
                // Unbounded: a 10MB cap turned a large-but-successful build into
                // a spurious ERR_CHILD_PROCESS_STDIO_MAXBUFFER failure.
                { maxBuffer: Infinity, ...options },
                (error, stdout) => {
                    if (error) {
                        // Let one layer above print this once. It used to print
                        // three lines here and the callers printed the same
                        // failure again -- ~6 lines across 4 layers per error.
                        // execFile already appends stderr to error.message, so
                        // appending it again here showed it twice.
                        reject(error)
                        return
                    }
                    // Tools write plenty of non-fatal chatter to stderr, so a
                    // successful command reporting "Warning: ..." was noise.
                    resolve(stdout.trim())
                }
            )
        })
    }

    /**
     * The phase from an xcodebuild line, or null for lines worth ignoring.
     * "CompileSwift normal arm64 /path/ContentView.swift" becomes
     * "CompileSwift ContentView.swift".
     */
    function xcodePhase(line) {
        const match =
            /^(CompileSwift|CompileC|Ld|CodeSign|ProcessInfoPlistFile|CpResource|Touch)\b(.*)$/.exec(
                line.trim()
            )
        if (!match) return null
        const file = (match[2].trim().split(/\s+/).pop() || "").split("/").pop()
        return file ? `${match[1]} ${file}` : match[1]
    }

    /**
     * Streaming sibling of runCommand, for the long xcodebuild calls.
     *
     * Buffered execFile means nothing appears until the build finishes -- for
     * xcodebuild that is minutes of apparent hang. Rather than scroll its
     * hundreds of lines (nobody reads them on success, and the error path
     * re-derives what it needs from error.output), the current phase is shown
     * on the spinner's own row. The full output is still resolved for callers
     * that parse it.
     */
    function runCommandStreaming(command) {
        return new Promise((resolve, reject) => {
            progress.pause()

            // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Internal build command strings, same source as runCommand.
            const child = spawn(shellCommand, shellArgs(command), { stdio: ["ignore", "pipe", "pipe"] })

            let output = ""
            const partial = { stdout: "", stderr: "" }

            const consume = (data, stream) => {
                const text = data.toString()

                // Same 1MB tail cap as runInteractiveCommand. Without it a long
                // xcodebuild retained every byte it ever printed.
                output += text
                if (output.length > MAX_STREAMED_OUTPUT_BYTES) {
                    output = output.slice(-MAX_STREAMED_OUTPUT_BYTES)
                }

                const lines = (partial[stream] + text).split("\n")
                partial[stream] = lines.pop()
                for (const line of lines) progress.status(xcodePhase(line))
            }

            const flush = () => {
                for (const stream of ["stdout", "stderr"]) {
                    partial[stream] = ""
                }
            }

            child.stdout.on("data", (data) => consume(data, "stdout"))
            child.stderr.on("data", (data) => consume(data, "stderr"))

            child.on("error", (error) => {
                flush()
                progress.resume()
                reject(error)
            })

            child.on("close", (code) => {
                flush()
                progress.resume()

                if (code === 0) {
                    resolve(output.trim())
                    return
                }

                // Carry the whole output so the reporter can mine the real
                // compiler errors out of it. A 5-line tail was arbitrary --
                // xcodebuild puts the cause in the middle and summary noise
                // at the end.
                const error = new Error(`Command failed with exit code ${code}`)
                error.code = code
                error.output = output
                reject(error)
            })
        })
    }

    function getXcodeProjectFilePath() {
        return path.join(PROJECT_DIR, `${PROJECT_NAME}.xcodeproj`, "project.pbxproj")
    }

    function ensureManagedBaseline(filePath) {
        const baselinePath = `${filePath}${MANAGED_BASELINE_SUFFIX}`
        if (!fs.existsSync(baselinePath)) {
            if (!fs.existsSync(filePath))
                throw new Error(`Managed baseline source file not found: ${filePath}`)
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
        WEBVIEW_CONFIG,
        BUILD_OUTPUT_PATH,
        iosConfig,
        isGoogleSignInEnabled,
        PROJECT_DIR,
        PROJECT_NAME,
        SCHEME_NAME,
        APP_BUNDLE_ID,
        IPHONE_MODEL,
        url,
        PUBLIC_PATH,
        progress,
        runCommand,
        runCommandStreaming,
        getXcodeProjectFilePath,
        ensureManagedBaseline,
        restoreManagedFileFromBaseline,
        readPlistObject,
        writePlistObject,
    }

    // ─── Instantiate phase modules ────────────────────────────────────────────

    const { generateConfigConstants, generateXCConfig, updateInfoPlist, updateEntitlements } =
        createConfigPhase(ctx)
    const { generatePackageSwift, updateXcodeProjectPackageDependencies, syncPluginResources } =
        createPluginsPhase(ctx)
    const { processNotificationAssets, copyOfflinePage, copySplashscreenAssets, copyAppIcon } =
        createAssetsPhase(ctx)
    const {
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
                            prefix: "├─ ",
                            color: "yellow",
                        },
                        {
                            text: "Provisioning profile matches your bundle ID",
                            indent: 1,
                            prefix: "├─ ",
                            color: "yellow",
                        },
                        {
                            text: "Device is connected and trusted",
                            indent: 1,
                            prefix: "└─ ",
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
            // Same aligned key/value shape as the Android summary and the
            // Config tree the setup commands print.
            progress.printTreeContent("Build", [
                {
                    text: `target         ${targetInfo.type === "physical" ? "physical device" : "simulator"}`,
                    color: "gray",
                },
                { text: `device         ${targetInfo.name}`, color: "gray" },
                { text: `artifact       ${APP_PATH}`, color: "gray" },
                { text: `url            ${url}`, color: "gray" },
            ])

            progress.summary("Installed", "Run catalyst start to serve the app")
            return { success: true, targetInfo, appPath: APP_PATH }
        } catch (error) {
            process.stderr.write(buildFailure({ error, stage: error.stage || "iOS build", cwd: originalDir }))

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
                await buildProjectForTesting(
                    SCHEME_NAME,
                    "iphonesimulator",
                    `platform=iOS Simulator,name=${IPHONE_MODEL}`,
                    APP_BUNDLE_ID,
                    derivedDataPath,
                    PROJECT_NAME
                )
                progress.complete("build")
            } catch (buildError) {
                progress.log(
                    "build-for-testing failed, attempting fallback with booted simulator...",
                    "warning"
                )
                const bootedUUID = await getBootedSimulatorUUID(IPHONE_MODEL)
                if (bootedUUID) {
                    await buildProjectForTesting(
                        SCHEME_NAME,
                        "iphonesimulator",
                        `platform=iOS Simulator,id=${bootedUUID}`,
                        APP_BUNDLE_ID,
                        derivedDataPath,
                        PROJECT_NAME
                    )
                    progress.complete("build")
                } else {
                    progress.fail("build", buildError.message)
                    throw buildError
                }
            }

            progress.log("build-for-testing complete — test bundle ready for xctest runner", "success")
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
