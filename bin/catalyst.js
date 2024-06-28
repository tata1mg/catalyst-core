#!/usr/bin/env node
"use strict"
process.on("unhandledRejection", (err) => {
    throw err
})
const { spawnSync } = require("node:child_process")
const args = process.argv.slice(2)
const scriptIndex = args.findIndex(
    (x) => x === "build" || x === "start" || x === "serve" || x === "devBuild" || x === "devServe"
)
const script = scriptIndex === -1 ? args[0] : args[scriptIndex]
const nodeArgs = scriptIndex > 0 ? args.slice(0, scriptIndex) : []
if (["build", "start", "serve", "devBuild", "devServe"].includes(script)) {
    const result = spawnSync(
        process.execPath,
        nodeArgs.concat(require.resolve("../dist/scripts/" + script)).concat(args.slice(scriptIndex + 1)),
        { stdio: "inherit" }
    )
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
} else {
    console.log('Unknown script "' + script + '".')
}
