import { describe, expect, it } from "vitest"

import {
    chooseAndroidTarget,
    devServerReachPlan,
    launchArgs,
    parseAdbDevices,
    reachDevServer,
} from "../../src/native/buildAndroid/devices.js"
import { devServerPorts } from "../../src/native/setupServer.js"

const ADB_OUTPUT = [
    "List of devices attached",
    "emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1",
    "R5CT1234ABC            device usb:1-1 product:o1sxeea model:SM_G991B device:o1s transport_id:2",
    "1A2B3C4D               unauthorized usb:1-2 transport_id:3",
    "",
].join("\n")

const devices = parseAdbDevices(ADB_OUTPUT)
const phone = { serial: "R5CT1234ABC", state: "device", emulator: false, model: "SM G991B" }
const secondPhone = { serial: "HT7A1B2C3", state: "device", emulator: false, model: "Pixel 7" }
const emulatorOnly = devices.filter((device) => device.emulator)

async function rejection(promise: Promise<unknown>): Promise<any> {
    try {
        await promise
    } catch (error) {
        return error
    }
    throw new Error("expected a rejection")
}

/** A select() stand-in that records the question and answers `pick`, or the default. */
function fakeSelect(pick?: string) {
    const asked: Array<{ question: string; values: string[]; defaultValue: unknown }> = []
    const select = async (question: string, choices: Array<{ value: string }>, options: any = {}) => {
        asked.push({ question, values: choices.map((c) => c.value), defaultValue: options.defaultValue })
        return pick ?? options.defaultValue
    }
    return { asked, select: select as any }
}

describe("parseAdbDevices", () => {
    it("reads serial, state, emulator and model", () => {
        expect(devices).toEqual([
            { serial: "emulator-5554", state: "device", emulator: true, model: "sdk gphone64 arm64" },
            phone,
            { serial: "1A2B3C4D", state: "unauthorized", emulator: false, model: null },
        ])
        expect(parseAdbDevices("List of devices attached\n\n")).toEqual([])
    })
})

describe("chooseAndroidTarget", () => {
    it("uses the emulator by default, even with a phone plugged in, when there is no terminal", async () => {
        const { asked, select } = fakeSelect()
        expect(await chooseAndroidTarget({ devices, isTTY: false, select })).toEqual({ target: "emulator" })
        expect(asked).toEqual([])
    })

    it("uses the emulator without asking when no phone is connected", async () => {
        const { asked, select } = fakeSelect()
        expect(await chooseAndroidTarget({ devices: emulatorOnly, isTTY: true, select })).toEqual({
            target: "emulator",
        })
        expect(asked).toEqual([])
    })

    it("asks in a terminal when both are available, defaulting to the emulator", async () => {
        const { asked, select } = fakeSelect()
        expect(await chooseAndroidTarget({ devices, isTTY: true, select })).toEqual({ target: "emulator" })
        expect(asked).toEqual([
            { question: "Run the app on", values: ["emulator", "R5CT1234ABC"], defaultValue: "emulator" },
        ])
    })

    it("defaults the question to the remembered phone, and returns the pick", async () => {
        const { asked, select } = fakeSelect()
        const target = await chooseAndroidTarget({
            devices,
            isTTY: true,
            select,
            last: { target: "device", serial: "R5CT1234ABC" },
        })
        expect(asked[0].defaultValue).toBe("R5CT1234ABC")
        expect(target).toEqual({ target: "device", serial: "R5CT1234ABC", model: "SM G991B" })
    })

    it("ignores a remembered phone that is not connected", async () => {
        const { asked, select } = fakeSelect()
        await chooseAndroidTarget({ devices, isTTY: true, select, last: { target: "device", serial: "gone" } })
        expect(asked[0].defaultValue).toBe("emulator")
    })

    it("--device uses the one connected phone without asking, terminal or not", async () => {
        for (const isTTY of [true, false]) {
            const { asked, select } = fakeSelect()
            expect(await chooseAndroidTarget({ wantDevice: true, devices, isTTY, select, env: {} })).toEqual({
                target: "device",
                serial: "R5CT1234ABC",
                model: "SM G991B",
            })
            expect(asked).toEqual([])
        }
    })

    it("--device with no ready phone is ANDROID-011, naming an unauthorized one", async () => {
        const none = await rejection(
            chooseAndroidTarget({ wantDevice: true, devices: emulatorOnly, isTTY: true, env: {} })
        )
        expect(none.code).toBe("ANDROID-011")
        const unauthorized = await rejection(
            chooseAndroidTarget({
                wantDevice: true,
                devices: devices.filter((device) => device.state === "unauthorized"),
                isTTY: false,
                env: {},
            })
        )
        expect(unauthorized.code).toBe("ANDROID-011")
        expect(unauthorized.message).toContain("1A2B3C4D")
    })

    it("--device with several phones asks in a terminal, with the remembered one first", async () => {
        const { asked, select } = fakeSelect("HT7A1B2C3")
        const target = await chooseAndroidTarget({
            wantDevice: true,
            devices: [phone, secondPhone],
            isTTY: true,
            select,
            env: {},
            last: { target: "device", serial: "HT7A1B2C3" },
        })
        expect(asked[0].values).toEqual(["R5CT1234ABC", "HT7A1B2C3"])
        expect(asked[0].defaultValue).toBe("HT7A1B2C3")
        expect(target).toMatchObject({ target: "device", serial: "HT7A1B2C3" })
    })

    it("--device with several phones and no terminal fails with NATIVE-005 naming ANDROID_SERIAL", async () => {
        const error = await rejection(
            chooseAndroidTarget({ wantDevice: true, devices: [phone, secondPhone], isTTY: false, env: {} })
        )
        expect(error.code).toBe("NATIVE-005")
        expect(error.hint).toContain("ANDROID_SERIAL")
    })

    it("--device honours ANDROID_SERIAL, and fails when it names no connected phone", async () => {
        const env = { ANDROID_SERIAL: "HT7A1B2C3" }
        expect(
            await chooseAndroidTarget({ wantDevice: true, devices: [phone, secondPhone], isTTY: false, env })
        ).toMatchObject({ serial: "HT7A1B2C3" })
        const error = await rejection(
            chooseAndroidTarget({ wantDevice: true, devices: [phone], isTTY: false, env })
        )
        expect(error.code).toBe("ANDROID-011")
    })
})

describe("dev server reach (adb reverse)", () => {
    const config = {
        NODE_SERVER_PORT: 3005,
        API_URL: "http://localhost:4000/api",
        WEBVIEW_CONFIG: { port: "3005", apiBaseUrl: "http://127.0.0.1:4000" },
    }

    it("stops the app, then reverses the server, HMR and every localhost port in config", () => {
        const ports = devServerPorts(config, { hmrPort: 24678 })
        expect(ports).toEqual([3005, 4000, 24678])
        expect(devServerReachPlan("emulator-5554", "com.acme.shop.debug", ports)).toEqual([
            ["-s", "emulator-5554", "shell", "am", "force-stop", "com.acme.shop.debug"],
            ["-s", "emulator-5554", "reverse", "tcp:3005", "tcp:3005"],
            ["-s", "emulator-5554", "reverse", "tcp:4000", "tcp:4000"],
            ["-s", "emulator-5554", "reverse", "tcp:24678", "tcp:24678"],
        ])
    })

    it("runs the plan in order and tolerates an app that is not running", () => {
        const calls: string[][] = []
        reachDevServer(
            (args) => {
                calls.push(args)
                if (args.includes("force-stop")) throw new Error("not running")
                return ""
            },
            "R5CT1234ABC",
            "com.acme.shop.debug",
            [3005]
        )
        expect(calls.map((args) => args[2])).toEqual(["shell", "reverse"])
    })

    it("fails with the stage and a hint when a reverse fails", () => {
        let error: any
        try {
            reachDevServer(
                (args) => {
                    if (args.includes("reverse")) {
                        throw Object.assign(new Error("Command failed"), {
                            stderr: "adb: error: cannot bind listener: Address already in use",
                        })
                    }
                    return ""
                },
                "emulator-5554",
                "com.acme.shop.debug",
                [3005]
            )
        } catch (caught) {
            error = caught
        }
        expect(error.message).toContain("Address already in use")
        expect(error.stage).toBe("Connecting the device to the dev server")
        expect(error.hint).toContain("reverse --list")
    })

    it("launches the app's launcher activity on that device only", () => {
        expect(launchArgs("R5CT1234ABC", "com.acme.shop.debug")).toEqual([
            "-s",
            "R5CT1234ABC",
            "shell",
            "monkey",
            "-p",
            "com.acme.shop.debug",
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        ])
    })
})
