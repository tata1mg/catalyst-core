"use strict"

const fs = require("fs")
const { ANDROID_SDK_HINT } = require("../utils.js")
const { resolveNativeConfig } = require("../nativeConfig.js")

/** An error carrying the one action that fixes it, shown as the diagnostic's hint. */
function withHint(message, hint) {
    return Object.assign(new Error(message), { hint })
}

function createConfigPhase(ctx) {
    const { configPath, progress } = ctx

    /**
     * Read config.json and resolve what this build uses (nativeConfig.js):
     * release or debug, the start URL and its guard, the app id and the
     * version. The resolved config is written to a temp file for Gradle;
     * call `cleanup()` when done.
     *
     * @param {object} [options]
     * @param {boolean} [options.release] - `--release`
     * @param {string} [options.url] - `--url`
     * @param {string} [options.devHost] - the host the device reaches the dev server on
     */
    async function initializeConfig({ release: releaseFlag = false, url, devHost } = {}) {
        const configFile = fs.readFileSync(configPath, "utf8")
        const config = JSON.parse(configFile)
        const { WEBVIEW_CONFIG: baseConfig, BUILD_OUTPUT_PATH } = config

        if (!baseConfig || Object.keys(baseConfig).length === 0) {
            throw new Error("WebView Config missing in " + configPath)
        }

        const log = (message, type) => progress.log(message, type)
        const resolved = resolveNativeConfig("android", { release: releaseFlag, url, devHost, config, log })

        if (resolved.release) {
            progress.log("Release build - a signed AAB will be generated", "info")
            progress.log(`Release start URL: ${resolved.startUrl}`, "info")
        }

        return {
            config,
            WEBVIEW_CONFIG: resolved.WEBVIEW_CONFIG,
            BUILD_OUTPUT_PATH,
            release: resolved.release,
            version: resolved.version,
            applicationId: resolved.appId,
            usesDevServer: resolved.usesDevServer,
            resolvedConfigPath: resolved.configPath,
            cleanup: resolved.cleanup,
        }
    }

    /**
     * Check the SDK tools a build runs, once ensureAndroidSdk has installed
     * them: adb answers, and the emulator binary is there when one is used.
     *
     * @param {{ sdkPath: string }} androidConfig - sdkPath already resolved (resolveSdkPath)
     * @param {{ needEmulator?: boolean }} [options]
     */
    function validateAndroidTools(androidConfig, { needEmulator = true } = {}) {
        progress.status("validating tools")

        const ANDROID_SDK = androidConfig.sdkPath
        const ADB_PATH = `${ANDROID_SDK}/platform-tools/adb`
        const EMULATOR_PATH = `${ANDROID_SDK}/emulator/emulator`

        if (!fs.existsSync(ADB_PATH)) throw withHint(`adb not found at ${ADB_PATH}`, ANDROID_SDK_HINT)

        try {
            ctx.runCommand(`"${ADB_PATH}" version`, { timeout: 15000 })
        } catch (error) {
            if (error.hint) throw error
            throw new Error(`ADB is not working properly: ${error.message}`)
        }

        if (needEmulator && !fs.existsSync(EMULATOR_PATH)) {
            throw withHint(`Emulator not found at ${EMULATOR_PATH}`, ANDROID_SDK_HINT)
        }

        return { ANDROID_SDK, ADB_PATH, EMULATOR_PATH }
    }

    return { initializeConfig, validateAndroidTools }
}

module.exports = createConfigPhase
