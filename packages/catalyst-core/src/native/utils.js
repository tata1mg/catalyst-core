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
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - Paths come from env vars, the user's own SDK location or the project dir, never remote input.
        env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Android", "Sdk"),
    ].filter(Boolean)
    const adb = process.platform === "win32" ? "adb.exe" : "adb"
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - Paths come from env vars, the user's own SDK location or the project dir, never remote input.
    return candidates.find((dir) => fs.existsSync(path.join(dir, "platform-tools", adb))) || null
}

/** AVD names known to the SDK's emulator, or [] when it cannot be asked. */
function listAvds(sdkPath) {
    if (!sdkPath) return []
    try {
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process, javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - sdkPath is a local SDK directory from config or auto-detection, never remote input.
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
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - Paths come from env vars, the user's own SDK location or the project dir, never remote input.
    return dir.startsWith("~/") || dir.startsWith("~\\") ? path.join(os.homedir(), dir.slice(2)) : dir
}

/** The hint for a missing or wrong SDK path, naming the one field to set. */
const ANDROID_SDK_HINT =
    'Run catalyst setupEmulator:android to install it, or set WEBVIEW_CONFIG.android.sdkPath in config/config.json (e.g. "~/Library/Android/sdk").'

/**
 * Write the SDK location gradle reads. `setupEmulator:android` used to be the
 * only thing that wrote it, so a `buildApp:android` without a prior setup died
 * in gradle with "SDK location not found" despite a configured sdkPath.
 */
function ensureLocalProperties(projectDir, sdkPath) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - Paths come from env vars, the user's own SDK location or the project dir, never remote input.
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
 * @param {NodeJS.ProcessEnv} [options.env] - the child's environment (defaults to this process's)
 * @param {string} [options.cwd] - the child's working directory
 * @param {(line: string) => void} [options.onLine] - called per output line.
 *   Without it the output is captured silently. Gradle and xcodebuild emit
 *   hundreds of lines that nobody reads on success and that are redundant on
 *   failure -- the error path mines `error.output`, which is retained either
 *   way. Callers that want progress pass a handler that summarises, rather
 *   than letting the raw stream scroll.
 */
async function runInteractiveCommand(command, args, promptResponses = {}, { onLine, env, cwd } = {}) {
    return new Promise((resolve, reject) => {
        // Named `child`, not `process`: the previous name shadowed the global
        // `process` for the whole function body.
        // `env` is how secrets reach a child (ORG_GRADLE_PROJECT_*): never argv,
        // where ps and the failure echo would show them.
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Native build commands are fixed internal commands passed with argv arrays.
        const child = spawn(command, args, {
            stdio: ["pipe", "pipe", "pipe"],
            ...(env ? { env } : {}),
            ...(cwd ? { cwd } : {}),
        })

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

/**
 * Run a command on the user's own terminal: inherited stdio, so they see its
 * progress and can answer it (a sudo password, a licence). The spinner is
 * stood down for the duration. Only for steps a person has agreed to.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.cwd]
 */
async function runInheritedCommand(command, args, { env, cwd } = {}) {
    return withSpinnersPaused(
        () =>
            new Promise((resolve, reject) => {
                // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Fixed setup commands with argv arrays, run after the user agreed.
                const child = spawn(command, args, {
                    stdio: "inherit",
                    ...(env ? { env } : {}),
                    ...(cwd ? { cwd } : {}),
                })
                child.on("error", (error) =>
                    reject(
                        error.code === "ENOENT"
                            ? new Error(`Command not found: ${command}`, { cause: error })
                            : error
                    )
                )
                child.on("close", (code) => {
                    if (code === 0) resolve()
                    else reject(Object.assign(new Error(`${command} exited with code ${code}`), { code }))
                })
            })
    )
}

/** True when a person can answer a question on this terminal. */
function isInteractiveTerminal() {
    return Boolean(process.stdin.isTTY)
}

/**
 * A yes/no question. Enter takes the default. Without a terminal it returns
 * false, so callers decide (usually a coded error naming the flag to pass).
 */
async function confirm(question, { defaultYes = true, prompt = promptUser, isTTY } = {}) {
    if (!(isTTY ?? isInteractiveTerminal())) return false
    const answer = await prompt(`${question.replace(/[?\s]+$/, "")}? ${defaultYes ? "[Y/n]" : "[y/N]"}`, {
        defaultValue: defaultYes ? "y" : "n",
    })
    return /^y(es)?$/i.test(String(answer || "").trim())
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

// ---------------------------------------------------------------------------
// Release configuration, shared by the Android and iOS builds.
// ---------------------------------------------------------------------------

// Messages mirror errors/registry.js ERROR_DEFINITIONS (see errors/ANDROID/*.md).
// This CJS subtree can't import the ESM error registry (see
// buildErrorFormat.js), so the strings are copied here; a test keeps them equal.
const NATIVE_ERRORS = {
    "ANDROID-002": {
        message: "Release build points at a local or private host",
        hint: "Set WEBVIEW_CONFIG.release.LOCAL_IP (and port/useHttps) to your production host, or set WEBVIEW_CONFIG.release.allowPrivateHost to true for an internal app on a private network.",
    },
    "ANDROID-003": {
        message: "Release build has no build number",
        hint: "Pass --build-number <n>, set CATALYST_BUILD_NUMBER in CI, or set WEBVIEW_CONFIG.android.version.buildNumber.",
    },
    "ANDROID-004": {
        message: "Invalid build number",
        hint: "Use a whole number from 1 to 2100000000 that is higher than the last one you uploaded.",
    },
    "ANDROID-005": {
        message: "No upload key for the release build",
        hint: "Run the release build once in a terminal to create credentials/android/upload.jks, or in CI set CATALYST_ANDROID_KEYSTORE_BASE64 and CATALYST_ANDROID_STORE_PASSWORD (plus CATALYST_ANDROID_KEY_ALIAS and CATALYST_ANDROID_KEY_PASSWORD when they differ from the defaults).",
    },
    "ANDROID-006": {
        message: "Upload key settings are incomplete or wrong",
        hint: "Check credentials/android/keystore.properties, or the CATALYST_ANDROID_* environment variables, against the keystore.",
    },
    "ANDROID-007": {
        message: "Java 17 or newer not found",
        hint: "Install JDK 17 or newer (macOS: brew install --cask zulu@17; Linux: your distribution's openjdk-17-jdk package) and set JAVA_HOME, or run catalyst setupEmulator:android in a terminal to install it.",
    },
    "ANDROID-008": {
        message: "Android SDK setup needs your confirmation",
        hint: "Run catalyst setupEmulator:android in a terminal, or pass --yes to allow the downloads and --accept-licenses to accept the Android SDK licences (for CI).",
    },
    "ANDROID-009": {
        message: "Could not install the Android command-line tools",
        hint: "Check your network or proxy and retry, or download the command-line tools from https://developer.android.com/studio#command-tools and unzip them so that <sdk>/cmdline-tools/latest/bin/sdkmanager exists.",
    },
    "ANDROID-010": {
        message: "App icon is not usable",
        hint: "Replace public/icon.png with a square PNG of at least 1024x1024 pixels, or add per-density icons in public/android/appIcons.",
    },
    "IOS-002": {
        message: "Full Xcode is not installed or selected",
        hint: "Install Xcode from the Mac App Store, then run sudo xcode-select -s /Applications/Xcode.app/Contents/Developer.",
    },
    "IOS-003": {
        message: "Xcode setup is not finished",
        hint: "Run sudo xcodebuild -license accept and sudo xcodebuild -runFirstLaunch, then retry.",
    },
    "IOS-004": {
        message: "No iOS simulator runtime installed",
        hint: "Run catalyst setupEmulator:ios in a terminal or with --yes, or run xcodebuild -downloadPlatform iOS yourself.",
    },
    "IOS-005": {
        message: "App icon is not usable",
        hint: "Replace public/icon.png with a square PNG of at least 1024x1024 pixels, or add the sized icons in public/ios/appIcons.",
    },
    "IOS-006": {
        message: "App icon has transparency",
        hint: "Export public/icon.png without an alpha channel (flatten it onto a solid background), then rebuild.",
    },
}

// Per-platform codes for the shared release checks. iOS adds its own codes
// here when its release build lands.
const RELEASE_ERROR_CODES = {
    android: {
        privateHost: "ANDROID-002",
        missingBuildNumber: "ANDROID-003",
        invalidBuildNumber: "ANDROID-004",
    },
}

const ERROR_DOC_BASE = "https://github.com/tata1mg/catalyst-core/blob/main/errors"

/** A coded error the build diagnostic prints with its code, hint and doc link. */
function nativeError(code, detail, { hint } = {}) {
    const def = NATIVE_ERRORS[code] || { message: "Native build failed" }
    const error = new Error(detail ? `${def.message}: ${detail}` : def.message)
    error.code = code
    error.hint = hint || def.hint
    error.docUrl = `${ERROR_DOC_BASE}/${code.split("-")[0]}/${code}.md`
    return error
}

function releaseErrorCode(platform, kind) {
    const code = RELEASE_ERROR_CODES[platform]?.[kind]
    if (!code) throw new Error(`No ${kind} error code for platform "${platform}"`)
    return code
}

/**
 * The native flags the CLI forwards: `--release`, `--build-number <n>` (or
 * `--build-number=<n>`), and setup's `--yes` (allow downloads and config
 * writes without asking) and `--accept-licenses` (accept the Android SDK
 * licences). bin/catalyst.js keeps them out of command dispatch; this reads
 * them back in the platform script.
 */
function parseNativeArgs(argv = process.argv.slice(2)) {
    const result = { release: false, buildNumber: undefined, yes: false, acceptLicenses: false }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === "--release") result.release = true
        else if (arg === "--yes") result.yes = true
        else if (arg === "--accept-licenses") result.acceptLicenses = true
        else if (arg === "--build-number") result.buildNumber = argv[++i]
        else if (arg.startsWith("--build-number=")) result.buildNumber = arg.slice("--build-number=".length)
    }
    return result
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

/** Objects merge key by key; arrays and scalars in `override` replace the base value. */
function deepMerge(base, override) {
    const out = { ...base }
    for (const [key, value] of Object.entries(override)) {
        out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value
    }
    return out
}

/**
 * The config a native build should use.
 *
 * For a release build, `WEBVIEW_CONFIG.release` is deep-merged over the base
 * values. `release` itself is always stripped, so the native generators never
 * see it, and the result is written to a 0600 temp file for tools that read a
 * path (Gradle's -PconfigPath). Call `cleanup()` when the build is done.
 *
 * @param {"android"|"ios"} platform
 * @param {object} options
 * @param {boolean} [options.release]
 * @param {object} [options.config] - the parsed config.json; read from configPath when omitted
 * @param {string} [options.configPath] - defaults to <cwd>/config/config.json
 * @param {(message: string, type?: string) => void} [options.log]
 */
function resolveNativeConfig(platform, { release = false, config, configPath, log = () => {} } = {}) {
    const sourcePath = configPath || path.join(process.cwd(), "config", "config.json")
    const raw = config || JSON.parse(fs.readFileSync(sourcePath, "utf8"))
    const base = raw.WEBVIEW_CONFIG || {}
    const { release: releaseBlock, ...rest } = base

    let WEBVIEW_CONFIG = rest
    let allowPrivateHost = false
    if (release) {
        if (isPlainObject(releaseBlock)) {
            const { allowPrivateHost: allow, ...overrides } = releaseBlock
            allowPrivateHost = allow === true
            WEBVIEW_CONFIG = deepMerge(rest, overrides)
        } else {
            log(
                "WEBVIEW_CONFIG.release is not set, so this release build uses the base config. " +
                    "Add a release block with your production LOCAL_IP, port, useHttps and apiBaseUrl; " +
                    "building release from the base config is deprecated.",
                "warning"
            )
        }
    }

    const resolved = { ...raw, WEBVIEW_CONFIG }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `catalyst-${platform}-config-`))
    const resolvedPath = path.join(dir, "config.json")
    fs.writeFileSync(resolvedPath, JSON.stringify(resolved, null, 2), { mode: 0o600 })

    return {
        config: resolved,
        WEBVIEW_CONFIG,
        configPath: resolvedPath,
        release,
        allowPrivateHost,
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    }
}

/**
 * The URL the app opens on launch, built the way each shell builds it:
 * Android uses the configured port (MainActivity), iOS forces 443 under
 * HTTPS (buildIos/index.js). With no LOCAL_IP, an Android release falls back
 * to 127.0.0.1 (generateWebViewConfig) and iOS to localhost.
 */
function computeStartUrl(platform, wv = {}, { release = false } = {}) {
    const protocol = wv.useHttps ? "https" : "http"
    const fallbackHost = platform === "android" && release ? "127.0.0.1" : "localhost"
    const host = String(wv.LOCAL_IP || fallbackHost)
    let port
    if (platform === "ios") port = wv.port ? (wv.useHttps ? 443 : wv.port) : null
    else port = wv.port || 3005
    const initial = platform === "android" ? String(wv.initial_url || "") : ""
    const hostPart = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
    return { protocol, host, port, url: `${protocol}://${hostPart}${port ? `:${port}` : ""}/${initial}` }
}

function ipv4ToInt(ip) {
    return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0)
}

const PRIVATE_V4_RANGES = [
    ["0.0.0.0", 8, "an unroutable address"],
    ["127.0.0.0", 8, "a loopback address"],
    ["10.0.0.0", 8, "a private (RFC 1918) address"],
    ["172.16.0.0", 12, "a private (RFC 1918) address"],
    ["192.168.0.0", 16, "a private (RFC 1918) address"],
    ["169.254.0.0", 16, "a link-local address"],
]

/** This machine's own addresses and hostname: what a dev setup writes into LOCAL_IP. */
function localMachineHosts() {
    const hosts = new Set()
    try {
        for (const entries of Object.values(os.networkInterfaces())) {
            for (const entry of entries || []) hosts.add(entry.address.toLowerCase())
        }
    } catch (error) {
        // No interfaces to compare against.
    }
    try {
        hosts.add(os.hostname().toLowerCase())
    } catch (error) {
        // Hostname unavailable.
    }
    return hosts
}

/**
 * Why a host can't serve a store build, or null when it can. Covers
 * localhost, loopback, RFC 1918, link-local, mDNS (.local) names and this
 * machine's own current addresses.
 *
 * @param {string} rawHost
 * @param {object} [options]
 * @param {Set<string>} [options.localHosts] - this machine's addresses; detected when omitted
 * @returns {string | null}
 */
function privateHostReason(rawHost, { localHosts = localMachineHosts() } = {}) {
    const host = String(rawHost || "")
        .trim()
        .toLowerCase()
        .replace(/^\[|\]$/g, "")
    if (!host) return "an empty host"
    if (host === "localhost" || host.endsWith(".localhost")) return "localhost"
    if (host.endsWith(".local")) return "a local network (mDNS) name"
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        const value = ipv4ToInt(host)
        for (const [start, bits, reason] of PRIVATE_V4_RANGES) {
            const from = ipv4ToInt(start)
            if (value >= from && value < from + 2 ** (32 - bits)) return reason
        }
    } else if (host.includes(":")) {
        if (host === "::" || host === "::1") return "a loopback address"
        if (/^fe[89ab]/.test(host)) return "a link-local address"
        if (/^f[cd]/.test(host)) return "a private (unique local) address"
        const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host)
        if (mapped) return privateHostReason(mapped[1], { localHosts })
    }
    if (localHosts.has(host)) return "this machine's own address"
    return null
}

/**
 * Fail a release build whose start URL users' devices could never reach.
 * `release.allowPrivateHost: true` downgrades the failure to a warning for
 * internal apps. Plain HTTP is always only a warning.
 *
 * @param {"android"|"ios"} platform
 * @param {object} wv - the resolved WEBVIEW_CONFIG
 * @param {object} [options]
 * @param {boolean} [options.allowPrivateHost]
 * @param {(message: string, type?: string) => void} [options.log]
 * @param {Set<string>} [options.localHosts]
 */
function assertReleaseHost(platform, wv, { allowPrivateHost = false, log = () => {}, localHosts } = {}) {
    const start = computeStartUrl(platform, wv, { release: true })
    const reason = privateHostReason(start.host, { localHosts })
    if (reason) {
        if (!allowPrivateHost) {
            throw nativeError(
                releaseErrorCode(platform, "privateHost"),
                `${start.url} (${start.host} is ${reason})`
            )
        }
        log(`Release start URL ${start.url} is ${reason}; allowed by release.allowPrivateHost`, "warning")
    }
    if (!wv.useHttps) {
        log(`Release start URL ${start.url} uses plain HTTP. Set useHttps for store builds.`, "warning")
    }
    return start
}

// Google Play's ceiling for versionCode.
const MAX_BUILD_NUMBER = 2100000000

/**
 * The marketing version and build number for a native build.
 *
 * Marketing version: `<platform>.version.{major,minor,patch}`, else the app's
 * package.json version. Build number: `--build-number`, then
 * `CATALYST_BUILD_NUMBER`, then `<platform>.version.buildNumber`. A release
 * without one fails; debug defaults to 1.
 *
 * @param {"android"|"ios"} platform
 * @param {object} [options]
 * @param {Record<string, any>} [options.WEBVIEW_CONFIG]
 * @param {boolean} [options.release]
 * @param {string | number} [options.buildNumber] - from --build-number
 * @param {Record<string, string | undefined>} [options.env]
 * @param {string} [options.cwd] - the app root, for package.json
 * @returns {{ versionName: string | undefined, buildNumber: number, buildNumberSource: string }}
 */
function resolveAppVersion(
    platform,
    { WEBVIEW_CONFIG = {}, release = false, buildNumber, env = process.env, cwd = process.cwd() } = {}
) {
    const version = WEBVIEW_CONFIG[platform]?.version
    let versionName
    if (isPlainObject(version) && (version.major != null || version.minor != null || version.patch != null)) {
        versionName = `${version.major || 1}.${version.minor || 0}.${version.patch || 0}`
    } else {
        try {
            // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - cwd is the local app directory; the file name is fixed.
            const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"))
            if (typeof pkg.version === "string" && pkg.version.trim()) versionName = pkg.version.trim()
        } catch (error) {
            // No package.json version: the native project's default applies.
        }
    }

    const candidates = [
        ["--build-number", buildNumber],
        ["CATALYST_BUILD_NUMBER", env.CATALYST_BUILD_NUMBER],
        [`${platform}.version.buildNumber`, isPlainObject(version) ? version.buildNumber : undefined],
    ]
    const found = candidates.find(
        ([, value]) => value !== undefined && value !== null && String(value).trim() !== ""
    )
    if (!found) {
        if (release) {
            throw nativeError(
                releaseErrorCode(platform, "missingBuildNumber"),
                "set one with --build-number, CATALYST_BUILD_NUMBER or " + `${platform}.version.buildNumber`
            )
        }
        return { versionName, buildNumber: 1, buildNumberSource: "default" }
    }

    const [source, value] = found
    const text = String(value).trim()
    const number = Number(text)
    if (!/^\d+$/.test(text) || number < 1 || number > MAX_BUILD_NUMBER) {
        throw nativeError(releaseErrorCode(platform, "invalidBuildNumber"), `"${text}" from ${source}`)
    }
    return { versionName, buildNumber: number, buildNumberSource: source }
}

export {
    NATIVE_ERRORS,
    nativeError,
    parseNativeArgs,
    deepMerge,
    resolveNativeConfig,
    computeStartUrl,
    privateHostReason,
    assertReleaseHost,
    resolveAppVersion,
    MAX_BUILD_NUMBER,
    runCommand,
    commandExists,
    promptUser,
    detectAndroidSdk,
    listAvds,
    ensureLocalProperties,
    ANDROID_SDK_HINT,
    runSdkManagerCommand,
    runInteractiveCommand,
    runInheritedCommand,
    isInteractiveTerminal,
    confirm,
    validateAndCompleteConfig,
    redactSecrets,
    redactError,
    expandHome,
}
