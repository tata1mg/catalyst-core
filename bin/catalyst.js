#!/usr/bin/env node
"use strict"
process.on("unhandledRejection", (err) => {
    throw err
})
const { spawnSync } = require("node:child_process")
const args = process.argv.slice(2)

// Array of valid commands
const validCommands = [
    "build", "start", "serve", "devBuild", "devServe",
    "buildApp", "buildApp:ios", "buildApp:android",
    "setupEmulator", "setupEmulator:ios", "setupEmulator:android"
]

// Map of platform-specific commands to their script paths
const platformScripts = {
    "setupEmulator:ios": "@catalyst/template/src/native/setupEmulatorIos.js",
    "setupEmulator:android": "@catalyst/template/src/native/androidSetup.js",
    "buildApp:ios": "@catalyst/template/src/native/buildAppIos.js",
    "buildApp:android": "@catalyst/template/src/native/buildAppAndroid.js"
}

// Helper to check if arg is a platform command
const isPlatformCommand = (arg, prefix) => {
    if (!arg.startsWith(`${prefix}:`)) return false
    const platform = arg.split(':')[1]
    return ['ios', 'android'].includes(platform) || platform === undefined
}


// Helper function to run a platform command
const runPlatformCommand = (baseCommand, platform) => {
    const command = `${baseCommand}:${platform}`
    const result = spawnSync(
        process.execPath,
        nodeArgs.concat(require.resolve(platformScripts[command])).concat(args.slice(scriptIndex + 1)),
        { stdio: "inherit" }
    )
    return result
}

// Helper function to run commands for all platforms
const runAllPlatforms = (baseCommand) => {
    const platforms = ['ios', 'android']
    for (const platform of platforms) {
        const result = runPlatformCommand(baseCommand, platform)
        if (result.status !== 0) {
            handleProcessResult(result)
            return
        }
    }
    process.exit(0)
}

const scriptIndex = args.findIndex(
    (x) => x === "build" || x === "start" || x === "serve" || x === "devBuild" || x === "devServe" || 
    isPlatformCommand(x, 'buildApp') || isPlatformCommand(x, 'setupEmulator')
)
const script = scriptIndex === -1 ? args[0] : args[scriptIndex]
const nodeArgs = scriptIndex > 0 ? args.slice(0, scriptIndex) : []

if (validCommands.includes(script)) {
    // Handle platform-specific or combined commands
    if (script === "buildApp" || script === "setupEmulator") {
        // Run for all platforms if no specific platform is specified
        runAllPlatforms(script)
    } else if (script in platformScripts) {
        // Run for specific platform
        const result = spawnSync(
            process.execPath,
            nodeArgs.concat(require.resolve(platformScripts[script])).concat(args.slice(scriptIndex + 1)),
            { stdio: "inherit" }
        )
        handleProcessResult(result)
    } else {
        // Original commands
        const result = spawnSync(
            process.execPath,
            nodeArgs.concat(require.resolve("../dist/scripts/" + script)).concat(args.slice(scriptIndex + 1)),
            { stdio: "inherit" }
        )
        handleProcessResult(result)
    }
} else {
    console.log('Unknown script "' + script + '".')
}

// Helper function to handle process results
function handleProcessResult(result) {
    if (result.signal) {
        if (result.signal === "SIGKILL") {
            console.log(
                "The build failed because the process exited too early. " +
                "This probably means the system ran out of memory or someone called " +
                "`kill -9` on the process."
            )
        } else if (result.signal === "SIGTERM") {
            console.log(
                "The build failed because the process exited too early. " +
                "Someone might have called `kill` or `killall`, or the system could " +
                "be shutting down."
            )
        }
        process.exit(1)
    }
    process.exit(result.status)
}