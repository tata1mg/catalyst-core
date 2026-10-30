import { execFileSync, spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import {
    nativeError,
    needsAnswerError,
    runInheritedCommand,
    isInteractive,
    askConsent,
    select as selectChoice,
} from "./utils.js"
import { getDeviceReachableHost } from "./setupServer.js"
import { getLastTarget, saveLastTarget } from "./localState.js"

// The iOS toolchain checks `buildApp:ios` runs before it builds, and
// `setupEmulator:ios` runs on its own: full Xcode with its licence and
// first-launch components, an iOS simulator runtime, a simulator, and the
// choice between that simulator and a connected iPhone. Installs ask first
// (askConsent "install", answered by --yes), the licence asks separately
// ("licence", answered by --accept-licenses). Nothing here writes config.json.

const DEFAULT_SIMULATOR_NAME = "Catalyst iPhone"

/** Exit status and output of a probe; never throws. */
function probe(command, args, { spawn = spawnSync } = {}) {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Fixed Xcode probe commands with argv arrays.
    const result = spawn(command, args, { encoding: "utf8", timeout: 60000 })
    return {
        status: result.error ? null : result.status,
        output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
    }
}

function simctlJson(args, { exec = execFileSync } = {}) {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Fixed simctl queries with argv arrays.
    return JSON.parse(exec("xcrun", ["simctl", ...args, "-j"], { encoding: "utf8" }))
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
        consent: "licence",
        flag: "--accept-licenses",
        question: "Accept the Xcode licence (runs sudo xcodebuild -license accept)",
        check: ["xcodebuild", "-license", "check"],
        fix: ["sudo", "xcodebuild", "-license", "accept"],
    },
    {
        label: "Xcode's first-launch components",
        consent: "install",
        flag: "--yes",
        question: "Install Xcode's first-launch components (runs sudo xcodebuild -runFirstLaunch)",
        check: ["xcodebuild", "-checkFirstLaunchStatus"],
        fix: ["sudo", "xcodebuild", "-runFirstLaunch"],
    },
]

/** The setup steps Xcode still needs, each with the sudo command that does it. */
function pendingXcodeSetup({ run = probe } = {}) {
    return XCODE_SETUP_STEPS.filter((step) => run(step.check[0], step.check.slice(1)).status !== 0)
}

/**
 * Full Xcode, licence accepted and first launch done.
 *
 * Each pending step is printed with its sudo command, then asked for: the
 * licence with askConsent("licence") (only --accept-licenses answers it
 * without a terminal), the first-launch install with askConsent("install")
 * (--yes). In a terminal sudo asks for the password there. Without one the
 * command runs as `sudo -n`, which works only where sudo needs no password
 * (hosted CI runners); otherwise the error names the command to run.
 *
 * @param {Record<string, any>} [options] - `flags` ({ yes, acceptLicenses } from parseNativeArgs) and `log`; the rest are seams for tests
 */
async function ensureXcodeReady({
    flags = {},
    run = probe,
    isTTY = isInteractive(),
    ask = askConsent,
    runInherited = runInheritedCommand,
    log = () => {},
} = {}) {
    const developerDir = assertFullXcode({ run })
    const pending = pendingXcodeSetup({ run })
    if (!pending.length) return developerDir

    for (const step of pending) {
        const command = step.fix.join(" ")
        log(`Xcode needs ${step.label}. To do it yourself, run: ${command}`, "note")
        const answered = step.consent === "licence" ? flags.acceptLicenses : flags.yes
        if (!isTTY && !answered) {
            throw needsAnswerError(step.question, {
                flag: step.flag,
                hint: `Run ${command} yourself, or pass ${step.flag} where sudo needs no password (CI), or run the build in a terminal.`,
            })
        }
        if (!(await ask(step.consent, step.question, { flags, isTTY }))) {
            throw nativeError("IOS-003", command)
        }
        const argv = isTTY ? step.fix : ["sudo", "-n", ...step.fix.slice(1)]
        try {
            await runInherited(argv[0], argv.slice(1))
        } catch (error) {
            throw nativeError("IOS-003", `${command} did not finish (${error.message})`)
        }
    }
    const still = pendingXcodeSetup({ run })
    if (still.length) throw nativeError("IOS-003", still.map((step) => step.fix.join(" ")).join(" && "))
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
 * iOS` (several GB) runs after askConsent("install") (a terminal yes or
 * --yes). Without a terminal and without --yes it fails with NATIVE-005; a
 * no fails with IOS-004.
 */
async function ensureIosRuntime({
    flags = {},
    isTTY = isInteractive(),
    ask = askConsent,
    runInherited = runInheritedCommand,
    listRuntimes = () => simctlJson(["list", "runtimes"]),
    log = () => {},
} = {}) {
    let [runtime] = availableIosRuntimes(listRuntimes())
    if (runtime) return runtime

    const consent = await ask(
        "install",
        "No iOS simulator runtime is installed. Download the latest (several GB)",
        { flags, isTTY }
    )
    if (!consent) throw nativeError("IOS-004", "the download was declined")
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
 * The available simulator called `name`: under `runtime` first, then under
 * any other runtime. Null when there is none.
 */
function findSimulator(name, runtime, devicesJson) {
    const preferred = runtime ? simulatorsFor(runtime, devicesJson).find((sim) => sim.name === name) : null
    if (preferred) return preferred
    for (const devices of Object.values(devicesJson?.devices || {})) {
        const match = (devices || []).find((sim) => sim.name === name && isAvailable(sim))
        if (match) return match
    }
    return null
}

/** An iPhone simulator, by device type, else by name (test fixtures carry no type). */
const isIphoneSimulator = (sim) =>
    /\.iPhone-/.test(sim?.deviceTypeIdentifier || "") || /^iPhone\b/.test(sim?.name || "")

/** "26.0" from "com.apple.CoreSimulator.SimRuntime.iOS-26-0"; null for other platforms. */
const iosRuntimeVersion = (identifier) => {
    const match = /SimRuntime\.iOS-([\d-]+)$/.exec(identifier)
    return match ? match[1].replace(/-/g, ".") : null
}

/**
 * Available iPhone simulators, grouped by iOS runtime: `runtime` first, then
 * the other runtimes newest first.
 *
 * @returns {{ runtimeIdentifier: string, simulators: Record<string, any>[] }[]}
 */
function iphoneSimulatorsByRuntime(runtime, devicesJson) {
    return Object.entries(devicesJson?.devices || {})
        .filter(([identifier]) => identifier === runtime?.identifier || iosRuntimeVersion(identifier))
        .sort(([a], [b]) => {
            if (a === runtime?.identifier) return -1
            if (b === runtime?.identifier) return 1
            return compareVersions(iosRuntimeVersion(b), iosRuntimeVersion(a))
        })
        .map(([runtimeIdentifier, sims]) => ({
            runtimeIdentifier,
            simulators: (sims || []).filter((sim) => isAvailable(sim) && isIphoneSimulator(sim)),
        }))
        .filter((group) => group.simulators.length)
}

/**
 * The newest of these iPhone simulators, preferring a Pro that is not a Max.
 * Newest is the runtime's supportedDeviceTypes order (simctl lists it newest
 * first), then the model number in the name; name and udid break ties so the
 * pick is the same on every run.
 */
function newestIphoneSimulator(simulators, runtime) {
    const order = (runtime?.supportedDeviceTypes || []).map((type) => type.identifier)
    const rank = (sim) => {
        const index = order.indexOf(sim.deviceTypeIdentifier)
        return index === -1 ? order.length : index
    }
    const model = (sim) => Number((/^iPhone (\d+)/.exec(sim.name || "") || [])[1] || 0)
    const sorted = [...simulators].sort(
        (a, b) =>
            rank(a) - rank(b) ||
            model(b) - model(a) ||
            String(a.name).localeCompare(String(b.name)) ||
            String(a.udid).localeCompare(String(b.udid))
    )
    const pro = sorted.find((sim) => /\bPro\b/.test(sim.name || "") && !/\bMax\b/.test(sim.name || ""))
    return pro || sorted[0] || null
}

/**
 * The simulator to build for. Install only what is missing, never ask for
 * what can be derived:
 *
 *   1. `name` (ios.simulatorName) when it exists on an available runtime;
 *   2. the remembered pick (`last`, getLastTarget("ios")) while its udid is
 *      still available;
 *   3. an iPhone simulator that is already booted;
 *   4. the newest iPhone simulator on `runtime` (a Pro that is not a Max
 *      first), else on the newest other runtime that has one;
 *   5. only when there is no iPhone simulator at all, "Catalyst iPhone" is
 *      created for the newest iPhone the runtime supports, after
 *      askConsent("install").
 *
 * @param {Record<string, any>} [options] - `runtime` (from ensureIosRuntime), `name` (ios.simulatorName), `last`, `flags`, `log`; the rest are seams for tests
 * @returns {Promise<{ name: string, udid: string, created: boolean }>}
 */
async function ensureSimulator({
    runtime,
    name,
    last = null,
    flags = {},
    isTTY = isInteractive(),
    ask = askConsent,
    devicesJson = simctlJson(["list", "devices"]),
    deviceTypesJson,
    create = (simName, deviceType, rt) =>
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - simctl with an argv array; the name is passed as one argument.
        execFileSync("xcrun", ["simctl", "create", simName, deviceType.identifier, rt.identifier], {
            encoding: "utf8",
        }),
    log = () => {},
} = {}) {
    const use = (sim) => ({ name: sim.name, udid: sim.udid, created: false })

    if (name) {
        const configured = findSimulator(name, runtime, devicesJson)
        if (configured) return use(configured)
        log(`ios.simulatorName "${name}" is not an available simulator; picking one`, "warning")
    }

    const allAvailable = Object.values(devicesJson?.devices || {})
        .flat()
        .filter((sim) => sim && isAvailable(sim))
    if (last?.target === "simulator" && last.udid) {
        const remembered = allAvailable.find((sim) => sim.udid === last.udid)
        if (remembered) return use(remembered)
    }

    const groups = iphoneSimulatorsByRuntime(runtime, devicesJson)
    const booted = groups.flatMap((group) => group.simulators).find((sim) => sim.state === "Booted")
    if (booted) return use(booted)

    if (groups.length) {
        const [group] = groups
        const groupRuntime = group.runtimeIdentifier === runtime?.identifier ? runtime : null
        return use(newestIphoneSimulator(group.simulators, groupRuntime))
    }

    const deviceType = newestIphoneDeviceType(runtime, deviceTypesJson || simctlJson(["list", "devicetypes"]))
    if (!deviceType) throw new Error(`No iPhone device type is available for ${runtime.name}`)
    const consent = await ask(
        "install",
        `No iPhone simulator is available. Create the "${DEFAULT_SIMULATOR_NAME}" simulator (${deviceType.name || "iPhone"}, ${runtime.name})`,
        { flags, isTTY }
    )
    if (!consent) {
        throw new Error(
            "No iPhone simulator is available; create one in Xcode (Window > Devices and Simulators)"
        )
    }
    const udid = String(create(DEFAULT_SIMULATOR_NAME, deviceType, runtime) || "").trim()
    log(`Created simulator "${DEFAULT_SIMULATOR_NAME}"`, "success")
    return { name: DEFAULT_SIMULATOR_NAME, udid, created: true }
}

// Apple's identifiers are hex digits and hyphens (a UUID, or the 40-char
// legacy UDID). The udid ends up in xcodebuild and devicectl arguments, so
// anything else from devicectl's output is dropped rather than passed on.
const VALID_UDID_RE = /^[A-Fa-f0-9-]+$/

/**
 * The iPhones devicectl can reach now, from `devicectl list devices
 * --json-output` JSON. devicectl lists every device it ever paired with and
 * simulators too: keep physical ones whose tunnel is not "unavailable".
 *
 * @returns {{ name: string, udid: string, version: string }[]}
 */
function parseDevicectlDevices(json) {
    return (json?.result?.devices || [])
        .filter((d) => d.hardwareProperties?.reality === "physical")
        .filter((d) => d.connectionProperties?.tunnelState !== "unavailable")
        .filter((d) => !d.hardwareProperties?.platform || d.hardwareProperties.platform === "iOS")
        .map((d) => ({
            name: d.deviceProperties?.name ?? "iPhone",
            udid: d.hardwareProperties?.udid ?? d.identifier,
            version: d.deviceProperties?.osVersionNumber ?? "",
        }))
        .filter((d) => typeof d.udid === "string" && VALID_UDID_RE.test(d.udid))
}

/**
 * `xcrun devicectl list devices` into a temp file (Apple's scripting
 * guidance), parsed. The file goes in a fresh owner-only folder from
 * mkdtemp, so no other user can predict or pre-create its path.
 */
function runDevicectlList({ exec = execFileSync } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-devicectl-"))
    const file = path.join(dir, "devices.json")
    try {
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - fixed argv.
        exec("xcrun", ["devicectl", "list", "devices", "--json-output", file], {
            stdio: ["ignore", "ignore", "ignore"],
            timeout: 30000,
        })
        return JSON.parse(fs.readFileSync(file, "utf8"))
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
}

/** Connected iPhones; [] when devicectl fails (Xcode older than 15, nothing paired). */
function listConnectedIphones({ list = runDevicectlList, log = () => {} } = {}) {
    try {
        return parseDevicectlDevices(list())
    } catch (error) {
        log(`devicectl could not list devices (${error.message})`, "info")
        return []
    }
}

const deviceLabel = (device) => `${device.name}${device.version ? ` (iOS ${device.version})` : ""}`

/**
 * Simulator or connected iPhone. The simulator is the default; `--device`
 * picks the iPhone (one: that one; several: ios.deviceUDID, else a choice in
 * a terminal, else NATIVE-005). Without the flag, a terminal with an iPhone
 * connected is asked, defaulting to the last pick. A connected iPhone never
 * wins on its own.
 *
 * @param {object} options
 * @param {boolean} [options.device] - `--device`
 * @param {{ name: string, udid: string, version?: string }[]} options.devices - connected iPhones
 * @param {string} [options.simulatorName] - for the choice label, when known
 * @param {{ target: string, udid?: string } | null} [options.last] - getLastTarget("ios")
 * @param {string} [options.configuredUdid] - WEBVIEW_CONFIG.ios.deviceUDID
 * @param {boolean} [options.isTTY]
 * @param {typeof selectChoice} [options.select]
 * @returns {Promise<{ target: "simulator" } | { target: "device", udid: string, name: string }>}
 */
async function chooseIosTarget({
    device: deviceFlag = false,
    devices = [],
    simulatorName,
    last = null,
    configuredUdid,
    isTTY = isInteractive(),
    select = selectChoice,
} = {}) {
    const asTarget = (d) => ({ target: "device", udid: d.udid, name: d.name })
    const lastDevice = last?.target === "device" ? devices.find((d) => d.udid === last.udid) : null

    if (deviceFlag) {
        if (!devices.length) {
            throw nativeError("IOS-014", "--device was passed but devicectl lists no connected iPhone")
        }
        if (devices.length === 1) return asTarget(devices[0])
        const configured = configuredUdid ? devices.find((d) => d.udid === configuredUdid) : null
        if (configured) return asTarget(configured)
        if (!isTTY) {
            throw needsAnswerError(
                `${devices.length} iPhones are connected. Which one should the app run on`,
                {
                    hint: "Connect only one iPhone, or set WEBVIEW_CONFIG.ios.deviceUDID to the one to use, or run the build in a terminal to pick.",
                }
            )
        }
        const udid = await select(
            "Which iPhone",
            devices.map((d) => ({ label: deviceLabel(d), value: d.udid, hint: d.udid })),
            { defaultValue: lastDevice?.udid, isTTY }
        )
        return asTarget(devices.find((d) => d.udid === udid))
    }

    if (!isTTY || !devices.length) return { target: "simulator" }
    const choice = await select(
        "Run the app on",
        [
            { label: simulatorName ? `${simulatorName} simulator` : "Simulator", value: "simulator" },
            ...devices.map((d) => ({ label: deviceLabel(d), value: d.udid, hint: "connected" })),
        ],
        { defaultValue: lastDevice ? lastDevice.udid : "simulator", isTTY }
    )
    if (choice === "simulator") return { target: "simulator" }
    return asTarget(devices.find((d) => d.udid === choice))
}

/**
 * The host a debug build reaches the dev server on. The simulator shares the
 * Mac's network, so localhost. An iPhone uses the Mac's Bonjour name
 * (`<LocalHostName>.local`), else its LAN IP; IOS-015 when there is neither.
 * It goes into the build only, never into config.json.
 *
 * @param {{ target: string, name?: string } | null} target
 * @param {object} [options]
 * @param {() => ({ host: string, source: string } | null)} [options.reachableHost]
 * @param {(message: string, type?: string) => void} [options.log]
 */
function devHostFor(target, { reachableHost = getDeviceReachableHost, log = () => {} } = {}) {
    if (target?.target !== "device") return "localhost"
    const found = reachableHost()
    if (!found) {
        throw nativeError(
            "IOS-015",
            `${target.name || "the iPhone"} cannot use localhost, and this Mac has no .local name or LAN address`
        )
    }
    if (found.source === "lan") {
        log(
            `No Local Hostname on this Mac; ${target.name || "the iPhone"} loads the dev server from ${found.host}`,
            "info"
        )
    }
    return found.host
}

/**
 * A debug build's target and dev server host: list the connected iPhones,
 * choose (chooseIosTarget), find the simulator (ensureSimulator: configured,
 * remembered, booted or newest, creating one only when there is no iPhone
 * simulator), and remember the pick when a person or --device made it.
 *
 * @param {Record<string, any>} [options] - `flags` (parseNativeArgs), `iosConfig` (WEBVIEW_CONFIG.ios: simulatorName, deviceUDID), `cwd` (the app root, for .catalyst/local.json), `log`; the rest are seams for tests
 * @returns {Promise<{ target: { target: "simulator" | "device", name: string, udid: string }, devHost: string }>}
 */
async function prepareIosDebugTarget({
    flags = {},
    iosConfig = {},
    cwd = process.cwd(),
    isTTY = isInteractive(),
    listDevices = listConnectedIphones,
    last = getLastTarget("ios", { cwd }),
    save = saveLastTarget,
    select = selectChoice,
    ensureRuntime = ensureIosRuntime,
    ensureSim = ensureSimulator,
    reachableHost = getDeviceReachableHost,
    log = () => {},
} = {}) {
    const devices = listDevices({ log })
    let target = await chooseIosTarget({
        device: flags.device,
        devices,
        simulatorName: iosConfig.simulatorName || (last?.target === "simulator" ? last.name : undefined),
        last,
        configuredUdid: iosConfig.deviceUDID,
        isTTY,
        select,
    })
    if (target.target === "simulator") {
        const runtime = await ensureRuntime({ flags, isTTY, log })
        const simulator = await ensureSim({ runtime, name: iosConfig.simulatorName, last, flags, isTTY, log })
        target = { target: "simulator", name: simulator.name, udid: simulator.udid }
    }
    const devHost = devHostFor(target, { reachableHost, log })
    if (flags.device || isTTY) save("ios", target, { cwd })
    return { target, devHost }
}

export {
    DEFAULT_SIMULATOR_NAME,
    probe,
    runDevicectlList,
    assertFullXcode,
    pendingXcodeSetup,
    ensureXcodeReady,
    availableIosRuntimes,
    ensureIosRuntime,
    newestIphoneDeviceType,
    simulatorsFor,
    findSimulator,
    newestIphoneSimulator,
    ensureSimulator,
    parseDevicectlDevices,
    listConnectedIphones,
    chooseIosTarget,
    devHostFor,
    prepareIosDebugTarget,
    simctlJson,
}
