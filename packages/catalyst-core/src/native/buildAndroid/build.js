"use strict"

const { spawn, execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const { buildAndroidAAB } = require("../renameAndroidProject.js")
const { ensureLocalProperties } = require("../utils.js")
const { signingGradleEnv } = require("./signing.js")

// adb answers in milliseconds when healthy. A wedged adb server accepts the
// connection and never replies, so without a bound the build sat on
// "detecting physical devices" forever.
const ADB_TIMEOUT_MS = 15000

/** A timed-out device tool is fatal: every later adb call would hang the same way. */
const isToolTimeout = (error) => error?.code === "ETOOLTIMEOUT"

const DEFAULT_DEPLOYMENT_PATH = "./deployment"
const DEFAULT_OLD_PROJECT_NAME = "androidProject"
const DEFAULT_OVERWRITE_EXISTING = true

/**
 * Version and application id as Gradle project properties, passed through
 * the environment (ORG_GRADLE_PROJECT_*) like the signing values.
 */
function versionGradleEnv({ applicationId, version } = {}) {
    const env = {}
    if (applicationId) env.ORG_GRADLE_PROJECT_catalystApplicationId = applicationId
    if (version?.buildNumber) env.ORG_GRADLE_PROJECT_catalystVersionCode = String(version.buildNumber)
    if (version?.versionName) env.ORG_GRADLE_PROJECT_catalystVersionName = version.versionName
    return env
}

function createBuildPhase(ctx) {
    const { configPath: defaultConfigPath, pwd, progress, ANDROID_PACKAGE } = ctx

    async function detectPhysicalDevice(ADB_PATH) {
        try {
            progress.status("detecting physical devices")
            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - ADB_PATH is derived from androidConfig.sdkPath, a trusted internal config value.
            const devices = ctx.runCommand(`${ADB_PATH} devices -l`, { timeout: ADB_TIMEOUT_MS })
            const lines = devices
                .split("\n")
                .filter((line) => line.trim() && !line.includes("List of devices"))

            for (const line of lines) {
                const parts = line.trim().split(/\s+/)
                if (parts.length >= 2 && parts[1] === "device") {
                    const deviceId = parts[0]

                    if (!deviceId.startsWith("emulator-")) {
                        try {
                            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - deviceId comes from adb devices output, not user input.
                            const qemuCheck = ctx.runCommand(
                                `${ADB_PATH} -s ${deviceId} shell getprop ro.kernel.qemu`,
                                { timeout: ADB_TIMEOUT_MS }
                            )
                            if (!qemuCheck.trim()) {
                                progress.log(`Physical device detected: ${deviceId}`, "success")

                                let deviceModel = "Unknown Device"
                                try {
                                    // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - deviceId comes from adb devices output, not user input.
                                    const model = ctx.runCommand(
                                        `${ADB_PATH} -s ${deviceId} shell getprop ro.product.model`,
                                        { timeout: ADB_TIMEOUT_MS }
                                    )
                                    deviceModel = model.trim() || deviceModel
                                } catch (e) {
                                    // Ignore model detection errors
                                }

                                return { id: deviceId, model: deviceModel }
                            }
                        } catch (error) {
                            continue
                        }
                    }
                }
            }

            progress.log("No physical devices detected", "info")
            return null
        } catch (error) {
            if (isToolTimeout(error)) throw error
            progress.log("Error detecting physical devices: " + error.message, "error")
            return null
        }
    }

    async function testPhysicalDeviceInstallation(ADB_PATH, deviceId) {
        try {
            progress.log(`Testing installation capability on device ${deviceId}...`, "info")

            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - deviceId comes from adb devices output, not user input.
            const connectionTest = ctx.runCommand(`${ADB_PATH} -s ${deviceId} shell echo "test"`)
            if (!connectionTest.includes("test")) {
                progress.log("Device connection test failed", "error")
                return false
            }

            try {
                // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - deviceId comes from adb devices output, not user input.
                const developerOptions = ctx.runCommand(
                    `${ADB_PATH} -s ${deviceId} shell settings get global development_settings_enabled`
                )
                if (developerOptions.trim() !== "1") {
                    progress.log("Developer options not enabled on device", "warning")
                    return false
                }
            } catch (error) {
                progress.log("Cannot verify developer options status", "warning")
            }

            try {
                // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - deviceId comes from adb devices output, not user input.
                const usbDebugging = ctx.runCommand(
                    `${ADB_PATH} -s ${deviceId} shell settings get global adb_enabled`
                )
                if (usbDebugging.trim() !== "1") {
                    progress.log("USB debugging not enabled on device", "warning")
                    return false
                }
            } catch (error) {
                progress.log("Cannot verify USB debugging status", "warning")
            }

            try {
                // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - deviceId comes from adb devices output, not user input.
                ctx.runCommand(`${ADB_PATH} -s ${deviceId} shell pm list packages -3 | head -1`)
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

    // Returns the serial of an online emulator (adb state "device"), or null if
    // none is online. `devices.includes("emulator")` alone would also match a
    // serial like "emulator-5554" whose state is "offline" or still enumerating —
    // i.e. a device that's connected but not actually ready — so this checks the
    // state column explicitly rather than doing a substring match.
    async function checkEmulator(ADB_PATH) {
        try {
            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - ADB_PATH is derived from androidConfig.sdkPath, a trusted internal config value.
            const devices = ctx.runCommand(`${ADB_PATH} devices`, { timeout: ADB_TIMEOUT_MS })
            const onlineEmulator = devices
                .split("\n")
                .map((line) => line.trim().split(/\s+/))
                .find(([id, state]) => id?.startsWith("emulator-") && state === "device")
            return onlineEmulator ? onlineEmulator[0] : null
        } catch (error) {
            if (isToolTimeout(error)) throw error
            progress.log("Error checking emulator status: " + error.message, "error")
            return null
        }
    }

    /**
     * The task name from a gradle line, or null for lines worth ignoring.
     * "> Task :app:compileDebugKotlin" becomes "app:compileDebugKotlin".
     */
    function gradleTask(line) {
        const match = /^>\s*Task\s+:(\S+)/.exec(line.trim())
        return match ? match[1] : null
    }

    /**
     * Run something that writes directly to the terminal, with the progress
     * tree stood down for the duration.
     *
     * The resume must happen on the failure path too -- a build that throws
     * while paused would otherwise leave the tree silent for the rest of the
     * run, hiding exactly the output someone needs when a build fails.
     */
    async function withStreamedOutput(fn) {
        progress.pause()
        try {
            return await fn()
        } finally {
            progress.resume()
        }
    }

    // The Android emulator binary is a long-running server process — it does not
    // exit after boot, it keeps running until the emulator window is closed. Using
    // runInteractiveCommand (which only resolves on the child's `close` event, see
    // utils.js) would block forever waiting for an exit that never happens before
    // the app finishes booting. Spawn it detached instead (same approach as
    // androidSetup.js's startEmulator) and let handleEmulatorSetup poll for
    // readiness separately.
    /**
     * Launch the emulator detached and return once it has actually spawned
     * (not once it exits — see the note above on why runInteractiveCommand
     * can't be used here).
     * @returns {Promise<number>} the spawned process's pid, so a caller whose
     *   boot-readiness wait times out can kill it instead of leaving a
     *   CPU/RAM-heavy orphaned emulator running past a failed build.
     */
    async function startEmulator(EMULATOR_PATH, androidConfig) {
        progress.log(`Starting emulator: ${androidConfig.emulatorName}...`, "info")
        return new Promise((resolve, reject) => {
            // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - spawn with an argv array (no shell), so androidConfig.emulatorName can't be interpreted as shell syntax even though it comes from a locally-editable config file.
            const child = spawn(EMULATOR_PATH, ["-avd", androidConfig.emulatorName, "-read-only"], {
                detached: true,
                stdio: "ignore",
            })
            child.once("error", (error) => {
                progress.log("Error starting emulator: " + error.message, "error")
                reject(error)
            })
            // "error" only fires for spawn failures (e.g. bad EMULATOR_PATH); once the
            // process has actually spawned we can detach and let the caller poll adb
            // for boot readiness rather than waiting on this child at all.
            child.once("spawn", () => {
                const { pid } = child
                child.unref()
                progress.log("Emulator process started, waiting for it to boot...", "info")
                resolve(pid)
            })
        })
    }

    // Best-effort cleanup for an emulator process this build spawned but that
    // never became ready — kills the whole detached process group (negative pid)
    // so we don't leave a CPU/RAM-heavy orphaned emulator running after a failed
    // build. Never throws: a failure here shouldn't mask the original timeout error.
    function killOrphanedEmulator(pid, emulatorName) {
        try {
            process.kill(-pid, "SIGTERM")
            progress.log(`Stopped orphaned emulator process (pid ${pid}) after boot failure`, "info")
        } catch (error) {
            progress.log(
                `Could not stop orphaned emulator "${emulatorName}" (pid ${pid}): ${error.message}. ` +
                    "You may need to quit it manually.",
                "warning"
            )
        }
    }

    function listEmulatorSerials(ADB_PATH) {
        try {
            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - ADB_PATH is derived from androidConfig.sdkPath, a trusted internal config value.
            const devices = ctx.runCommand(`${ADB_PATH} devices`, { timeout: ADB_TIMEOUT_MS })
            return devices
                .split("\n")
                .map((line) => line.trim().split(/\s+/)[0])
                .filter((id) => id && id.startsWith("emulator-"))
        } catch (error) {
            if (isToolTimeout(error)) throw error
            return []
        }
    }

    // Waits for a NEW emulator-XXXX serial to appear in `adb devices` (one not in
    // knownSerials, captured before startEmulator was called), so boot polling can
    // be scoped to the emulator this build just launched rather than whichever
    // device `adb shell` (with no -s) happens to pick when multiple are connected.
    async function waitForNewEmulatorSerial(
        ADB_PATH,
        knownSerials,
        { timeoutMs = 30000, pollIntervalMs = 1000 } = {}
    ) {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
            const current = listEmulatorSerials(ADB_PATH)
            const newSerial = current.find((id) => !knownSerials.includes(id))
            if (newSerial) return newSerial
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
        }
        return null
    }

    /**
     * Poll a specific emulator (by adb serial, e.g. "emulator-5554") until it
     * reports a completed boot and a stopped boot animation, or the timeout
     * elapses.
     * @param {string} ADB_PATH Path to the adb executable.
     * @param {string} serial The emulator's adb serial to target (adb -s).
     * @param {Object} [options]
     * @param {number} [options.timeoutMs=120000] Overall deadline in milliseconds.
     * @param {number} [options.pollIntervalMs=2000] Delay between readiness checks.
     * @returns {Promise<boolean>} true once both readiness signals are observed;
     *   false if the deadline elapses first (a transient/hung adb call counts
     *   against the same deadline via the per-call execFileSync timeout below).
     */
    async function waitForEmulatorBoot(ADB_PATH, serial, { timeoutMs = 120000, pollIntervalMs = 2000 } = {}) {
        const deadline = Date.now() + timeoutMs
        const getprop = (prop) => {
            const remaining = Math.max(deadline - Date.now(), 1000)
            return execFileSync(ADB_PATH, ["-s", serial, "shell", "getprop", prop], {
                encoding: "utf8",
                timeout: remaining,
                // "adb: device offline" is the expected answer while the
                // emulator boots; inherited, it landed on the spinner's row.
                stdio: ["ignore", "pipe", "ignore"],
            }).trim()
        }
        while (Date.now() < deadline) {
            try {
                const bootCompleted = getprop("sys.boot_completed")
                const bootAnimDone = getprop("init.svc.bootanim")
                if (bootCompleted === "1" && bootAnimDone === "stopped") return true
            } catch {
                // adb not ready yet (device still enumerating), or this call hit its
                // own per-call timeout — either way, keep polling against the outer
                // deadline rather than treating it as fatal.
            }
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
        }
        return false
    }

    // Message mirrors errors/registry.js ERROR_DEFINITIONS[ANDROID-001] (see
    // errors/ANDROID/ANDROID-001.md) — this CJS subtree can't import the ESM
    // error registry (see buildErrorFormat.js), so the code is prefixed onto the
    // thrown message directly rather than imported.
    function emulatorBootTimeoutError(detail) {
        return new Error(`[ANDROID-001] Timed out waiting for the Android emulator to boot: ${detail}`)
    }

    async function handleEmulatorSetup(ADB_PATH, EMULATOR_PATH, androidConfig) {
        progress.status("setting up emulator")
        let serial = await checkEmulator(ADB_PATH)
        let pid = null
        if (!serial) {
            progress.log("No emulator running, attempting to start one...", "info")
            const knownSerials = listEmulatorSerials(ADB_PATH)
            pid = await startEmulator(EMULATOR_PATH, androidConfig)
            serial = await waitForNewEmulatorSerial(ADB_PATH, knownSerials)
            if (!serial) {
                killOrphanedEmulator(pid, androidConfig.emulatorName)
                throw emulatorBootTimeoutError(
                    `emulator "${androidConfig.emulatorName}" never appeared in adb devices`
                )
            }
        } else {
            progress.log(`Emulator ${serial} already online, confirming it's fully booted...`, "info")
        }
        // Wait for boot readiness whether the emulator was already online (it may
        // still be finishing its boot animation) or was just launched above.
        const booted = await waitForEmulatorBoot(ADB_PATH, serial)
        if (!booted) {
            if (pid) killOrphanedEmulator(pid, androidConfig.emulatorName)
            throw emulatorBootTimeoutError(
                `emulator "${androidConfig.emulatorName}" (${serial}) never finished booting`
            )
        }
        progress.log("Emulator booted successfully", "success")
        return { type: "emulator", name: androidConfig.emulatorName }
    }

    async function buildApp(
        ADB_PATH,
        androidConfig,
        buildOptimisation,
        targetDevice = null,
        { configPath = defaultConfigPath, applicationId, version } = {}
    ) {
        progress.status("building and installing app")
        try {
            // Gradle needs the SDK location in local.properties. Only
            // setupEmulator:android wrote it, so building without a prior
            // setup died in gradle despite a configured sdkPath.
            if (androidConfig.sdkPath) ensureLocalProperties(`${pwd}/androidProject`, androidConfig.sdkPath)

            // --quiet was the Android silence: it suppresses gradle's task and
            // error output entirely. --console=rich emits ANSI redraws, which
            // are meaningless on a pipe; plain gives one line per task.
            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - pwd and configPath are internal resolved paths, not user input.
            let buildCommand = `cd ${pwd}/androidProject && ./gradlew generateWebViewConfig -PconfigPath=${configPath} -PcatalystBuildType=debug -PbuildOptimisation=${buildOptimisation} && ./gradlew clean installDebug -PconfigPath=${configPath} -PcatalystBuildType=debug --console=plain`

            if (targetDevice && targetDevice.type === "physical") {
                buildCommand = buildCommand.replace(
                    "installDebug",
                    `installDebug -Pandroid.injected.target.device=${targetDevice.id}`
                )
            }

            // Gradle emits hundreds of lines that nobody reads on success and
            // that the error path re-derives from error.output anyway. Show the
            // current task on the spinner's own row instead of scrolling them.
            await ctx.runInteractiveCommand(
                "sh",
                ["-c", buildCommand],
                { "BUILD SUCCESSFUL": "" },
                {
                    onLine: (line) => progress.status(gradleTask(line)),
                    env: { ...process.env, ...versionGradleEnv({ applicationId, version }) },
                }
            )
        } catch (error) {
            // Re-wrapping with a new Error dropped `output`, and with it the
            // compiler errors. Keep the original and let the reporter mine it.
            error.stage = "Building and installing the app"
            throw error
        }
    }

    async function launchApp(
        ADB_PATH,
        buildType = "debug",
        targetDevice = null,
        applicationId = ANDROID_PACKAGE
    ) {
        if (!targetDevice) {
            progress.log("No target device specified, skipping launch", "warning")
            return
        }

        if (targetDevice.type === "physical") {
            progress.log(`App installed on physical device: ${targetDevice.model}`, "success")
            progress.log("Open the app on your device to launch it", "note")
            return
        }

        try {
            progress.status("launching app on emulator")
            const packageName = `${applicationId}${buildType === "debug" ? ".debug" : ""}`
            // nosemgrep: javascript.lang.security.audit.dangerous-spawn-shell-command.dangerous-spawn-shell-command - ADB_PATH is derived from androidConfig.sdkPath, a trusted internal config value.
            const launchCommand = `${ADB_PATH} shell monkey -p ${packageName} 1`
            await ctx.runInteractiveCommand("sh", ["-c", launchCommand], {})
        } catch (error) {
            progress.log(`Warning: Could not auto-launch app: ${error.message}`, "warning")
            progress.log("App was installed successfully, but auto-launch failed", "info")
        }
    }

    function aabNames(androidConfig) {
        const newProjectName =
            androidConfig.newProjectName ||
            androidConfig.appName ||
            androidConfig.packageName?.split(".").pop() ||
            "catalystapp"
        const outputPath = androidConfig.outputPath || `${process.cwd()}/build-output`
        return { newProjectName, outputPath }
    }

    /** Where releases before 1.1.1 left a copy of their (per-build) keystore. */
    function legacyKeystorePath(androidConfig) {
        const { newProjectName, outputPath } = aabNames(androidConfig)
        return path.join(outputPath, `${newProjectName}-keystore.jks`) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - outputPath and the name come from the app's own config.
    }

    async function createAABConfig(androidConfig) {
        const DEFAULT_PROJECT_PATH = `${pwd}/androidProject`

        const aabConfig = {
            projectPath: androidConfig.projectPath || DEFAULT_PROJECT_PATH,
            deploymentPath: DEFAULT_DEPLOYMENT_PATH,
            oldProjectName: DEFAULT_OLD_PROJECT_NAME,
            overwriteExisting:
                androidConfig.overwriteExisting !== undefined
                    ? androidConfig.overwriteExisting
                    : DEFAULT_OVERWRITE_EXISTING,

            newProjectName: aabNames(androidConfig).newProjectName,

            packageName: androidConfig.packageName || null,

            createSignedAAB: true,
            outputPath: aabNames(androidConfig).outputPath,
        }

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
            if (!BUILD_OUTPUT_PATH) {
                progress.log("BUILD_OUTPUT_PATH not set, skipping APK move", "warning")
                return null
            }

            const currentDate = new Date().toLocaleDateString("en-GB").replace(/\//g, "-")
            // 24-hour and locale-free: "02-05-09 PM" put a space in every
            // artifact name, which breaks unquoted shell use of the path.
            const currentTime = new Date().toTimeString().slice(0, 8).replace(/:/g, "-")
            let destinationApkFileName = ""

            if (appName) {
                destinationApkFileName =
                    buildType === "release"
                        ? `${appName}-${currentTime}.release.apk`
                        : `${appName}-${currentTime}.debug.apk`
            } else {
                destinationApkFileName =
                    buildType === "release"
                        ? `app-${currentTime}.release.apk`
                        : `app-${currentTime}.debug.apk`
            }

            const sourceApkFileName = buildType === "release" ? `app.apk` : `app-debug.apk`

            const sourceApkPath = path.join(
                pwd, // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - pwd is an internal resolved path.
                "androidProject",
                "app",
                "build",
                "outputs",
                "apk",
                buildType, // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - buildType is "debug" or "release" from config.
                sourceApkFileName
            )
            const destinationDir = path.join(
                process.cwd(),
                BUILD_OUTPUT_PATH, // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - BUILD_OUTPUT_PATH is trusted application config.
                "native",
                "android",
                currentDate,
                buildType // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - buildType is "debug" or "release" from config.
            )
            const destinationApkPath = path.join(destinationDir, destinationApkFileName) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - destinationDir and destinationApkFileName are derived from internal config values, not user input.

            if (!fs.existsSync(sourceApkPath)) {
                progress.log(`APK not found at source path: ${sourceApkPath}`, "warning")
                return null
            }

            if (!fs.existsSync(destinationDir)) {
                fs.mkdirSync(destinationDir, { recursive: true })
            }

            fs.copyFileSync(sourceApkPath, destinationApkPath)
            return destinationApkPath
        } catch (error) {
            progress.log(`Error moving APK: ${error.message}`, "error")
            return null
        }
    }

    /**
     * Build the signed release bundle. The webview config is generated in
     * the temp_build_<pkg> copy that Gradle then bundles, from the resolved
     * release config and with -PcatalystBuildType=release, so the release
     * branch of generateWebViewConfig actually runs. Signing and version
     * values reach Gradle through the environment, never argv.
     */
    async function buildSignedAAB(
        androidConfig,
        { configPath = defaultConfigPath, signing, version, applicationId, buildOptimisation = false } = {}
    ) {
        progress.log("Building signed AAB for release...", "info")

        try {
            if (!signing) throw new Error("No upload key resolved for the release build")
            // Same as buildApp: gradle needs local.properties on a fresh machine.
            if (androidConfig.sdkPath) ensureLocalProperties(`${pwd}/androidProject`, androidConfig.sdkPath)

            const aabConfig = await createAABConfig(androidConfig)
            aabConfig.gradle = {
                configPath,
                buildOptimisation,
                env: {
                    ...process.env,
                    ...versionGradleEnv({ applicationId, version }),
                    ...signingGradleEnv(signing),
                },
            }
            // buildAndroidAAB shells out to `./gradlew bundleRelease` and prints
            // its own progress lines, so it owns the screen for its duration.
            const result = await withStreamedOutput(() => buildAndroidAAB(aabConfig))

            progress.log("Signed AAB build completed successfully!", "success")
            return result
        } catch (error) {
            error.stage = "Building the signed AAB"
            throw error
        }
    }

    return {
        detectPhysicalDevice,
        testPhysicalDeviceInstallation,
        checkEmulator,
        handleEmulatorSetup,
        startEmulator,
        waitForEmulatorBoot,
        buildApp,
        launchApp,
        createAABConfig,
        legacyKeystorePath,
        moveApkToOutputPath,
        buildSignedAAB,
    }
}

module.exports = createBuildPhase
