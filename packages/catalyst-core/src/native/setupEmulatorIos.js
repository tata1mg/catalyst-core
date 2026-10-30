import fs from "fs"
import path from "path"
import { parseNativeArgs } from "./utils.js"
import { ensureXcodeReady, ensureIosRuntime, ensureSimulator } from "./iosToolchain.js"
import { getLastTarget } from "./localState.js"
import TerminalProgress from "./terminalProgress.js"
import { buildFailure } from "../cli/diagnostic.js"

// `catalyst setupEmulator:ios`: install what an iOS debug build needs on this
// Mac (Xcode's licence and first-launch components, a simulator runtime, the
// simulator) and nothing else. It reads ios.simulatorName from config.json
// but never writes config.json, and starts no server. buildApp:ios runs the
// same checks itself, so this is only for setting a machine up ahead of time.

const steps = {
    platform: "Check platform compatibility",
    xcode: "Check Xcode",
    runtime: "Check iOS simulator runtime",
    simulator: "Check iOS simulator",
}

const progress = new TerminalProgress(steps, "catalyst setupEmulator", { subject: "ios" })
const log = (message, type = "info") => progress.log(message, type)

/** ios.simulatorName from config/config.json, when the app sets one. */
function configuredSimulatorName(cwd = process.cwd()) {
    try {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - cwd is the app root; the file name is fixed.
        const config = JSON.parse(fs.readFileSync(path.join(cwd, "config", "config.json"), "utf8"))
        const name = config?.WEBVIEW_CONFIG?.ios?.simulatorName
        return typeof name === "string" && name.trim() ? name.trim() : null
    } catch (error) {
        return null
    }
}

async function setupIOSEnvironment() {
    try {
        const flags = parseNativeArgs(process.argv.slice(2))

        progress.start("platform")
        if (process.platform !== "darwin") {
            progress.log("iOS Simulator is only available on macOS.", "error")
            process.exit(1)
        }
        progress.complete("platform")

        progress.start("xcode")
        const developerDir = await ensureXcodeReady({ flags, log })
        progress.log(`Using ${developerDir}`, "info")
        progress.complete("xcode")

        progress.start("runtime")
        const runtime = await ensureIosRuntime({ flags, log })
        progress.log(`Runtime ${runtime.name}`, "info")
        progress.complete("runtime")

        progress.start("simulator")
        const simulator = await ensureSimulator({
            runtime,
            name: configuredSimulatorName() || undefined,
            last: getLastTarget("ios"),
            flags,
            log,
        })
        if (!simulator.created) progress.log(`Simulator "${simulator.name}" is ready`, "info")
        progress.complete("simulator")

        progress.printTreeContent("iOS", [
            { text: `xcode       ${developerDir}`, color: "gray" },
            { text: `runtime     ${runtime.name}`, color: "gray" },
            { text: `simulator   ${simulator.name}`, color: "gray" },
        ])
        progress.summary("Ready", "Run catalyst buildApp:ios to build and install the app")
        process.exit(0)
    } catch (error) {
        // A coded error (IOS-003, NATIVE-005, ...) gets the full diagnostic:
        // code, hint and doc link. Anything else keeps the one-line failure.
        const coded = /^[A-Z]+-\d{3}$/.test(String(error?.code || ""))
        if (progress.currentStep) {
            progress.fail(progress.currentStep.id, coded ? undefined : error.message)
        }
        if (coded) process.stderr.write(buildFailure({ error, stage: "iOS setup" }))
        else progress.hint(error.hint)
        process.exit(1)
    }
}

setupIOSEnvironment()
