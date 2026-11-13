import { describe, expect, it } from "vitest"

import {
    askConsent,
    isInteractive,
    needsAnswerError,
    parseNativeArgs,
    select,
} from "../../src/native/utils.js"

function thrown(fn: () => unknown): any {
    try {
        fn()
    } catch (error) {
        return error
    }
    throw new Error("expected a throw")
}

describe("parseNativeArgs", () => {
    it("reads the five native flags", () => {
        expect(parseNativeArgs([])).toEqual({
            release: false,
            device: false,
            url: undefined,
            yes: false,
            acceptLicenses: false,
        })
        expect(
            parseNativeArgs([
                "--release",
                "--device",
                "--url",
                "https://shop.acme.com",
                "--yes",
                "--accept-licenses",
            ])
        ).toEqual({
            release: true,
            device: true,
            url: "https://shop.acme.com",
            yes: true,
            acceptLicenses: true,
        })
    })

    it("takes --url=<u> too, and ignores other arguments", () => {
        expect(parseNativeArgs(["--verbose", "--url=https://a.com"])).toMatchObject({ url: "https://a.com" })
    })

    it("no longer knows the removed flags", () => {
        expect(parseNativeArgs(["--build-number", "7", "--no-sign"])).not.toHaveProperty("buildNumber")
        expect(parseNativeArgs(["--no-sign"])).not.toHaveProperty("noSign")
    })

    it.each([[["--url"]], [["--url", "--release"]], [["--url="]]])(
        "fails on --url without a value: %j",
        (argv) => {
            expect(thrown(() => parseNativeArgs(argv)).code).toBe("NATIVE-004")
        }
    )
})

describe("isInteractive", () => {
    const tty = { isTTY: true }
    const pipe = { isTTY: false }

    it("needs both stdin and stdout to be terminals", () => {
        expect(isInteractive({ stdin: tty, stdout: tty, env: {} })).toBe(true)
        expect(isInteractive({ stdin: pipe, stdout: tty, env: {} })).toBe(false)
        expect(isInteractive({ stdin: tty, stdout: pipe, env: {} })).toBe(false)
    })

    it("is false under CI", () => {
        expect(isInteractive({ stdin: tty, stdout: tty, env: { CI: "true" } })).toBe(false)
        expect(isInteractive({ stdin: tty, stdout: tty, env: { CI: "1" } })).toBe(false)
        expect(isInteractive({ stdin: tty, stdout: tty, env: { CI: "false" } })).toBe(true)
        expect(isInteractive({ stdin: tty, stdout: tty, env: { CI: "" } })).toBe(true)
    })
})

describe("needsAnswerError", () => {
    it("names the flag", () => {
        const error = needsAnswerError("Install JDK 17 with Homebrew?", { flag: "--yes" })
        expect(error.code).toBe("NATIVE-005")
        expect(error.message).toContain("Install JDK 17 with Homebrew (pass --yes)")
        expect(error.hint).toContain("--yes")
    })

    it("says no flag helps when only a person can answer", () => {
        expect(needsAnswerError("Create an upload key").hint).toContain("not even --yes")
    })
})

describe("askConsent", () => {
    const never = async () => {
        throw new Error("must not prompt")
    }
    const answer = (value: string) => async () => value

    it("--yes answers installs without asking", async () => {
        await expect(
            askConsent("install", "Install?", { flags: { yes: true }, isTTY: false, prompt: never })
        ).resolves.toBe(true)
    })

    it("--yes never answers licences or key creation", async () => {
        const licence = await askConsent("licence", "Accept?", { flags: { yes: true }, isTTY: false }).catch(
            (e) => e
        )
        expect(licence.code).toBe("NATIVE-005")
        expect(licence.message).toContain("--accept-licenses")
        const key = await askConsent("key", "Create key?", {
            flags: { yes: true, acceptLicenses: true },
            isTTY: false,
        }).catch((e) => e)
        expect(key.code).toBe("NATIVE-005")
    })

    it("--accept-licenses answers licences", async () => {
        await expect(
            askConsent("licence", "Accept?", { flags: { acceptLicenses: true }, isTTY: false, prompt: never })
        ).resolves.toBe(true)
    })

    it("without a terminal or flag, an install fails naming --yes", async () => {
        const error = await askConsent("install", "Install the SDK?", { isTTY: false }).catch((e) => e)
        expect(error.code).toBe("NATIVE-005")
        expect(error.message).toContain("--yes")
    })

    it("asks in a terminal, and key creation defaults to no", async () => {
        await expect(askConsent("install", "Install?", { isTTY: true, prompt: answer("n") })).resolves.toBe(
            false
        )
        await expect(askConsent("key", "Create?", { isTTY: true, prompt: answer("yes") })).resolves.toBe(true)
        let asked = ""
        await askConsent("key", "Create?", {
            isTTY: true,
            prompt: async (question: string, { defaultValue }: any) => {
                asked = question
                return defaultValue
            },
        })
        expect(asked).toContain("[y/N]")
    })
})

describe("select", () => {
    const choices = [
        { label: "Emulator", value: "emulator" },
        { label: "Pixel 8 (USB)", value: "device" },
    ]

    it("returns the default without a terminal", async () => {
        await expect(select("Run on", choices, { defaultValue: "emulator", isTTY: false })).resolves.toBe(
            "emulator"
        )
    })

    it("fails naming the flag without a terminal or default", async () => {
        const error = await select("Run on", choices, { flag: "--device", isTTY: false }).catch((e) => e)
        expect(error.code).toBe("NATIVE-005")
        expect(error.message).toContain("--device")
    })

    it("asks by number and re-asks on a bad answer", async () => {
        const answers = ["9", "2"]
        const out: string[] = []
        const value = await select("Run on", choices, {
            isTTY: true,
            defaultValue: "emulator",
            prompt: async () => answers.shift() as string,
            write: (text: string) => out.push(text),
        })
        expect(value).toBe("device")
        expect(out.join("")).toContain("2. Pixel 8 (USB)")
    })
})
