"use strict"

const { execFile, execFileSync, spawn } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { displayPath } = require("../../cli/theme.js")
const TerminalProgress = require("../terminalProgress.js").default
const { buildFailure } = require("../../cli/diagnostic.js")
const { resolveNativeConfig, assertReleaseHost, resolveAppVersion, nativeError } = require("../utils.js")
const {
    isReleaseBuildType,
    resolveExportMethod,
    resolveAscApiKey,
    planIosSigning,
    xcodeAuthArgs,
    setupCiSigning,
    buildExportOptions,
    writeExportOptionsPlist,
    isSigningFailure,
    signingSetupError,
} = require("./signing.js")
const { generateLocalhostP12 } = require("./localhostCert.js")

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

/** A file-name-safe version of the app name for the release artifacts. */
function artifactBaseName(appName) {
    const safe = String(appName || "")
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
    return safe || "app"
}

/**
 * @param {object} config - { WEBVIEW_CONFIG, BUILD_OUTPUT_PATH } from config.json
 * @param {object} [options]
 * @param {object} [options.progress] - an existing TerminalProgress to continue, when the build is re-created after the config changed
 * @param {boolean} [options.release] - `--release`: archive and export the store IPA whatever ios.buildType says
 * @param {boolean} [options.noSign] - `--no-sign`: an unsigned release archive and no export (CI)
 * @param {string} [options.buildNumber] - `--build-number`
 */
function createIosBuild(
    config,
    { progress: existingProgress, release: releaseFlag = false, noSign = false, buildNumber } = {}
) {
    const { BUILD_OUTPUT_PATH } = config
    const release = Boolean(
        releaseFlag || noSign || isReleaseBuildType(config.WEBVIEW_CONFIG?.ios?.buildType)
    )

    const steps = {
        server: "Start dev server",
        signing: "Resolve signing",
        config: "Generate build configuration",
        deviceDetection: "Detect physical device",
        launchSimulator: "Launch iOS simulator",
        clean: "Clean build artifacts",
        assets: "Process notification assets",
        build: "Build iOS project",
        findApp: "Locate built application",
        install: "Install application",
        launch: "Launch application",
        archive: "Archive release build",
        export: "Export IPA",
    }

    const progress = existingProgress || new TerminalProgress(steps, "catalyst buildApp", { subject: "ios" })
    const log = (message, type) => progress.log(message, type)

    // ─── Release resolution, before anything reads the config ─────────────────
    // `release` is merged over the base config, the start URL must be a public
    // host, and the build number is required. All of it fails here, before
    // Xcode is touched.

    let WEBVIEW_CONFIG = config.WEBVIEW_CONFIG
    let allowPrivateHost = false
    if (release) {
        const resolved = resolveNativeConfig("ios", { release: true, config, log })
        // iOS reads the merged config in memory; Gradle is the one that needs the file.
        resolved.cleanup()
        WEBVIEW_CONFIG = resolved.WEBVIEW_CONFIG
        WEBVIEW_CONFIG.ios = { ...WEBVIEW_CONFIG.ios, buildType: "release" }
        allowPrivateHost = resolved.allowPrivateHost
        assertReleaseHost("ios", WEBVIEW_CONFIG, { allowPrivateHost, log })
    }
    const version = resolveAppVersion("ios", { WEBVIEW_CONFIG, release, buildNumber })
    const exportMethod = release ? resolveExportMethod(WEBVIEW_CONFIG.ios || {}, { log }) : undefined
    const signingPlan = planIosSigning({ iosConfig: WEBVIEW_CONFIG.ios || {}, release, noSign, exportMethod })
    // The API key signs releases here and device builds once a device is
    // found (a simulator build never needs it). A temp copy of a base64 key
    // is removed by cleanup().
    const resolveApiKey = () =>
        signingPlan.style === "automatic"
            ? resolveAscApiKey({ iosConfig: WEBVIEW_CONFIG.ios || {}, appRoot: process.cwd(), log })
            : null
    const apiKey = release ? resolveApiKey() : null
    if (release && signingPlan.style === "automatic" && !signingPlan.teamId) {
        apiKey?.cleanup()
        throw nativeError(
            "IOS-010",
            "a signed release with automatic signing needs WEBVIEW_CONFIG.ios.developmentTeam (pass --no-sign for an unsigned archive)"
        )
    }

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
    // What Shared.xcconfig sets as PRODUCT_BUNDLE_IDENTIFIER (generateXCConfig).
    const PRODUCT_BUNDLE_ID =
        iosConfig.bundleIdentifier || iosConfig.appBundleId || "com.catalyst.framework.app"
    const PROJECT_NAME = path.basename(PROJECT_DIR)
    const IPHONE_MODEL = iosConfig.simulatorName

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
    function runCommandStreaming(command, args) {
        return new Promise((resolve, reject) => {
            progress.pause()

            // With `args`, the program runs directly with that argv (no shell
            // quoting to get wrong); without, `command` is a shell string.
            // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Internal build command strings, same source as runCommand.
            const child = Array.isArray(args)
                ? spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
                : spawn(shellCommand, shellArgs(command), { stdio: ["ignore", "pipe", "pipe"] })

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
        // Captured before the build chdirs into the Xcode project.
        appRoot: process.cwd(),
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
        release,
        version,
        signingPlan,
        apiKey,
        resolveApiKey,
        apsEnvironment: signingPlan.apsEnvironment,
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

    /** A fresh self-signed localhost identity for the in-app HTTPS server, every build. */
    function generateLocalhostCertificate() {
        generateLocalhostP12(path.join(PROJECT_DIR, PROJECT_NAME, "localhost.p12"))
    }

    /** <app>/<BUILD_OUTPUT_PATH>/native/ios/<version>-<build>, from the app root, not the cwd. */
    function releaseOutputDir() {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - appRoot and BUILD_OUTPUT_PATH come from the local app and its config.
        return path.resolve(
            ctx.appRoot,
            BUILD_OUTPUT_PATH || "build-output",
            "native",
            "ios",
            `${version.versionName || "1.0.0"}-${version.buildNumber}`
        )
    }

    /** Remove the previous artifact at this path, so a rebuild of the same version replaces it. */
    function clearArtifact(target) {
        fs.rmSync(target, { recursive: true, force: true })
    }

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
            generateLocalhostCertificate()
            process.chdir(PROJECT_DIR)
            const physicalDevice = await detectPhysicalDevices()
            let APP_PATH, targetInfo
            if (physicalDevice) {
                progress.log("Building for physical device workflow", "success")
                targetInfo = { type: "physical", name: physicalDevice.name, udid: physicalDevice.udid }
                await cleanBuildArtifacts()
                progress.start("build")
                try {
                    if (!ctx.apiKey) ctx.apiKey = ctx.resolveApiKey()
                    await buildProjectForPhysicalDevice(
                        SCHEME_NAME,
                        APP_BUNDLE_ID,
                        path.join(process.env.HOME, "Library/Developer/Xcode/DerivedData"),
                        PROJECT_NAME,
                        physicalDevice
                    )
                    progress.complete("build")
                } catch (error) {
                    // The diagnostic in the catch below shows what xcodebuild
                    // said. A signing failure gets IOS-010, which names both
                    // ways to set signing up. Not checked up front: an Apple
                    // account signed in to Xcode signs fine without either.
                    const failure = isSigningFailure(error.output)
                        ? signingSetupError("Xcode could not sign the device build", error)
                        : error
                    failure.stage = failure.stage || "Building for the device"
                    throw failure
                }
                progress.start("findApp")
                try {
                    APP_PATH = await findPhysicalDeviceAppPath()
                    progress.log("Found app at: " + APP_PATH, "success")
                    progress.complete("findApp")
                } catch (error) {
                    error.stage = error.stage || "Locating the built app"
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
            const deviceName = `${targetInfo.name}${targetInfo.type === "physical" ? "" : " simulator"}`
            progress.printTreeContent("Build", [
                { text: `device     ${deviceName}`, color: "gray" },
                { text: `artifact   ${displayPath(APP_PATH, originalDir)}`, color: "gray" },
                { text: `loads      ${url}`, color: "gray" },
            ])

            progress.summary(`Installed on ${deviceName}`, "Run catalyst start to serve the app")
            return { success: true, targetInfo, appPath: APP_PATH }
        } catch (error) {
            // Mark the step, then show what actually broke -- once. The ✗ line
            // carries no message: the diagnostic below is the message.
            if (progress.currentStep) progress.fail(progress.currentStep.id)
            process.stderr.write(
                buildFailure({ error, stage: error.stage || "iOS build", code: "IOS-000", cwd: originalDir })
            )

            throw error
        } finally {
            process.chdir(originalDir)
        }
    }

    /**
     * The store build: `xcodebuild archive` in Release for a generic iOS
     * device, then `-exportArchive` to an IPA, with the IPA and zipped dSYMs
     * written to releaseOutputDir(). With --no-sign the archive is built with
     * CODE_SIGNING_ALLOWED=NO, nothing is exported, and the .xcarchive itself
     * is the artifact.
     */
    async function buildReleaseForIOS(pluginComposition = {}) {
        const originalDir = process.cwd()
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - fixed prefix under the OS temp dir.
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-ios-release-"))
        let ciSigning = null
        try {
            await generatePackageSwift(pluginComposition.iosDependencies)
            await updateXcodeProjectPackageDependencies()
            progress.start("assets")
            await processNotificationAssets(WEBVIEW_CONFIG)
            await copyOfflinePage()
            progress.complete("assets")

            progress.start("signing")
            const signing = { ...signingPlan }
            if (signingPlan.ci) {
                ciSigning = setupCiSigning({ bundleId: PRODUCT_BUNDLE_ID, log })
                signing.provisioningProfile = ciSigning.profile.name
                signing.identity = ciSigning.identity.sha1
                signing.teamId = ciSigning.profile.teamId || signing.teamId
            } else if (signing.style === "manual" && exportMethod !== "debugging") {
                signing.identity = "iPhone Distribution"
            }
            if (signing.style === "none") {
                progress.log("Unsigned archive (--no-sign); the IPA export is skipped", "info")
            } else if (signing.style === "manual") {
                progress.log(`Manual signing with profile "${signing.provisioningProfile}"`, "info")
            } else {
                progress.log(
                    ctx.apiKey
                        ? `Automatic signing for team ${signing.teamId} with App Store Connect key ${ctx.apiKey.keyId} (${ctx.apiKey.source})`
                        : `Automatic signing for team ${signing.teamId} with the Apple account signed in to Xcode`,
                    "info"
                )
            }
            progress.complete("signing")

            await generateXCConfig({ signing, version })
            await copySplashscreenAssets()
            await copyAppIcon({ release: true })
            generateLocalhostCertificate()
            process.chdir(PROJECT_DIR)

            const outDir = releaseOutputDir()
            fs.mkdirSync(outDir, { recursive: true })
            const name = artifactBaseName(iosConfig.appName)
            const archivePath = path.join(signing.style === "none" ? outDir : workDir, `${name}.xcarchive`)
            clearArtifact(archivePath)

            const signingArgs =
                signing.style === "none"
                    ? ["CODE_SIGNING_ALLOWED=NO"]
                    : signing.style === "automatic"
                      ? xcodeAuthArgs(ctx.apiKey)
                      : []
            progress.start("archive")
            try {
                await runCommandStreaming("xcodebuild", [
                    "archive",
                    "-project",
                    `${PROJECT_NAME}.xcodeproj`,
                    "-scheme",
                    SCHEME_NAME,
                    "-configuration",
                    "Release",
                    "-destination",
                    "generic/platform=iOS",
                    "-archivePath",
                    archivePath,
                    ...signingArgs,
                ])
            } catch (error) {
                const failure =
                    signing.style !== "none" && isSigningFailure(error.output)
                        ? signingSetupError("Xcode could not sign the release archive", error)
                        : error
                failure.stage = "Archiving the release build"
                throw failure
            }
            progress.complete("archive")

            const rows = []
            let result
            if (signing.style === "none") {
                rows.push({ text: `archive    ${displayPath(archivePath, originalDir)}`, color: "gray" })
                result = { archivePath }
            } else {
                progress.start("export")
                const exportPath = path.join(workDir, "export")
                const optionsPlist = writeExportOptionsPlist(
                    buildExportOptions({
                        method: exportMethod,
                        teamId: signing.teamId,
                        signingStyle: signing.style,
                        bundleId: PRODUCT_BUNDLE_ID,
                        profileName: signing.provisioningProfile,
                        signingCertificate: signing.ci ? signing.identity : undefined,
                    }),
                    path.join(workDir, "ExportOptions.plist")
                )
                try {
                    await runCommandStreaming("xcodebuild", [
                        "-exportArchive",
                        "-archivePath",
                        archivePath,
                        "-exportPath",
                        exportPath,
                        "-exportOptionsPlist",
                        optionsPlist,
                        ...(signing.style === "automatic" ? xcodeAuthArgs(ctx.apiKey) : []),
                    ])
                } catch (error) {
                    const failure = isSigningFailure(error.output)
                        ? signingSetupError("Xcode could not sign the IPA for export", error)
                        : error
                    failure.stage = "Exporting the IPA"
                    throw failure
                }
                const exported = fs.readdirSync(exportPath).find((file) => file.endsWith(".ipa"))
                if (!exported) throw new Error(`xcodebuild -exportArchive wrote no .ipa to ${exportPath}`)
                const ipaPath = path.join(outDir, `${name}.ipa`)
                clearArtifact(ipaPath)
                fs.copyFileSync(path.join(exportPath, exported), ipaPath)

                const dsymsDir = path.join(archivePath, "dSYMs")
                const dsymsZip = path.join(outDir, `${name}-dSYMs.zip`)
                clearArtifact(dsymsZip)
                if (fs.existsSync(dsymsDir) && fs.readdirSync(dsymsDir).length > 0) {
                    execFileSync("ditto", ["-c", "-k", "--keepParent", dsymsDir, dsymsZip])
                }
                progress.complete("export")
                rows.push({ text: `artifact   ${displayPath(ipaPath, originalDir)}`, color: "gray" })
                if (fs.existsSync(dsymsZip)) {
                    rows.push({ text: `dSYMs      ${displayPath(dsymsZip, originalDir)}`, color: "gray" })
                }
                result = { ipaPath, dsymsZip: fs.existsSync(dsymsZip) ? dsymsZip : null }
            }

            rows.push({
                text: `version    ${version.versionName || "1.0.0"} (${version.buildNumber})`,
                color: "gray",
            })
            rows.push({
                text: `signing    ${signing.style === "none" ? "unsigned" : `${signing.style}, ${exportMethod}`}`,
                color: "gray",
            })
            rows.push({ text: `loads      ${url}`, color: "gray" })
            progress.printTreeContent("Build", rows)
            if (signing.style === "none") {
                progress.summary(
                    "Built the unsigned release archive",
                    "Sign and export it, or build with signing set up"
                )
            } else {
                progress.summary("Built the signed IPA", "Upload it to App Store Connect with Transporter")
            }
            return { success: true, ...result }
        } catch (error) {
            if (progress.currentStep) progress.fail(progress.currentStep.id)
            process.stderr.write(
                buildFailure({
                    error,
                    stage: error.stage || "iOS release build",
                    code: "IOS-000",
                    cwd: originalDir,
                })
            )
            throw error
        } finally {
            ciSigning?.cleanup()
            fs.rmSync(workDir, { recursive: true, force: true })
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
            generateLocalhostCertificate()

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
        buildReleaseForIOS,
        buildIosForTesting,
        progress,
        release,
        version,
        WEBVIEW_CONFIG,
        PROJECT_DIR,
        SCHEME_NAME,
        /** Removes the temp copy of a base64 API key. */
        cleanup: () => ctx.apiKey?.cleanup(),
    }
}

module.exports = { createIosBuild, pwd }
