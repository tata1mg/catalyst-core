import { execFileSync, spawnSync } from "child_process"
import {
    nativeError,
    runInheritedCommand,
    isInteractiveTerminal,
    promptUser,
    confirm as confirmUser,
} from "./utils.js"

const DEFAULT_SIMULATOR_NAME = "Catalyst iPhone"

/** Exit status and output of a probe; never throws. */
function probe(command, args) {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Fixed Xcode probe commands with argv arrays.
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 60000 })
    return {
        status: result.error ? null : result.status,
        output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
    }
}

function simctlJson(args) {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Fixed simctl queries with argv arrays.
    return JSON.parse(execFileSync("xcrun", ["simctl", ...args, "-j"], { encoding: "utf8" }))
}

/**
 * The active developer directory must be inside an Xcode app bundle. The
 * Command Line Tools alone have no simulator, SDKs or xcodebuild that builds
 * apps. Throws IOS-002 otherwise.
 */
function assertFullXcode({ run = probe } = {}) {
    const { status, output } = run("xcode-select", ["-p"])
    const dir = status === 0 ? output.split("\n")[0].trim() : ""
    if (!/\.app\/Contents\/Developer\/?$/.test(dir)) {
        throw nativeError(
            "IOS-002",
            dir ? `xcode-select points at ${dir}` : "xcode-select has no developer directory"
        )
    }
    return dir
}

const XCODE_SETUP_STEPS = [
    {
        label: "the Xcode licence",
        check: ["xcodebuild", "-license", "check"],
        fix: ["sudo", "xcodebuild", "-license", "accept"],
    },
    {
        label: "Xcode's first-launch components",
        check: ["xcodebuild", "-checkFirstLaunchStatus"],
        fix: ["sudo", "xcodebuild", "-runFirstLaunch"],
    },
]

/** The setup steps Xcode still needs, each with the sudo command that does it. */
function pendingXcodeSetup({ run = probe } = {}) {
    return XCODE_SETUP_STEPS.filter((step) => run(step.check[0], step.check.slice(1)).status !== 0)
}

/**
 * Full Xcode, licence accepted and first launch done. Pending steps are
 * printed; in a terminal the user may let us run them (sudo asks for the
 * password on their terminal). Never runs sudo without a terminal yes.
 */
async function ensureXcodeReady({
    run = probe,
    isTTY = isInteractiveTerminal(),
    confirm = confirmUser,
    runInherited = runInheritedCommand,
    log = () => {},
} = {}) {
    const developerDir = assertFullXcode({ run })
    let pending = pendingXcodeSetup({ run })
    if (!pending.length) return developerDir

    const commands = pending.map((step) => step.fix.join(" "))
    log(`Xcode needs ${pending.map((step) => step.label).join(" and ")}. Run:`, "note")
    for (const command of commands) log(`  ${command}`, "note")
    if (!isTTY || !(await confirm("Run them now (sudo will ask for your password)"))) {
        throw nativeError("IOS-003", commands.join(" && "))
    }
    for (const step of pending) await runInherited(step.fix[0], step.fix.slice(1))
    pending = pendingXcodeSetup({ run })
    if (pending.length) throw nativeError("IOS-003", pending.map((step) => step.fix.join(" ")).join(" && "))
    return developerDir
}

function compareVersions(a, b) {
    const pa = String(a).split(".").map(Number)
    const pb = String(b).split(".").map(Number)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0)
        if (diff) return diff
    }
    return 0
}

const isAvailable = (item) =>
    item.isAvailable === true || item.availability === "(available)" || item.availability === "available"

/** Available iOS simulator runtimes, newest first. */
function availableIosRuntimes(runtimesJson) {
    return (runtimesJson?.runtimes || [])
        .filter(
            (runtime) =>
                (runtime.platform === "iOS" || /SimRuntime\.iOS-/.test(runtime.identifier)) &&
                isAvailable(runtime)
        )
        .sort((a, b) => compareVersions(b.version, a.version))
}

/**
 * The newest available iOS runtime. With none, `xcodebuild -downloadPlatform
 * iOS` (several GB) runs after a terminal confirm or --yes; otherwise IOS-004.
 */
async function ensureIosRuntime({
    yes = false,
    isTTY = isInteractiveTerminal(),
    confirm = confirmUser,
    runInherited = runInheritedCommand,
    listRuntimes = () => simctlJson(["list", "runtimes"]),
    log = () => {},
} = {}) {
    let [runtime] = availableIosRuntimes(listRuntimes())
    if (runtime) return runtime

    const consent =
        yes ||
        (isTTY && (await confirm("No iOS simulator runtime is installed. Download the latest (several GB)")))
    if (!consent) throw nativeError("IOS-004", "pass --yes or run xcodebuild -downloadPlatform iOS")
    log("Downloading the iOS simulator runtime", "note")
    await runInherited("xcodebuild", ["-downloadPlatform", "iOS"])
    ;[runtime] = availableIosRuntimes(listRuntimes())
    if (!runtime)
        throw nativeError("IOS-004", "xcodebuild -downloadPlatform iOS finished without an available runtime")
    return runtime
}

/**
 * The newest iPhone this runtime supports. simctl lists a runtime's supported
 * device types newest first; the global list is the fallback, ordered by the
 * oldest runtime each type needs.
 */
function newestIphoneDeviceType(runtime, deviceTypesJson) {
    const isIphone = (type) => type.productFamily === "iPhone" || /^iPhone/.test(type.name || "")
    const supported = (runtime?.supportedDeviceTypes || []).filter(isIphone)
    if (supported.length) return supported[0]
    const all = (deviceTypesJson?.devicetypes || []).filter(isIphone)
    return all.sort((a, b) => (b.minRuntimeVersion || 0) - (a.minRuntimeVersion || 0))[0] || null
}

/** Available simulators under a runtime. */
function simulatorsFor(runtime, devicesJson) {
    return (devicesJson?.devices?.[runtime.identifier] || []).filter(isAvailable)
}

/**
 * Pick the simulator to configure when none is. A terminal gets a list whose
 * first (default) entry creates (or reuses) "Catalyst iPhone"; without one,
 * or with --yes, that default is taken.
 *
 * @returns {Promise<{ name: string, created: boolean }>}
 */
async function chooseSimulator({
    runtime,
    devicesJson,
    deviceTypesJson,
    yes = false,
    isTTY = isInteractiveTerminal(),
    prompt = promptUser,
    print = (line) => console.log(line),
    create = (name, deviceType, rt) =>
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - simctl with an argv array; the name is passed as one argument.
        execFileSync("xcrun", ["simctl", "create", name, deviceType.identifier, rt.identifier], {
            encoding: "utf8",
        }),
}) {
    const simulators = simulatorsFor(runtime, devicesJson)
    const deviceType = newestIphoneDeviceType(runtime, deviceTypesJson)
    const existingDefault = simulators.find((sim) => sim.name === DEFAULT_SIMULATOR_NAME)

    const createNamed = (name) => {
        if (!deviceType) throw new Error(`No iPhone device type is available for ${runtime.name}`)
        create(name, deviceType, runtime)
        return { name, created: true }
    }
    const takeDefault = () =>
        existingDefault
            ? { name: DEFAULT_SIMULATOR_NAME, created: false }
            : createNamed(DEFAULT_SIMULATOR_NAME)

    if (yes || !isTTY) return takeDefault()

    const others = simulators.filter((sim) => sim.name !== DEFAULT_SIMULATOR_NAME)
    print(`\nSimulators for ${runtime.name}:`)
    print(
        existingDefault
            ? `1. ${DEFAULT_SIMULATOR_NAME}`
            : `1. Create "${DEFAULT_SIMULATOR_NAME}" (${deviceType?.name || "iPhone"}, ${runtime.name})`
    )
    others.forEach((sim, index) => print(`${index + 2}. ${sim.name}`))
    print(`Or type "new" to create one with another name.`)

    for (;;) {
        const answer = String(await prompt("Simulator", { defaultValue: "1" })).trim()
        if (answer.toLowerCase() === "new") {
            const name = String(
                await prompt("Name for the new simulator", { defaultValue: DEFAULT_SIMULATOR_NAME })
            ).trim()
            const existing = simulators.find((sim) => sim.name === name)
            return existing ? { name, created: false } : createNamed(name)
        }
        const index = Number.parseInt(answer, 10)
        if (index === 1) return takeDefault()
        if (index >= 2 && index < others.length + 2) return { name: others[index - 2].name, created: false }
        print("Invalid selection. Please try again.")
    }
}

export {
    DEFAULT_SIMULATOR_NAME,
    assertFullXcode,
    pendingXcodeSetup,
    ensureXcodeReady,
    availableIosRuntimes,
    ensureIosRuntime,
    newestIphoneDeviceType,
    simulatorsFor,
    chooseSimulator,
    simctlJson,
}
