#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

process.on("unhandledRejection", (error) => {
    throw error
})

const __dirname = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const webCommands = new Set(["build", "start", "serve", "serve:inspect", "plugin", "plugins"])
const platformScripts = {
    "setupEmulator:ios": "../dist/native/setupEmulatorIos.js",
    "setupEmulator:android": "../dist/native/androidSetup.js",
    "buildApp:ios": "../dist/native/buildAppIos.js",
    "buildApp:android": "../dist/native/buildAppAndroid.js",
}
const validCommands = new Set([...webCommands, "buildApp", "setupEmulator", ...Object.keys(platformScripts)])

const scriptIndex = args.findIndex((arg) => validCommands.has(arg))
const script = scriptIndex === -1 ? args[0] : args[scriptIndex]
const nodeArgs = scriptIndex > 0 ? args.slice(0, scriptIndex) : []
const scriptArgs = args.slice(scriptIndex + 1)

function handleProcessResult(result) {
    if (result.signal) {
        if (result.signal === "SIGKILL") {
            console.error("The Catalyst process was terminated with SIGKILL.")
        } else if (result.signal === "SIGTERM") {
            console.error("The Catalyst process was terminated with SIGTERM.")
        }
        process.exit(1)
    }
    process.exit(result.status ?? 1)
}

function runScript(relativePath, extraArgs = []) {
    return spawnSync(
        process.execPath,
        [...nodeArgs, resolve(__dirname, relativePath), ...extraArgs, ...scriptArgs],
        {
            stdio: "inherit",
        }
    )
}

function runPlatformCommand(command) {
    return runScript(platformScripts[command])
}

if (script === "buildApp" || script === "setupEmulator") {
    for (const platform of ["ios", "android"]) {
        const result = runPlatformCommand(`${script}:${platform}`)
        if (result.status !== 0 || result.signal) handleProcessResult(result)
    }
    process.exit(0)
}

if (platformScripts[script]) {
    handleProcessResult(runPlatformCommand(script))
}

if (webCommands.has(script)) {
    const scriptName = script === "plugin" ? "plugins" : script === "serve:inspect" ? "serve" : script
    const extraArgs = script === "serve:inspect" ? ["--inspect"] : []
    handleProcessResult(runScript(`../dist/scripts/${scriptName}.js`, extraArgs))
}

console.error(`Unknown script "${script}".`)
process.exit(1)
