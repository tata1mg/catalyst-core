"use strict"

const fs = require("fs")
const os = require("os")
const {
    detectAndroidSdk,
    listAvds,
    expandHome,
    ANDROID_SDK_HINT,
    resolveNativeConfig,
    assertReleaseHost,
    resolveAppVersion,
} = require("../utils.js")

const TEMPLATE_APPLICATION_ID = "io.yourname.androidproject"

/** An error carrying the one action that fixes it, shown as the diagnostic's hint. */
function withHint(message, hint) {
    return Object.assign(new Error(message), { hint })
}

const tilde = (dir) => (dir.startsWith(os.homedir()) ? `~${dir.slice(os.homedir().length)}` : dir)

function createConfigPhase(ctx) {
    const { configPath, progress } = ctx

    /**
     * Read config.json and resolve what this build uses: release or debug
     * (`--release` or android.buildType), the release override block merged
     * in, the start-URL guard, and the version. The resolved config is
     * written to a temp file for Gradle; call `cleanup()` when done.
     */
    async function initializeConfig({ release: releaseFlag = false, buildNumber } = {}) {
        const configFile = fs.readFileSync(configPath, "utf8")
        const config = JSON.parse(configFile)
        const { WEBVIEW_CONFIG: baseConfig, BUILD_OUTPUT_PATH } = config

        if (!baseConfig || Object.keys(baseConfig).length === 0) {
            throw new Error("WebView Config missing in " + configPath)
        }

        if (!baseConfig.android) {
            throw withHint(
                "Android config missing in WebView Config",
                "Run catalyst setupEmulator:android to create it, or add WEBVIEW_CONFIG.android to config/config.json."
            )
        }

        const release = releaseFlag || baseConfig.android.buildType === "release"
        const log = (message, type) => progress.log(message, type)
        // `--release` wins over android.buildType, in the file Gradle reads too.
        const buildType = release ? "release" : baseConfig.android.buildType || "debug"
        const prepared = {
            ...config,
            WEBVIEW_CONFIG: { ...baseConfig, android: { ...baseConfig.android, buildType } },
        }
        const resolved = resolveNativeConfig("android", { release, config: prepared, log })

        try {
            const { WEBVIEW_CONFIG } = resolved
            WEBVIEW_CONFIG.android = { ...WEBVIEW_CONFIG.android, buildType }

            if (release) {
                progress.log("Release build - a signed AAB will be generated", "info")
                const start = assertReleaseHost("android", WEBVIEW_CONFIG, {
                    allowPrivateHost: resolved.allowPrivateHost,
                    log,
                })
                progress.log(`Release start URL: ${start.url}`, "info")
            }

            const version = resolveAppVersion("android", { WEBVIEW_CONFIG, release, buildNumber })
            const applicationId = WEBVIEW_CONFIG.android.packageName || TEMPLATE_APPLICATION_ID

            return {
                WEBVIEW_CONFIG,
                BUILD_OUTPUT_PATH,
                release,
                version,
                applicationId,
                resolvedConfigPath: resolved.configPath,
                cleanup: resolved.cleanup,
            }
        } catch (error) {
            resolved.cleanup()
            throw error
        }
    }

    function validateAndroidTools(androidConfig) {
        progress.status("validating tools")

        // An unset sdkPath is usually just an SDK in the default place. Use it,
        // and say so, rather than failing on a field most people never set.
        if (!androidConfig.sdkPath) {
            const detected = detectAndroidSdk()
            if (!detected) throw withHint("Android SDK not found", ANDROID_SDK_HINT)
            androidConfig.sdkPath = detected
            progress.log(`Using the Android SDK at ${tilde(detected)}`, "note")
        }
        // "~/Library/Android/sdk", as the hint suggests. Expanded in memory
        // only; the config file keeps what the user wrote.
        androidConfig.sdkPath = expandHome(androidConfig.sdkPath)

        const ANDROID_SDK = androidConfig.sdkPath
        const ADB_PATH = `${ANDROID_SDK}/platform-tools/adb`
        const EMULATOR_PATH = `${ANDROID_SDK}/emulator/emulator`

        if (!fs.existsSync(ANDROID_SDK)) {
            throw withHint(`Android SDK path does not exist: ${ANDROID_SDK}`, ANDROID_SDK_HINT)
        }

        if (!fs.existsSync(ADB_PATH)) {
            throw withHint(
                `adb not found at ${ADB_PATH}`,
                "Install Android SDK Platform-Tools from Android Studio's SDK Manager."
            )
        }

        try {
            ctx.runCommand(`${ADB_PATH} version`, { timeout: 15000 })
        } catch (error) {
            if (error.hint) throw error
            throw new Error(`ADB is not working properly: ${error.message}`)
        }

        const buildType = androidConfig.buildType || "debug"
        if (buildType !== "release") {
            if (!fs.existsSync(EMULATOR_PATH)) {
                throw new Error(`Emulator not found at: ${EMULATOR_PATH}`)
            }

            try {
                ctx.runCommand(`${EMULATOR_PATH} -version`)
            } catch (error) {
                throw new Error(`Emulator is not working properly: ${error.message}`)
            }

            if (!androidConfig.emulatorName) {
                const [first] = listAvds(ANDROID_SDK)
                if (!first) {
                    throw withHint(
                        "No Android emulator found",
                        "Create one in Android Studio's Device Manager, or set WEBVIEW_CONFIG.android.emulatorName."
                    )
                }
                androidConfig.emulatorName = first
                progress.log(`Using the "${first}" emulator`, "note")
            }

            try {
                const avdOutput = ctx.runCommand(`${EMULATOR_PATH} -list-avds`)
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

        return { ANDROID_SDK, ADB_PATH, EMULATOR_PATH }
    }

    return { initializeConfig, validateAndroidTools }
}

module.exports = createConfigPhase
