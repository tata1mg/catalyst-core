#!/usr/bin/env node
"use strict"
process.on("unhandledRejection", (err) => {
    throw err
})
const { spawnSync } = require("node:child_process")
const args = process.argv.slice(2)
const scriptIndex = args.findIndex(
    (x) => x === "build" || x === "start" || x === "serve" || x === "devBuild" || x === "devServe" || 
    x === "buildAppIos" || x === "setupEmulatorIos"
)
const script = scriptIndex === -1 ? args[0] : args[scriptIndex]
const nodeArgs = scriptIndex > 0 ? args.slice(0, scriptIndex) : []

// Array of valid commands
const validCommands = [
    "build", "start", "serve", "devBuild", "devServe",
    "buildAppIos", "setupEmulatorIos"
]

if (validCommands.includes(script)) {
    // Special handling for iOS commands
    if (script === "setupEmulatorIos") {
        const result = spawnSync(
            process.execPath,
            nodeArgs.concat(require.resolve("@catalyst/template/src/native/iosSetup.js")).concat(args.slice(scriptIndex + 1)),
            { stdio: "inherit" }
        )
        handleProcessResult(result)
    } else
    if (script === "buildAppIos") {
        const result = spawnSync(
            process.execPath,
            nodeArgs.concat(require.resolve("@catalyst/template/src/native/iosBuild.js")).concat(args.slice(scriptIndex + 1)),
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