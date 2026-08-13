import { execSync, spawn } from "child_process"
import readline from "readline"
import fs from "fs"

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
})

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

function runCommand(command) {
    // Redacted before it reaches the log file too -- the log is a build
    // artifact that gets attached to bug reports and uploaded by CI.
    try {
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Native setup/build uses fixed internal command strings; preserve existing shell behavior.
        // stderr is captured, not inherited. Many tools (java -version, for
        // one) write to stderr on success, and an inherited fd puts that text
        // at column 0 -- straight through whatever the spinner is drawing.
        // The caller decides what, if anything, is worth showing.
        return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    } catch (error) {
        console.error(`Error executing command: ${redactSecrets(command)}`)
        console.error(`Error message: ${redactSecrets(error.message)}`)
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

async function promptUser(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim())
        })
    })
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
        port: "Enter port number (e.g., 3005): ",
    }

    const platformConfigs = {
        android: {
            buildType: "Enter Android build type (debug/release): ",
            sdkPath: "Enter Android SDK path: ",
            emulatorName: "Enter Android emulator name (e.g., Small_Phone_API_35): ",
            cachePattern: "Enter Cache pattern (e.g.,  *.css): ",
        },
        ios: {
            buildType: "Enter iOS build type (debug/release): ",
            appBundleId: "Enter iOS bundle ID (e.g., com.test.test): ",
            simulatorName: "Enter iOS simulator name (e.g., iPhone 16 Pro): ",
            cachePattern: "Enter Cache pattern (e.g.,  *.css): ",
        },
    }

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

    // Handle common fields
    for (const [key, prompt] of Object.entries(commonFields)) {
        if (!webviewConfig[key]) {
            webviewConfig[key] = await promptUser(prompt)
        }
    }

    // Handle platform-specific fields
    for (const [key, prompt] of Object.entries(platformConfigs[platform])) {
        if (!webviewConfig[platform][key]) {
            webviewConfig[platform][key] = await promptUser(prompt)
        }
    }

    // Save updated config back to file
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
        console.log("Configuration updated successfully.")
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
    runSdkManagerCommand,
    runInteractiveCommand,
    validateAndCompleteConfig,
    redactSecrets,
}
