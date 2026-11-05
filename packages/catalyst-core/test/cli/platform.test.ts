import { createRequire } from "node:module"
import { afterEach, describe, expect, it, vi } from "vitest"

import type platformModule from "../../src/cli/platform.js"
import { onPlatform } from "../onPlatform"

const platform: typeof platformModule = createRequire(import.meta.url)("../../src/cli/platform.js")
const { appRoot, batchInvocation, freePortCommand, isWindows, quoteWindowsArg, stopProcessCommand } = platform

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe("isWindows", () => {
    it("reads the platform when asked, not when loaded", () => {
        expect(onPlatform("win32", isWindows)).toBe(true)
        expect(onPlatform("darwin", isWindows)).toBe(false)
    })
})

describe("appRoot", () => {
    it("ignores PWD on Windows, where it is missing or left over from another shell", () => {
        vi.stubEnv("PWD", "/c/some/other/project")
        vi.spyOn(process, "cwd").mockReturnValue("C:\\the\\app")
        expect(onPlatform("win32", appRoot)).toBe("C:\\the\\app")
    })

    it("prefers PWD elsewhere, and falls back to the working directory", () => {
        vi.spyOn(process, "cwd").mockReturnValue("/real/app")
        vi.stubEnv("PWD", "/linked/app")
        expect(onPlatform("linux", appRoot)).toBe("/linked/app")
        vi.stubEnv("PWD", "")
        expect(onPlatform("linux", appRoot)).toBe("/real/app")
    })
})

describe("quoteWindowsArg", () => {
    it("leaves a plain argument alone", () => {
        expect(quoteWindowsArg("installDebug")).toBe("installDebug")
        expect(quoteWindowsArg("-PconfigPath=C:\\app\\config.json")).toBe("-PconfigPath=C:\\app\\config.json")
    })

    it("quotes spaces and whatever cmd.exe would act on", () => {
        expect(quoteWindowsArg("C:\\Program Files\\x.bat")).toBe('"C:\\Program Files\\x.bat"')
        for (const special of ["a&b", "a|b", "a<b", "a>b", "a^b", "a(b", "a%b", "a!b"]) {
            expect(quoteWindowsArg(special)).toBe(`"${special}"`)
        }
        expect(quoteWindowsArg("")).toBe('""')
    })

    it("escapes quotes, doubling only the backslashes in front of one", () => {
        expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""')
        expect(quoteWindowsArg('a\\"b')).toBe('"a\\\\\\"b"')
        expect(quoteWindowsArg("C:\\a b\\")).toBe('"C:\\a b\\\\"')
        expect(quoteWindowsArg("C:\\a\\b c")).toBe('"C:\\a\\b c"')
    })
})

describe("batchInvocation", () => {
    it("goes through cmd.exe, quoted once more for its /s switch", () => {
        // Named, not read from ComSpec: the environment does not pick the shell.
        vi.stubEnv("ComSpec", "C:\\elsewhere\\shell.exe")
        expect(
            batchInvocation("C:\\my app\\gradlew.bat", ["clean", "-PconfigPath=C:\\my app\\c.json"])
        ).toEqual({
            command: "cmd.exe",
            args: ["/d", "/s", "/c", '""C:\\my app\\gradlew.bat" clean "-PconfigPath=C:\\my app\\c.json""'],
            options: { windowsVerbatimArguments: true },
        })
        vi.unstubAllEnvs()
    })

    it("refuses what cmd.exe would still read as syntax inside quotes", () => {
        for (const unsafe of ["C:\\%PATH%\\sdk", 'a"b', "a\nb", "a\rb"]) {
            expect(() => batchInvocation("C:\\sdk\\sdkmanager.bat", [unsafe])).toThrow(/cmd\.exe would read/)
        }
        expect(() => batchInvocation("C:\\100%\\gradlew.bat")).toThrow(/cmd\.exe would read/)
    })
})

describe("advice that names a command", () => {
    it("names one that exists on this system", () => {
        expect(onPlatform("linux", () => freePortCommand(3005))).toBe("lsof -ti :3005 | xargs kill")
        expect(onPlatform("win32", () => freePortCommand(3005))).toBe(
            "netstat -ano | findstr :3005, then taskkill /PID <pid> /F"
        )
        expect(onPlatform("linux", () => stopProcessCommand(42))).toBe("kill 42")
        expect(onPlatform("win32", () => stopProcessCommand(42))).toBe("taskkill /PID 42 /F")
    })
})
