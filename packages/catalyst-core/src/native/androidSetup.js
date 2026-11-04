import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import { runFile, parseNativeArgs, ensureLocalProperties, ANDROID_SDK_HINT } from "./utils.js"
import { applyJavaHome, ensureAndroidSdk, ensureJava, resolveSdkPath } from "./androidToolchain.js"
import { getLastTarget } from "./localState.js"
import TerminalProgress from "./terminalProgress.js"
import { buildFailure } from "../cli/diagnostic.js"

// setupEmulator:android installs what an Android build needs (JDK, SDK
// packages, an emulator) and starts the emulator. It changes nothing in the
// app: config/config.json is read for sdkPath and emulatorName when they are
// set, never written. buildApp:android does the same checks itself, so this
// command is optional.

const catalystCorePath = path.dirname(require.resolve("catalyst-core/package.json"))
const pwd = path.join(catalystCorePath, "dist/native")
const configPath = path.join(process.cwd(), "config", "config.json")
const flags = parseNativeArgs(process.argv.slice(2))

// Sentence case, verb first: these read as a sequence of actions, not as
// headings.
const steps = {
    java: "Check Java (JDK 17 to 23)",
    sdk: "Set up the Android SDK",
    androidTools: "Validate Android tools",
    emulator: "Start the Android emulator",
    properties: "Update local.properties",
}

const progress = new TerminalProgress(steps, "catalyst setupEmulator", { subject: "android" })
const log = (message, type = "info") => progress.log(message, type)

/**
 * A usable JDK for this process and every tool it starts (Gradle, sdkmanager,
 * avdmanager). JAVA_HOME is set here only; no shell profile is edited.
 */
async function validateJavaEnvironment() {
    progress.start("java")
    const java = await ensureJava({ flags, log })
    applyJavaHome(java)
    progress.log(`Java ${java.version} from ${java.source} (${java.home})`, "info")
    progress.complete("java")
}

/** WEBVIEW_CONFIG.android from config.json, or {} when there is none. Read only. */
function readAndroidConfig() {
    try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
        const android = config?.WEBVIEW_CONFIG?.android
        return android && typeof android === "object" ? android : {}
    } catch {
        return {}
    }
}

function validateAndroidTools(androidConfig) {
    const ANDROID_SDK = androidConfig.sdkPath
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
        runFile(ADB_PATH, ["version"])
    } catch (error) {
        throw new Error(`ADB is not working properly: ${error.message}`)
    }

    if (!fs.existsSync(EMULATOR_PATH)) {
        throw new Error(`Emulator not found at: ${EMULATOR_PATH}`)
    }

    try {
        runFile(EMULATOR_PATH, ["-version"])
    } catch (error) {
        throw new Error(`Emulator is not working properly: ${error.message}`)
    }

    try {
        const avdOutput = runFile(EMULATOR_PATH, ["-list-avds"])
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
        const devices = runFile(ADB_PATH, ["devices"], { timeout: 15000 })
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

function updateLocalProperties(sdkPath) {
    progress.start("properties")
    ensureLocalProperties(`${pwd}/androidProject`, sdkPath)
    progress.complete("properties")
}

async function setupAndroidEnvironment() {
    try {
        await validateJavaEnvironment()

        progress.start("sdk")
        const fileAndroid = readAndroidConfig()
        const sdkPath = resolveSdkPath(fileAndroid)
        const last = getLastTarget("android")
        const sdk = await ensureAndroidSdk({
            sdkPath,
            emulatorName: fileAndroid.emulatorName,
            preferredAvd: last?.target === "emulator" ? last.avd : undefined,
            flags,
            log,
        })
        if (sdk.installed.length) progress.log(`Installed ${sdk.installed.join(", ")}`, "success")
        if (sdk.createdAvd) progress.log(`Created the "${sdk.emulatorName}" emulator`, "success")
        progress.complete("sdk")

        const androidConfig = { ...fileAndroid, sdkPath, emulatorName: sdk.emulatorName }

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

        updateLocalProperties(sdkPath)

        // What this machine uses, not what the keys mean: the explanation
        // belongs in the docs, not in every successful run's transcript.
        progress.printTreeContent("Android", [
            { text: `sdk        ${sdkPath}`, color: "gray" },
            { text: `emulator   ${sdk.emulatorName}`, color: "gray" },
        ])

        progress.summary("Ready", "Run catalyst buildApp:android to install the app")
        process.exit(0)
    } catch (error) {
        // A coded error (ANDROID-007, NATIVE-005, ...) gets the full diagnostic:
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
