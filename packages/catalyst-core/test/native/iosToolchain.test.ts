import { describe, expect, it } from "vitest"

import {
    DEFAULT_SIMULATOR_NAME,
    assertFullXcode,
    availableIosRuntimes,
    chooseSimulator,
    ensureIosRuntime,
    ensureXcodeReady,
    newestIphoneDeviceType,
    pendingXcodeSetup,
} from "../../src/native/iosToolchain.js"

async function rejection(promise: Promise<unknown>): Promise<any> {
    try {
        await promise
    } catch (error) {
        return error
    }
    throw new Error("expected a rejection")
}

function thrown(fn: () => unknown): any {
    try {
        fn()
    } catch (error) {
        return error
    }
    throw new Error("expected a throw")
}

/** A probe stand-in: xcode-select's answer plus which setup checks pass. */
function xcode({
    dir = "/Applications/Xcode.app/Contents/Developer",
    licence = true,
    firstLaunch = true,
} = {}) {
    const state = { licence, firstLaunch }
    const run = (command: string, args: string[]) => {
        if (command === "xcode-select") return { status: dir ? 0 : 2, output: dir }
        if (args.includes("-license")) return { status: state.licence ? 0 : 1, output: "" }
        if (args.includes("-checkFirstLaunchStatus"))
            return { status: state.firstLaunch ? 0 : 69, output: "" }
        return { status: 0, output: "" }
    }
    return { run, state }
}

const runtime = (version: string, extra: object = {}) => ({
    name: `iOS ${version}`,
    version,
    identifier: `com.apple.CoreSimulator.SimRuntime.iOS-${version.replace(/\./g, "-")}`,
    platform: "iOS",
    isAvailable: true,
    ...extra,
})

describe("Xcode checks", () => {
    it("accepts a developer directory inside Xcode.app", () => {
        expect(assertFullXcode({ run: xcode().run })).toBe("/Applications/Xcode.app/Contents/Developer")
        expect(
            assertFullXcode({ run: xcode({ dir: "/Applications/Xcode-beta.app/Contents/Developer" }).run })
        ).toContain("Xcode-beta")
    })

    it("fails with IOS-002 on the Command Line Tools alone", () => {
        const error = thrown(() =>
            assertFullXcode({ run: xcode({ dir: "/Library/Developer/CommandLineTools" }).run })
        )
        expect(error.code).toBe("IOS-002")
        expect(error.message).toContain("CommandLineTools")
        expect(thrown(() => assertFullXcode({ run: xcode({ dir: "" }).run })).code).toBe("IOS-002")
    })

    it("lists the pending licence and first-launch steps", () => {
        const pending = pendingXcodeSetup({ run: xcode({ licence: false, firstLaunch: false }).run })
        expect(pending.map((step) => step.fix.join(" "))).toEqual([
            "sudo xcodebuild -license accept",
            "sudo xcodebuild -runFirstLaunch",
        ])
    })

    it("never runs sudo without a terminal: IOS-003 names the commands", async () => {
        const sudo: string[][] = []
        const error = await rejection(
            ensureXcodeReady({
                run: xcode({ firstLaunch: false }).run,
                isTTY: false,
                runInherited: async (command: string, args: string[]) => void sudo.push([command, ...args]),
            })
        )
        expect(error.code).toBe("IOS-003")
        expect(error.message).toContain("sudo xcodebuild -runFirstLaunch")
        expect(sudo).toEqual([])
    })

    it("runs the pending steps on the user's terminal after a yes", async () => {
        const { run, state } = xcode({ licence: false })
        const sudo: string[][] = []
        await ensureXcodeReady({
            run,
            isTTY: true,
            confirm: async () => true,
            runInherited: async (command: string, args: string[]) => {
                sudo.push([command, ...args])
                state.licence = true
            },
        })
        expect(sudo).toEqual([["sudo", "xcodebuild", "-license", "accept"]])
    })

    it("fails with IOS-003 when the user declines", async () => {
        const error = await rejection(
            ensureXcodeReady({ run: xcode({ licence: false }).run, isTTY: true, confirm: async () => false })
        )
        expect(error.code).toBe("IOS-003")
    })
})

describe("iOS runtime", () => {
    it("keeps available iOS runtimes, newest first", () => {
        const runtimes = availableIosRuntimes({
            runtimes: [
                runtime("18.2"),
                runtime("26.0"),
                runtime("17.5", { isAvailable: false }),
                {
                    ...runtime("11.0"),
                    platform: "watchOS",
                    identifier: "com.apple.CoreSimulator.SimRuntime.watchOS-11-0",
                },
            ],
        })
        expect(runtimes.map((r) => r.version)).toEqual(["26.0", "18.2"])
    })

    it("fails with IOS-004 with no runtime and no consent, without downloading", async () => {
        const downloads: string[][] = []
        const error = await rejection(
            ensureIosRuntime({
                isTTY: false,
                listRuntimes: () => ({ runtimes: [] }),
                runInherited: async (_c: string, args: string[]) => void downloads.push(args),
            })
        )
        expect(error.code).toBe("IOS-004")
        expect(downloads).toEqual([])
    })

    it("downloads the platform with --yes", async () => {
        let installed = false
        const downloads: string[][] = []
        const result = await ensureIosRuntime({
            yes: true,
            isTTY: false,
            listRuntimes: () => ({ runtimes: installed ? [runtime("26.0")] : [] }),
            runInherited: async (command: string, args: string[]) => {
                downloads.push([command, ...args])
                installed = true
            },
        })
        expect(downloads).toEqual([["xcodebuild", "-downloadPlatform", "iOS"]])
        expect(result.version).toBe("26.0")
    })
})

describe("simulator choice", () => {
    const rt = runtime("26.0", {
        supportedDeviceTypes: [
            { name: "iPad Pro", identifier: "ipad", productFamily: "iPad" },
            { name: "iPhone 17 Pro", identifier: "iphone-17-pro", productFamily: "iPhone" },
            { name: "iPhone 17", identifier: "iphone-17", productFamily: "iPhone" },
        ],
    })
    const devices = (names: string[]) => ({
        devices: { [rt.identifier]: names.map((name, i) => ({ name, udid: `U${i}`, isAvailable: true })) },
    })

    it("takes the runtime's newest iPhone, falling back to the global list", () => {
        expect(newestIphoneDeviceType(rt, {})?.identifier).toBe("iphone-17-pro")
        expect(
            newestIphoneDeviceType(runtime("26.0"), {
                devicetypes: [
                    {
                        name: "iPhone 15",
                        identifier: "iphone-15",
                        productFamily: "iPhone",
                        minRuntimeVersion: 1,
                    },
                    {
                        name: "iPhone 16",
                        identifier: "iphone-16",
                        productFamily: "iPhone",
                        minRuntimeVersion: 2,
                    },
                ],
            })?.identifier
        ).toBe("iphone-16")
    })

    it("creates Catalyst iPhone without a terminal", async () => {
        const created: string[][] = []
        const choice = await chooseSimulator({
            runtime: rt,
            devicesJson: devices(["iPhone 17"]),
            deviceTypesJson: {},
            isTTY: false,
            create: (name: string, type: any, r: any) =>
                void created.push([name, type.identifier, r.identifier]),
        })
        expect(choice).toEqual({ name: DEFAULT_SIMULATOR_NAME, created: true })
        expect(created).toEqual([[DEFAULT_SIMULATOR_NAME, "iphone-17-pro", rt.identifier]])
    })

    it("reuses an existing Catalyst iPhone with --yes", async () => {
        const choice = await chooseSimulator({
            runtime: rt,
            devicesJson: devices([DEFAULT_SIMULATOR_NAME]),
            deviceTypesJson: {},
            yes: true,
            isTTY: true,
            create: () => {
                throw new Error("should not create")
            },
        })
        expect(choice).toEqual({ name: DEFAULT_SIMULATOR_NAME, created: false })
    })

    it("defaults the terminal picker to creating Catalyst iPhone, and can pick another", async () => {
        const lines: string[] = []
        const created: string[] = []
        const common = {
            runtime: rt,
            devicesJson: devices(["iPhone 17", "iPhone Air"]),
            deviceTypesJson: {},
            isTTY: true,
            print: (line: string) => lines.push(line),
            create: (name: string) => void created.push(name),
        }
        expect(
            await chooseSimulator({ ...common, prompt: async (_q: string, o: any) => o.defaultValue })
        ).toEqual({
            name: DEFAULT_SIMULATOR_NAME,
            created: true,
        })
        expect(
            lines.some((line) => line.startsWith(`1. Create "${DEFAULT_SIMULATOR_NAME}" (iPhone 17 Pro`))
        ).toBe(true)
        expect(await chooseSimulator({ ...common, prompt: async () => "3" })).toEqual({
            name: "iPhone Air",
            created: false,
        })
        expect(created).toEqual([DEFAULT_SIMULATOR_NAME])
    })
})
