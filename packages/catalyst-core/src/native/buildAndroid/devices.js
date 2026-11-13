import { nativeError, needsAnswerError, select as selectChoice } from "../utils.js"

// Where a debug build runs, and how it reaches the dev server.
//
// The emulator is the default. `--device` picks a connected phone instead,
// and in a terminal with both available the person is asked, with the last
// pick (.catalyst/local.json) as the default. A phone is never picked just
// because it is plugged in.
//
// Debug builds load http://localhost:<port>. On the emulator and on a USB
// phone alike, localhost is the device itself, so every port the app uses
// is forwarded to this machine with `adb reverse` after each install.

/**
 * Parse `adb devices -l`.
 *
 * @param {string} output
 * @returns {{ serial: string, state: string, emulator: boolean, model: string | null }[]}
 */
function parseAdbDevices(output) {
    return String(output || "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("List of devices") && !line.startsWith("*"))
        .map((line) => {
            const [serial, state, ...rest] = line.split(/\s+/)
            const props = Object.fromEntries(
                rest
                    .filter((token) => token.includes(":"))
                    .map((token) => [token.slice(0, token.indexOf(":")), token.slice(token.indexOf(":") + 1)])
            )
            return {
                serial,
                state,
                emulator: serial.startsWith("emulator-"),
                model: props.model ? props.model.replace(/_/g, " ") : null,
            }
        })
        .filter((device) => device.serial && device.state)
}

/** Phones adb can install on: not an emulator, and authorized ("device"). */
function readyPhones(devices) {
    return devices.filter((device) => !device.emulator && device.state === "device")
}

const phoneLabel = (device) => (device.model ? `${device.model} (${device.serial})` : device.serial)

/**
 * Choose where a debug build runs.
 *
 * @param {object} options
 * @param {boolean} [options.wantDevice] - `--device`
 * @param {ReturnType<typeof parseAdbDevices>} options.devices
 * @param {{ target: string, serial?: string, avd?: string } | null} [options.last] - getLastTarget("android")
 * @param {Record<string, string | undefined>} [options.env] - ANDROID_SERIAL picks a phone without a terminal
 * @param {boolean} [options.isTTY]
 * @param {typeof selectChoice} [options.select]
 * @param {string} [options.emulatorHint] - shown beside the emulator choice
 * @returns {Promise<{ target: "emulator" } | { target: "device", serial: string, model: string | null }>}
 */
async function chooseAndroidTarget({
    wantDevice = false,
    devices,
    last = null,
    env = process.env,
    isTTY,
    select = selectChoice,
    emulatorHint,
}) {
    const phones = readyPhones(devices)
    const asDevice = (device) => ({ target: "device", serial: device.serial, model: device.model })
    const lastPhone =
        last?.target === "device" ? phones.find((device) => device.serial === last.serial) : undefined

    if (wantDevice) {
        if (env.ANDROID_SERIAL) {
            const named = phones.find((device) => device.serial === env.ANDROID_SERIAL)
            if (!named) {
                throw nativeError("ANDROID-011", `ANDROID_SERIAL=${env.ANDROID_SERIAL} is not a connected phone`)
            }
            return asDevice(named)
        }
        if (!phones.length) {
            const unauthorized = devices.filter((device) => !device.emulator && device.state === "unauthorized")
            throw nativeError(
                "ANDROID-011",
                unauthorized.length
                    ? `${unauthorized.map((device) => device.serial).join(", ")} has not allowed this computer yet; accept the prompt on the phone`
                    : "adb devices lists no phone"
            )
        }
        if (phones.length === 1) return asDevice(phones[0])
        const question = `Several Android phones are connected (${phones.map((device) => device.serial).join(", ")}). Which one`
        if (!isTTY) {
            throw needsAnswerError(question, {
                hint: "Set ANDROID_SERIAL to the serial of the phone to use (adb devices lists them), or run the command in a terminal to pick one.",
            })
        }
        const serial = await select(
            question,
            phones.map((device) => ({ label: phoneLabel(device), value: device.serial })),
            { defaultValue: (lastPhone || phones[0]).serial, isTTY }
        )
        return asDevice(phones.find((device) => device.serial === serial))
    }

    // No flag: the emulator, unless a person here picks a connected phone.
    if (!phones.length || !isTTY) return { target: "emulator" }
    const pick = await select(
        "Run the app on",
        [
            { label: "Emulator", value: "emulator", hint: emulatorHint },
            ...phones.map((device) => ({
                label: phoneLabel(device),
                value: device.serial,
                hint: "connected phone",
            })),
        ],
        { defaultValue: lastPhone ? lastPhone.serial : "emulator", isTTY }
    )
    if (pick === "emulator") return { target: "emulator" }
    return asDevice(phones.find((device) => device.serial === pick))
}

/**
 * The adb calls that let the app on `serial` reach the dev server: stop the
 * running app first (its in-app server scans device ports 3000 to 3099 and
 * would hold the port a reverse needs), then reverse every port.
 *
 * @param {string} serial
 * @param {string} packageName - the installed (debug) package
 * @param {number[]} ports - devServerPorts()
 * @returns {string[][]} adb argv lists, in order
 */
function devServerReachPlan(serial, packageName, ports) {
    return [
        ["-s", serial, "shell", "am", "force-stop", packageName],
        ...ports.map((port) => ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]),
    ]
}

/**
 * Run devServerReachPlan with `adb(args)`. Stopping the app may fail (it may
 * not be running); a failed reverse is an error, since the app would load a
 * page with nothing behind it.
 *
 * @param {(args: string[]) => unknown} adb
 * @param {string} serial
 * @param {string} packageName
 * @param {number[]} ports
 */
function reachDevServer(adb, serial, packageName, ports) {
    const [stop, ...reverses] = devServerReachPlan(serial, packageName, ports)
    try {
        adb(stop)
    } catch {
        // Not running is fine.
    }
    for (const args of reverses) {
        try {
            adb(args)
        } catch (error) {
            const detail = String(error.stderr || error.message || "")
                .trim()
                .split("\n")[0]
            throw Object.assign(new Error(`adb ${args.slice(2).join(" ")} failed on ${serial}: ${detail}`), {
                stage: "Connecting the device to the dev server",
                hint: `Run adb -s ${serial} reverse --list to see what holds the port, quit it, and build again.`,
            })
        }
    }
}

/** adb argv that opens the app's launcher activity. */
function launchArgs(serial, packageName) {
    return ["-s", serial, "shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]
}

export { parseAdbDevices, readyPhones, chooseAndroidTarget, devServerReachPlan, reachDevServer, launchArgs }
