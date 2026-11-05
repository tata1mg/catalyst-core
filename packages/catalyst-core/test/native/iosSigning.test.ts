import { execFileSync } from "child_process"
import fs from "fs"
import { createRequire } from "module"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { afterEach, describe, expect, it } from "vitest"

import {
    buildExportOptions,
    isReleaseBuildType,
    isSigningFailure,
    parseIdentity,
    parseKeychainList,
    parseProperties,
    planIosSigning,
    profileMatchesBundleId,
    readIosCredentials,
    readProvisioningProfile,
    resolveExportMethod,
    setupP12Signing,
    signingSetupError,
    writeExportOptionsPlist,
    xcodeAuthArgs,
} from "../../src/native/buildIos/signing.js"
import { releaseOutputDir } from "../../src/native/buildIos/output.js"
import { packCredentials, resolveCredentials } from "../../src/native/credentials.js"

// The CJS build phases load with require, as in releaseConfig.test.ts.
const require = createRequire(import.meta.url)
const createIosConfigPhase = require("../../src/native/buildIos/config.js")
const { generateLocalhostP12 } = require("../../src/native/buildIos/localhostCert.js")

const here = path.dirname(fileURLToPath(import.meta.url))
const shellDir = path.resolve(here, "../../src/native/iosnativeWebView")
const isMac = process.platform === "darwin"

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-ios-signing-test-"))
    temps.push(dir)
    return dir
}

afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** Run fn and return what it threw. */
function thrown(fn: () => unknown): any {
    try {
        fn()
    } catch (error) {
        return error
    }
    throw new Error("expected a throw")
}

describe("isReleaseBuildType", () => {
    it("accepts release in any case", () => {
        expect(isReleaseBuildType("release")).toBe(true)
        expect(isReleaseBuildType("Release")).toBe(true)
        expect(isReleaseBuildType(" RELEASE ")).toBe(true)
        expect(isReleaseBuildType("Debug")).toBe(false)
        expect(isReleaseBuildType(undefined)).toBe(false)
    })
})

describe("resolveExportMethod", () => {
    it("defaults to app-store-connect and accepts Xcode 26 names", () => {
        expect(resolveExportMethod({})).toBe("app-store-connect")
        expect(resolveExportMethod({ exportMethod: "release-testing" })).toBe("release-testing")
        expect(resolveExportMethod({ exportMethod: "Debugging" })).toBe("debugging")
    })

    it("maps the old names with a warning", () => {
        const logs: string[] = []
        expect(resolveExportMethod({ exportMethod: "ad-hoc" }, { log: (m: string) => logs.push(m) })).toBe(
            "release-testing"
        )
        expect(resolveExportMethod({ exportMethod: "app-store" })).toBe("app-store-connect")
        expect(logs[0]).toMatch(/old name/)
    })

    it("fails an unknown method with IOS-013", () => {
        expect(thrown(() => resolveExportMethod({ exportMethod: "testflight" })).code).toBe("IOS-013")
    })
})

/** A credentials/ios/ folder with these files (name -> contents). */
function credentialsFolder(files: Record<string, string>) {
    const dir = path.join(tempDir(), "credentials", "ios")
    fs.mkdirSync(dir, { recursive: true })
    for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), contents)
    return dir
}

describe("readIosCredentials", () => {
    const PEM = "-----BEGIN PRIVATE KEY-----\nMIGT\n-----END PRIVATE KEY-----\n"

    it("finds nothing in a missing or empty folder", () => {
        expect(readIosCredentials(path.join(tempDir(), "nope"))).toMatchObject({ apiKey: null, p12: null })
        expect(readIosCredentials(credentialsFolder({}))).toMatchObject({ apiKey: null, p12: null })
    })

    it("reads the API key, taking the key ID from the file name", () => {
        const dir = credentialsFolder({
            "AuthKey_ABC123XYZ.p8": PEM,
            "signing.properties": "# cloud signing\nascIssuerId = 11111111-2222-3333-4444-555555555555\n",
        })
        expect(readIosCredentials(dir).apiKey).toEqual({
            keyPath: path.join(dir, "AuthKey_ABC123XYZ.p8"),
            keyId: "ABC123XYZ",
            issuerId: "11111111-2222-3333-4444-555555555555",
        })
    })

    it("takes ascKeyId over the file name", () => {
        const dir = credentialsFolder({
            "store.p8": PEM,
            "signing.properties": "ascKeyId=KEY42\nascIssuerId=issuer\n",
        })
        expect(readIosCredentials(dir).apiKey).toMatchObject({ keyId: "KEY42", issuerId: "issuer" })
    })

    it("fails a partial API key with IOS-011 naming what is missing", () => {
        const noIssuer = thrown(() => readIosCredentials(credentialsFolder({ "AuthKey_ABC.p8": PEM })))
        expect(noIssuer.code).toBe("IOS-011")
        expect(noIssuer.message).toMatch(/issuer ID/)
        expect(noIssuer.message).not.toMatch(/key file/)
        const noKey = thrown(() =>
            readIosCredentials(credentialsFolder({ "signing.properties": "ascIssuerId=issuer\n" }))
        )
        expect(noKey.code).toBe("IOS-011")
        expect(noKey.message).toMatch(/key file/)
        expect(
            thrown(() =>
                readIosCredentials(
                    credentialsFolder({
                        "AuthKey_A.p8": PEM,
                        "AuthKey_B.p8": PEM,
                        "signing.properties": "ascIssuerId=i",
                    })
                )
            ).message
        ).toMatch(/keep one/)
        expect(thrown(() => readIosCredentials(credentialsFolder({ "AuthKey_A.p8": PEM }))).hint).toMatch(
            /CATALYST_IOS_CREDENTIALS/
        )
    })

    it("fails a key ID that is not letters and digits with IOS-011", () => {
        const error = thrown(() =>
            readIosCredentials(
                credentialsFolder({
                    "store.p8": PEM,
                    "signing.properties": "ascKeyId=KEY-42 x\nascIssuerId=issuer\n",
                })
            )
        )
        expect(error.code).toBe("IOS-011")
        expect(error.message).toContain('the key ID "KEY-42 x" should be letters and digits only')
    })

    it("pairs the .p12 with its profile and masks the password", () => {
        const masked: string[] = []
        const dir = credentialsFolder({
            "dist.p12": "p12",
            "Acme_App_Store.mobileprovision": "profile",
            "signing.properties": "p12Password=hunter2-s3cret\n",
        })
        const found = readIosCredentials(dir, { mask: (value: string) => void masked.push(value) })
        expect(found.p12).toEqual({
            file: path.join(dir, "dist.p12"),
            password: "hunter2-s3cret",
            profileFile: path.join(dir, "Acme_App_Store.mobileprovision"),
        })
        expect(masked).toEqual(["hunter2-s3cret"])
    })

    it("fails a .p12 without a profile, and a profile without a .p12, with IOS-012", () => {
        expect(thrown(() => readIosCredentials(credentialsFolder({ "dist.p12": "x" }))).code).toBe("IOS-012")
        expect(thrown(() => readIosCredentials(credentialsFolder({ "a.mobileprovision": "x" }))).code).toBe(
            "IOS-012"
        )
    })

    it("reads the same files from CATALYST_IOS_CREDENTIALS when the folder is missing", () => {
        const source = credentialsFolder({
            "AuthKey_ENVKEY1.p8": PEM,
            "signing.properties": "ascIssuerId=env-issuer\n",
        })
        const value = packCredentials("ios", { cwd: path.dirname(path.dirname(source)) })
        const found = resolveCredentials("ios", {
            cwd: tempDir(),
            env: { CATALYST_IOS_CREDENTIALS: value },
        })
        try {
            expect(found.source).toBe("env")
            const key = readIosCredentials(found.dir).apiKey!
            expect(key).toMatchObject({ keyId: "ENVKEY1", issuerId: "env-issuer" })
            expect(fs.readFileSync(key.keyPath, "utf8")).toBe(PEM)
        } finally {
            found.cleanup()
        }
        expect(fs.existsSync(found.dir)).toBe(false)
    })

    it("parses the properties subset people write", () => {
        expect(parseProperties("# c\n! c\na=1\nb : two words \n\nbroken line\n")).toEqual({
            a: "1",
            b: "two words",
        })
    })
})

describe("xcodeAuthArgs", () => {
    it("lets Xcode provision with the signed-in account when there is no key", () => {
        expect(xcodeAuthArgs(null)).toEqual([
            "-allowProvisioningUpdates",
            "-allowProvisioningDeviceRegistration",
        ])
    })

    it("adds the API key flags", () => {
        expect(xcodeAuthArgs({ keyPath: "/k/AuthKey_A.p8", keyId: "A", issuerId: "I" })).toEqual([
            "-allowProvisioningUpdates",
            "-allowProvisioningDeviceRegistration",
            "-authenticationKeyPath",
            "/k/AuthKey_A.p8",
            "-authenticationKeyID",
            "A",
            "-authenticationKeyIssuerID",
            "I",
        ])
    })
})

describe("planIosSigning", () => {
    const p12 = { file: "/c/dist.p12", password: "", profileFile: "/c/a.mobileprovision" }
    const apiKey = { keyPath: "/c/AuthKey_A.p8", keyId: "A", issuerId: "I" }

    it("signs a release locally with the .p12 from credentials/ios, with a production push environment", () => {
        expect(planIosSigning({ release: true, credentials: { dir: "/c", apiKey, p12 } })).toMatchObject({
            style: "manual",
            p12: true,
            apsEnvironment: "production",
        })
    })

    it("leaves the .p12 to releases: a debug build signs automatically", () => {
        expect(planIosSigning({ credentials: { dir: "/c", apiKey: null, p12 } })).toMatchObject({
            style: "automatic",
            p12: false,
        })
    })

    it("keeps ios.provisioningProfile users on manual signing", () => {
        const iosConfig = { provisioningProfile: "My Profile", developmentTeam: "TEAM123456" }
        expect(planIosSigning({ iosConfig })).toMatchObject({
            style: "manual",
            provisioningProfile: "My Profile",
            teamId: "TEAM123456",
            apsEnvironment: "development",
        })
        expect(planIosSigning({ iosConfig, release: true }).apsEnvironment).toBe("production")
        expect(planIosSigning({ iosConfig, release: true, exportMethod: "debugging" }).apsEnvironment).toBe(
            "development"
        )
    })

    it("is cloud signing with the API key otherwise, archived for development (export re-signs)", () => {
        expect(
            planIosSigning({
                iosConfig: { developmentTeam: "T" },
                release: true,
                credentials: { dir: "/c", apiKey, p12: null },
            })
        ).toMatchObject({
            style: "automatic",
            source: "App Store Connect API key",
            teamId: "T",
            apsEnvironment: "development",
        })
        expect(planIosSigning({ release: true }).source).toBe("Xcode account")
    })

    it("has no unsigned mode", () => {
        expect(planIosSigning({ release: true, noSign: true } as any).style).not.toBe("none")
    })
})

describe("security output parsing", () => {
    it("reads the keychain search list", () => {
        expect(
            parseKeychainList(
                '    "/Users/a/Library/Keychains/login.keychain-db"\n    "/Library/Keychains/System.keychain"\n'
            )
        ).toEqual(["/Users/a/Library/Keychains/login.keychain-db", "/Library/Keychains/System.keychain"])
    })

    it("reads the first valid identity", () => {
        const sha = "A".repeat(40)
        expect(
            parseIdentity(
                `  1) ${sha} "Apple Distribution: Acme (TEAM123456)"\n     1 valid identities found\n`
            )
        ).toEqual({ sha1: sha, name: "Apple Distribution: Acme (TEAM123456)" })
        expect(parseIdentity("     0 valid identities found\n")).toBeNull()
    })

    it("matches profiles to bundle ids, including wildcards", () => {
        expect(profileMatchesBundleId("TEAM.com.acme.app", "com.acme.app")).toBe(true)
        expect(profileMatchesBundleId("TEAM.com.acme.*", "com.acme.app")).toBe(true)
        expect(profileMatchesBundleId("TEAM.*", "com.acme.app")).toBe(true)
        expect(profileMatchesBundleId("TEAM.com.other.app", "com.acme.app")).toBe(false)
    })
})

describe("readProvisioningProfile", () => {
    it("fails with IOS-012 for a file security cannot decode", () => {
        const error = thrown(() =>
            readProvisioningProfile("/creds/store.mobileprovision", {
                workDir: tempDir(),
                run: () => {
                    throw new Error("security: SecCmsDecoder failed")
                },
            })
        )
        expect(error.code).toBe("IOS-012")
        expect(error.message).toContain("store.mobileprovision is not a provisioning profile")
    })

    it("fails with IOS-012 when the profile has no usable UUID", () => {
        const noFields = (command: string) => {
            if (command === "plutil") throw new Error("No value at that key path")
            return ""
        }
        const missing = thrown(() =>
            readProvisioningProfile("/creds/a.mobileprovision", { workDir: tempDir(), run: noFields })
        )
        expect(missing.code).toBe("IOS-012")
        expect(missing.message).toContain("no UUID")

        const odd = (command: string, args: string[]) =>
            command === "plutil" && args[1] === "UUID" ? "not-a-uuid!\n" : ""
        expect(
            thrown(() =>
                readProvisioningProfile("/creds/a.mobileprovision", { workDir: tempDir(), run: odd })
            ).message
        ).toContain("no UUID")
    })

    it("reads the fields it can and leaves the rest undefined", () => {
        const workDir = tempDir()
        const calls: string[][] = []
        const run = (command: string, args: string[]) => {
            calls.push([command, ...args])
            if (command !== "plutil") return ""
            if (args[1] === "UUID") return "AAAA-BBBB\n"
            if (args[1] === "Name") return "Acme Dev\n"
            throw new Error("No value at that key path")
        }
        const profile = readProvisioningProfile("/creds/a.mobileprovision", { workDir, run })
        expect(profile).toMatchObject({ uuid: "AAAA-BBBB", name: "Acme Dev", teamId: undefined })
        expect(calls[0]).toEqual([
            "security",
            "cms",
            "-D",
            "-i",
            "/creds/a.mobileprovision",
            "-o",
            path.join(workDir, "profile.plist"),
        ])
    })
})

describe("setupP12Signing", () => {
    const P12_PASSWORD = "p12-s3cret-value"
    const SHA = "B".repeat(40)
    const LOGIN = "/Users/ci/Library/Keychains/login.keychain-db"
    const SYSTEM = "/Library/Keychains/System.keychain"

    type Call = { command: string; args: string[] }

    function fakeSigning({
        failOn,
        profile = {},
        identities = `  1) ${SHA} "Apple Distribution: Acme (TEAM123456)"\n     1 valid identities found\n`,
    }: { failOn?: string; profile?: Record<string, string>; identities?: string } = {}) {
        const calls: Call[] = []
        const profileFields: Record<string, string> = {
            UUID: "11111111-2222-3333-4444-555555555555",
            Name: "Acme App Store",
            "TeamIdentifier.0": "TEAM123456",
            "Entitlements.application-identifier": "TEAM123456.com.acme.app",
            "Entitlements.aps-environment": "production",
            ExpirationDate: "2099-01-01T00:00:00Z",
            ...profile,
        }
        const run = (command: string, args: string[]) => {
            calls.push({ command, args })
            const key = `${command} ${args[0]}`
            if (failOn && key === failOn) {
                const error: any = new Error(`Command failed: ${command} ${args.join(" ")}`)
                error.stderr = `security: ${args.join(" ")}: The specified item could not be found.`
                throw error
            }
            if (command === "security" && args[0] === "list-keychains" && !args.includes("-s")) {
                return `    "${LOGIN}"\n    "${SYSTEM}"\n`
            }
            if (command === "security" && args[0] === "find-identity") return identities
            if (command === "plutil" && args[0] === "-extract") {
                if (!(args[1] in profileFields)) throw new Error("No value at that key path")
                return `${profileFields[args[1]]}\n`
            }
            return ""
        }
        const handlers: Record<string, (signal: string) => void> = {}
        const signals = {
            once: (name: string, fn: (signal: string) => void) => {
                handlers[name] = fn
            },
            removeListener: (name: string, fn: (signal: string) => void) => {
                if (handlers[name] === fn) delete handlers[name]
            },
        }
        const logs: string[] = []
        const exits: number[] = []
        const masked: string[] = []
        const homeDir = tempDir()
        const tmpRoot = tempDir()
        const credentials = credentialsFolder({ "dist.p12": "p12-bytes", "store.mobileprovision": "profile" })
        const options = {
            p12: {
                file: path.join(credentials, "dist.p12"),
                password: P12_PASSWORD,
                profileFile: path.join(credentials, "store.mobileprovision"),
            },
            bundleId: "com.acme.app",
            env: {},
            mask: (value: string) => void masked.push(value),
            run,
            homeDir,
            tmpRoot,
            signals,
            exit: (code: number) => exits.push(code),
            log: (message: string) => logs.push(message),
            now: () => new Date("2026-10-26T00:00:00Z"),
        }
        return { calls, handlers, logs, exits, masked, credentials, homeDir, tmpRoot, options }
    }

    const securityCalls = (calls: Call[]) =>
        calls.filter((call) => call.command === "security").map((call) => call.args[0])

    const profilePaths = (homeDir: string) => [
        path.join(
            homeDir,
            "Library/Developer/Xcode/UserData/Provisioning Profiles/11111111-2222-3333-4444-555555555555.mobileprovision"
        ),
        path.join(
            homeDir,
            "Library/MobileDevice/Provisioning Profiles/11111111-2222-3333-4444-555555555555.mobileprovision"
        ),
    ]

    it("runs the keychain commands in order and restores the exact search list on cleanup", () => {
        const fake = fakeSigning()
        const result = setupP12Signing(fake.options)

        expect(securityCalls(fake.calls)).toEqual([
            "list-keychains",
            "create-keychain",
            "set-keychain-settings",
            "unlock-keychain",
            "import",
            "set-key-partition-list",
            "list-keychains",
            "find-identity",
            "cms",
        ])
        const keychain = result.keychainPath
        const set = fake.calls.filter((c) => c.args[0] === "list-keychains" && c.args.includes("-s"))
        expect(set[0].args).toEqual(["list-keychains", "-d", "user", "-s", keychain, LOGIN, SYSTEM])
        expect(result.identity.sha1).toBe(SHA)
        expect(result.profile).toMatchObject({ name: "Acme App Store", teamId: "TEAM123456" })
        for (const file of profilePaths(fake.homeDir)) {
            expect(fs.existsSync(file)).toBe(true)
            expect(fs.statSync(file).mode & 0o777).toBe(0o600)
        }
        expect(Object.keys(fake.handlers).sort()).toEqual(["SIGINT", "SIGTERM"])

        const before = fake.calls.length
        result.cleanup()
        const after = fake.calls.slice(before)
        expect(after.map((c) => c.args)).toEqual([
            ["list-keychains", "-d", "user", "-s", LOGIN, SYSTEM],
            ["delete-keychain", keychain],
        ])
        for (const file of profilePaths(fake.homeDir)) expect(fs.existsSync(file)).toBe(false)
        // The folders this created are gone too; nothing else in the fake home.
        expect(fs.readdirSync(fake.homeDir)).toEqual([])
        expect(fs.readdirSync(fake.tmpRoot)).toEqual([])
        expect(fake.handlers).toEqual({})
        // The credentials folder is read, never changed.
        expect(fs.readdirSync(fake.credentials).sort()).toEqual(["dist.p12", "store.mobileprovision"])
        // Idempotent.
        result.cleanup()
        expect(fake.calls.length).toBe(before + 2)
    })

    it("restores the search list and deletes the keychain when a step fails, without leaking the password", () => {
        const fake = fakeSigning({ failOn: "security import" })
        const error = thrown(() => setupP12Signing(fake.options))
        expect(error.code).toBe("IOS-012")
        expect(error.message).not.toContain(P12_PASSWORD)
        const tail = fake.calls.slice(-2).map((c) => c.args.slice(0, 5))
        expect(tail[0]).toEqual(["list-keychains", "-d", "user", "-s", LOGIN])
        expect(fake.calls.at(-2)!.args).toEqual(["list-keychains", "-d", "user", "-s", LOGIN, SYSTEM])
        expect(tail[1][0]).toBe("delete-keychain")
        expect(fs.readdirSync(fake.tmpRoot)).toEqual([])
        expect(fake.handlers).toEqual({})
    })

    it("warns, without the passwords, when a cleanup step fails, and still runs the others", () => {
        const fake = fakeSigning()
        const options = {
            ...fake.options,
            run: (command: string, args: string[]) => {
                if (args[0] === "delete-keychain") {
                    throw Object.assign(
                        new Error(`Command failed: security delete-keychain ${P12_PASSWORD}`),
                        {
                            stderr: "security: SecKeychainDelete: The specified keychain could not be found.",
                        }
                    )
                }
                return fake.options.run(command, args)
            },
        }
        const result = setupP12Signing(options)
        result.cleanup()
        const warning = fake.logs.find((line) =>
            line.includes("Signing cleanup could not delete the temporary keychain")
        )
        expect(warning).toBeDefined()
        expect(warning).not.toContain(P12_PASSWORD)
        // The steps after the failed one still ran.
        for (const file of profilePaths(fake.homeDir)) expect(fs.existsSync(file)).toBe(false)
        expect(fs.readdirSync(fake.tmpRoot)).toEqual([])
    })

    it("cleans up and exits on SIGINT", () => {
        const fake = fakeSigning()
        setupP12Signing(fake.options)
        const before = fake.calls.length
        fake.handlers.SIGINT("SIGINT")
        expect(fake.calls.slice(before).map((c) => c.args[0])).toEqual(["list-keychains", "delete-keychain"])
        expect(fake.calls.at(-2)!.args).toEqual(["list-keychains", "-d", "user", "-s", LOGIN, SYSTEM])
        expect(fake.exits).toEqual([130])
        for (const file of profilePaths(fake.homeDir)) expect(fs.existsSync(file)).toBe(false)
    })

    it("keeps secrets out of logs and passes them only to the security commands that require them", () => {
        const fake = fakeSigning()
        const result = setupP12Signing(fake.options)
        result.cleanup()
        const keychainPassword = fake.calls.find((c) => c.args[0] === "create-keychain")!.args[2]
        expect(keychainPassword.length).toBeGreaterThan(20)
        const carrying = (secret: string) =>
            fake.calls.filter((c) => c.args.includes(secret)).map((c) => c.args[0])
        // security has no environment or stdin form for these; see signing.js.
        expect(carrying(P12_PASSWORD)).toEqual(["import"])
        expect(carrying(keychainPassword)).toEqual([
            "create-keychain",
            "unlock-keychain",
            "set-key-partition-list",
        ])
        // Under GitHub Actions both are masked before any command runs.
        expect(fake.masked).toEqual([P12_PASSWORD, keychainPassword])
        const logged = fake.logs.join("\n")
        expect(logged).not.toContain(P12_PASSWORD)
        expect(logged).not.toContain(keychainPassword)
        expect(logged).toMatch(/Acme App Store/)
    })

    it("leaves a profile the developer already installed in place", () => {
        const fake = fakeSigning()
        const [userData] = profilePaths(fake.homeDir)
        fs.mkdirSync(path.dirname(userData), { recursive: true })
        fs.writeFileSync(userData, "theirs")
        setupP12Signing(fake.options).cleanup()
        expect(fs.readFileSync(userData, "utf8")).toBe("theirs")
    })

    it("rejects a profile for another bundle id, an expired profile, and a p12 with no identity", () => {
        expect(
            thrown(() =>
                setupP12Signing(
                    fakeSigning({
                        profile: { "Entitlements.application-identifier": "TEAM123456.com.other" },
                    }).options
                )
            ).code
        ).toBe("IOS-012")
        expect(
            thrown(() =>
                setupP12Signing(fakeSigning({ profile: { ExpirationDate: "2020-01-01T00:00:00Z" } }).options)
            ).message
        ).toMatch(/expired/)
        const fake = fakeSigning({ identities: "     0 valid identities found\n" })
        expect(thrown(() => setupP12Signing(fake.options)).code).toBe("IOS-012")
        expect(fake.calls.at(-1)!.args[0]).toBe("delete-keychain")
    })
})

describe("export options", () => {
    it("sets the method, team and style, and pins the profile for manual signing", () => {
        expect(
            buildExportOptions({ method: "app-store-connect", teamId: "T", signingStyle: "automatic" })
        ).toEqual({
            method: "app-store-connect",
            signingStyle: "automatic",
            destination: "export",
            stripSwiftSymbols: true,
            teamID: "T",
            uploadSymbols: true,
            manageAppVersionAndBuildNumber: false,
        })
        expect(
            buildExportOptions({
                method: "release-testing",
                teamId: "T",
                signingStyle: "manual",
                bundleId: "com.acme.app",
                profileName: "Acme Ad Hoc",
                signingCertificate: "ABC",
            })
        ).toMatchObject({
            provisioningProfiles: { "com.acme.app": "Acme Ad Hoc" },
            signingCertificate: "ABC",
        })
    })

    it.skipIf(!isMac)("writes a valid plist with special characters escaped", () => {
        const dir = tempDir()
        const file = writeExportOptionsPlist(
            buildExportOptions({
                method: "app-store-connect",
                teamId: "T",
                signingStyle: "manual",
                bundleId: "com.acme.app",
                profileName: 'Acme & <Co> "Store"',
            }),
            path.join(dir, "ExportOptions.plist")
        )
        expect(execFileSync("plutil", ["-lint", file], { encoding: "utf8" })).toMatch(/OK/)
        const xml = fs.readFileSync(file, "utf8")
        expect(xml).toContain("Acme &amp; &lt;Co&gt;")
        expect(
            execFileSync(
                "plutil",
                ["-extract", "provisioningProfiles.com\\.acme\\.app", "raw", "-o", "-", file],
                {
                    encoding: "utf8",
                }
            ).trim()
        ).toBe('Acme & <Co> "Store"')
        expect(fs.readdirSync(dir)).toEqual(["ExportOptions.plist"])
    })
})

describe("signing failures", () => {
    it("recognises xcodebuild's signing errors", () => {
        expect(isSigningFailure('error: Signing for "iosnativeWebView" requires a development team.')).toBe(
            true
        )
        expect(isSigningFailure("error: No profiles for 'com.acme.app' were found")).toBe(true)
        expect(isSigningFailure("error: No Accounts: Add a new account in Accounts settings.")).toBe(true)
        expect(isSigningFailure("error: cannot find 'Foo' in scope")).toBe(false)
    })

    it("wraps one as IOS-010 and keeps the transcript", () => {
        const cause: any = Object.assign(new Error("exit 65"), { output: "requires a development team" })
        const error = signingSetupError("Xcode could not sign the device build", cause)
        expect(error.code).toBe("IOS-010")
        expect(error.output).toBe("requires a development team")
        expect(error.hint).toMatch(/CATALYST_IOS_CREDENTIALS/)
        expect(error.hint).toMatch(/catalyst credentials:export ios/)
        expect(error.hint).not.toMatch(/CATALYST_ASC_|CATALYST_IOS_P12/)
    })
})

describe("generateXCConfig signing and version", () => {
    function phase(iosConfig: Record<string, any>, extra: Record<string, any> = {}) {
        const projectDir = tempDir()
        const statuses: string[] = []
        const { generateXCConfig } = createIosConfigPhase({
            WEBVIEW_CONFIG: { ios: iosConfig },
            iosConfig,
            PROJECT_DIR: projectDir,
            progress: { status: (s: string) => statuses.push(s) },
            ...extra,
        })
        const read = () => fs.readFileSync(path.join(projectDir, "Configurations", "Shared.xcconfig"), "utf8")
        return { generateXCConfig, read }
    }

    it("is Automatic for the configured team with no identity or profile pinned", async () => {
        const { generateXCConfig, read } = phase({
            developmentTeam: "TEAM123456",
            appBundleId: "com.acme.app",
        })
        await generateXCConfig()
        const xcconfig = read()
        expect(xcconfig).toMatch(/^CODE_SIGN_STYLE = Automatic$/m)
        expect(xcconfig).toMatch(/^DEVELOPMENT_TEAM = TEAM123456$/m)
        expect(xcconfig).not.toMatch(/CODE_SIGN_IDENTITY|PROVISIONING_PROFILE_SPECIFIER/)
    })

    it("keeps the manual settings for ios.provisioningProfile", async () => {
        const { generateXCConfig, read } = phase({ provisioningProfile: "Acme Dev", developmentTeam: "T" })
        await generateXCConfig()
        const xcconfig = read()
        expect(xcconfig).toMatch(/^CODE_SIGN_STYLE = Manual$/m)
        expect(xcconfig).toMatch(/^CODE_SIGN_IDENTITY\[sdk=iphoneos\*\] = iPhone Developer$/m)
        expect(xcconfig).toMatch(/^PROVISIONING_PROFILE_SPECIFIER\[sdk=iphoneos\*\] = Acme Dev$/m)
    })

    it("signs a CI release with the imported identity and the profile's team", async () => {
        const { generateXCConfig, read } = phase({ developmentTeam: "" })
        await generateXCConfig({
            signing: {
                style: "manual",
                provisioningProfile: "Acme Store",
                identity: "A".repeat(40),
                teamId: "TEAMCI",
            },
            version: { versionName: "2.5.0-beta.1", buildNumber: 42 },
        })
        const xcconfig = read()
        expect(xcconfig).toMatch(/^DEVELOPMENT_TEAM = TEAMCI$/m)
        expect(xcconfig).toMatch(
            new RegExp(`^CODE_SIGN_IDENTITY\\[sdk=iphoneos\\*\\] = ${"A".repeat(40)}$`, "m")
        )
        expect(xcconfig).toMatch(/^MARKETING_VERSION = 2\.5\.0$/m)
        expect(xcconfig).toMatch(/^CURRENT_PROJECT_VERSION = 42$/m)
    })

    it("takes the resolved version from the build context", async () => {
        const { generateXCConfig, read } = phase({}, { version: { versionName: "3.1", buildNumber: 9 } })
        await generateXCConfig()
        expect(read()).toMatch(/^MARKETING_VERSION = 3\.1$/m)
        expect(read()).toMatch(/^CURRENT_PROJECT_VERSION = 9$/m)
    })
})

describe("updateInfoPlist", () => {
    function infoPlistPhase(extra: Record<string, any> = {}, pluginInfoPlist: Record<string, any> = {}) {
        const projectDir = tempDir()
        const dir = path.join(projectDir, "iosnativeWebView")
        fs.mkdirSync(dir, { recursive: true })
        const debugFile = path.join(dir, "Info.plist")
        const releaseFile = path.join(dir, "Info-Release.plist")
        fs.writeFileSync(
            debugFile,
            JSON.stringify({ NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } })
        )
        fs.writeFileSync(
            releaseFile,
            JSON.stringify({ NSAppTransportSecurity: { NSAllowsArbitraryLoads: false } })
        )
        const { updateInfoPlist } = createIosConfigPhase({
            WEBVIEW_CONFIG: {},
            iosConfig: { appName: "Acme" },
            PROJECT_DIR: projectDir,
            PROJECT_NAME: "iosnativeWebView",
            version: { versionName: "2.5.0-beta.1", buildNumber: 1501234 },
            restoreManagedFileFromBaseline: () => {},
            readPlistObject: (f: string) => JSON.parse(fs.readFileSync(f, "utf8")),
            writePlistObject: (f: string, v: unknown) => fs.writeFileSync(f, JSON.stringify(v)),
            ...extra,
        })
        const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"))
        return {
            run: () => updateInfoPlist({ infoPlist: pluginInfoPlist }),
            debug: () => read(debugFile),
            release: () => read(releaseFile),
        }
    }

    it("writes the version and build number into both plists", async () => {
        const phase = infoPlistPhase()
        await phase.run()
        for (const plist of [phase.debug(), phase.release()]) {
            expect(plist.CFBundleShortVersionString).toBe("2.5.0")
            expect(plist.CFBundleVersion).toBe("1501234")
        }
    })

    it("allows local networking in the debug plist only, when the app loads the dev server", async () => {
        // The template's debug plist allows arbitrary loads; NSAllowsLocalNetworking
        // there would make iOS ignore it, so it is not added.
        const dev = infoPlistPhase({ localNetworking: true })
        await dev.run()
        expect(dev.debug().NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: true })
        expect(dev.release().NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: false })

        // A debug plist without arbitrary loads gets local networking.
        const strict = infoPlistPhase({
            localNetworking: true,
            restoreManagedFileFromBaseline: (file: string) => {
                if (file.endsWith("/Info.plist")) {
                    fs.writeFileSync(
                        file,
                        JSON.stringify({ NSAppTransportSecurity: { NSAllowsArbitraryLoads: false } })
                    )
                }
            },
        })
        await strict.run()
        expect(strict.debug().NSAppTransportSecurity).toEqual({
            NSAllowsArbitraryLoads: false,
            NSAllowsLocalNetworking: true,
        })

        const legacy = infoPlistPhase({ localNetworking: false })
        await legacy.run()
        expect(legacy.debug().NSAppTransportSecurity).not.toHaveProperty("NSAllowsLocalNetworking")
    })

    it("declares no non-exempt encryption in the release plist, unless a plugin says otherwise", async () => {
        const phase = infoPlistPhase()
        await phase.run()
        expect(phase.release().ITSAppUsesNonExemptEncryption).toBe(false)
        expect(phase.debug()).not.toHaveProperty("ITSAppUsesNonExemptEncryption")

        const crypto = infoPlistPhase({}, { ITSAppUsesNonExemptEncryption: true })
        await crypto.run()
        expect(crypto.release().ITSAppUsesNonExemptEncryption).toBe(true)
    })
})

describe("release output", () => {
    it("goes to build-output/ios/<version>-<build> under the app root", () => {
        expect(releaseOutputDir("/apps/shop", { versionName: "1.4.0", buildNumber: 1501234 })).toBe(
            path.resolve("/apps/shop/build-output/ios/1.4.0-1501234")
        )
        expect(releaseOutputDir("/apps/shop", { buildNumber: 7 } as any)).toBe(
            path.resolve("/apps/shop/build-output/ios/1.0.0-7")
        )
    })
})

describe("updateEntitlements", () => {
    function entitlementsPhase(WEBVIEW_CONFIG: Record<string, any>, apsEnvironment?: string) {
        const projectDir = tempDir()
        const file = path.join(projectDir, "iosnativeWebView", "iosnativeWebView.entitlements")
        fs.mkdirSync(path.dirname(file), { recursive: true })
        // A baseline from an older Catalyst, which still carried the key.
        fs.writeFileSync(
            file,
            JSON.stringify({ "aps-environment": "development", "keychain-access-groups": ["x"] })
        )
        const { updateEntitlements } = createIosConfigPhase({
            WEBVIEW_CONFIG,
            iosConfig: {},
            PROJECT_DIR: projectDir,
            PROJECT_NAME: "iosnativeWebView",
            apsEnvironment,
            restoreManagedFileFromBaseline: () => {},
            readPlistObject: (f: string) => JSON.parse(fs.readFileSync(f, "utf8")),
            writePlistObject: (f: string, v: unknown) => fs.writeFileSync(f, JSON.stringify(v)),
        })
        return { updateEntitlements, read: () => JSON.parse(fs.readFileSync(file, "utf8")) }
    }

    it("leaves aps-environment out when notifications are off", async () => {
        const { updateEntitlements, read } = entitlementsPhase({})
        await updateEntitlements()
        expect(read()).toEqual({ "keychain-access-groups": ["x"] })
    })

    it("writes the planned aps-environment when notifications are on", async () => {
        const dev = entitlementsPhase({ notifications: { enabled: true } })
        await dev.updateEntitlements()
        expect(dev.read()["aps-environment"]).toBe("development")
        const prod = entitlementsPhase({ notifications: { enabled: true } }, "production")
        await prod.updateEntitlements()
        expect(prod.read()["aps-environment"]).toBe("production")
    })
})

describe("ConfigConstants", () => {
    it("never emits the App Store Connect key or the export method", async () => {
        const projectDir = tempDir()
        const progress = { start() {}, complete() {}, fail() {}, log() {} }
        const { generateConfigConstants } = createIosConfigPhase({
            WEBVIEW_CONFIG: { port: 3005 },
            iosConfig: {
                appBundleId: "com.acme.app",
                exportMethod: "app-store-connect",
                ascApiKey: { path: "/secret/AuthKey.p8", keyId: "KEY1", issuerId: "issuer" },
            },
            PROJECT_DIR: projectDir,
            PUBLIC_PATH: tempDir(),
            url: "https://www.example.com:443",
            progress,
        })
        await generateConfigConstants()
        const swift = fs.readFileSync(
            path.join(projectDir, "CoreLogic/Sources/CatalystCoreLogic/Constants/ConfigConstants.swift"),
            "utf8"
        )
        expect(swift).toContain('public static let url = "https://www.example.com:443"')
        expect(swift).toContain("appBundleId")
        expect(swift).not.toMatch(/AuthKey|ascApiKey|AscApiKey|exportMethod/)
    })
})

describe("ConfigConstants resolver-only keys", () => {
    it("skips url, appId, appName and allowPrivateHost even when they reach the emitter", async () => {
        const projectDir = tempDir()
        const progress = { start() {}, complete() {}, fail() {}, log() {} }
        const { generateConfigConstants } = createIosConfigPhase({
            WEBVIEW_CONFIG: {
                url: "https://shop.acme.com",
                appId: "com.acme.shop",
                appName: "Acme Shop",
                allowPrivateHost: true,
                LOCAL_IP: "shop.acme.com",
            },
            iosConfig: {},
            PROJECT_DIR: projectDir,
            PUBLIC_PATH: tempDir(),
            url: "https://shop.acme.com",
            progress,
        })
        await generateConfigConstants()
        const swift = fs.readFileSync(
            path.join(projectDir, "CoreLogic/Sources/CatalystCoreLogic/Constants/ConfigConstants.swift"),
            "utf8"
        )
        expect(swift.match(/static let url\b/g)).toHaveLength(1)
        expect(swift).not.toMatch(/static let (appId|appName|allowPrivateHost)\b/)
        expect(swift).toContain('public static let LOCAL_IP = "shop.acme.com"')
    })
})

describe("localhost.p12", () => {
    it("falls back to /usr/bin/openssl when openssl on PATH fails", () => {
        const dest = path.join(tempDir(), "out", "localhost.p12")
        const used: string[] = []
        generateLocalhostP12(dest, {
            run: (command: string, args: string[]) => {
                used.push(`${command} ${args[0]}`)
                if (command === "openssl")
                    throw Object.assign(new Error("boom"), { stderr: "unknown option" })
                const out = args[args.indexOf("-out") + 1]
                fs.writeFileSync(out, "p12")
                return ""
            },
        })
        expect(used).toEqual(["openssl req", "/usr/bin/openssl req", "/usr/bin/openssl pkcs12"])
        expect(fs.readFileSync(dest, "utf8")).toBe("p12")
    })

    it("names openssl's last error line when every openssl fails, and writes nothing", () => {
        const dest = path.join(tempDir(), "out", "localhost.p12")
        const tmpBefore = fs
            .readdirSync(os.tmpdir())
            .filter((n) => n.startsWith("catalyst-localhost-cert-")).length
        expect(() =>
            generateLocalhostP12(dest, {
                run: () => {
                    throw Object.assign(new Error("Command failed"), {
                        stderr: "req: Use -help for summary.\nreq: Unrecognized flag addext\n",
                    })
                },
            })
        ).toThrow("Could not create the localhost certificate with openssl: req: Unrecognized flag addext")
        expect(fs.existsSync(dest)).toBe(false)
        expect(
            fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("catalyst-localhost-cert-")).length
        ).toBe(tmpBefore)
    })

    it.skipIf(!isMac)("writes a localhost identity openssl reads with an empty passphrase", () => {
        const dest = path.join(tempDir(), "localhost.p12")
        generateLocalhostP12(dest)
        const info = execFileSync("openssl", ["pkcs12", "-in", dest, "-passin", "pass:", "-info", "-noout"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        })
        expect(info).toBe("")
        const cert = execFileSync("openssl", ["pkcs12", "-in", dest, "-passin", "pass:", "-nokeys"], {
            encoding: "utf8",
        })
        const text = execFileSync("openssl", ["x509", "-noout", "-subject", "-ext", "subjectAltName"], {
            input: cert,
            encoding: "utf8",
        })
        expect(text).toMatch(/CN\s*=\s*localhost/)
        expect(text).toMatch(/DNS:localhost/)
        expect(text).toMatch(/IP Address:127\.0\.0\.1/)
    })
})

describe("the iOS shell project", () => {
    const pbxproj = fs.readFileSync(path.join(shellDir, "iosnativeWebView.xcodeproj/project.pbxproj"), "utf8")

    it("carries no team, profile or bundle id overrides from the 1mg app", () => {
        expect(pbxproj).not.toMatch(/DEVELOPMENT_TEAM\[sdk=iphoneos\*\]/)
        expect(pbxproj).not.toMatch(/PROVISIONING_PROFILE_SPECIFIER/)
        expect(pbxproj).not.toMatch(/com\.1mg|BHQQRZ69D3|Tata1mgPos/)
    })

    it("bundles PrivacyInfo.xcprivacy and still references the generated localhost.p12", () => {
        const resources = /\/\* Begin PBXResourcesBuildPhase section \*\/[\s\S]*?\);/.exec(pbxproj)![0]
        expect(resources).toContain("PrivacyInfo.xcprivacy in Resources")
        expect(resources).toContain("localhost.p12 in Resources")
        expect(fs.existsSync(path.join(shellDir, "iosnativeWebView/PrivacyInfo.xcprivacy"))).toBe(true)
        expect(fs.readFileSync(path.join(shellDir, ".gitignore"), "utf8")).toMatch(
            /^iosnativeWebView\/localhost\.p12$/m
        )
    })

    it.skipIf(!isMac)("has a valid privacy manifest that declares no tracking", () => {
        const file = path.join(shellDir, "iosnativeWebView/PrivacyInfo.xcprivacy")
        expect(execFileSync("plutil", ["-lint", file], { encoding: "utf8" })).toMatch(/OK/)
        const json = JSON.parse(
            execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" })
        )
        expect(json.NSPrivacyTracking).toBe(false)
        expect(json.NSPrivacyCollectedDataTypes).toEqual([])
        expect(
            json.NSPrivacyAccessedAPITypes.map((entry: any) => entry.NSPrivacyAccessedAPIType).sort()
        ).toEqual([
            "NSPrivacyAccessedAPICategoryFileTimestamp",
            "NSPrivacyAccessedAPICategorySystemBootTime",
            "NSPrivacyAccessedAPICategoryUserDefaults",
        ])
    })

    it("declares no non-exempt encryption in the release plist and keeps local networking out of the template", () => {
        const release = fs.readFileSync(path.join(shellDir, "iosnativeWebView/Info-Release.plist"), "utf8")
        expect(release).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/)
        const debug = fs.readFileSync(path.join(shellDir, "iosnativeWebView/Info.plist"), "utf8")
        expect(debug + release).not.toContain("NSAllowsLocalNetworking")
    })

    it("does not ask for push in the template entitlements", () => {
        const entitlements = fs.readFileSync(
            path.join(shellDir, "iosnativeWebView/iosnativeWebView.entitlements"),
            "utf8"
        )
        expect(entitlements).not.toContain("aps-environment")
    })
})
