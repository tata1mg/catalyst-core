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

// Version history management functions
function loadBuildVersionHistory(buildVersionsFile) {
    try {
        if (fs.existsSync(buildVersionsFile)) {
            const content = fs.readFileSync(buildVersionsFile, "utf8")
            return JSON.parse(content)
        }
    } catch (error) {
        console.warn(`Warning: Could not load version history: ${error.message}`)
    }
    // Return default structure
    return {
        android: {
            versions: [],
            lastUsed: null,
        },
    }
}

function saveBuildVersionHistory(buildVersionsFile, history) {
    try {
        fs.writeFileSync(buildVersionsFile, JSON.stringify(history, null, 4), "utf8")
    } catch (error) {
        throw new Error(`Failed to save version history: ${error.message}`)
    }
}

function isVersionUsed(version, history) {
    return history.android.versions.includes(version)
}

function addVersionToHistory(buildVersionsFile, version, history) {
    if (!history.android.versions.includes(version)) {
        history.android.versions.push(version)
        history.android.lastUsed = version
    }
    saveBuildVersionHistory(buildVersionsFile, history)
}

async function promptBuildVersion(buildVersionsFile, logger = console) {
    const versionRegex = /^\d+\.\d+\.\d+$/
    const history = loadBuildVersionHistory(buildVersionsFile)

    let isValid = false
    let version = ""

    while (!isValid) {
        version = await promptUser("\nEnter build version (format: X.Y.Z, e.g., 1.0.0): ")

        // Validate format
        if (!versionRegex.test(version)) {
            logger.log(`Invalid format: "${version}". Please use format X.Y.Z (e.g., 1.0.0)`)
            continue
        }

        // Check if version already used
        if (isVersionUsed(version, history)) {
            logger.log(`Version ${version} has already been used. Please enter a new version.`)
            if (history.android.versions.length > 0) {
                logger.log(
                    `Previously used versions: ${history.android.versions.slice(-5).join(", ")}${history.android.versions.length > 5 ? "..." : ""}`
                )
            }
            continue
        }

        // Valid and unique version
        isValid = true
    }

    addVersionToHistory(buildVersionsFile, version, history)
    logger.log(`Build version ${version} validated and saved`)
    return version
}

export {
    runCommand,
    commandExists,
    promptUser,
    runSdkManagerCommand,
    runInteractiveCommand,
    validateAndCompleteConfig,
    loadBuildVersionHistory,
    saveBuildVersionHistory,
    isVersionUsed,
    addVersionToHistory,
    promptBuildVersion,
}
