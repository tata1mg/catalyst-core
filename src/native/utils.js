import { execSync, spawn } from "child_process"
import readline from "readline"
import fs from "fs"

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
})

function runCommand(command) {
    try {
        return execSync(command, { encoding: "utf8" })
    } catch (error) {
        console.error(`Error executing command: ${command}`)
        console.error(`Error message: ${error.message}`)
        throw error
    }
}

function commandExists(command) {
    try {
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

async function promptUserWithTimeout(question, timeoutMs, defaultValue) {
    return new Promise((resolve) => {
        let timer = setTimeout(() => {
            console.log(`\nNo input received. Defaulting to: ${defaultValue}`)
            resolve(defaultValue)
        }, timeoutMs)

        rl.question(question, (answer) => {
            clearTimeout(timer)
            resolve(answer.trim() || defaultValue)
        })
    })
}

async function runInteractiveCommand(command, args, promptResponses = {}) {
    return new Promise((resolve, reject) => {
        const process = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] })

        let buffer = ""
        let outputBuffer = ""

        process.stdout.on("data", (data) => {
            buffer += data.toString()
            outputBuffer += data.toString()
            console.log(data.toString())
            handlePrompts(process, buffer, promptResponses)
        })

        process.stderr.on("data", (data) => {
            buffer += data.toString()
            outputBuffer += data.toString()
            console.error(data.toString())
            handlePrompts(process, buffer, promptResponses)
        })

        process.on("close", (code) => {
            if (code === 0) {
                resolve(outputBuffer)
            } else {
                reject(new Error(`Command failed with exit code ${code}`))
            }
        })
    })
}

function handlePrompts(process, buffer, promptResponses) {
    for (const [prompt, response] of Object.entries(promptResponses)) {
        if (buffer.includes(prompt)) {
            process.stdin.write(response + "\n")
            return
        }
    }
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

/**
 * Initialize configuration for a specific platform
 */
async function initializeConfig(platform, configPath, progress) {
    const configFile = fs.readFileSync(configPath, "utf8")
    const config = JSON.parse(configFile)
    const { WEBVIEW_CONFIG } = config

    if (!WEBVIEW_CONFIG || Object.keys(WEBVIEW_CONFIG).length === 0) {
        progress.log("WebView Config missing in " + configPath, "error")
        process.exit(1)
    }

    if (!WEBVIEW_CONFIG[platform]) {
        WEBVIEW_CONFIG[platform] = {}
    }

    return { WEBVIEW_CONFIG }
}

/**
 * Save configuration for a specific platform
 */
async function saveConfig(platform, configPath, newConfig, progress) {
    try {
        const existingConfigFile = fs.readFileSync(configPath, "utf8")
        const existingConfig = JSON.parse(existingConfigFile)

        const updatedConfig = {
            ...existingConfig,
            WEBVIEW_CONFIG: {
                ...existingConfig.WEBVIEW_CONFIG,
                [platform]: newConfig.WEBVIEW_CONFIG[platform],
            },
        }

        fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2))
        progress.log("Configuration saved successfully", "success")
    } catch (error) {
        progress.log("Failed to save configuration: " + error.message, "error")
        process.exit(1)
    }
}

/**
 * Handle post-setup interactive prompts (IP Update and Server Start)
 */
async function handlePostSetupSteps(platform, configPath, progress, utils) {
    const { getLocalIPAddress, updateConfigWithLocalIP, isServerRunning, startServerBackground } = utils

    // Step 1: Optional IP Update
    progress.start("updateIP")
    progress.pause()
    const updateIP = await promptUserWithTimeout(
        "\nWould you like to update the local IP in the configuration? (y/N) [Default: N, Timeout: 10s]: ",
        10000,
        "n"
    )
    progress.resume()

    if (updateIP.toLowerCase() === "y") {
        progress.pause()
        const localIP = getLocalIPAddress()
        updateConfigWithLocalIP(configPath, localIP)
        progress.resume()
        progress.log(`Configuration updated with local IP: ${localIP}`, "success")
    } else {
        progress.log("Skipping IP update", "info")
    }
    progress.complete("updateIP")

    // Step 2: Optional Server Start
    progress.start("startServer")
    const configFile = fs.readFileSync(configPath, "utf8")
    const configObj = JSON.parse(configFile)
    const port = configObj.WEBVIEW_CONFIG?.port || 3005
    const running = await isServerRunning(port)

    if (running) {
        progress.log(`Dev server already running on port ${port}`, "info")
    } else {
        progress.pause()
        const startServer = await promptUserWithTimeout(
            "\nWould you like to start the dev server? (y/N) [Default: N, Timeout: 10s]: ",
            10000,
            "n"
        )
        progress.resume()

        if (startServer.toLowerCase() === "y") {
            startServerBackground()
            progress.log("Dev server started in background", "success")
        } else {
            progress.log("Skipping server startup", "info")
            progress.log("To serve pages locally, start the dev server manually.", "info")
        }
    }
    progress.complete("startServer")
}

export {
    runCommand,
    commandExists,
    promptUser,
    promptUserWithTimeout,
    runSdkManagerCommand,
    runInteractiveCommand,
    validateAndCompleteConfig,
    initializeConfig,
    saveConfig,
    handlePostSetupSteps,
}
