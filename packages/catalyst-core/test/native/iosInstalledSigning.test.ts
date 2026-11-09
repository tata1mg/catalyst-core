import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

import {
    XCODE_TEAM_HINT,
    chooseXcodeTeam,
    createProfileScanner,
    findInstalledProfileIdentity,
    needsXcodeTeam,
    parseXcodeTeams,
    pickInstalledProfile,
    planIosSigning,
    planSigningForConfig,
    productBundleId,
    readXcodeTeams,
    scanInstalledProfiles,
    settleXcodeTeam,
    signingFailureLine,
    signingSetupError,
} from "../../src/native/buildIos/signing.js"

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-ios-installed-test-"))
    temps.push(dir)
    return dir
}

afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function rejection(promise: Promise<unknown>): Promise<any> {
    try {
        await promise
    } catch (error) {
        return error
    }
    throw new Error("expected a rejection")
}

const sha1 = (text: string) => crypto.createHash("sha1").update(Buffer.from(text)).digest("hex").toUpperCase()
const der = (text: string) => Buffer.from(text).toString("base64")
const NOW = new Date("2026-11-05T00:00:00Z")
const LATER = Date.parse("2027-06-01T00:00:00Z")

const identities = [
    { sha1: sha1("dist"), name: "iPhone Distribution: Acme (TEAM123)" },
    { sha1: sha1("dev"), name: "Apple Development: Acme (TEAM123)" },
]

/** An App Store distribution profile for com.acme.shop, as scanInstalledProfiles reports it. */
function appStore(fields: Record<string, any> = {}) {
    return {
        file: "a.mobileprovision",
        uuid: "AAAA-0001",
        name: "Shop App Store",
        teamId: "TEAM123",
        applicationIdentifier: "TEAM123.com.acme.shop",
        apsEnvironment: "production",
        getTaskAllow: false,
        devices: 0,
        allDevices: false,
        expirationDate: "2027-06-01T00:00:00Z",
        expires: LATER,
        certificates: [sha1("dist")],
        ...fields,
    }
}

const scanOf = (...profiles: any[]) => ({ identities, profiles })
const pick = (scan: any, options: Record<string, any> = {}) =>
    pickInstalledProfile(scan, { bundleId: "com.acme.shop", now: NOW, ...options })

describe("pickInstalledProfile: auto-pick", () => {
    it("picks the newest App Store profile whose certificate is in the keychain, with its team", () => {
        const scan = scanOf(
            appStore({ uuid: "OLD", expires: LATER - 1000 }),
            appStore({ uuid: "NEW" }),
            appStore({ uuid: "NEWEST", expires: LATER + 1000, certificates: [sha1("someone-else")] })
        )
        expect(pick(scan).identity).toEqual({
            ...identities[0],
            teamId: "TEAM123",
            uuid: "NEW",
            profileName: "Shop App Store",
        })
    })

    it.each([
        ["a wildcard profile", { applicationIdentifier: "TEAM123.com.acme.*" }, /exactly com.acme.shop/],
        ["a profile for another bundle id", { applicationIdentifier: "TEAM123.com.acme.other" }, /exactly/],
        ["an ad-hoc profile with devices", { devices: 3 }, /App Store profile/],
        ["an enterprise profile", { allDevices: true }, /App Store profile/],
        ["a development profile", { getTaskAllow: true }, /App Store profile/],
        ["a profile without get-task-allow", { getTaskAllow: undefined }, /App Store profile/],
        ["a macOS .provisionprofile", { file: "a.provisionprofile" }, /exactly/],
        ["an expired profile", { expires: NOW.getTime() - 1 }, /expired/],
        ["a profile whose certificate is not in the keychain", { certificates: [sha1("x")] }, /keychain/],
    ])("skips %s", (_what, fields, reason) => {
        const result = pick(scanOf(appStore(fields)))
        expect(result.identity).toBeNull()
        expect(result.reason).toMatch(reason)
    })

    it("keeps to ios.developmentTeam when it is set", () => {
        const scan = scanOf(
            appStore({ teamId: "OTHER99999", applicationIdentifier: "OTHER99999.com.acme.shop" })
        )
        expect(pick(scan, { teamId: "TEAM123" })).toMatchObject({ identity: null, reason: /team TEAM123/ })
        expect(pick(scan, { teamId: "OTHER99999" }).identity?.teamId).toBe("OTHER99999")
    })

    it("needs aps-environment in the profile when push notifications are on", () => {
        const scan = scanOf(appStore({ apsEnvironment: undefined }))
        expect(pick(scan, { needsPush: true })).toMatchObject({ identity: null, reason: /push/ })
        expect(pick(scan).identity).not.toBeNull()
    })

    it("finds nothing in an empty scan", () => {
        expect(pick({ identities: [], profiles: [] })).toEqual({
            identity: null,
            reason: "the keychain has no valid signing certificate",
        })
        expect(pick({ identities, profiles: [] }).reason).toMatch(/exactly/)
        expect(pick(null as any).identity).toBeNull()
    })
})

describe("pickInstalledProfile: ios.provisioningProfile", () => {
    const named = (fields: Record<string, any> = {}) =>
        appStore({ name: "Shop Ad Hoc", devices: 5, ...fields })

    it("finds the named profile by name or UUID, ad-hoc and wildcard included", () => {
        const scan = scanOf(named({ applicationIdentifier: "TEAM123.com.acme.*" }))
        expect(pick(scan, { profile: "Shop Ad Hoc" }).identity?.sha1).toBe(sha1("dist"))
        expect(pick(scan, { profile: "aaaa-0001" }).identity?.uuid).toBe("AAAA-0001")
    })

    it("says why it could not use the profile", () => {
        expect(pick(scanOf(named()), { profile: "Missing" }).reason).toBe(
            "no installed profile has that name or UUID"
        )
        expect(
            pick(scanOf(named({ expires: 1, expirationDate: "2001-01-01T00:00:00Z" })), {
                profile: "Shop Ad Hoc",
            }).reason
        ).toBe("it expired on 2001-01-01T00:00:00Z")
        expect(
            pick(scanOf(named({ applicationIdentifier: "TEAM123.com.acme.other" })), {
                profile: "Shop Ad Hoc",
            }).reason
        ).toBe("it is for com.acme.other, not com.acme.shop")
        expect(pick(scanOf(named({ certificates: [] })), { profile: "Shop Ad Hoc" }).reason).toBe(
            "its certificate is not in the keychain"
        )
    })
})

describe("scanInstalledProfiles", () => {
    // A fake home with profiles in both of Xcode's folders, and a fake
    // `security`/`plutil` answering from the profile decoded last.
    function fakeMac(files: Record<string, Record<string, string> | null>, keychain: string) {
        const homeDir = tempDir()
        const dirs = [
            path.join(homeDir, "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles"),
            path.join(homeDir, "Library", "MobileDevice", "Provisioning Profiles"),
        ]
        for (const dir of dirs) fs.mkdirSync(dir, { recursive: true })
        for (const [index, file] of Object.keys(files).entries()) {
            fs.writeFileSync(path.join(dirs[index % 2], file), "")
        }
        // The same profile in the second folder too.
        fs.writeFileSync(path.join(dirs[1], Object.keys(files)[0]), "")
        let current: Record<string, string> = {}
        const calls: string[][] = []
        const run = (command: string, args: string[]) => {
            calls.push([command, ...args])
            if (command === "security" && args[0] === "find-identity") return keychain
            if (command === "security" && args[0] === "cms") {
                const fields = files[path.basename(args[3])]
                if (!fields) throw new Error("SecCmsDecoder failed")
                current = fields
                return ""
            }
            if (command === "plutil" && args[1] in current) return `${current[args[1]]}\n`
            throw new Error("No value at that key path")
        }
        return { homeDir, run, calls }
    }
    const keychain = `  1) ${sha1("dist")} "iPhone Distribution: Acme (TEAM123)"\n     1 valid identities found\n`

    it("decodes each profile once, with the fields auto-pick needs", () => {
        const tmpRoot = tempDir()
        const mac = fakeMac(
            {
                "a.mobileprovision": {
                    UUID: "AAAA-0001",
                    Name: "Shop App Store",
                    "TeamIdentifier.0": "TEAM123",
                    "Entitlements.application-identifier": "TEAM123.com.acme.shop",
                    "Entitlements.get-task-allow": "false",
                    "Entitlements.aps-environment": "production",
                    ExpirationDate: "2027-06-01T00:00:00Z",
                    DeveloperCertificates: "1",
                    "DeveloperCertificates.0": der("dist"),
                },
                "b.mobileprovision": {
                    UUID: "BBBB-0002",
                    Name: "Shop Ad Hoc",
                    "Entitlements.get-task-allow": "true",
                    ProvisionedDevices: "4",
                    ProvisionsAllDevices: "true",
                },
                "broken.mobileprovision": null,
                "c.mobileprovision": { Name: "No UUID" },
            },
            keychain
        )
        const scan = scanInstalledProfiles({ run: mac.run, homeDir: mac.homeDir, tmpRoot })
        expect(scan.identities).toEqual([{ sha1: sha1("dist"), name: "iPhone Distribution: Acme (TEAM123)" }])
        expect(scan.profiles).toEqual([
            {
                file: "a.mobileprovision",
                uuid: "AAAA-0001",
                name: "Shop App Store",
                teamId: "TEAM123",
                applicationIdentifier: "TEAM123.com.acme.shop",
                apsEnvironment: "production",
                getTaskAllow: false,
                devices: 0,
                allDevices: false,
                expirationDate: "2027-06-01T00:00:00Z",
                expires: LATER,
                certificates: [sha1("dist")],
            },
            expect.objectContaining({
                uuid: "BBBB-0002",
                getTaskAllow: true,
                devices: 4,
                allDevices: true,
                expires: 0,
            }),
        ])
        // Its scratch folder is gone again.
        expect(fs.readdirSync(tmpRoot)).toEqual([])
        expect(pickInstalledProfile(scan, { bundleId: "com.acme.shop", now: NOW }).identity?.uuid).toBe(
            "AAAA-0001"
        )
    })

    it("reads nothing when the keychain has no identity or security fails", () => {
        const mac = fakeMac({ "a.mobileprovision": { UUID: "A" } }, "     0 valid identities found\n")
        expect(scanInstalledProfiles({ run: mac.run, homeDir: mac.homeDir })).toEqual({
            identities: [],
            profiles: [],
        })
        expect(mac.calls).toHaveLength(1)
        const failing = () => {
            throw new Error("security: not found")
        }
        expect(scanInstalledProfiles({ run: failing, homeDir: mac.homeDir })).toEqual({
            identities: [],
            profiles: [],
        })
    })

    it("keeps a caller's workDir and runs once through createProfileScanner", () => {
        const mac = fakeMac({ "a.mobileprovision": { UUID: "AAAA-0001", Name: "Shop" } }, keychain)
        const workDir = tempDir()
        const scanProfiles = createProfileScanner({ run: mac.run, homeDir: mac.homeDir, workDir })
        const first = scanProfiles()
        expect(scanProfiles()).toBe(first)
        expect(mac.calls.filter((call) => call[1] === "find-identity")).toHaveLength(1)
        expect(fs.existsSync(workDir)).toBe(true)
        expect(fs.readdirSync(workDir)).toEqual([])
    })

    it("backs findInstalledProfileIdentity, which can also be handed a scan", () => {
        const scan = scanOf(appStore())
        expect(findInstalledProfileIdentity({ scan, bundleId: "com.acme.shop", now: NOW })?.uuid).toBe(
            "AAAA-0001"
        )
        expect(findInstalledProfileIdentity({ scan, profile: "Nope", now: NOW })).toBeNull()
    })
})

describe("planIosSigning order", () => {
    const p12 = { file: "/c/dist.p12", password: "", profileFile: "/c/a.mobileprovision" }
    const apiKey = { keyPath: "/c/AuthKey_A.p8", keyId: "A", issuerId: "I" }
    function scanner(scan: any = scanOf(appStore())) {
        const calls = { count: 0 }
        const scanProfiles = () => {
            calls.count += 1
            return scan
        }
        return { scanProfiles, calls }
    }
    const plan = (options: Record<string, any>) =>
        planIosSigning({ release: true, bundleId: "com.acme.shop", now: NOW, ...options })

    it("puts the .p12 first, then ios.provisioningProfile, then the API key, without scanning", () => {
        const { scanProfiles, calls } = scanner()
        expect(
            plan({
                credentials: { dir: "/c", apiKey, p12 },
                iosConfig: { provisioningProfile: "X" },
                scanProfiles,
            }).source
        ).toBe("credentials/ios .p12")
        expect(
            plan({
                credentials: { dir: "/c", apiKey, p12: null },
                iosConfig: { provisioningProfile: "X" },
                scanProfiles,
            }).source
        ).toBe("ios.provisioningProfile")
        expect(plan({ credentials: { dir: "/c", apiKey, p12: null }, scanProfiles })).toMatchObject({
            style: "automatic",
            source: "App Store Connect API key",
        })
        expect(calls.count).toBe(0)
    })

    it("signs manually with an installed App Store profile before the Xcode account", () => {
        const { scanProfiles, calls } = scanner()
        expect(plan({ scanProfiles })).toEqual({
            style: "manual",
            source: "installed profile",
            p12: false,
            teamId: "TEAM123",
            provisioningProfile: "Shop App Store",
            profileName: "Shop App Store",
            identity: sha1("dist"),
            signingCertificate: sha1("dist"),
            certificateName: "iPhone Distribution: Acme (TEAM123)",
            apsEnvironment: "production",
        })
        expect(calls.count).toBe(1)
    })

    it("names the profile by UUID when another installed profile has the same name", () => {
        const { scanProfiles } = scanner(scanOf(appStore(), appStore({ uuid: "DUP", expires: 1 })))
        expect(plan({ scanProfiles }).provisioningProfile).toBe("AAAA-0001")
    })

    it("falls back to the Xcode account when nothing matches, or the export is not for the App Store", () => {
        expect(plan({ scanProfiles: scanner(scanOf()).scanProfiles }).source).toBe("Xcode account")
        expect(plan({}).source).toBe("Xcode account")
        for (const exportMethod of ["release-testing", "enterprise", "debugging"]) {
            const { scanProfiles, calls } = scanner()
            expect(plan({ exportMethod, scanProfiles }).source).toBe("Xcode account")
            expect(calls.count).toBe(0)
        }
    })

    it("leaves debug builds alone", () => {
        const { scanProfiles, calls } = scanner()
        expect(planIosSigning({ release: false, bundleId: "com.acme.shop", scanProfiles }).style).toBe(
            "automatic"
        )
        expect(calls.count).toBe(0)
    })

    it("plans from a resolved config: its bundle id, push setting and team", () => {
        const { scanProfiles } = scanner(scanOf(appStore({ apsEnvironment: undefined })))
        const WEBVIEW_CONFIG = { ios: { bundleIdentifier: "com.acme.shop", appBundleId: "com.acme.shop" } }
        expect(planSigningForConfig({ WEBVIEW_CONFIG, release: true, scanProfiles, now: NOW }).source).toBe(
            "installed profile"
        )
        expect(
            planSigningForConfig({
                WEBVIEW_CONFIG: { ...WEBVIEW_CONFIG, notifications: { enabled: true } },
                release: true,
                scanProfiles,
                now: NOW,
            }).source
        ).toBe("Xcode account")
        expect(productBundleId({ appBundleId: "com.a.b" })).toBe("com.a.b")
        expect(productBundleId()).toBe("com.catalyst.framework.app")
    })
})

describe("the team signed in to Xcode", () => {
    const prefs = (byAccount: unknown) => JSON.stringify(byAccount)

    it("reads one entry per team, keeping an unknown free flag", () => {
        expect(
            parseXcodeTeams(
                prefs({
                    "account-1": [
                        { teamID: "TEAM123", teamName: "Acme", isFreeProvisioningTeam: false },
                        {
                            teamID: "PERS000001",
                            teamName: "Jo (Personal Team)",
                            isFreeProvisioningTeam: true,
                        },
                    ],
                    "account-2": [
                        { teamID: "TEAM123", teamName: "Acme" },
                        { teamID: "UNKNOWN001", teamName: "Mystery" },
                        { teamID: "", teamName: "Broken" },
                        "not a team",
                    ],
                    "account-3": "not a list",
                })
            )
        ).toEqual([
            { teamId: "TEAM123", teamName: "Acme", free: false },
            { teamId: "PERS000001", teamName: "Jo (Personal Team)", free: true },
            { teamId: "UNKNOWN001", teamName: "Mystery", free: undefined },
        ])
        expect(parseXcodeTeams(prefs({ a: [{ teamID: "T1", isFreeProvisioningTeam: 0 }] }))?.[0].free).toBe(
            false
        )
        expect(
            parseXcodeTeams(
                prefs({ a: [{ teamID: "T1" }, { teamID: "T1", isFreeProvisioningTeam: 1 }] })
            )?.[0].free
        ).toBe(true)
    })

    it("is null for anything that is not the expected shape", () => {
        expect(parseXcodeTeams("not json")).toBeNull()
        expect(parseXcodeTeams("[]")).toBeNull()
        expect(parseXcodeTeams("null")).toBeNull()
    })

    it("extracts only IDEProvisioningTeamByIdentifier, through stdin", () => {
        const calls: any[] = []
        const run = (command: string, args: string[], options?: any) => {
            calls.push({ command, args, input: options?.input })
            if (command === "defaults") return "<plist>whole domain</plist>"
            return prefs({ a: [{ teamID: "TEAM123", teamName: "Acme" }] })
        }
        expect(readXcodeTeams({ run })).toEqual([{ teamId: "TEAM123", teamName: "Acme", free: undefined }])
        expect(calls).toEqual([
            { command: "defaults", args: ["export", "com.apple.dt.Xcode", "-"], input: undefined },
            {
                command: "plutil",
                args: ["-extract", "IDEProvisioningTeamByIdentifier", "json", "-o", "-", "-"],
                input: "<plist>whole domain</plist>",
            },
        ])
        const failing = () => {
            throw new Error("No value at that key path")
        }
        expect(readXcodeTeams({ run: failing })).toBeNull()
    })

    it("is needed only for a release signing with the Xcode account without a team", () => {
        const xcode = { style: "automatic", source: "Xcode account", teamId: "" }
        expect(needsXcodeTeam(xcode, { release: true })).toBe(true)
        expect(needsXcodeTeam(xcode, { release: false })).toBe(false)
        expect(needsXcodeTeam({ ...xcode, teamId: "T" }, { release: true })).toBe(false)
        expect(needsXcodeTeam({ ...xcode, source: "App Store Connect API key" }, { release: true })).toBe(
            false
        )
        expect(needsXcodeTeam({ style: "manual", source: "installed profile" }, { release: true })).toBe(
            false
        )
        expect(needsXcodeTeam(undefined, { release: true })).toBe(false)
        expect(needsXcodeTeam(xcode)).toBe(false)
    })

    const acme = { teamId: "TEAM123", teamName: "Acme", free: false }
    const personal = { teamId: "PERS000001", teamName: "Jo (Personal Team)", free: true }
    const unknown = { teamId: "UNKNOWN001", teamName: "", free: undefined }

    it("uses the one team that can sign, dropping personal teams for the App Store", async () => {
        expect(await chooseXcodeTeam({ teams: [personal, acme], exportMethod: "app-store-connect" })).toBe(
            acme
        )
        expect(await chooseXcodeTeam({ teams: [personal, unknown], exportMethod: "release-testing" })).toBe(
            unknown
        )
        expect(await chooseXcodeTeam({ teams: [personal], exportMethod: "debugging" })).toBe(personal)
    })

    it("asks which team when several can sign, and needs a terminal for it", async () => {
        const asked: any[] = []
        const choose = async (question: string, choices: any[]) => {
            asked.push({ question, choices })
            return "UNKNOWN001"
        }
        expect(await chooseXcodeTeam({ teams: [acme, unknown], isTTY: true, choose: choose as any })).toBe(
            unknown
        )
        expect(asked[0].choices).toEqual([
            { label: "Acme (TEAM123)", value: "TEAM123" },
            { label: "Unnamed team (UNKNOWN001)", value: "UNKNOWN001" },
        ])
        const fallback = async () => "SOMETHING-ELSE"
        expect(await chooseXcodeTeam({ teams: [acme, unknown], isTTY: true, choose: fallback as any })).toBe(
            acme
        )

        const error = await rejection(chooseXcodeTeam({ teams: [acme, unknown], isTTY: false }))
        expect(error.code).toBe("NATIVE-005")
        expect(error.hint).toContain("WEBVIEW_CONFIG.ios.developmentTeam")
        expect(error.hint).toContain("Acme (TEAM123)")
    })

    it("is IOS-010 with the Xcode Accounts hint when no team can sign or Xcode cannot be read", async () => {
        for (const teams of [[personal], [], null]) {
            const error = await rejection(chooseXcodeTeam({ teams, exportMethod: "app-store-connect" }))
            expect(error.code).toBe("IOS-010")
            expect(error.hint).toBe(XCODE_TEAM_HINT)
        }
        expect((await rejection(chooseXcodeTeam({ teams: [personal] }))).message).toMatch(/personal team/)
        expect((await rejection(chooseXcodeTeam({ teams: null }))).message).toMatch(/could not read/)
    })
})

describe("settleXcodeTeam", () => {
    const xcodePlan = {
        style: "automatic",
        source: "Xcode account",
        p12: false,
        teamId: "",
        apsEnvironment: "development",
    }
    const acme = { teamId: "TEAM123", teamName: "Acme", free: false }
    function settle(options: Record<string, any>) {
        const saved: string[] = []
        const logs: { message: string; type?: string }[] = []
        const result = settleXcodeTeam({
            plan: xcodePlan as any,
            release: true,
            exportMethod: "app-store-connect",
            readTeams: () => [acme],
            save: (teamId: string) => saved.push(teamId),
            log: (message: string, type?: string) => logs.push({ message, type }),
            ...options,
        })
        return { result, saved, logs }
    }

    it("saves the team in a terminal", async () => {
        const { result, saved, logs } = settle({ isTTY: true })
        expect(await result).toEqual({ teamId: "TEAM123", saved: true })
        expect(saved).toEqual(["TEAM123"])
        expect(logs).toEqual([{ message: "Signing for Acme (TEAM123), signed in to Xcode", type: "info" }])
    })

    it("uses the team for this build only without a terminal, never saving", async () => {
        const { result, saved, logs } = settle({ isTTY: false })
        expect(await result).toEqual({ teamId: "TEAM123", saved: false })
        expect(saved).toEqual([])
        expect(logs).toEqual([
            {
                message:
                    "Using team Acme (TEAM123) from Xcode. Set WEBVIEW_CONFIG.ios.developmentTeam to keep it.",
                type: "note",
            },
        ])
    })

    it("does nothing when no team is needed, and passes chooseXcodeTeam's errors on", async () => {
        const reads = { count: 0 }
        const readTeams = () => {
            reads.count += 1
            return [acme]
        }
        expect(await settle({ plan: { ...xcodePlan, teamId: "T" }, readTeams }).result).toBeNull()
        expect(await settle({ release: false, readTeams }).result).toBeNull()
        expect(reads.count).toBe(0)
        const error = await rejection(settle({ isTTY: false, readTeams: () => null }).result)
        expect(error.code).toBe("IOS-010")
    })
})

describe("signing failure detail", () => {
    it("puts xcodebuild's own signing line into the IOS-010 detail", () => {
        const output = [
            "Command line invocation:",
            "    xcodebuild archive -authenticationKeyPath /c/AuthKey_A.p8",
            '/Users/a/app/iosnativeWebView.xcodeproj: error: Provisioning profile "Shop" has app ID "com.acme.a", which does not match the bundle ID "com.acme.b". (in target \'iosnativeWebView\')',
            "** ARCHIVE FAILED **",
        ].join("\n")
        expect(signingFailureLine(output)).toBe(
            'Provisioning profile "Shop" has app ID "com.acme.a", which does not match the bundle ID "com.acme.b". (in target \'iosnativeWebView\')'
        )
        const error = signingSetupError("Xcode could not sign the release archive", { output })
        expect(error.message).toBe(
            `iOS code signing is not set up: Xcode could not sign the release archive: ${signingFailureLine(output)}`
        )
    })

    it("strips a bare error: prefix, caps long lines, and is null without a match", () => {
        expect(signingFailureLine("error: No Accounts: Add a new account in Accounts settings.")).toBe(
            "No Accounts: Add a new account in Accounts settings."
        )
        expect(signingFailureLine(`error: No signing certificate ${"x".repeat(400)}`)).toHaveLength(300)
        expect(signingFailureLine("-authenticationKeyPath /c/AuthKey_A.p8")).toBe(
            "-authenticationKeyPath /c/AuthKey_A.p8"
        )
        expect(signingFailureLine("error: cannot find 'Foo' in scope")).toBeNull()
        expect(signingFailureLine(undefined)).toBeNull()
        expect(signingSetupError("Xcode could not sign the device build").message).toBe(
            "iOS code signing is not set up: Xcode could not sign the device build"
        )
    })
})
