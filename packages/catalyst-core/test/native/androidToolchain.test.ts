import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

import {
    AVD_NAME,
    CMDLINE_TOOLS,
    applyJavaHome,
    cmdlineToolsArchive,
    ensureAndroidSdk,
    ensureJava,
    installCmdlineTools,
    missingAndroidPackages,
    parseJavaMajor,
    requiredAndroidPackages,
    resolveJavaHome,
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
        expect(skipped).toEqual(["/old/jdk"])
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

    it("fails with ANDROID-007 without a terminal, and never installs", async () => {
        const installs: string[][] = []
        const error = await rejection(
            ensureJava({
                platform: "darwin",
                isTTY: false,
                resolve: () => null,
                runInherited: async (_command: string, args: string[]) => void installs.push(args),
            })
        )
        expect(error.code).toBe("ANDROID-007")
        expect(installs).toEqual([])
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
            confirm: async () => true,
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

    it("fails with ANDROID-008 without a terminal or --yes, listing what it would fetch", async () => {
        const sdk = tempDir()
        const { calls, deps } = fakes(sdk)
        const error = await rejection(
            ensureAndroidSdk({ sdkPath: sdk, isTTY: false, arch: "arm64", listAvds: () => [], ...deps })
        )
        expect(error.code).toBe("ANDROID-008")
        expect(error.message).toContain("Android command-line tools")
        expect(error.message).toContain(image)
        expect(calls).toEqual([])
    })

    it("fails with ANDROID-008 when the licences are not accepted in CI", async () => {
        const sdk = tempDir()
        const error = await rejection(
            ensureAndroidSdk({
                sdkPath: sdk,
                yes: true,
                isTTY: false,
                arch: "arm64",
                listAvds: () => [],
                ...fakes(sdk).deps,
            })
        )
        expect(error.code).toBe("ANDROID-008")
        expect(error.message).toContain("--accept-licenses")
    })

    it("installs from nothing in CI with --yes --accept-licenses and creates the AVD", async () => {
        const sdk = tempDir()
        const { calls, deps } = fakes(sdk)
        const result = await ensureAndroidSdk({
            sdkPath: sdk,
            yes: true,
            acceptLicenses: true,
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
            confirm: async (question: string) => {
                questions.push(question)
                return true
            },
            listAvds: () => ["Pixel_7"],
            ...deps,
        })
        expect(questions).toHaveLength(1)
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
                confirm: async () => false,
                listAvds: () => [],
                ...fakes(sdk).deps,
            })
        )
        expect(error.code).toBe("ANDROID-008")
    })

    it("replaces a configured AVD that does not exist with catalyst-api36", async () => {
        const sdk = tempDir()
        installPackages(sdk, [...base, image])
        installTools(sdk)
        const logs: string[] = []
        const result = await ensureAndroidSdk({
            sdkPath: sdk,
            emulatorName: "Gone_Phone",
            yes: true,
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
