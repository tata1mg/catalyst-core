import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import {
    runCommand,
    expandHome,
    detectAndroidSdk,
    parseNativeArgs,
    promptUser,
    confirm,
    isInteractiveTerminal,
    ANDROID_SDK_HINT,
} from "./utils.js"
import { applyJavaHome, defaultSdkPath, ensureAndroidSdk, ensureJava } from "./androidToolchain.js"
import TerminalProgress from "./terminalProgress.js"
import { buildFailure } from "../cli/diagnostic.js"
import { setupServer } from "./setupServer.js"

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
const pwd = path.join(catalystCorePath, "dist/native")
const configPath = `${process.env.PWD}/config/config.json`
const flags = parseNativeArgs(process.argv.slice(2))

// Sentence case, verb first: these read as a sequence of actions, not as
// headings.
const steps = {
    java: "Check Java (JDK 17+)",
    config: "Initialize configuration",
    sdk: "Set up the Android SDK",
    androidTools: "Validate Android tools",
    emulator: "Configure Android emulator",
    properties: "Update local.properties",
    saveConfig: "Save configuration",
    setupServer: "Set up server",
}

const progress = new TerminalProgress(steps, "catalyst setupEmulator", { subject: "android" })
const log = (message, type = "info") => progress.log(message, type)

/**
 * JDK 17+ for this process and every tool it starts (Gradle, sdkmanager,
 * avdmanager). JAVA_HOME is set here only; no shell profile is edited.
 */
async function validateJavaEnvironment() {
    progress.start("java")
    const java = await ensureJava({ log })
    applyJavaHome(java)
    progress.log(`Java ${java.version} from ${java.source} (${java.home})`, "info")
    progress.complete("java")
}

async function initializeConfig() {
    const configFile = fs.readFileSync(configPath, "utf8")
    const config = JSON.parse(configFile)
    const { WEBVIEW_CONFIG } = config

    if (!WEBVIEW_CONFIG || Object.keys(WEBVIEW_CONFIG).length === 0) {
        progress.log("WebView Config missing in " + configPath, "error")
        process.exit(1)
    }

    if (!WEBVIEW_CONFIG.android) {
        WEBVIEW_CONFIG.android = {}
    }

    return { config, WEBVIEW_CONFIG }
}

/**
 * Write what setup worked out (port, buildType, sdkPath, emulatorName) into
 * config/config.json, after a terminal confirm or --yes. Without either the
 * values are used for this run only and the user is told how to keep them.
 */
async function saveAndroidConfig(changes) {
    const keys = Object.keys(changes)
    if (!keys.length) return false
    const summary = keys.map((key) => `${key}=${changes[key]}`).join(", ")
    const ok =
        flags.yes ||
        (await confirm(`Save ${keys.join(", ")} to config/config.json`, { isTTY: isInteractiveTerminal() }))
    if (!ok) {
        progress.log(`Not saved to config/config.json (pass --yes to save): ${summary}`, "note")
        return false
    }
    const existing = JSON.parse(fs.readFileSync(configPath, "utf8"))
    const webview = existing.WEBVIEW_CONFIG || {}
    const { port, ...android } = changes
    existing.WEBVIEW_CONFIG = {
        ...webview,
        ...(port !== undefined ? { port } : {}),
        android: { ...(webview.android || {}), ...android },
    }
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2))
    progress.log(`Saved ${keys.join(", ")} to config/config.json`, "note")
    return true
}

function validateAndroidTools(androidConfig) {
    const ANDROID_SDK = expandHome(androidConfig.sdkPath)
    const EMULATOR_PATH = `${ANDROID_SDK}/emulator/emulator`
    const ADB_PATH = `${ANDROID_SDK}/platform-tools/adb`

    if (!ANDROID_SDK) {
        throw Object.assign(new Error("Android SDK not found"), { hint: ANDROID_SDK_HINT })
    }

    if (!fs.existsSync(ANDROID_SDK)) {
        throw new Error(`Android SDK path does not exist: ${ANDROID_SDK}`)
    }

    if (!fs.existsSync(ADB_PATH)) {
        throw new Error(`ADB not found at: ${ADB_PATH}`)
    }

    try {
        runCommand(`${ADB_PATH} version`)
    } catch (error) {
        throw new Error(`ADB is not working properly: ${error.message}`)
    }

    if (!fs.existsSync(EMULATOR_PATH)) {
        throw new Error(`Emulator not found at: ${EMULATOR_PATH}`)
    }

    try {
        runCommand(`${EMULATOR_PATH} -version`)
    } catch (error) {
        throw new Error(`Emulator is not working properly: ${error.message}`)
    }

    try {
        const avdOutput = runCommand(`${EMULATOR_PATH} -list-avds`)
        if (!avdOutput.includes(androidConfig.emulatorName)) {
            throw new Error(`Specified emulator "${androidConfig.emulatorName}" not found in available AVDs`)
        }
        progress.log(`Using emulator "${androidConfig.emulatorName}"`, "info")
    } catch (error) {
        throw new Error(`Error checking emulator AVD: ${error.message}`)
    }

    return { EMULATOR_PATH, ADB_PATH }
}

async function checkEmulator(ADB_PATH) {
    try {
        const devices = runCommand(`${ADB_PATH} devices`, { timeout: 15000 })
        return devices.includes("emulator")
    } catch (error) {
        progress.log(`Error checking emulator: ${error}`, "error")
        return false
    }
}

async function startEmulator(EMULATOR_PATH, androidConfig) {
    progress.log(`Starting emulator: ${androidConfig.emulatorName}...`)
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - spawn with an argv array (no shell), so androidConfig.emulatorName can't be interpreted as shell syntax even though it comes from a locally-editable config file.
    const child = spawn(EMULATOR_PATH, ["-avd", androidConfig.emulatorName, "-read-only"], {
        detached: true,
        stdio: "ignore",
    })
    child.on("error", (error) => {
        progress.log(`Error starting emulator: ${error}`, "error")
    })
    child.unref()
}

async function updateLocalProperties(sdkPath) {
    progress.start("properties")
    try {
        runCommand(`cd ${pwd}/androidProject && ./gradlew updateSdkPath -PsdkPath="${sdkPath}"`)
        progress.complete("properties")
    } catch (error) {
        progress.fail("properties", `Failed to update local.properties: ${error.message}`)
        throw error
    }
}

async function setupAndroidEnvironment() {
    try {
        await validateJavaEnvironment()

        progress.start("config")
        const { config, WEBVIEW_CONFIG } = await initializeConfig()
        const fileAndroid = WEBVIEW_CONFIG.android
        const changes = {}
        let port = WEBVIEW_CONFIG.port
        if (!port) {
            port = config.NODE_SERVER_PORT
                ? String(config.NODE_SERVER_PORT)
                : await promptUser("Port the app is served on", { defaultValue: "3005" })
            changes.port = port
        }
        const buildType = fileAndroid.buildType || "debug"
        if (!fileAndroid.buildType) changes.buildType = buildType
        progress.complete("config")

        progress.start("sdk")
        const sdkPath = expandHome(fileAndroid.sdkPath) || detectAndroidSdk() || defaultSdkPath()
        const sdk = await ensureAndroidSdk({
            sdkPath,
            emulatorName: fileAndroid.emulatorName,
            yes: flags.yes,
            acceptLicenses: flags.acceptLicenses,
            log,
        })
        if (sdk.installed.length) progress.log(`Installed ${sdk.installed.join(", ")}`, "success")
        if (sdk.createdAvd) progress.log(`Created the "${sdk.emulatorName}" emulator`, "success")
        if (!fileAndroid.sdkPath) changes.sdkPath = sdkPath
        if (fileAndroid.emulatorName !== sdk.emulatorName) changes.emulatorName = sdk.emulatorName
        progress.complete("sdk")

        const androidConfig = { ...fileAndroid, buildType, sdkPath, emulatorName: sdk.emulatorName }

        progress.start("saveConfig")
        await saveAndroidConfig(changes)
        progress.complete("saveConfig")

        progress.start("androidTools")
        const { EMULATOR_PATH, ADB_PATH } = validateAndroidTools(androidConfig)
        progress.complete("androidTools")

        progress.start("emulator")
        const emulatorRunning = await checkEmulator(ADB_PATH)
        if (!emulatorRunning) {
            progress.log("No emulator running, attempting to start one...")
            await startEmulator(EMULATOR_PATH, androidConfig)
        } else {
            progress.log("Emulator already running", "info")
        }
        progress.complete("emulator")

        await updateLocalProperties(sdkPath)

        progress.start("setupServer")
        await setupServer(configPath, (message) => progress.log(message, "info"))
        progress.complete("setupServer")

        // What was configured, not what the keys mean -- the explanation
        // belongs in the docs, not in every successful run's transcript.
        progress.printTreeContent("Config  config/config.json", [
            { text: `port           ${port ?? ""}`, color: "gray" },
            { text: `buildType      ${buildType}`, color: "gray" },
            { text: `sdkPath        ${sdkPath}`, color: "gray" },
            { text: `emulatorName   ${sdk.emulatorName}`, color: "gray" },
        ])

        progress.summary("Ready", "Run catalyst buildApp:android to install the app")
        process.exit(0)
    } catch (error) {
        // A coded error (ANDROID-007, IOS-003, ...) gets the full diagnostic:
        // code, hint and doc link. Anything else keeps the one-line failure.
        const coded = /^[A-Z]+-\d{3}$/.test(String(error?.code || ""))
        if (progress.currentStep) {
            progress.fail(progress.currentStep.id, coded ? undefined : error.message)
        }
        if (coded) process.stderr.write(buildFailure({ error, stage: "Android setup" }))
        else progress.hint(error.hint)
        process.exit(1)
    }
}

// Execute the main setup
setupAndroidEnvironment()
