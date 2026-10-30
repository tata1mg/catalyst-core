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

// ---------------------------------------------------------------------------
// Coded errors shared by the Android and iOS builds.
// ---------------------------------------------------------------------------

// Messages mirror errors/registry.js ERROR_DEFINITIONS (see errors/<CATEGORY>/*.md).
// This CJS subtree can't import the ESM error registry (see
// buildErrorFormat.js), so the strings are copied here; a test keeps them equal.
const NATIVE_ERRORS = {
    "ANDROID-005": {
        message: "No upload key for the release build",
        hint: "Run catalyst buildApp:android --release once in a terminal to create credentials/android/upload.jks, then back it up with catalyst credentials:export android. In CI, set the CATALYST_ANDROID_CREDENTIALS secret to the output of catalyst credentials:export android.",
    },
    "ANDROID-006": {
        message: "Upload key settings are incomplete or wrong",
        hint: "Check credentials/android/keystore.properties against credentials/android/upload.jks. In CI, run catalyst credentials:export android again and update the CATALYST_ANDROID_CREDENTIALS secret.",
    },
    "ANDROID-007": {
        message: "No JDK 17 to 23 found",
        hint: "Install JDK 17 or 21 (macOS: brew install --cask zulu@17; Linux: your distribution's openjdk-17-jdk package) and set JAVA_HOME, or run catalyst buildApp:android in a terminal, or with --yes, to install it.",
    },
    "ANDROID-008": {
        message: "Android SDK setup was declined",
        hint: "Run the command again and answer yes, or pass --yes to allow the downloads and --accept-licenses to accept the Android SDK licences.",
    },
    "ANDROID-009": {
        message: "Could not install the Android command-line tools",
        hint: "Check your network or proxy and retry, or download the command-line tools from https://developer.android.com/studio#command-tools and unzip them so that <sdk>/cmdline-tools/latest/bin/sdkmanager exists.",
    },
    "ANDROID-010": {
        message: "App icon is not usable",
        hint: "Replace public/icon.png with a square PNG of at least 1024x1024 pixels, or add per-density icons in public/android/appIcons.",
    },
    "ANDROID-011": {
        message: "No Android phone connected",
        hint: "Connect the phone, turn on USB debugging in Developer options, accept the Allow USB debugging prompt on the phone and check that adb devices lists it. Or drop --device to use the emulator.",
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
    "IOS-010": {
        message: "iOS code signing is not set up",
        hint: "For cloud signing, put an App Store Connect API key (its AuthKey_*.p8 file, with an ascIssuerId line in signing.properties) in credentials/ios/ and set WEBVIEW_CONFIG.ios.developmentTeam; for local signing, put a distribution .p12 and its .mobileprovision there instead. In CI, set CATALYST_IOS_CREDENTIALS to the output of catalyst credentials:export ios.",
    },
    "IOS-011": {
        message: "App Store Connect API key settings are incomplete or wrong",
        hint: "Put the AuthKey_*.p8 file in credentials/ios/, and an ascIssuerId line (plus ascKeyId when the file is renamed) in credentials/ios/signing.properties. In CI, run catalyst credentials:export ios again and paste the value into CATALYST_IOS_CREDENTIALS.",
    },
    "IOS-012": {
        message: "Manual signing inputs are incomplete or wrong",
        hint: "Keep one distribution .p12 and the .mobileprovision for WEBVIEW_CONFIG.appId in credentials/ios/, with a p12Password line in credentials/ios/signing.properties, and check that they belong together. In CI, run catalyst credentials:export ios again and paste the value into CATALYST_IOS_CREDENTIALS.",
    },
    "IOS-013": {
        message: "Unknown iOS export method",
        hint: "Set WEBVIEW_CONFIG.ios.exportMethod to app-store-connect (the default), release-testing, enterprise or debugging.",
    },
    "IOS-014": {
        message: "No connected iPhone found",
        hint: "Connect the iPhone with a cable, unlock it, accept Trust This Computer and turn on Developer Mode (Settings > Privacy & Security), then retry; or leave out --device to use the simulator.",
    },
    "IOS-015": {
        message: "No address the iPhone can reach this Mac on",
        hint: "Join the Mac and the iPhone to the same Wi-Fi network and check the Local Hostname in System Settings > General > Sharing, then retry.",
    },
    "NATIVE-001": {
        message: "Release build points at a local or private host",
        hint: "Set WEBVIEW_CONFIG.url to your production origin (e.g. https://shop.acme.com) or pass --url, or set WEBVIEW_CONFIG.allowPrivateHost to true for an internal app on a private network.",
    },
    "NATIVE-002": {
        message: "Invalid build number",
        hint: "Unset CATALYST_BUILD_NUMBER to use the automatic build number, or set it to a whole number from 1 to 2100000000 that is higher than the last one you uploaded.",
    },
    "NATIVE-003": {
        message: "Release build uses a placeholder app id",
        hint: "Set WEBVIEW_CONFIG.appId in config/config.json to your own reverse-DNS id, e.g. com.acme.shop.",
    },
    "NATIVE-004": {
        message: "Invalid production URL",
        hint: "Use an origin such as https://shop.acme.com, without a path or a port other than 443.",
    },
    "NATIVE-005": {
        message: "A step needs your answer and there is no terminal to ask on",
        hint: "Pass the flag named in the message, or run the command in an interactive terminal.",
    },
    "NATIVE-006": {
        message: "The dev server did not answer",
        hint: "Run npm start on its own to see why the server does not start, then run the build again.",
    },
    "NATIVE-007": {
        message: "The credentials secret could not be unpacked",
        hint: "Run catalyst credentials:export <android|ios> where credentials/<platform>/ exists and paste the whole value into the secret again.",
    },
    "NATIVE-008": {
        message: "No credentials to export",
        hint: "Run the command from the app root after a release build has created credentials/<platform>/.",
    },
    "NATIVE-009": {
        message: "Credentials are too large for one secret",
        hint: "Remove files the build does not need from credentials/<platform>/ (only signing keys, profiles and their settings belong there), then export again.",
    },
    "NATIVE-010": {
        message: "Invalid app id",
        hint: "Set WEBVIEW_CONFIG.appId in config/config.json to a reverse-DNS id such as com.acme.shop: letters and digits only, each part starting with a letter.",
    },
    "NATIVE-011": {
        message: "A release with this version and build number already exists",
        hint: "Wait a minute and run the release again, or set CATALYST_BUILD_NUMBER to a higher number. To rebuild the same build on purpose, delete that folder first.",
    },
}

const ERROR_DOC_BASE = "https://github.com/tata1mg/catalyst-core/blob/main/errors"

/**
 * A coded error the build diagnostic prints with its code, hint and doc link.
 *
 * @param {string} code
 * @param {string} [detail]
 * @param {{ hint?: string }} [options]
 * @returns {Error & { code: string, hint?: string, docUrl: string }}
 */
function nativeError(code, detail, { hint } = {}) {
    const def = NATIVE_ERRORS[code] || { message: "Native build failed" }
    /** @type {any} */
    const error = new Error(detail ? `${def.message}: ${detail}` : def.message)
    error.code = code
    error.hint = hint || def.hint
    error.docUrl = `${ERROR_DOC_BASE}/${code.replace(/-\d{3}$/, "")}/${code}.md`
    return error
}

// ---------------------------------------------------------------------------
// Flags and questions. Agents and CI never get a prompt: without a terminal,
// a question that needs an answer fails at once with NATIVE-005 naming the
// flag that answers it.
// ---------------------------------------------------------------------------

/**
 * The native flags the CLI forwards (bin/catalyst.js keeps them out of
 * command dispatch; this reads them back in the platform script):
 * `--release` (signed store build), `--device` (the connected phone instead
 * of the emulator/simulator), `--url <u>` / `--url=<u>` (the release's
 * production URL, over WEBVIEW_CONFIG.url), `--yes` (confirms installs and
 * downloads, never licences or key creation) and `--accept-licenses`.
 *
 * @param {string[]} [argv]
 * @returns {{ release: boolean, device: boolean, url: string | undefined, yes: boolean, acceptLicenses: boolean }}
 */
function parseNativeArgs(argv = process.argv.slice(2)) {
    const result = { release: false, device: false, url: undefined, yes: false, acceptLicenses: false }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === "--release") result.release = true
        else if (arg === "--device") result.device = true
        else if (arg === "--yes") result.yes = true
        else if (arg === "--accept-licenses") result.acceptLicenses = true
        else if (arg === "--url" || arg.startsWith("--url=")) {
            const value = arg === "--url" ? argv[++i] : arg.slice("--url=".length)
            if (!value || value.startsWith("--")) {
                throw nativeError("NATIVE-004", "--url needs a value, e.g. --url https://shop.acme.com")
            }
            result.url = value
        }
    }
    return result
}

/**
 * True when a person can answer a question here: stdin and stdout are both
 * terminals and `CI` is not set.
 *
 * @param {object} [options]
 * @param {{ isTTY?: boolean }} [options.stdin]
 * @param {{ isTTY?: boolean }} [options.stdout]
 * @param {Record<string, string | undefined>} [options.env]
 */
function isInteractive({ stdin = process.stdin, stdout = process.stdout, env = process.env } = {}) {
    const ci = env.CI !== undefined && env.CI !== "" && env.CI !== "0" && env.CI.toLowerCase() !== "false"
    return Boolean(stdin?.isTTY && stdout?.isTTY && !ci)
}

/**
 * The error for a question that needs an answer when there is no terminal.
 *
 * @param {string} question - what would have been asked
 * @param {object} [options]
 * @param {string | null} [options.flag] - the flag that answers it; null when only a person can (key creation)
 * @param {string} [options.hint] - replaces the generated hint
 */
function needsAnswerError(question, { flag = null, hint } = {}) {
    const label = String(question).replace(/[?:\s]+$/, "")
    return nativeError("NATIVE-005", flag ? `${label} (pass ${flag})` : label, {
        hint:
            hint ||
            (flag
                ? `Pass ${flag} to answer yes without a terminal, or run the command in an interactive terminal.`
                : "Run the command once in an interactive terminal. No flag answers this, not even --yes."),
    })
}

/**
 * A yes/no question. Enter takes the default. Without a terminal it returns
 * false, so callers decide (usually needsAnswerError naming the flag).
 */
async function confirm(question, { defaultYes = true, prompt = promptUser, isTTY } = {}) {
    if (!(isTTY ?? isInteractive())) return false
    const answer = await prompt(`${question.replace(/[?\s]+$/, "")}? ${defaultYes ? "[Y/n]" : "[y/N]"}`, {
        defaultValue: defaultYes ? "y" : "n",
    })
    return /^y(es)?$/i.test(String(answer || "").trim())
}

// What each kind of consent accepts in place of a typed yes.
const CONSENT_FLAGS = { install: "--yes", licence: "--accept-licenses", key: null }

/**
 * Ask for consent to a step, following the rules for every native command:
 * - "install": an install or download. `--yes` answers it.
 * - "licence": accepting a licence. Only `--accept-licenses` answers it.
 * - "key": creating a signing key. Only a person at a terminal answers it.
 *
 * Returns true when allowed, false when the person said no. Without a
 * terminal and without the answering flag it throws NATIVE-005.
 *
 * @param {"install" | "licence" | "key"} kind
 * @param {string} question
 * @param {object} [options]
 * @param {{ yes?: boolean, acceptLicenses?: boolean }} [options.flags] - from parseNativeArgs
 * @param {boolean} [options.defaultYes] - Enter's answer; defaults to true, false for "key"
 * @param {boolean} [options.isTTY] - defaults to isInteractive()
 * @param {typeof promptUser} [options.prompt]
 * @returns {Promise<boolean>}
 */
async function askConsent(kind, question, { flags = {}, defaultYes, isTTY, prompt = promptUser } = {}) {
    if (!(kind in CONSENT_FLAGS)) throw new Error(`Unknown consent kind "${kind}"`)
    if (kind === "install" && flags.yes) return true
    if (kind === "licence" && flags.acceptLicenses) return true
    const interactive = isTTY ?? isInteractive()
    if (!interactive) throw needsAnswerError(question, { flag: CONSENT_FLAGS[kind] })
    return confirm(question, { defaultYes: defaultYes ?? kind !== "key", prompt, isTTY: true })
}

/**
 * Pick one of several choices on the terminal (a numbered list; Enter takes
 * the default). Without a terminal it returns the default, or throws
 * NATIVE-005 naming `flag` when there is none.
 *
 * @template T
 * @param {string} question
 * @param {{ label: string, value: T, hint?: string }[]} choices
 * @param {object} [options]
 * @param {T} [options.defaultValue]
 * @param {string} [options.flag] - the flag that makes this choice without a terminal
 * @param {boolean} [options.isTTY]
 * @param {typeof promptUser} [options.prompt]
 * @param {(text: string) => void} [options.write]
 * @returns {Promise<T>}
 */
async function select(
    question,
    choices,
    { defaultValue, flag, isTTY, prompt = promptUser, write = (text) => process.stdout.write(text) } = {}
) {
    if (!choices.length) throw new Error("select() needs at least one choice")
    const defaultIndex = Math.max(
        0,
        choices.findIndex((choice) => choice.value === defaultValue)
    )
    if (!(isTTY ?? isInteractive())) {
        if (defaultValue !== undefined) return defaultValue
        throw needsAnswerError(question, { flag: flag || null })
    }
    return withSpinnersPaused(async () => {
        write(`${GUTTER}${t.warn("?")} ${String(question).replace(/[?:\s]+$/, "")}\n`)
        choices.forEach((choice, index) => {
            const hint = choice.hint ? t.dim(`  ${choice.hint}`) : ""
            write(`${GUTTER}  ${index + 1}. ${choice.label}${hint}\n`)
        })
        for (;;) {
            const answer = await prompt(`Choose 1-${choices.length}`, {
                defaultValue: String(defaultIndex + 1),
            })
            const index = Number(String(answer).trim()) - 1
            if (Number.isInteger(index) && index >= 0 && index < choices.length) return choices[index].value
        }
    })
}

export {
    NATIVE_ERRORS,
    nativeError,
    parseNativeArgs,
    isInteractive,
    needsAnswerError,
    askConsent,
    select,
    runCommand,
    commandExists,
    promptUser,
    detectAndroidSdk,
    listAvds,
    ensureLocalProperties,
    ANDROID_SDK_HINT,
    runInteractiveCommand,
    runInheritedCommand,
    confirm,
    redactSecrets,
    redactError,
    expandHome,
}
