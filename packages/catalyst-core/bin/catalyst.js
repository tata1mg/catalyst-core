#!/usr/bin/env node
process.on("unhandledRejection", (err) => {
    throw err
})

import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const args = process.argv.slice(2)

const validCommands = [
    "build",
    "start",
    "serve",
    "devBuild",
    "devServe",
    "buildApp",
    "buildApp:ios",
    "buildApp:android",
    "setupEmulator",
    "setupEmulator:ios",
    "setupEmulator:android",
]

const platformScripts = {
    "setupEmulator:ios": "../dist/native/setupEmulatorIos.js",
    "setupEmulator:android": "../dist/native/androidSetup.js",
    "buildApp:ios": "../dist/native/buildAppIos.js",
    "buildApp:android": "../dist/native/buildAppAndroid.js",
}

const isPlatformCommand = (arg, prefix) => {
    if (!arg.startsWith(`${prefix}:`)) return false
    const platform = arg.split(":")[1]
    return ["ios", "android"].includes(platform) || platform === undefined
}

const runPlatformCommand = (baseCommand, platform) => {
    const command = `${baseCommand}:${platform}`
    const result = spawnSync(
        process.execPath,
        nodeArgs.concat(resolve(__dirname, platformScripts[command])).concat(args.slice(scriptIndex + 1)),
        { stdio: "inherit" }
    )
    return result
}

const runAllPlatforms = (baseCommand) => {
    const platforms = ["ios", "android"]
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
    (x) =>
        x === "build" ||
        x === "start" ||
        x === "serve" ||
        x === "devBuild" ||
        x === "devServe" ||
        isPlatformCommand(x, "buildApp") ||
        isPlatformCommand(x, "setupEmulator")
)
const script = scriptIndex === -1 ? args[0] : args[scriptIndex]
const nodeArgs = scriptIndex > 0 ? args.slice(0, scriptIndex) : []

if (validCommands.includes(script)) {
    if (script === "buildApp" || script === "setupEmulator") {
        runAllPlatforms(script)
    } else if (script in platformScripts) {
        const result = spawnSync(
            process.execPath,
            nodeArgs.concat(resolve(__dirname, platformScripts[script])).concat(args.slice(scriptIndex + 1)),
            { stdio: "inherit" }
        )
        handleProcessResult(result)
    } else {
        const result = spawnSync(
            process.execPath,
            nodeArgs.concat(resolve(__dirname, "../dist/scripts/" + script + ".js")).concat(args.slice(scriptIndex + 1)),
            { stdio: "inherit" }
        )
        handleProcessResult(result)
    }
} else {
    console.log('Unknown script "' + script + '".')
}

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
