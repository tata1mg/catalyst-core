import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

import {
    DEFAULT_SIMULATOR_NAME,
    assertFullXcode,
    availableIosRuntimes,
    chooseIosTarget,
    devHostFor,
    ensureIosRuntime,
    ensureSimulator,
    ensureXcodeReady,
    newestIphoneDeviceType,
    listConnectedIphones,
    parseDevicectlDevices,
    pendingXcodeSetup,
    prepareIosDebugTarget,
    probe,
    runDevicectlList,
    simctlJson,
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

    it("never runs sudo without a terminal or a flag: NATIVE-005 names the flag and the command", async () => {
        const sudo: string[][] = []
        const logs: string[] = []
        const error = await rejection(
            ensureXcodeReady({
                run: xcode({ licence: false }).run,
                isTTY: false,
                log: (m: string) => void logs.push(m),
                runInherited: async (command: string, args: string[]) => void sudo.push([command, ...args]),
            })
        )
        expect(error.code).toBe("NATIVE-005")
        expect(error.message).toContain("--accept-licenses")
        expect(error.hint).toContain("sudo xcodebuild -license accept")
        expect(logs.join("\n")).toContain("sudo xcodebuild -license accept")
        expect(sudo).toEqual([])
    })

    it("does not take --yes for the licence", async () => {
        const error = await rejection(
            ensureXcodeReady({ run: xcode({ licence: false }).run, isTTY: false, flags: { yes: true } })
        )
        expect(error.code).toBe("NATIVE-005")
    })

    it("asks for the licence as a licence and the first launch as an install", async () => {
        const { run, state } = xcode({ licence: false, firstLaunch: false })
        const asked: string[] = []
        const sudo: string[][] = []
        await ensureXcodeReady({
            run,
            isTTY: true,
            ask: async (kind: string) => {
                asked.push(kind)
                return true
            },
            runInherited: async (command: string, args: string[]) => {
                sudo.push([command, ...args])
                if (args.includes("-license")) state.licence = true
                else state.firstLaunch = true
            },
        })
        expect(asked).toEqual(["licence", "install"])
        expect(sudo).toEqual([
            ["sudo", "xcodebuild", "-license", "accept"],
            ["sudo", "xcodebuild", "-runFirstLaunch"],
        ])
    })

    it("runs sudo -n without a terminal when the flag answers (CI)", async () => {
        const { run, state } = xcode({ licence: false })
        const sudo: string[][] = []
        await ensureXcodeReady({
            run,
            isTTY: false,
            flags: { acceptLicenses: true },
            runInherited: async (command: string, args: string[]) => {
                sudo.push([command, ...args])
                state.licence = true
            },
        })
        expect(sudo).toEqual([["sudo", "-n", "xcodebuild", "-license", "accept"]])
    })

    it("fails with IOS-003 naming the command when the user declines or sudo fails", async () => {
        const declined = await rejection(
            ensureXcodeReady({ run: xcode({ licence: false }).run, isTTY: true, ask: async () => false })
        )
        expect(declined.code).toBe("IOS-003")
        expect(declined.message).toContain("sudo xcodebuild -license accept")
        const failed = await rejection(
            ensureXcodeReady({
                run: xcode({ licence: false }).run,
                isTTY: false,
                flags: { acceptLicenses: true },
                runInherited: async () => {
                    throw new Error("sudo: a password is required")
                },
            })
        )
        expect(failed.code).toBe("IOS-003")
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

    it("orders equal versions stably and treats a missing part as 0", () => {
        const runtimes = availableIosRuntimes({
            runtimes: [
                runtime("26.0", { name: "first" }),
                runtime("26", { name: "second" }),
                runtime("26.0.1"),
                {
                    ...runtime("18.0"),
                    platform: undefined,
                    availability: "(available)",
                    isAvailable: undefined,
                },
            ],
        })
        expect(runtimes.map((r: any) => r.version)).toEqual(["26.0.1", "26.0", "26", "18.0"])
        expect(availableIosRuntimes(undefined)).toEqual([])
    })

    it("fails with IOS-004 when the download leaves no runtime", async () => {
        const error = await rejection(
            ensureIosRuntime({
                flags: { yes: true },
                isTTY: false,
                listRuntimes: () => ({ runtimes: [] }),
                runInherited: async () => {},
            })
        )
        expect(error.code).toBe("IOS-004")
        expect(error.message).toContain("without an available runtime")
    })

    it("fails with NATIVE-005 naming --yes without a terminal, without downloading", async () => {
        const downloads: string[][] = []
        const error = await rejection(
            ensureIosRuntime({
                isTTY: false,
                listRuntimes: () => ({ runtimes: [] }),
                runInherited: async (_c: string, args: string[]) => void downloads.push(args),
            })
        )
        expect(error.code).toBe("NATIVE-005")
        expect(error.message).toContain("--yes")
        expect(downloads).toEqual([])
    })

    it("fails with IOS-004 when the user declines the download", async () => {
        const error = await rejection(
            ensureIosRuntime({ isTTY: true, ask: async () => false, listRuntimes: () => ({ runtimes: [] }) })
        )
        expect(error.code).toBe("IOS-004")
    })

    it("downloads the platform with --yes", async () => {
        let installed = false
        const downloads: string[][] = []
        const result = await ensureIosRuntime({
            flags: { yes: true },
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

describe("simulator", () => {
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

    it("uses an existing simulator without asking", async () => {
        const simulator = await ensureSimulator({
            runtime: rt,
            name: "iPhone 17",
            devicesJson: devices([DEFAULT_SIMULATOR_NAME, "iPhone 17"]),
            deviceTypesJson: {},
            ask: async () => {
                throw new Error("should not ask")
            },
        })
        expect(simulator).toEqual({ name: "iPhone 17", udid: "U1", created: false })
    })

    // What Xcode 26 puts on a fresh Mac: stock iPhones and iPads on iOS 26.0,
    // and older ones on an iOS 18.2 runtime.
    const ios26 = runtime("26.0", {
        supportedDeviceTypes: [
            "iPhone-17-Pro",
            "iPhone-17-Pro-Max",
            "iPhone-Air",
            "iPhone-17",
            "iPhone-16e",
        ].map((t) => ({
            name: t.replace(/-/g, " "),
            identifier: `com.apple.CoreSimulator.SimDeviceType.${t}`,
            productFamily: "iPhone",
        })),
    })
    const ios18 = runtime("18.2")
    const sim = (name: string, udid: string, extra: object = {}) => ({
        name,
        udid,
        state: "Shutdown",
        isAvailable: true,
        deviceTypeIdentifier: `com.apple.CoreSimulator.SimDeviceType.${name.replace(/[ ()]+/g, "-")}`,
        ...extra,
    })
    const stock = (overrides: Record<string, object> = {}) => {
        const at = (name: string, udid: string) => sim(name, udid, overrides[name] || {})
        return {
            devices: {
                [ios18.identifier]: [at("iPhone 16 Pro", "OLD-16PRO"), at("iPhone 16", "OLD-16")],
                [ios26.identifier]: [
                    at("iPhone 17 Pro Max", "PROMAX"),
                    at("iPhone 17", "SEVENTEEN"),
                    at("iPhone Air", "AIR"),
                    at("iPhone 16e", "SIXTEENE"),
                    at("iPad Pro 11-inch (M4)", "IPAD"),
                    at("iPhone 17 Pro", "PRO"),
                ],
                "com.apple.CoreSimulator.SimRuntime.watchOS-26-0": [sim("Apple Watch Series 11", "WATCH")],
            },
        }
    }
    const pick = (options: Record<string, any>) =>
        ensureSimulator({
            runtime: ios26,
            deviceTypesJson: {},
            isTTY: false,
            ask: async () => {
                throw new Error("should not ask")
            },
            create: () => {
                throw new Error("should not create")
            },
            ...options,
        })

    it("takes the newest Pro (not Max) on the chosen runtime without asking or creating", async () => {
        expect(await pick({ devicesJson: stock() })).toEqual({
            name: "iPhone 17 Pro",
            udid: "PRO",
            created: false,
        })
    })

    it("takes the newest iPhone when the runtime has no Pro, the same one every run", async () => {
        const noPro = stock()
        noPro.devices[ios26.identifier] = noPro.devices[ios26.identifier].filter(
            (s: any) => s.udid !== "PRO" && s.udid !== "PROMAX"
        )
        const first = await pick({ devicesJson: noPro })
        noPro.devices[ios26.identifier].reverse()
        expect(first).toEqual({ name: "iPhone Air", udid: "AIR", created: false })
        expect(await pick({ devicesJson: noPro })).toEqual(first)
    })

    it("falls back to another runtime's iPhones before creating one", async () => {
        const only18 = stock()
        only18.devices[ios26.identifier] = []
        expect(await pick({ devicesJson: only18 })).toEqual({
            name: "iPhone 16 Pro",
            udid: "OLD-16PRO",
            created: false,
        })
    })

    it("prefers a booted iPhone over the newest one", async () => {
        expect(await pick({ devicesJson: stock({ "iPhone 16e": { state: "Booted" } }) })).toEqual({
            name: "iPhone 16e",
            udid: "SIXTEENE",
            created: false,
        })
    })

    it("prefers the remembered pick while its udid is available, over a booted one", async () => {
        const devicesJson = stock({ "iPhone 16e": { state: "Booted" } })
        const last = { target: "simulator", udid: "AIR", name: "iPhone Air" }
        expect(await pick({ devicesJson, last })).toEqual({ name: "iPhone Air", udid: "AIR", created: false })
        const gone = stock({ "iPhone Air": { isAvailable: false }, "iPhone 16e": { state: "Booted" } })
        expect(await pick({ devicesJson: gone, last })).toMatchObject({ udid: "SIXTEENE" })
        expect(
            await pick({ devicesJson, last: { target: "device", udid: "AIR", name: "Jane's iPhone" } })
        ).toMatchObject({ udid: "SIXTEENE" })
    })

    it("prefers ios.simulatorName over the remembered pick, and warns when it is missing", async () => {
        const last = { target: "simulator", udid: "AIR", name: "iPhone Air" }
        expect(await pick({ devicesJson: stock(), name: "iPhone 16", last })).toEqual({
            name: "iPhone 16",
            udid: "OLD-16",
            created: false,
        })
        const logs: string[][] = []
        const result = await pick({
            devicesJson: stock(),
            name: "iPhone 15",
            last,
            log: (message: string, type: string) => void logs.push([message, type]),
        })
        expect(result).toMatchObject({ udid: "AIR" })
        expect(logs).toEqual([[expect.stringContaining('"iPhone 15"'), "warning"]])
    })

    it("does not count iPads or other platforms as an iPhone simulator", async () => {
        const created: string[] = []
        const result = await pick({
            devicesJson: {
                devices: {
                    [ios26.identifier]: [sim("iPad Pro 11-inch (M4)", "IPAD")],
                    "com.apple.CoreSimulator.SimRuntime.watchOS-26-0": [
                        sim("Apple Watch Series 11", "WATCH"),
                    ],
                },
            },
            flags: { yes: true },
            ask: async () => true,
            create: (name: string) => {
                created.push(name)
                return "NEW\n"
            },
        })
        expect(created).toEqual([DEFAULT_SIMULATOR_NAME])
        expect(result).toEqual({ name: DEFAULT_SIMULATOR_NAME, udid: "NEW", created: true })
    })

    it("creates Catalyst iPhone after an install consent, and returns its udid", async () => {
        const created: string[][] = []
        const asked: string[] = []
        const simulator = await ensureSimulator({
            runtime: rt,
            devicesJson: devices(["iPad Pro"]),
            deviceTypesJson: {},
            isTTY: false,
            flags: { yes: true },
            ask: async (kind: string, question: string, options: any) => {
                asked.push(kind)
                return Boolean(options.flags.yes)
            },
            create: (name: string, type: any, r: any) => {
                created.push([name, type.identifier, r.identifier])
                return "ABCDEF01-2345-6789-ABCD-EF0123456789\n"
            },
        })
        expect(asked).toEqual(["install"])
        expect(created).toEqual([[DEFAULT_SIMULATOR_NAME, "iphone-17-pro", rt.identifier]])
        expect(simulator).toEqual({
            name: DEFAULT_SIMULATOR_NAME,
            udid: "ABCDEF01-2345-6789-ABCD-EF0123456789",
            created: true,
        })
    })

    it("falls back to the newest other runtime, wherever it sits in simctl's list", async () => {
        const sim = (name: string, udid: string) => ({
            name,
            udid,
            isAvailable: true,
            deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-15",
        })
        const simulator = await ensureSimulator({
            runtime: rt,
            devicesJson: {
                devices: {
                    "com.apple.CoreSimulator.SimRuntime.iOS-17-0": [sim("iPhone 15", "OLD-17")],
                    [rt.identifier]: [],
                    "com.apple.CoreSimulator.SimRuntime.iOS-18-2": [sim("iPhone 15", "NEW-18")],
                    "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [sim("iPhone 15", "MID-18")],
                },
            },
            deviceTypesJson: {},
            isTTY: false,
        })
        expect(simulator).toEqual({ name: "iPhone 15", udid: "NEW-18", created: false })
    })

    it("fails when the user declines to create one, pointing to Xcode", async () => {
        let created = false
        const error = await rejection(
            ensureSimulator({
                runtime: rt,
                devicesJson: devices([]),
                deviceTypesJson: {},
                isTTY: true,
                ask: async () => false,
                create: () => {
                    created = true
                    return ""
                },
            })
        )
        expect(error.message).toContain("Devices and Simulators")
        expect(created).toBe(false)
    })

    it("fails with NATIVE-005 naming --yes when it would create one without a terminal", async () => {
        const error = await rejection(
            ensureSimulator({ runtime: rt, devicesJson: devices([]), deviceTypesJson: {}, isTTY: false })
        )
        expect(error.code).toBe("NATIVE-005")
        expect(error.message).toContain("--yes")
    })
})

describe("connected iPhones", () => {
    const entry = (name: string, udid: string, extra: Record<string, any> = {}) => ({
        identifier: `id-${udid}`,
        deviceProperties: { name, osVersionNumber: "26.0" },
        hardwareProperties: { reality: "physical", udid, platform: "iOS" },
        connectionProperties: { tunnelState: "connected" },
        ...extra,
    })

    it("keeps reachable physical iOS devices with a safe udid", () => {
        const json = {
            result: {
                devices: [
                    entry("Jane's iPhone", "00008110-001A2B3C4D5E"),
                    entry("Old iPhone", "00008030-AAAA", {
                        connectionProperties: { tunnelState: "unavailable" },
                    }),
                    entry("Sim", "1111", { hardwareProperties: { reality: "virtual", udid: "1111" } }),
                    entry("Evil", "00; rm -rf /"),
                    entry("Watch", "2222", {
                        hardwareProperties: { reality: "physical", udid: "2222", platform: "watchOS" },
                    }),
                ],
            },
        }
        expect(parseDevicectlDevices(json)).toEqual([
            { name: "Jane's iPhone", udid: "00008110-001A2B3C4D5E", version: "26.0" },
        ])
        expect(parseDevicectlDevices({})).toEqual([])
    })

    it("lists through devicectl's JSON file, and is empty when devicectl fails", () => {
        const json = { result: { devices: [entry("Jane's iPhone", "00008110-001A2B3C4D5E")] } }
        let written = ""
        const devices = listConnectedIphones({
            list: () =>
                runDevicectlList({
                    exec: ((command: string, args: string[], options: any) => {
                        expect(command).toBe("xcrun")
                        expect(args.slice(0, 4)).toEqual(["devicectl", "list", "devices", "--json-output"])
                        expect(options.timeout).toBe(30000)
                        written = args[4]
                        // A private folder from mkdtemp, not a guessable name in tmp.
                        expect(fs.statSync(path.dirname(written)).mode & 0o077).toBe(0)
                        fs.writeFileSync(written, JSON.stringify(json))
                        return ""
                    }) as any,
                }),
        })
        expect(devices).toEqual([{ name: "Jane's iPhone", udid: "00008110-001A2B3C4D5E", version: "26.0" }])
        expect(fs.existsSync(path.dirname(written))).toBe(false)

        const logs: string[] = []
        let failedFile = ""
        expect(
            listConnectedIphones({
                list: () =>
                    runDevicectlList({
                        exec: ((_c: string, args: string[]) => {
                            failedFile = args[4]
                            throw new Error("xcrun: error: unable to find utility devicectl")
                        }) as any,
                    }),
                log: ((message: string) => void logs.push(message)) as any,
            })
        ).toEqual([])
        expect(logs[0]).toContain("unable to find utility devicectl")
        expect(fs.existsSync(path.dirname(failedFile))).toBe(false)
    })
})

describe("process probes", () => {
    it("reports the exit status and both streams, and null when the tool cannot start", () => {
        const ok = probe("xcode-select", ["-p"], {
            spawn: (() => ({
                status: 0,
                stdout: "/Applications/Xcode.app/Contents/Developer\n",
                stderr: "",
            })) as any,
        })
        expect(ok).toEqual({ status: 0, output: "/Applications/Xcode.app/Contents/Developer" })
        const missing = probe("xcodebuild", ["-license", "check"], {
            spawn: (() => ({ error: new Error("ENOENT"), status: null, stdout: null, stderr: null })) as any,
        })
        expect(missing).toEqual({ status: null, output: "" })
        const real = probe(process.execPath, ["-e", "process.stderr.write('warn'); process.exit(2)"])
        expect(real).toEqual({ status: 2, output: "warn" })
    })

    it("reads simctl JSON with -j appended", () => {
        const calls: any[] = []
        const json = simctlJson(["list", "runtimes"], {
            exec: ((...args: any[]) => {
                calls.push(args)
                return '{"runtimes":[]}'
            }) as any,
        })
        expect(json).toEqual({ runtimes: [] })
        expect(calls[0].slice(0, 2)).toEqual(["xcrun", ["simctl", "list", "runtimes", "-j"]])
    })
})

describe("target choice", () => {
    const jane = { name: "Jane's iPhone", udid: "00008110-AAAA", version: "26.0" }
    const ravi = { name: "Ravi's iPhone", udid: "00008110-BBBB", version: "18.5" }
    const never = async () => {
        throw new Error("should not ask")
    }

    it("is the simulator by default, even with an iPhone connected, without a terminal", async () => {
        expect(await chooseIosTarget({ devices: [jane], isTTY: false, select: never })).toEqual({
            target: "simulator",
        })
    })

    it("does not ask in a terminal when no iPhone is connected", async () => {
        expect(await chooseIosTarget({ devices: [], isTTY: true, select: never })).toEqual({
            target: "simulator",
        })
    })

    it("asks in a terminal when both are available, defaulting to the remembered pick", async () => {
        const seen: any[] = []
        const select = async (_q: string, choices: any[], options: any) => {
            seen.push({ values: choices.map((c) => c.value), defaultValue: options.defaultValue })
            return options.defaultValue
        }
        expect(await chooseIosTarget({ devices: [jane], isTTY: true, select })).toEqual({
            target: "simulator",
        })
        expect(
            await chooseIosTarget({
                devices: [jane, ravi],
                isTTY: true,
                last: { target: "device", udid: ravi.udid },
                select,
            })
        ).toEqual({ target: "device", udid: ravi.udid, name: ravi.name })
        expect(seen).toEqual([
            { values: ["simulator", jane.udid], defaultValue: "simulator" },
            { values: ["simulator", jane.udid, ravi.udid], defaultValue: ravi.udid },
        ])
    })

    it("--device takes the one connected iPhone without asking", async () => {
        expect(await chooseIosTarget({ device: true, devices: [jane], isTTY: false, select: never })).toEqual(
            {
                target: "device",
                udid: jane.udid,
                name: jane.name,
            }
        )
    })

    it("--device fails with IOS-014 when no iPhone is connected", async () => {
        const error = await rejection(chooseIosTarget({ device: true, devices: [], isTTY: true }))
        expect(error.code).toBe("IOS-014")
    })

    it("--device with several iPhones: ios.deviceUDID, else a choice in a terminal, else NATIVE-005", async () => {
        expect(
            await chooseIosTarget({
                device: true,
                devices: [jane, ravi],
                configuredUdid: ravi.udid,
                isTTY: false,
                select: never,
            })
        ).toMatchObject({ udid: ravi.udid })
        expect(
            await chooseIosTarget({
                device: true,
                devices: [jane, ravi],
                isTTY: true,
                select: async (_q: string, choices: any[]) => choices[1].value,
            })
        ).toMatchObject({ udid: ravi.udid })
        const error = await rejection(chooseIosTarget({ device: true, devices: [jane, ravi], isTTY: false }))
        expect(error.code).toBe("NATIVE-005")
        expect(error.hint).toContain("deviceUDID")
    })
})

describe("dev server host", () => {
    it("is localhost for the simulator, which shares the Mac's network", () => {
        expect(
            devHostFor(
                { target: "simulator" },
                {
                    reachableHost: () => {
                        throw new Error("not needed")
                    },
                }
            )
        ).toBe("localhost")
    })

    it("is the Mac's .local name for an iPhone, else its LAN IP", () => {
        const iphone = { target: "device", name: "Jane's iPhone" }
        expect(
            devHostFor(iphone, { reachableHost: () => ({ host: "janes-mac.local", source: "bonjour" }) })
        ).toBe("janes-mac.local")
        expect(devHostFor(iphone, { reachableHost: () => ({ host: "192.168.1.20", source: "lan" }) })).toBe(
            "192.168.1.20"
        )
    })

    it("fails with IOS-015 when the iPhone has no way to reach the Mac", () => {
        expect(thrown(() => devHostFor({ target: "device" }, { reachableHost: () => null })).code).toBe(
            "IOS-015"
        )
    })
})

describe("prepareIosDebugTarget", () => {
    const rt = runtime("26.0")
    const jane = { name: "Jane's iPhone", udid: "00008110-AAAA", version: "26.0" }

    function deps(overrides: Record<string, any> = {}) {
        const saved: any[] = []
        const options = {
            cwd: "/app",
            last: null,
            listDevices: () => [jane],
            ensureRuntime: async () => rt,
            ensureSim: async ({ name }: any) => ({
                name: name || "iPhone 17 Pro",
                udid: "SIM-UDID",
                created: false,
            }),
            reachableHost: () => ({ host: "janes-mac.local", source: "bonjour" }),
            save: (platform: string, target: any) => void saved.push([platform, target]),
            ...overrides,
        }
        return { options, saved }
    }

    it("builds for the simulator on localhost without a terminal, and remembers nothing", async () => {
        const { options, saved } = deps({ isTTY: false, iosConfig: { simulatorName: "iPhone 17" } })
        expect(await prepareIosDebugTarget(options)).toEqual({
            target: { target: "simulator", name: "iPhone 17", udid: "SIM-UDID" },
            devHost: "localhost",
        })
        expect(saved).toEqual([])
    })

    it("builds for the iPhone on the Mac's .local name with --device, and remembers it", async () => {
        const { options, saved } = deps({
            isTTY: false,
            flags: { device: true },
            ensureRuntime: async () => {
                throw new Error("a device build needs no simulator runtime")
            },
        })
        const result = await prepareIosDebugTarget(options)
        expect(result).toEqual({
            target: { target: "device", udid: jane.udid, name: jane.name },
            devHost: "janes-mac.local",
        })
        expect(saved).toEqual([["ios", result.target]])
    })

    it("remembers a pick made in a terminal", async () => {
        const { options, saved } = deps({ isTTY: true, select: async () => "simulator" })
        await prepareIosDebugTarget(options)
        expect(saved).toEqual([["ios", { target: "simulator", name: "iPhone 17 Pro", udid: "SIM-UDID" }]])
    })

    it("hands the configured name and the remembered pick to the simulator choice", async () => {
        const seen: any[] = []
        const last = { target: "simulator", udid: "LAST-UDID", name: "iPhone Air" }
        const { options } = deps({
            isTTY: false,
            last,
            ensureSim: async (args: any) => {
                seen.push({ name: args.name, last: args.last })
                return { name: "iPhone Air", udid: "LAST-UDID", created: false }
            },
        })
        expect((await prepareIosDebugTarget(options)).target).toEqual({
            target: "simulator",
            name: "iPhone Air",
            udid: "LAST-UDID",
        })
        await prepareIosDebugTarget({ ...options, iosConfig: { simulatorName: "iPhone 16" } })
        expect(seen).toEqual([
            { name: undefined, last },
            { name: "iPhone 16", last },
        ])
    })
})
