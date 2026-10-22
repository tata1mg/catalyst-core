import { execSync, spawn } from "child_process"
import readline from "readline"
import fs from "fs"
import os from "os"
import path from "path"
import theme from "../cli/theme.js"
import spinnerModule from "../cli/spinner.js"

const { GUTTER, t } = theme
const { withSpinnersPaused } = spinnerModule

// Retain only the tail of a child's output: it is used for diagnostics, and a
// long gradle build would otherwise hold every byte it ever printed in memory.
const MAX_OUTPUT_BUFFER_BYTES = 1024 * 1024

// Prompts are short, so only a small trailing window is ever worth matching.
// This is load-bearing, not belt-and-braces: handlePrompts only trims the
// buffer when something matches, and a normal build never prompts at all --
// so without the cap the match buffer accumulates the entire build output and
// indexOf rescans all of it on every chunk.
const MAX_PROMPT_MATCH_BYTES = 8 * 1024

// Signing commands carry keystore passwords on the command line, and this is
// the one place every native command is echoed on failure. Redact here so a
// wrong password cannot put the real one in the terminal or in CI logs.
const SECRET_ARG_PATTERNS = [
    /(-storepass\s+)("[^"]*"|\S+)/gi,
    /(-keypass\s+)("[^"]*"|\S+)/gi,
    /(signing\.store\.password=)("[^"]*"|\S+)/gi,
    /(signing\.key\.password=)("[^"]*"|\S+)/gi,
    /(--password[=\s]+)("[^"]*"|\S+)/gi,
]

function redactSecrets(text) {
    if (typeof text !== "string") return text
    return SECRET_ARG_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "$1***"), text)
}

/** Redacts by pattern, and also every secret value the command carries, in case a tool echoes one back without its flag. */
function secretScrubber(command) {
    const secrets = SECRET_ARG_PATTERNS.flatMap((pattern) =>
        [...String(command).matchAll(pattern)].map((match) => match[2].replace(/^"|"$/g, ""))
    ).filter(Boolean)
    return (text) =>
        typeof text === "string"
            ? secrets.reduce((acc, secret) => acc.split(secret).join("***"), redactSecrets(text))
            : text
}

/**
 * Scrub a failed command's error before anyone sees it. execSync puts the
 * whole command line in error.message ("Command failed: ...") and the child's
 * output in stdout/stderr, and callers rethrow error.message wrapped in their
 * own text -- so the passwords are removed here, at the source.
 */
function redactError(error, command) {
    if (!error || typeof error !== "object") return error
    const scrub = secretScrubber(command)
    for (const key of ["message", "stack", "cmd", "stdout", "stderr"]) {
        if (typeof error[key] === "string") error[key] = scrub(error[key])
    }
    if (Array.isArray(error.output)) error.output = error.output.map(scrub)
    return error
}

/**
 * @param {string} command
 * @param {object} [options]
 * @param {number} [options.timeout] - ms before the command is killed. Device
 *   probes (adb, devicectl) take one: a wedged adb server otherwise hangs the
 *   build forever behind a spinner that keeps saying it is working.
 */
function runCommand(command, { timeout } = {}) {
    // Redacted before it reaches the log file too -- the log is a build
    // artifact that gets attached to bug reports and uploaded by CI.
    try {
        // stderr is captured, not inherited. Many tools (java -version, for
        // one) write to stderr on success, and an inherited fd puts that text
        // at column 0 -- straight through whatever the spinner is drawing.
        // The caller decides what, if anything, is worth showing.
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Native setup/build uses fixed internal command strings; preserve existing shell behavior.
        return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout })
    } catch (error) {
        if (timeout && isTimeout(error)) throw toolTimeoutError(command, timeout)
        redactError(error, command)
        console.error(`Error executing command: ${secretScrubber(command)(command)}`)
        console.error(`Error message: ${error.message}`)
        throw error
    }
}

function commandExists(command) {
    try {
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Utility checks known local tool names during native setup.
        execSync(`which ${command}`, { stdio: "ignore" })
        return true
    } catch (error) {
        return false
    }
}

/** execSync reports a timeout as a killed child, not with a code of its own. */
function isTimeout(error) {
    return error?.code === "ETIMEDOUT" || (error?.signal === "SIGTERM" && error?.status === null)
}

/**
 * A device tool that stopped answering. adb in particular wedges: its server
 * keeps the port open and accepts connections but never replies, so every
 * later call hangs too. Name the tool and the reset that clears it.
 */
function toolTimeoutError(command, timeout) {
    const tool = path.basename(String(command).trim().split(/\s+/)[0].replace(/^"|"$/g, ""))
    const seconds = Math.round(timeout / 1000)
    const error = new Error(`${tool} did not respond within ${seconds}s`)
    error.code = "ETOOLTIMEOUT"
    error.hint =
        tool === "adb"
            ? "The adb server is stuck. Restart it with `adb kill-server && adb start-server`, then retry."
            : tool === "xcrun"
              ? "Xcode's device tools are not responding. Quit Xcode and Simulator, then retry."
              : `Check that ${tool} works on its own, then retry.`
    return error
}

/** A required value with no terminal to ask for it on, e.g. in CI. */
function missingConfigError(question) {
    const label = question.replace(/[:\s]+$/, "")
    const error = new Error(`Missing configuration, and no terminal to ask on: ${label}`)
    error.code = "ENOTTY"
    error.hint =
        "Set it in config/config.json (WEBVIEW_CONFIG), or run the command in an interactive terminal."
    return error
}

/**
 * Ask a question on the terminal.
 *
 * Every live spinner is stood down first: the native steps run under one, and
 * its next frame used to erase the question, so a missing config field looked
 * like a hang that never ended. The interface is created per question and
 * closed after it -- one held open at module load kept stdin referenced, so
 * every command that imported this file had to process.exit() to finish.
 */
async function promptUser(question, { defaultValue } = {}) {
    if (!process.stdin.isTTY) {
        if (defaultValue !== undefined) return defaultValue
        throw missingConfigError(question)
    }
    return withSpinnersPaused(
        () =>
            new Promise((resolve) => {
                const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
                const label = question.replace(/[:\s]+$/, "")
                const suffix = defaultValue ? t.dim(` (${defaultValue})`) : ""
                rl.question(`${GUTTER}${t.warn("?")} ${label}${suffix} `, (answer) => {
                    rl.close()
                    const value = answer.trim() || defaultValue || ""
                    // Settle the question into a record of what was chosen,
                    // in place: one line up, cleared, rewritten.
                    const esc = String.fromCharCode(27)
                    process.stdout.write(
                        `${esc}[1A\r${esc}[2K${GUTTER}${t.ok("✓")} ${label}  ${t.dim(value)}\n`
                    )
                    resolve(value)
                })
            })
    )
}

/**
 * Where the Android SDK most likely lives: the environment first, then the
 * locations Android Studio installs to. Returns null when none has adb, so a
 * stray empty directory is not mistaken for an SDK.
 */
function detectAndroidSdk(env = process.env) {
    const home = os.homedir()
    const candidates = [
        env.ANDROID_HOME,
        env.ANDROID_SDK_ROOT,
        path.join(home, "Library", "Android", "sdk"),
        path.join(home, "Android", "Sdk"),
        env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Android", "Sdk"),
    ].filter(Boolean)
    const adb = process.platform === "win32" ? "adb.exe" : "adb"
    return candidates.find((dir) => fs.existsSync(path.join(dir, "platform-tools", adb))) || null
}

/** AVD names known to the SDK's emulator, or [] when it cannot be asked. */
function listAvds(sdkPath) {
    if (!sdkPath) return []
    try {
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - sdkPath is a local SDK directory from config or auto-detection.
        const out = execSync(`"${path.join(expandHome(sdkPath), "emulator", "emulator")}" -list-avds`, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 15000,
        })
        return out
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("INFO"))
    } catch (error) {
        return []
    }
}

/** Expand a leading `~` (as in the SDK hint below); nothing else in the chain does. */
function expandHome(dir) {
    if (typeof dir !== "string") return dir
    if (dir === "~") return os.homedir()
    return dir.startsWith("~/") || dir.startsWith("~\\") ? path.join(os.homedir(), dir.slice(2)) : dir
}

/** The hint for a missing or wrong SDK path, naming the one field to set. */
const ANDROID_SDK_HINT =
    'Install Android Studio, or set WEBVIEW_CONFIG.android.sdkPath in config/config.json (e.g. "~/Library/Android/sdk").'

/**
 * Write the SDK location gradle reads. `setupEmulator:android` used to be the
 * only thing that wrote it, so a `buildApp:android` without a prior setup died
 * in gradle with "SDK location not found" despite a configured sdkPath.
 */
function ensureLocalProperties(projectDir, sdkPath) {
    const file = path.join(projectDir, "local.properties")
    const line = `sdk.dir=${expandHome(sdkPath).replace(/\\/g, "\\\\")}`
    let content = ""
    try {
        content = fs.readFileSync(file, "utf8")
    } catch (error) {
        // Missing is the case being fixed.
    }
    if (content.split("\n").some((existing) => existing.trim() === line)) return false
    const kept = content.split("\n").filter((existing) => existing.trim() && !existing.startsWith("sdk.dir="))
    fs.writeFileSync(file, [...kept, line].join("\n") + "\n")
    return true
}

/**
 * Run a command, keeping its output rather than printing it.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} [promptResponses] - text to answer prompts with
 * @param {object} [options]
 * @param {(line: string) => void} [options.onLine] - called per output line.
 *   Without it the output is captured silently. Gradle and xcodebuild emit
 *   hundreds of lines that nobody reads on success and that are redundant on
 *   failure -- the error path mines `error.output`, which is retained either
 *   way. Callers that want progress pass a handler that summarises, rather
 *   than letting the raw stream scroll.
 */
async function runInteractiveCommand(command, args, promptResponses = {}, { onLine } = {}) {
    return new Promise((resolve, reject) => {
        // Named `child`, not `process`: the previous name shadowed the global
        // `process` for the whole function body.
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Native build commands are fixed internal commands passed with argv arrays.
        const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] })

        let promptBuffer = ""
        let outputBuffer = ""
        const partial = { stdout: "", stderr: "" }

        const consume = (data, stream) => {
            const text = data.toString()

            // Hold back a trailing partial line until its newline arrives.
            // Printing raw chunks splits lines mid-write and injects blanks.
            const lines = (partial[stream] + text).split("\n")
            partial[stream] = lines.pop()
            if (onLine) {
                for (const line of lines) onLine(line)
            }

            // Previously unbounded: a long gradle build retained every byte.
            outputBuffer += text
            if (outputBuffer.length > MAX_OUTPUT_BUFFER_BYTES) {
                outputBuffer = outputBuffer.slice(-MAX_OUTPUT_BUFFER_BYTES)
            }

            promptBuffer = handlePrompts(child, promptBuffer + text, promptResponses)
            if (promptBuffer.length > MAX_PROMPT_MATCH_BYTES) {
                promptBuffer = promptBuffer.slice(-MAX_PROMPT_MATCH_BYTES)
            }
        }

        child.stdout.on("data", (data) => consume(data, "stdout"))
        child.stderr.on("data", (data) => consume(data, "stderr"))

        // Without this the promise never settles when the binary is missing or
        // not executable, so a missing gradle/adb hangs the CLI indefinitely.
        child.on("error", (error) => {
            if (error.code === "ENOENT") {
                reject(new Error(`Command not found: ${command}`, { cause: error }))
            } else {
                reject(new Error(`Failed to start ${command}: ${error.message}`, { cause: error }))
            }
        })

        child.on("close", (code) => {
            // Flush whatever never got its closing newline.
            for (const stream of ["stdout", "stderr"]) {
                if (partial[stream]) {
                    if (onLine) onLine(partial[stream])
                    partial[stream] = ""
                }
            }

            if (code === 0) {
                resolve(outputBuffer)
                return
            }

            // Carry the output on the error. Without it the caller only has
            // "exit code 1" and the compiler error that actually broke the
            // build is lost -- which is why failures used to mean opening
            // Android Studio to find out what happened.
            const failure = new Error(`Command failed with exit code ${code}`)
            failure.code = code
            failure.output = outputBuffer
            reject(failure)
        })
    })
}

/**
 * Answer a prompt found in the accumulated output.
 *
 * Returns the buffer to keep looking in. The match must be consumed: the buffer
 * grows with every chunk, so leaving a matched prompt in it re-answers that
 * prompt on every subsequent chunk, spraying `y\n` into the child's stdin.
 */
function handlePrompts(child, buffer, promptResponses) {
    for (const [prompt, response] of Object.entries(promptResponses)) {
        const index = buffer.indexOf(prompt)
        if (index !== -1) {
            child.stdin.write(response + "\n")
            return buffer.slice(index + prompt.length)
        }
    }
    return buffer
}

async function runSdkManagerCommand(sdkManagerPath, args) {
    const promptResponses = {
        "(y/N)": "y",
        "Accept? (y/N):": "y",
    }
    return runInteractiveCommand(sdkManagerPath, args, promptResponses)
}

async function validateAndCompleteConfig(platform, configPath) {
    // Read existing config
    let config
    try {
        const configContent = fs.readFileSync(configPath, "utf8")
        config = JSON.parse(configContent)
    } catch (error) {
        console.error(`Error reading config file: ${error.message}`)
        config = {}
    }

    // Initialize WEBVIEW_CONFIG if it doesn't exist
    if (!config.WEBVIEW_CONFIG) {
        config.WEBVIEW_CONFIG = {}
    }

    // Check if WEBVIEW_CONFIG already has all required fields
    const webviewConfig = config.WEBVIEW_CONFIG

    const commonFields = {
        port: "Port the app is served on",
    }

    // cachePattern is optional -- the iOS build emits an empty pattern list
    // when it is absent and Android never required it -- so asking for it on
    // every first setup only stalled people on a question they could not answer.
    const platformConfigs = {
        android: {
            buildType: "Android build type (debug/release)",
            sdkPath: "Android SDK path",
            emulatorName: "Android emulator (AVD) name",
        },
        ios: {
            buildType: "iOS build type (debug/release)",
            appBundleId: "iOS bundle ID (e.g. com.example.app)",
            simulatorName: "iOS simulator name (e.g. iPhone 16 Pro)",
        },
    }

    // Answers we can work out are filled in rather than asked; the rest are
    // asked with the best guess offered as the default.
    const sdkGuess = platform === "android" ? webviewConfig.android?.sdkPath || detectAndroidSdk() : null
    const defaults = {
        port: config.NODE_SERVER_PORT ? String(config.NODE_SERVER_PORT) : undefined,
        buildType: "debug",
        sdkPath: sdkGuess || undefined,
        emulatorName: platform === "android" ? listAvds(sdkGuess)[0] : undefined,
    }
    const filled = []

    if (!platformConfigs[platform]) {
        throw new Error('Invalid platform. Must be either "android" or "ios"')
    }

    // Check if all required fields are present
    let hasAllFields = true

    // Check common fields
    for (const key of Object.keys(commonFields)) {
        if (!webviewConfig[key]) {
            hasAllFields = false
            break
        }
    }

    // Check platform-specific fields
    if (!webviewConfig[platform]) {
        webviewConfig[platform] = {}
        hasAllFields = false
    } else {
        for (const key of Object.keys(platformConfigs[platform])) {
            if (!webviewConfig[platform][key]) {
                hasAllFields = false
                break
            }
        }
    }

    // If all fields are present, return the platform-specific config
    if (hasAllFields) {
        return {
            port: webviewConfig.port,
            [platform]: webviewConfig[platform],
        }
    }

    // Fields with a sure answer (detected or conventional) are filled without
    // asking; only genuinely unknown ones reach the prompt.
    const autoFill = new Set(["port", "buildType", "sdkPath"])
    const fill = async (target, key, prompt) => {
        if (target[key]) return
        const guess = defaults[key]
        target[key] = guess && autoFill.has(key) ? guess : await promptUser(prompt, { defaultValue: guess })
        filled.push(key)
    }

    for (const [key, prompt] of Object.entries(commonFields)) await fill(webviewConfig, key, prompt)
    for (const [key, prompt] of Object.entries(platformConfigs[platform])) {
        await fill(webviewConfig[platform], key, prompt)
    }

    // Save updated config back to file
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
        if (filled.length) {
            // Under a live spinner a plain log lands on the spinner's own row.
            await withSpinnersPaused(async () =>
                console.log(
                    `${GUTTER}${t.accent("›")} Saved ${filled.join(", ")} to ${t.accent("config/config.json")}`
                )
            )
        }
    } catch (error) {
        console.error(`Error saving config file: ${error.message}`)
        throw error
    }

    // Return only the platform-specific config
    return {
        port: webviewConfig.port,
        [platform]: webviewConfig[platform],
    }
}

export {
    runCommand,
    commandExists,
    promptUser,
    detectAndroidSdk,
    listAvds,
    ensureLocalProperties,
    ANDROID_SDK_HINT,
    runSdkManagerCommand,
    runInteractiveCommand,
    validateAndCompleteConfig,
    redactSecrets,
    redactError,
    expandHome,
}
