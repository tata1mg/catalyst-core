import { execFileSync, execSync, spawn } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import readline from "readline"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// utils.js is ESM, so it is imported here the same way redactSecrets.test.ts
// imports it: one module copy for v8 coverage to merge.
//
// execSync, execFileSync and spawn are wrapped so each test can fake a tool's answer, while
// anything a test does not stub still runs for real (node itself, never adb
// or an emulator).
vi.mock("child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("child_process")>()
    return {
        ...actual,
        default: actual,
        execSync: vi.fn(actual.execSync),
        execFileSync: vi.fn(actual.execFileSync),
        spawn: vi.fn(actual.spawn),
    }
})

import {
    ANDROID_SDK_HINT,
    commandExists,
    detectAndroidSdk,
    ensureLocalProperties,
    listAvds,
    promptUser,
    redactError,
    redactSecrets,
    runCommand,
    runFile,
    runInheritedCommand,
    runInteractiveCommand,
} from "../../src/native/utils.js"

const mockedExec = vi.mocked(execSync)
const mockedExecFile = vi.mocked(execFileSync)
const mockedSpawn = vi.mocked(spawn)
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g")
const plain = (text: unknown) => String(text).replace(ANSI, "")

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-native-utils-"))
    temps.push(dir)
    return dir
}

/** A directory laid out like an SDK: what detectAndroidSdk checks for. */
function fakeSdk() {
    const sdk = tempDir()
    fs.mkdirSync(path.join(sdk, "platform-tools"))
    fs.writeFileSync(path.join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb"), "")
    return sdk
}

function setTTY(value: boolean | undefined) {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true })
}

const originalTTY = process.stdin.isTTY

beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    // mockReset puts back the real implementation vi.fn was given.
    mockedExec.mockReset()
    mockedExecFile.mockReset()
    mockedSpawn.mockReset()
    setTTY(originalTTY)
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("runCommand", () => {
    it("returns the command's stdout with stderr captured, not inherited", () => {
        expect(runCommand("echo hello")).toBe("hello\n")
        expect(mockedExec).toHaveBeenCalledWith("echo hello", {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: undefined,
        })
    })

    it("logs the failing command with its passwords redacted and rethrows", () => {
        const failure = Object.assign(new Error("Command failed: keytool -storepass hunter2"), { status: 1 })
        mockedExec.mockImplementationOnce(() => {
            throw failure
        })

        expect(() => runCommand("keytool -storepass hunter2")).toThrow(failure)
        expect(failure.message).toBe("Command failed: keytool -storepass ***")
        const logged = vi.mocked(console.error).mock.calls.flat().join("\n")
        expect(logged).toContain("Error executing command: keytool -storepass ***")
        expect(logged).not.toContain("hunter2")
    })

    it("turns an adb timeout into a named error with the reset that clears it", () => {
        mockedExec.mockImplementationOnce(() => {
            throw Object.assign(new Error("spawnSync /bin/sh ETIMEDOUT"), { code: "ETIMEDOUT" })
        })

        let error: any
        try {
            runCommand('"/sdk/platform-tools/adb" devices', { timeout: 10000 })
        } catch (caught) {
            error = caught
        }
        expect(error.message).toBe("adb did not respond within 10s")
        expect(error.code).toBe("ETOOLTIMEOUT")
        expect(error.hint).toContain("adb kill-server && adb start-server")
        expect(console.error).not.toHaveBeenCalled()
    })

    it("recognises a timeout reported as a SIGTERM kill, with tool-specific hints", () => {
        const killed = () => {
            throw Object.assign(new Error("killed"), { signal: "SIGTERM", status: null })
        }
        const timeoutOf = (command: string) => {
            mockedExec.mockImplementationOnce(killed)
            try {
                runCommand(command, { timeout: 2500 })
            } catch (error: any) {
                return error
            }
        }

        const xcrun = timeoutOf("xcrun devicectl list devices")
        expect(xcrun.message).toBe("xcrun did not respond within 3s")
        expect(xcrun.hint).toContain("Quit Xcode and Simulator")

        const other = timeoutOf("  /usr/bin/java -version")
        expect(other.message).toBe("java did not respond within 3s")
        expect(other.hint).toBe("Check that java works on its own, then retry.")
    })

    it("does not treat a SIGTERM as a timeout when no timeout was asked for", () => {
        const killed = Object.assign(new Error("killed"), { signal: "SIGTERM", status: null })
        mockedExec.mockImplementationOnce(() => {
            throw killed
        })
        expect(() => runCommand("adb devices")).toThrow(killed)
    })
})

describe("runFile", () => {
    it("runs the program with an argv array and no shell", () => {
        mockedExecFile.mockImplementationOnce(() => "List of devices attached\n" as any)
        const adb = "/sdk dir/$(touch x)/adb"
        expect(runFile(adb, ["devices"], { timeout: 15000 })).toBe("List of devices attached\n")
        expect(mockedExecFile).toHaveBeenCalledWith(adb, ["devices"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 15000,
        })
        expect(mockedExec).not.toHaveBeenCalled()
    })

    it("refuses an empty path or one with a NUL or line break", () => {
        for (const bad of ["", "   ", "/sdk/adb\nrm -rf /", "/sdk/adb\u0000", undefined]) {
            expect(() => runFile(bad as any, ["version"])).toThrow(/Not a valid tool path/)
        }
        expect(mockedExecFile).not.toHaveBeenCalled()
    })

    it("names the tool on a timeout, even when its folder has spaces", () => {
        mockedExecFile.mockImplementationOnce(() => {
            throw Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" })
        })
        let error: any
        try {
            runFile("/Android Sdk/platform-tools/adb", ["devices"], { timeout: 10000 })
        } catch (caught) {
            error = caught
        }
        expect(error.message).toBe("adb did not respond within 10s")
        expect(error.hint).toContain("adb kill-server")
        expect(console.error).not.toHaveBeenCalled()
    })

    it("logs the failure with passwords redacted and rethrows", () => {
        const failure = Object.assign(new Error("Command failed: keytool -storepass hunter2"), { status: 1 })
        mockedExecFile.mockImplementationOnce(() => {
            throw failure
        })
        expect(() => runFile("keytool", ["-storepass", "hunter2"])).toThrow(failure)
        expect(failure.message).toBe("Command failed: keytool -storepass ***")
        const logged = vi.mocked(console.error).mock.calls.flat().join("\n")
        expect(logged).toContain("Error executing command: keytool -storepass ***")
        expect(logged).not.toContain("hunter2")
    })

    it("runs a real program", () => {
        expect(runFile(process.execPath, ["-e", "process.stdout.write('ok')"])).toBe("ok")
    })
})

describe("runInheritedCommand", () => {
    it("resolves on exit code 0 and passes env and cwd through", async () => {
        const cwd = tempDir()
        await runInheritedCommand(process.execPath, ["-e", "process.exit(0)"], {
            env: { ...process.env },
            cwd,
        })
        expect(mockedSpawn).toHaveBeenLastCalledWith(process.execPath, ["-e", "process.exit(0)"], {
            stdio: "inherit",
            env: expect.any(Object),
            cwd,
        })
    })

    it("rejects with the exit code", async () => {
        const error: any = await runInheritedCommand(process.execPath, ["-e", "process.exit(3)"]).catch(
            (caught) => caught
        )
        expect(error.message).toBe(`${process.execPath} exited with code 3`)
        expect(error.code).toBe(3)
    })

    it("names a command that is not installed", async () => {
        const error: any = await runInheritedCommand("catalyst-no-such-tool-xyz", []).catch(
            (caught) => caught
        )
        expect(error.message).toBe("Command not found: catalyst-no-such-tool-xyz")
        expect(error.cause.code).toBe("ENOENT")
    })
})

describe("redactSecrets and redactError", () => {
    it("redacts every password form and passes non-strings through", () => {
        expect(
            redactSecrets(
                'x -storepass "a b" -keypass k signing.store.password=s signing.key.password="q" --password=p --password z'
            )
        ).toBe(
            "x -storepass *** -keypass *** signing.store.password=*** signing.key.password=*** --password=*** --password ***"
        )
        expect(redactSecrets(undefined)).toBe(undefined)
        expect(redactSecrets(42 as any)).toBe(42)
    })

    it("scrubs every string field and the output array, leaving the rest", () => {
        const error: any = {
            message: "failed: -keypass sekret",
            stack: "at sekret",
            cmd: "cmd -keypass sekret",
            stdout: "echo sekret",
            stderr: "err sekret",
            output: [null, "out sekret", "fine"],
            status: 1,
        }
        expect(redactError(error, "cmd -keypass sekret")).toBe(error)
        expect(JSON.stringify(error)).not.toContain("sekret")
        expect(error.output).toEqual([null, "out ***", "fine"])
        expect(error.status).toBe(1)
    })

    it("ignores anything that is not an error object", () => {
        expect(redactError(null, "x")).toBe(null)
        expect(redactError("text" as any, "x")).toBe("text")
    })
})

describe("commandExists", () => {
    it("asks `which` and reports whether it found the tool", () => {
        mockedExec.mockImplementationOnce(() => "")
        expect(commandExists("adb")).toBe(true)
        expect(mockedExec).toHaveBeenLastCalledWith("which adb", { stdio: "ignore" })

        mockedExec.mockImplementationOnce(() => {
            throw new Error("not found")
        })
        expect(commandExists("adb")).toBe(false)
    })
})

describe("detectAndroidSdk", () => {
    it("prefers ANDROID_HOME, then ANDROID_SDK_ROOT", () => {
        const home = fakeSdk()
        const root = fakeSdk()
        expect(detectAndroidSdk({ ANDROID_HOME: home, ANDROID_SDK_ROOT: root })).toBe(home)
        expect(detectAndroidSdk({ ANDROID_SDK_ROOT: root })).toBe(root)
    })

    it("skips a directory without adb and falls back to Android Studio's location", () => {
        const empty = tempDir()
        const home = tempDir()
        vi.spyOn(os, "homedir").mockReturnValue(home)
        const studio = path.join(home, "Android", "Sdk")
        fs.mkdirSync(path.join(studio, "platform-tools"), { recursive: true })
        fs.writeFileSync(
            path.join(studio, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb"),
            ""
        )

        expect(detectAndroidSdk({ ANDROID_HOME: empty, LOCALAPPDATA: tempDir() })).toBe(studio)
    })

    it("returns null when nothing has adb", () => {
        vi.spyOn(os, "homedir").mockReturnValue(tempDir())
        expect(detectAndroidSdk({})).toBe(null)
    })

    it("reads process.env by default", () => {
        const sdk = fakeSdk()
        vi.stubEnv("ANDROID_HOME", sdk)
        try {
            expect(detectAndroidSdk()).toBe(sdk)
        } finally {
            vi.unstubAllEnvs()
        }
    })
})

describe("listAvds", () => {
    it("asks the SDK's emulator, expanding ~ and dropping INFO noise", () => {
        const home = tempDir()
        vi.spyOn(os, "homedir").mockReturnValue(home)
        mockedExecFile.mockImplementationOnce(
            () => "INFO    | Storing crashdata\nPixel_7_API_34\n\n  Tablet  \n" as any
        )

        expect(listAvds("~/sdk")).toEqual(["Pixel_7_API_34", "Tablet"])
        // The path is one argv entry, never a shell string.
        expect(mockedExecFile).toHaveBeenLastCalledWith(
            path.join(home, "sdk", "emulator", "emulator"),
            ["-list-avds"],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 }
        )
    })

    it("returns [] without an SDK or when the emulator cannot be run", () => {
        expect(listAvds(null)).toEqual([])
        expect(mockedExecFile).not.toHaveBeenCalled()

        mockedExecFile.mockImplementationOnce(() => {
            throw new Error("ENOENT")
        })
        expect(listAvds("/no/sdk")).toEqual([])
        // A path with a line break is refused before anything runs.
        expect(listAvds("/sdk\nrm")).toEqual([])
        expect(mockedExecFile).toHaveBeenCalledTimes(1)
    })
})

describe("ensureLocalProperties", () => {
    it("writes sdk.dir when local.properties is missing", () => {
        const project = tempDir()
        expect(ensureLocalProperties(project, "/opt/sdk")).toBe(true)
        expect(fs.readFileSync(path.join(project, "local.properties"), "utf8")).toBe("sdk.dir=/opt/sdk\n")
    })

    it("does nothing when the line is already there", () => {
        const project = tempDir()
        const file = path.join(project, "local.properties")
        fs.writeFileSync(file, "ndk.dir=/ndk\nsdk.dir=/opt/sdk\n")
        expect(ensureLocalProperties(project, "/opt/sdk")).toBe(false)
        expect(fs.readFileSync(file, "utf8")).toBe("ndk.dir=/ndk\nsdk.dir=/opt/sdk\n")
    })

    it("replaces a stale sdk.dir, keeps other settings, expands ~ and escapes backslashes", () => {
        const project = tempDir()
        const file = path.join(project, "local.properties")
        fs.writeFileSync(file, "sdk.dir=/old\n\nndk.dir=/ndk\n")
        const home = tempDir()
        vi.spyOn(os, "homedir").mockReturnValue(home)

        expect(ensureLocalProperties(project, "~/Android/sdk")).toBe(true)
        expect(fs.readFileSync(file, "utf8")).toBe(
            `ndk.dir=/ndk\nsdk.dir=${path.join(home, "Android/sdk")}\n`
        )

        expect(ensureLocalProperties(project, "C:\\Android\\sdk")).toBe(true)
        expect(fs.readFileSync(file, "utf8")).toBe("ndk.dir=/ndk\nsdk.dir=C:\\\\Android\\\\sdk\n")
    })

    it("names the config field to set in the SDK hint", () => {
        expect(ANDROID_SDK_HINT).toContain("WEBVIEW_CONFIG.android.sdkPath")
    })
})

describe("promptUser", () => {
    it("returns the default without a terminal", async () => {
        setTTY(undefined)
        await expect(promptUser("Port the app is served on", { defaultValue: "3005" })).resolves.toBe("3005")
    })

    it("fails with ENOTTY and a hint when there is no terminal and no default", async () => {
        setTTY(false)
        const error: any = await promptUser("Android SDK path:  ").catch((caught) => caught)
        expect(error.message).toBe("Missing configuration, and no terminal to ask on: Android SDK path")
        expect(error.code).toBe("ENOTTY")
        expect(error.hint).toContain("config/config.json")
    })

    function fakeTerminal(answer: string) {
        setTTY(true)
        const asked: string[] = []
        const close = vi.fn()
        vi.spyOn(readline, "createInterface").mockReturnValue({
            question: (text: string, callback: (answer: string) => void) => {
                asked.push(text)
                callback(answer)
            },
            close,
        } as any)
        const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
        return { asked, close, write }
    }

    it("asks on the terminal with the default offered, and settles the answer in place", async () => {
        const { asked, close, write } = fakeTerminal("")
        await expect(promptUser("Android emulator (AVD) name", { defaultValue: "Pixel_7" })).resolves.toBe(
            "Pixel_7"
        )
        expect(plain(asked[0])).toContain("? Android emulator (AVD) name (Pixel_7) ")
        expect(close).toHaveBeenCalled()
        expect(plain(write.mock.calls[0][0])).toContain("✓ Android emulator (AVD) name  Pixel_7")
    })

    it("uses the typed answer, trimmed, and an empty string with no default", async () => {
        fakeTerminal("  com.example.app ")
        await expect(promptUser("iOS bundle ID")).resolves.toBe("com.example.app")

        vi.restoreAllMocks()
        const { asked } = fakeTerminal("   ")
        await expect(promptUser("iOS bundle ID")).resolves.toBe("")
        expect(plain(asked[0])).not.toContain("(")
    })
})

describe("runInteractiveCommand", () => {
    const node = process.execPath

    it("resolves with the output and reports each line, flushing a trailing partial one", async () => {
        const lines: string[] = []
        const output = await runInteractiveCommand(
            node,
            [
                "-e",
                "process.stdout.write('one\\ntw'); setTimeout(() => { process.stdout.write('o\\nlast'); process.stderr.write('warn') }, 20)",
            ],
            {},
            { onLine: (line: string) => lines.push(line) }
        )
        expect(output).toContain("one\ntwo\nlast")
        expect(lines).toEqual(expect.arrayContaining(["one", "two", "last", "warn"]))
        expect(lines).toHaveLength(4)
    })

    it("captures silently without onLine", async () => {
        await expect(runInteractiveCommand(node, ["-e", "console.log('quiet')"])).resolves.toBe("quiet\n")
    })

    it("rejects with the exit code and the output that explains it", async () => {
        const error: any = await runInteractiveCommand(node, [
            "-e",
            "console.error('error: cannot find symbol'); console.log('partial'); process.exitCode = 3",
        ]).catch((caught) => caught)
        expect(error.message).toBe("Command failed with exit code 3")
        expect(error.code).toBe(3)
        expect(error.output).toContain("error: cannot find symbol")
        expect(error.output).toContain("partial")
    })

    it("rejects instead of hanging when the binary is missing", async () => {
        const error: any = await runInteractiveCommand("catalyst-no-such-binary", []).catch(
            (caught) => caught
        )
        expect(error.message).toBe("Command not found: catalyst-no-such-binary")
        expect(error.cause.code).toBe("ENOENT")
    })

    it.skipIf(process.platform === "win32")("rejects when the binary cannot be started", async () => {
        const file = path.join(tempDir(), "not-executable")
        fs.writeFileSync(file, "#!/bin/sh\n", { mode: 0o644 })
        const error: any = await runInteractiveCommand(file, []).catch((caught) => caught)
        expect(error.message).toMatch(new RegExp(`^Failed to start ${file}: `))
        expect(error.cause.code).toBe("EACCES")
    })

    it("answers each prompt once and keeps only a bounded tail of the output", async () => {
        // Prints a prompt, reads the answer, echoes it, then floods well past
        // the 1 MiB output cap and the 8 KiB prompt window.
        const script = `
            process.stdout.write("Accept? (y/N): ")
            process.stdin.once("data", (answer) => {
                process.stdout.write("got:" + String(answer).trim() + "\\n")
                const chunk = "x".repeat(64 * 1024) + "\\n"
                for (let i = 0; i < 20; i++) process.stdout.write(chunk)
                process.stdout.write("END\\n")
                process.stdin.destroy()
            })
        `
        const output = await runInteractiveCommand(node, ["-e", script], { "(y/N)": "y" })
        expect(output.length).toBeLessThanOrEqual(1024 * 1024)
        expect(output.endsWith("END\n")).toBe(true)
        expect(output).not.toContain("got:")
    })
})
