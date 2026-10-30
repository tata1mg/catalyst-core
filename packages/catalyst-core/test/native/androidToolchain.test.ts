import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

import {
    AVD_NAME,
    CMDLINE_TOOLS,
    applyJavaHome,
    cleanSdkTemp,
    cmdlineTool,
    cmdlineToolsArchive,
    defaultSdkPath,
    ensureAndroidSdk,
    ensureJava,
    halfInstalledPaths,
    installCmdlineTools,
    installSdkPackages,
    knownAvds,
    missingAndroidPackages,
    parseJavaMajor,
    requiredAndroidPackages,
    resolveJavaHome,
    resolveSdkPath,
    systemImageFor,
} from "../../src/native/androidToolchain.js"

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-android-toolchain-"))
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

/** Mark SDK packages installed the way sdkmanager does: <sdk>/<id with ; as />/package.xml. */
function installPackages(sdk: string, ids: string[]) {
    for (const id of ids) {
        const dir = path.join(sdk, ...id.split(";"))
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, "package.xml"), "<package/>")
    }
}

function installTools(sdk: string) {
    const bin = path.join(sdk, "cmdline-tools", "latest", "bin")
    fs.mkdirSync(bin, { recursive: true })
    for (const tool of ["sdkmanager", "avdmanager"]) fs.writeFileSync(path.join(bin, tool), "")
}

function acceptLicences(sdk: string) {
    fs.mkdirSync(path.join(sdk, "licenses"), { recursive: true })
    fs.writeFileSync(path.join(sdk, "licenses", "android-sdk-license"), "hash")
}

describe("Java resolution", () => {
    it("parses modern and 1.x version strings", () => {
        expect(parseJavaMajor('openjdk version "17.0.9" 2023-10-17')).toBe(17)
        expect(parseJavaMajor('java version "1.8.0_392"')).toBe(8)
        expect(parseJavaMajor('openjdk version "21" 2023-09-19')).toBe(21)
        expect(parseJavaMajor("nonsense")).toBeNull()
    })

    it("skips a JAVA_HOME older than 17 and falls through to java_home", () => {
        const skipped: string[] = []
        const run = (command: string) => {
            if (command === "/usr/libexec/java_home") return "/jdks/zulu-17/Contents/Home\n"
            if (command === "/old/jdk/bin/java") return 'openjdk version "11.0.2"'
            if (command === "/jdks/zulu-17/Contents/Home/bin/java") return 'openjdk version "17.0.12"'
            return null
        }
        const java = resolveJavaHome({
            env: { JAVA_HOME: "/old/jdk" },
            platform: "darwin",
            run,
            exists: () => true,
            onSkip: (candidate) => skipped.push(candidate),
        })
        expect(java).toEqual({ home: "/jdks/zulu-17/Contents/Home", version: 17, source: "java_home" })
        expect(skipped[0]).toBe("/old/jdk")
    })

    it("skips a JDK newer than 23 with a reason, and prefers 21 over 17", () => {
        const skipped: Array<[string, string]> = []
        const versions: Record<string, string> = {
            "/jdk25/bin/java": 'openjdk version "25" 2025-09-16',
            "/jdk17/bin/java": 'openjdk version "17.0.12"',
            "/jdk21/bin/java": 'openjdk version "21.0.4"',
        }
        const run = (command: string, args: string[]) => {
            if (command === "/usr/libexec/java_home") {
                return { "21": "/jdk21\n", "17": "/jdk17\n", "17+": "/jdk25\n" }[args[1]] ?? null
            }
            return versions[command] ?? null
        }
        const java = resolveJavaHome({
            env: { JAVA_HOME: "/jdk25" },
            platform: "darwin",
            run,
            exists: (file) => file in versions,
            onSkip: (candidate, reason) => skipped.push([candidate, reason]),
        })
        expect(java).toEqual({ home: "/jdk21", version: 21, source: "java_home" })
        expect(skipped).toEqual([["/jdk25", expect.stringContaining("newer than Gradle 8.13 supports")]])
    })

    it("takes 17 over another in-range JDK, and nothing when only 24+ is installed", () => {
        const versions: Record<string, string> = {
            "/jdk22/bin/java": 'openjdk version "22.0.1"',
            "/jdk17/bin/java": 'openjdk version "17.0.12"',
        }
        const pick = (javaHome: string, others: string[]) =>
            resolveJavaHome({
                env: { JAVA_HOME: javaHome },
                platform: "linux",
                run: (command: string) =>
                    command === "sh" ? `${others[0] || ""}/bin/java` : (versions[command] ?? null),
                exists: (file) => file in versions,
            })
        expect(pick("/jdk22", ["/jdk17"])).toMatchObject({ home: "/jdk17", version: 17 })
        expect(
            resolveJavaHome({
                env: { JAVA_HOME: "/jdk24" },
                platform: "linux",
                run: () => 'openjdk version "24"',
                exists: (file) => file === "/jdk24/bin/java",
            })
        ).toBeNull()
    })

    it("uses Android Studio's bundled JBR when nothing else is there", () => {
        const jbr = "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
        const java = resolveJavaHome({
            env: {},
            platform: "darwin",
            run: (command) => (command === `${jbr}/bin/java` ? 'openjdk version "21.0.6"' : null),
            exists: (file) => file === `${jbr}/bin/java`,
        })
        expect(java).toMatchObject({ home: jbr, version: 21, source: "Android Studio" })
    })

    it("returns null with no JDK 17+", () => {
        expect(
            resolveJavaHome({ env: {}, platform: "darwin", run: () => null, exists: () => false })
        ).toBeNull()
    })

    it("points JAVA_HOME and PATH at the JDK without duplicating it", () => {
        const env: Record<string, string> = { PATH: ["/usr/bin", "/bin"].join(path.delimiter) }
        applyJavaHome({ home: "/jdk", version: 17, source: "JAVA_HOME" }, env)
        applyJavaHome({ home: "/jdk", version: 17, source: "JAVA_HOME" }, env)
        expect(env.JAVA_HOME).toBe("/jdk")
        expect(env.PATH.split(path.delimiter)).toEqual([path.join("/jdk", "bin"), "/usr/bin", "/bin"])
    })

    it("fails with NATIVE-005 naming --yes without a terminal, and never installs", async () => {
        const installs: string[][] = []
        const error = await rejection(
            ensureJava({
                platform: "darwin",
                isTTY: false,
                hasCommand: () => true,
                resolve: () => null,
                runInherited: async (_command: string, args: string[]) => void installs.push(args),
            })
        )
        expect(error.code).toBe("NATIVE-005")
        expect(error.message).toContain("--yes")
        expect(installs).toEqual([])
    })

    it("installs with --yes and no terminal", async () => {
        let installed = false
        const java = await ensureJava({
            platform: "darwin",
            flags: { yes: true },
            isTTY: false,
            hasCommand: () => true,
            resolve: () => (installed ? { home: "/zulu", version: 17, source: "java_home" } : null),
            runInherited: async () => {
                installed = true
            },
        })
        expect(java.home).toBe("/zulu")
    })

    it("fails with ANDROID-007 when the install is declined or Homebrew is missing", async () => {
        const declined = await rejection(
            ensureJava({
                platform: "darwin",
                isTTY: true,
                hasCommand: () => true,
                ask: async () => false,
                resolve: () => null,
            })
        )
        expect(declined.code).toBe("ANDROID-007")
        const noBrew = await rejection(
            ensureJava({ platform: "darwin", isTTY: true, hasCommand: () => false, resolve: () => null })
        )
        expect(noBrew.code).toBe("ANDROID-007")
    })

    it("fails with ANDROID-007 on Linux, naming a package to install", async () => {
        const error = await rejection(ensureJava({ platform: "linux", isTTY: true, resolve: () => null }))
        expect(error.code).toBe("ANDROID-007")
        expect(error.message).toContain("openjdk-17-jdk")
    })

    it("installs Zulu 17 with Homebrew after a terminal yes", async () => {
        let installed = false
        const calls: string[][] = []
        const java = await ensureJava({
            platform: "darwin",
            isTTY: true,
            hasCommand: () => true,
            ask: async () => true,
            resolve: () => (installed ? { home: "/zulu", version: 17, source: "java_home" } : null),
            runInherited: async (command: string, args: string[]) => {
                calls.push([command, ...args])
                installed = true
            },
        })
        expect(calls).toEqual([["brew", "install", "--cask", "zulu@17"]])
        expect(java.home).toBe("/zulu")
    })
})

describe("SDK packages", () => {
    it("picks the system image ABI from the CPU", () => {
        expect(systemImageFor("arm64")).toBe("system-images;android-36;google_apis;arm64-v8a")
        expect(systemImageFor("x64")).toBe("system-images;android-36;google_apis;x86_64")
    })

    it("needs the system image only when an emulator is to be created", () => {
        expect(requiredAndroidPackages({ arch: "arm64" })).toEqual([
            "platform-tools",
            "emulator",
            "platforms;android-36",
            "build-tools;36.0.0",
        ])
        expect(requiredAndroidPackages({ arch: "x64", withSystemImage: true })).toContain(
            "system-images;android-36;google_apis;x86_64"
        )
    })

    it("leaves the emulator out for a release or a connected phone", () => {
        expect(requiredAndroidPackages({ arch: "arm64", withEmulator: false })).toEqual([
            "platform-tools",
            "platforms;android-36",
            "build-tools;36.0.0",
        ])
    })

    it("reads the SDK path from config, then the environment, and never prompts", () => {
        expect(resolveSdkPath({ sdkPath: "/custom/sdk" }, {})).toBe("/custom/sdk")
        expect(resolveSdkPath({ sdkPath: "~/sdk" }, {})).toBe(path.join(os.homedir(), "sdk"))
        const home = tempDir()
        fs.mkdirSync(path.join(home, "platform-tools"))
        fs.writeFileSync(path.join(home, "platform-tools", "adb"), "")
        expect(resolveSdkPath({}, { ANDROID_HOME: home })).toBe(home)
    })

    it("finds what is missing from package.xml files", () => {
        const sdk = tempDir()
        installPackages(sdk, ["platform-tools", "platforms;android-36"])
        expect(missingAndroidPackages(sdk, requiredAndroidPackages())).toEqual([
            "emulator",
            "build-tools;36.0.0",
        ])
    })

    it("pins an archive with a SHA-256 for each host", () => {
        expect(cmdlineToolsArchive("darwin", "arm64").url).toBe(
            `https://dl.google.com/android/repository/commandlinetools-mac_arm64-${CMDLINE_TOOLS.build}_latest.zip`
        )
        expect(cmdlineToolsArchive("darwin", "x64").file).toContain("mac_x86_64")
        expect(cmdlineToolsArchive("linux", "x64").file).toContain("linux")
        for (const archive of Object.values(CMDLINE_TOOLS.archives))
            expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/)
    })
})

describe("installCmdlineTools", () => {
    const payload = Buffer.from("pretend zip")
    const archive = {
        file: "commandlinetools-test.zip",
        url: "https://example.invalid/tools.zip",
        sha256: crypto.createHash("sha256").update(payload).digest("hex"),
    }
    const download = async (_url: string, dest: string) => fs.writeFileSync(dest, payload)
    const unzip = (_zip: string, dest: string) => {
        fs.mkdirSync(path.join(dest, "cmdline-tools", "bin"), { recursive: true })
        fs.writeFileSync(path.join(dest, "cmdline-tools", "bin", "sdkmanager"), "")
    }

    it("verifies the checksum and unpacks into cmdline-tools/latest", async () => {
        const sdk = tempDir()
        const latest = await installCmdlineTools(sdk, { archive, download, unzip })
        expect(latest).toBe(path.join(sdk, "cmdline-tools", "latest"))
        expect(fs.existsSync(path.join(latest, "bin", "sdkmanager"))).toBe(true)
        // No staging folders are left behind.
        expect(fs.readdirSync(path.join(sdk, "cmdline-tools"))).toEqual(["latest"])
    })

    it("fails with ANDROID-009 on a checksum mismatch and unpacks nothing", async () => {
        const sdk = tempDir()
        const error = await rejection(
            installCmdlineTools(sdk, { archive: { ...archive, sha256: "0".repeat(64) }, download, unzip })
        )
        expect(error.code).toBe("ANDROID-009")
        expect(error.message).toContain("SHA-256")
        expect(fs.existsSync(path.join(sdk, "cmdline-tools", "latest"))).toBe(false)
    })

    it("fails with ANDROID-009 when the archive does not unpack, or has no cmdline-tools folder", async () => {
        const sdk = tempDir()
        const broken = await rejection(
            installCmdlineTools(sdk, {
                archive,
                download,
                unzip: () => {
                    throw Object.assign(new Error("Command failed: unzip"), {
                        stderr: "End-of-central-directory signature not found",
                    })
                },
            })
        )
        expect(broken.code).toBe("ANDROID-009")
        expect(broken.message).toContain("could not unpack commandlinetools-test.zip")
        expect(broken.message).toContain("End-of-central-directory")

        const empty = await rejection(installCmdlineTools(sdk, { archive, download, unzip: () => {} }))
        expect(empty.code).toBe("ANDROID-009")
        expect(empty.message).toContain("has no cmdline-tools folder")
        // Neither failure leaves a staging folder or a half-made latest/.
        expect(fs.readdirSync(path.join(sdk, "cmdline-tools"))).toEqual([])
    })

    it("fails with ANDROID-009 when the download fails", async () => {
        const error = await rejection(
            installCmdlineTools(tempDir(), {
                archive,
                download: async () => {
                    throw Object.assign(new Error("Command failed with exit code 6"), {
                        output: "curl: (6) Could not resolve host",
                    })
                },
                unzip,
            })
        )
        expect(error.code).toBe("ANDROID-009")
        expect(error.message).toContain("Could not resolve host")
    })
})

describe("SDK locations", () => {
    it("puts a new SDK at ANDROID_HOME, ANDROID_SDK_ROOT, or the platform default", () => {
        expect(defaultSdkPath({ ANDROID_HOME: "/a", ANDROID_SDK_ROOT: "/b" }, "linux")).toBe("/a")
        expect(defaultSdkPath({ ANDROID_SDK_ROOT: "/b" }, "linux")).toBe("/b")
        expect(defaultSdkPath({}, "darwin")).toBe(path.join(os.homedir(), "Library", "Android", "sdk"))
        expect(defaultSdkPath({}, "linux")).toBe(path.join(os.homedir(), "Android", "Sdk"))
    })

    it("finds sdkmanager in cmdline-tools/latest, else the newest versioned folder, else nothing", () => {
        const sdk = tempDir()
        expect(cmdlineTool(sdk, "sdkmanager", { platform: "linux" })).toBeNull()
        for (const version of ["9.0", "11.0"]) {
            fs.mkdirSync(path.join(sdk, "cmdline-tools", version, "bin"), { recursive: true })
        }
        expect(cmdlineTool(sdk, "sdkmanager", { platform: "linux" })).toBeNull()
        fs.writeFileSync(path.join(sdk, "cmdline-tools", "9.0", "bin", "sdkmanager"), "")
        fs.writeFileSync(path.join(sdk, "cmdline-tools", "11.0", "bin", "sdkmanager.bat"), "")
        expect(cmdlineTool(sdk, "sdkmanager", { platform: "linux" })).toBe(
            path.join(sdk, "cmdline-tools", "9.0", "bin", "sdkmanager")
        )
        expect(cmdlineTool(sdk, "sdkmanager", { platform: "win32" })).toBe(
            path.join(sdk, "cmdline-tools", "11.0", "bin", "sdkmanager.bat")
        )
    })

    it("knows AVDs from the AVD folder when the emulator is not installed yet", () => {
        const avdHome = tempDir()
        fs.writeFileSync(path.join(avdHome, "Pixel_8.ini"), "")
        fs.mkdirSync(path.join(avdHome, "Pixel_8.avd"))
        fs.writeFileSync(path.join(avdHome, "notes.txt"), "")
        // The SDK has no emulator binary, so only the folder answers.
        const sdk = tempDir()
        expect(knownAvds(sdk, { env: { ANDROID_AVD_HOME: avdHome } })).toEqual(["Pixel_8"])

        const userHome = tempDir()
        fs.mkdirSync(path.join(userHome, "avd"))
        fs.writeFileSync(path.join(userHome, "avd", "Tablet.ini"), "")
        expect(knownAvds(sdk, { env: { ANDROID_USER_HOME: userHome } })).toEqual(["Tablet"])

        expect(knownAvds(sdk, { env: { ANDROID_AVD_HOME: path.join(avdHome, "missing") } })).toEqual([])
    })
})

describe("ensureAndroidSdk", () => {
    const base = ["platform-tools", "emulator", "platforms;android-36", "build-tools;36.0.0"]
    const image = systemImageFor("arm64")

    function fakes(sdk: string) {
        const calls: Array<{ how: string; command: string; args: string[]; responses?: object }> = []
        const deps = {
            run: async (command: string, args: string[], responses?: object) => {
                calls.push({ how: "captured", command: path.basename(command), args, responses })
                if (args.includes("--licenses")) acceptLicences(sdk)
                const ids = args.filter((arg) => !arg.startsWith("-") && arg !== "create" && arg !== "avd")
                if (path.basename(command) === "sdkmanager") installPackages(sdk, ids)
                return ""
            },
            runInherited: async (command: string, args: string[]) => {
                calls.push({ how: "inherited", command: path.basename(command), args })
                if (args.includes("--licenses")) acceptLicences(sdk)
                else
                    installPackages(
                        sdk,
                        args.filter((arg) => !arg.startsWith("-"))
                    )
            },
            installTools: async (dir: string) => installTools(dir),
        }
        return { calls, deps }
    }

    it("does nothing when everything is installed and the AVD exists", async () => {
        const sdk = tempDir()
        installPackages(sdk, base)
        const { calls, deps } = fakes(sdk)
        const result = await ensureAndroidSdk({
            sdkPath: sdk,
            emulatorName: "Pixel_7",
            isTTY: false,
            arch: "arm64",
            ...deps,
            listAvds: () => ["Pixel_7"],
        })
        expect(result).toEqual({ sdkPath: sdk, emulatorName: "Pixel_7", installed: [], createdAvd: false })
        expect(calls).toEqual([])
    })

    it("reuses an existing AVD instead of downloading an image when none is configured", async () => {
        const sdk = tempDir()
        installPackages(sdk, base)
        const result = await ensureAndroidSdk({
            sdkPath: sdk,
            isTTY: false,
            arch: "arm64",
            listAvds: () => ["Medium_Phone"],
            ...fakes(sdk).deps,
        })
        expect(result.emulatorName).toBe("Medium_Phone")
        expect(result.createdAvd).toBe(false)
    })

    it("fails with NATIVE-005 without a terminal or --yes, listing what it would fetch", async () => {
        const sdk = tempDir()
        const { calls, deps } = fakes(sdk)
        const error = await rejection(
            ensureAndroidSdk({ sdkPath: sdk, isTTY: false, arch: "arm64", listAvds: () => [], ...deps })
        )
        expect(error.code).toBe("NATIVE-005")
        expect(error.message).toContain("Android command-line tools")
        expect(error.message).toContain(image)
        expect(error.message).toContain("--yes")
        expect(calls).toEqual([])
    })

    it("fails with NATIVE-005 naming --accept-licenses when only --yes is given in CI", async () => {
        const sdk = tempDir()
        const error = await rejection(
            ensureAndroidSdk({
                sdkPath: sdk,
                flags: { yes: true },
                isTTY: false,
                arch: "arm64",
                listAvds: () => [],
                ...fakes(sdk).deps,
            })
        )
        expect(error.code).toBe("NATIVE-005")
        expect(error.message).toContain("--accept-licenses")
    })

    it("installs from nothing in CI with --yes --accept-licenses and creates the AVD", async () => {
        const sdk = tempDir()
        const { calls, deps } = fakes(sdk)
        const result = await ensureAndroidSdk({
            sdkPath: sdk,
            flags: { yes: true, acceptLicenses: true },
            isTTY: false,
            arch: "arm64",
            listAvds: () => [],
            ...deps,
        })
        expect(result).toMatchObject({
            emulatorName: AVD_NAME,
            createdAvd: true,
            installed: [...base, image],
        })
        expect(
            calls.map((call) => [
                call.how,
                call.command,
                call.args.filter((a) => !a.startsWith("--sdk_root")),
            ])
        ).toEqual([
            ["captured", "sdkmanager", ["--licenses"]],
            ["captured", "sdkmanager", [...base, image]],
            ["captured", "avdmanager", ["create", "avd", "-n", AVD_NAME, "-k", image, "-d", "pixel_7"]],
        ])
        // Licences were accepted by flag, so sdkmanager may answer yes for later ones too.
        expect(calls[1].responses).toEqual({ "(y/N)": "y" })
    })

    it("asks once in a terminal, then runs licences and installs on the user's terminal", async () => {
        const sdk = tempDir()
        installPackages(sdk, ["platform-tools", "emulator", "platforms;android-36"])
        installTools(sdk)
        const questions: string[] = []
        const { calls, deps } = fakes(sdk)
        const result = await ensureAndroidSdk({
            sdkPath: sdk,
            emulatorName: "Pixel_7",
            isTTY: true,
            arch: "arm64",
            ask: async (kind: string) => {
                questions.push(kind)
                return true
            },
            listAvds: () => ["Pixel_7"],
            ...deps,
        })
        // One question for the download, one for the licences sdkmanager then shows.
        expect(questions).toEqual(["install", "licence"])
        expect(result).toMatchObject({
            emulatorName: "Pixel_7",
            installed: ["build-tools;36.0.0"],
            createdAvd: false,
        })
        expect(calls.map((call) => call.how)).toEqual(["inherited", "inherited"])
    })

    it("fails with ANDROID-008 when the terminal user declines", async () => {
        const sdk = tempDir()
        const error = await rejection(
            ensureAndroidSdk({
                sdkPath: sdk,
                isTTY: true,
                arch: "arm64",
                ask: async () => false,
                listAvds: () => [],
                ...fakes(sdk).deps,
            })
        )
        expect(error.code).toBe("ANDROID-008")
    })

    it("needs no emulator or AVD for a release or a connected phone", async () => {
        const sdk = tempDir()
        installPackages(sdk, ["platform-tools", "platforms;android-36", "build-tools;36.0.0"])
        const { calls, deps } = fakes(sdk)
        const result = await ensureAndroidSdk({
            sdkPath: sdk,
            needEmulator: false,
            isTTY: false,
            arch: "arm64",
            ...deps,
            listAvds: () => [],
        })
        expect(result).toEqual({ sdkPath: sdk, emulatorName: null, installed: [], createdAvd: false })
        expect(calls).toEqual([])
    })

    it("reuses the last AVD before any other, without asking", async () => {
        const sdk = tempDir()
        installPackages(sdk, base)
        const result = await ensureAndroidSdk({
            sdkPath: sdk,
            preferredAvd: "Tablet",
            isTTY: true,
            arch: "arm64",
            ask: async () => {
                throw new Error("should not ask")
            },
            listAvds: () => ["Phone", "Tablet"],
            ...fakes(sdk).deps,
        })
        expect(result.emulatorName).toBe("Tablet")
    })

    it("replaces a configured AVD that does not exist with catalyst-api36", async () => {
        const sdk = tempDir()
        installPackages(sdk, [...base, image])
        installTools(sdk)
        const logs: string[] = []
        const result = await ensureAndroidSdk({
            sdkPath: sdk,
            emulatorName: "Gone_Phone",
            flags: { yes: true },
            isTTY: false,
            arch: "arm64",
            listAvds: () => [],
            log: (message: string) => logs.push(message),
            ...fakes(sdk).deps,
        })
        expect(result).toMatchObject({ emulatorName: AVD_NAME, createdAvd: true, installed: [] })
        expect(logs.some((line) => line.includes('"Gone_Phone" does not exist'))).toBe(true)
    })
})

describe("ensureAndroidSdk failures after consent", () => {
    const ci = { flags: { yes: true, acceptLicenses: true }, isTTY: false, arch: "arm64" }

    it("fails with ANDROID-009 when the tools install leaves no sdkmanager", async () => {
        const sdk = tempDir()
        const error = await rejection(
            ensureAndroidSdk({
                sdkPath: sdk,
                ...ci,
                listAvds: () => [],
                installTools: async () => {},
                run: async () => "",
            })
        )
        expect(error.code).toBe("ANDROID-009")
        expect(error.message).toContain("no sdkmanager under")
    })

    it("fails with ANDROID-008 when sdkmanager --licenses does not record the licence", async () => {
        const sdk = tempDir()
        installTools(sdk)
        const ran: string[][] = []
        const error = await rejection(
            ensureAndroidSdk({
                sdkPath: sdk,
                ...ci,
                listAvds: () => ["Pixel_7"],
                emulatorName: "Pixel_7",
                run: async (_command: string, args: string[]) => {
                    ran.push(args)
                    return ""
                },
            })
        )
        expect(error.code).toBe("ANDROID-008")
        expect(error.message).toContain("licences were not accepted")
        expect(ran).toHaveLength(1)
        expect(ran[0]).toContain("--licenses")
    })

    it("fails with ANDROID-009 when an AVD is needed and there is no avdmanager", async () => {
        const sdk = tempDir()
        const bin = path.join(sdk, "cmdline-tools", "latest", "bin")
        fs.mkdirSync(bin, { recursive: true })
        fs.writeFileSync(path.join(bin, "sdkmanager"), "")
        acceptLicences(sdk)
        const error = await rejection(
            ensureAndroidSdk({
                sdkPath: sdk,
                ...ci,
                listAvds: () => [],
                run: async (command: string, args: string[]) => {
                    if (path.basename(command) === "sdkmanager") {
                        installPackages(
                            sdk,
                            args.filter((arg) => !arg.startsWith("-"))
                        )
                    }
                    return ""
                },
            })
        )
        expect(error.code).toBe("ANDROID-009")
        expect(error.message).toContain("no avdmanager under")
    })
})

describe("sdkmanager recovery (#301)", () => {
    it("removes stale partial downloads under <sdk>/.temp", () => {
        const sdk = tempDir()
        fs.mkdirSync(path.join(sdk, ".temp", "PackageOperation01"), { recursive: true })
        fs.writeFileSync(path.join(sdk, ".temp", "PackageOperation01", "emulator.zip"), "partial")
        const logs: string[] = []
        expect(cleanSdkTemp(sdk, { log: (message: string) => logs.push(message) })).toEqual([
            "PackageOperation01",
        ])
        expect(fs.readdirSync(path.join(sdk, ".temp"))).toEqual([])
        expect(logs).toHaveLength(1)
        expect(cleanSdkTemp(tempDir())).toEqual([])
    })

    it("finds half-installed folders, and only package folders inside the SDK", () => {
        const sdk = tempDir()
        installPackages(sdk, ["platforms;android-36"])
        fs.mkdirSync(path.join(sdk, "emulator"))
        const output = [
            `Warning: java.nio.file.FileAlreadyExistsException: ${path.join(sdk, "build-tools", "36.0.0")}`,
            `java.nio.file.FileAlreadyExistsException: ${path.join(sdk, "platforms")}`,
            "java.nio.file.FileAlreadyExistsException: /etc",
        ].join("\n")
        const ids = ["emulator", "platforms;android-36", "build-tools;36.0.0"]
        expect(halfInstalledPaths(sdk, ids, output).sort()).toEqual(
            [path.join(sdk, "build-tools", "36.0.0"), path.join(sdk, "emulator")].sort()
        )
    })

    it("cleans a half-installed package after FileAlreadyExistsException and retries once", async () => {
        const sdk = tempDir()
        let runs = 0
        await installSdkPackages(sdk, ["emulator"], async () => {
            runs++
            fs.mkdirSync(path.join(sdk, ".temp", `op${runs}`), { recursive: true })
            if (runs === 1) {
                fs.mkdirSync(path.join(sdk, "emulator", "lib"), { recursive: true })
                throw Object.assign(new Error("exit 1"), {
                    output: `java.nio.file.FileAlreadyExistsException: ${path.join(sdk, "emulator", "lib")}`,
                })
            }
            expect(fs.existsSync(path.join(sdk, "emulator"))).toBe(false)
            installPackages(sdk, ["emulator"])
            return ""
        })
        expect(runs).toBe(2)
        expect(fs.readdirSync(path.join(sdk, ".temp"))).toEqual(["op2"])
    })

    it("retries only once, and not at all for an unrelated failure", async () => {
        const sdk = tempDir()
        let runs = 0
        const stuck = await rejection(
            installSdkPackages(sdk, ["emulator"], async () => {
                runs++
                fs.mkdirSync(path.join(sdk, "emulator"), { recursive: true })
                return "Warning: java.nio.file.FileAlreadyExistsException"
            })
        )
        expect(runs).toBe(2)
        expect(stuck.message).toContain("did not install emulator")

        runs = 0
        const network = await rejection(
            installSdkPackages(tempDir(), ["emulator"], async () => {
                runs++
                throw Object.assign(new Error("exit 1"), { output: "Failed to download" })
            })
        )
        expect(runs).toBe(1)
        expect(network.message).toBe("exit 1")
    })
})
