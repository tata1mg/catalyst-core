#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
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
    "credentials:export": "../dist/native/exportCredentials.js",
}
const validCommands = new Set([...webCommands, "buildApp", "setupEmulator", ...Object.keys(platformScripts)])

const require = createRequire(import.meta.url)
const pkg = require("../package.json")

// The house style when the built CLI layer is present; plain text otherwise,
// so help still works from a source checkout that has not been built.
let theme = null
try {
    theme = require("../dist/cli/theme.js")
} catch {
    // Unbuilt checkout.
}
const paint = (name, text) => (theme ? theme.t[name](text) : text)
const GUTTER = "  "

const HELP = [
    [
        "Web",
        [
            ["start", "Start the development server"],
            ["build", "Build the app for production"],
            ["serve", "Serve the production build"],
        ],
    ],
    [
        "Native",
        [
            ["setupEmulator:android", "Install the Android tools and start the emulator"],
            ["setupEmulator:ios", "Install the iOS simulator and finish Xcode setup"],
            ["buildApp:android", "Build and install the Android app"],
            ["buildApp:ios", "Build and install the iOS app"],
            ["credentials:export", "Print credentials/<android|ios>/ as one CI secret"],
        ],
    ],
    [
        "More",
        [
            ["serve:inspect", "Serve with the Node inspector attached"],
            ["plugins", "Turn native plugins on or off"],
        ],
    ],
]

function printHelp() {
    const width = 24
    const lines = [""]
    lines.push(`${GUTTER}${paint("bold", paint("accent", "catalyst"))}${paint("dim", ` v${pkg.version}`)}`)
    lines.push(`${GUTTER}${paint("dim", "─".repeat(46))}`)
    lines.push(`${GUTTER}${paint("dim", "Usage")}  catalyst <command> [options]`)
    for (const [group, commands] of HELP) {
        lines.push("", `${GUTTER}${paint("bold", group)}`)
        for (const [name, text] of commands)
            lines.push(`${GUTTER}  ${paint("accent", name.padEnd(width))}${paint("dim", text)}`)
    }
    lines.push("", `${GUTTER}${paint("bold", "Options")}`)
    lines.push(
        `${GUTTER}  ${"--verbose".padEnd(width)}${paint("dim", "Show every step and the full tool output")}`
    )
    lines.push(
        `${GUTTER}  ${"--debug".padEnd(width)}${paint("dim", "Also print stacks and the environment")}`
    )
    lines.push(
        `${GUTTER}  ${"--release".padEnd(width)}${paint("dim", "buildApp: build the signed store release")}`
    )
    lines.push(
        `${GUTTER}  ${"--device".padEnd(width)}${paint("dim", "buildApp: run on the connected phone")}`
    )
    lines.push(
        `${GUTTER}  ${"--url <url>".padEnd(width)}${paint("dim", "buildApp: the release's production URL")}`
    )
    lines.push(
        `${GUTTER}  ${"--yes".padEnd(width)}${paint("dim", "Confirm installs and downloads without asking")}`
    )
    lines.push(
        `${GUTTER}  ${"--accept-licenses".padEnd(width)}${paint("dim", "Accept the Android SDK and Xcode licences")}`
    )
    lines.push(`${GUTTER}  ${"-h, --help".padEnd(width)}${paint("dim", "Show this help")}`)
    lines.push(`${GUTTER}  ${"-v, --version".padEnd(width)}${paint("dim", "Print the version")}`)
    console.log(`${lines.join("\n")}\n`)
}

/** Edit distance, for suggesting the command someone meant. */
function distance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0]
        row[0] = i
        for (let j = 1; j <= b.length; j++) {
            const current = row[j]
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
            previous = current
        }
    }
    return row[b.length]
}

function closestCommand(input) {
    let best = null
    for (const command of validCommands) {
        const d = distance(input.toLowerCase(), command.toLowerCase())
        if (d <= Math.max(2, Math.floor(command.length / 3)) && (!best || d < best.d)) best = { command, d }
    }
    return best?.command ?? null
}

if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    printHelp()
    process.exit(0)
}
if (args[0] === "--version" || args[0] === "-v") {
    console.log(pkg.version)
    process.exit(0)
}

// Native flags, with how many values each takes. They are pulled out before
// dispatch wherever they appear, so `--url build` can't be read as the build
// command and a flag before the command isn't handed to node. Agents and CI
// answer every question with these; nothing else is ever asked.
const nativeFlags = {
    "--release": 0,
    "--device": 0,
    "--url": 1,
    "--yes": 0,
    "--accept-licenses": 0,
}
const forwardedFlags = []
const commandArgs = []
for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const name = arg.split("=")[0]
    if (name in nativeFlags) {
        const takesValue = nativeFlags[name] > 0 && !arg.includes("=")
        forwardedFlags.push(...args.slice(i, i + 1 + (takesValue ? 1 : 0)))
        if (takesValue) i++
    } else {
        commandArgs.push(arg)
    }
}

const scriptIndex = commandArgs.findIndex((arg) => validCommands.has(arg))
const script = scriptIndex === -1 ? commandArgs[0] : commandArgs[scriptIndex]
const nodeArgs = scriptIndex > 0 ? commandArgs.slice(0, scriptIndex) : []
const scriptArgs = [...forwardedFlags, ...commandArgs.slice(scriptIndex + 1)]

if (!script) {
    // Only flags, no command.
    printHelp()
    process.exit(1)
}

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

const suggestion = closestCommand(script)
console.error(
    `\n${GUTTER}${paint("bad", paint("bold", "error"))}\n${GUTTER}${paint("bold", `Unknown command "${script}"`)}\n\n` +
        `${GUTTER}${paint("accent", "hint")}  ${
            suggestion ? `Did you mean ${paint("accent", `catalyst ${suggestion}`)}? ` : ""
        }Run ${paint("accent", "catalyst --help")} for the list.\n`
)
process.exit(1)
