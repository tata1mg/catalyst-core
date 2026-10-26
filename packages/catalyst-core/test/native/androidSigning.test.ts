import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

import {
    configHasPasswords,
    createUploadKeystore,
    credentialPaths,
    distinguishedName,
    ensureGitignored,
    readKeystoreProperties,
    resolveAndroidSigning,
    signingGradleEnv,
    verifyKeystore,
    writeKeystoreProperties,
} from "../../src/native/buildAndroid/signing.js"

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-android-signing-test-"))
    temps.push(dir)
    return dir
}

afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const mode = (file: string) => fs.statSync(file).mode & 0o777

/** A keytool stand-in: records calls, "creates" keystores, and can reject -list. */
function fakeKeytool({ rejectList = false } = {}) {
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = []
    const exec = (_cmd: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        calls.push({ args, env: options.env })
        if (args[0] === "-genkeypair") fs.writeFileSync(args[args.indexOf("-keystore") + 1], "keystore")
        if (args[0] === "-list" && rejectList) {
            throw Object.assign(new Error("Command failed"), {
                stderr: "keytool error: java.io.IOException: keystore password was incorrect",
            })
        }
        return ""
    }
    return { exec, calls }
}

async function rejection(promise: Promise<unknown>): Promise<any> {
    try {
        await promise
    } catch (error) {
        return error
    }
    throw new Error("expected a rejection")
}

describe("keystore.properties and .gitignore", () => {
    it("round-trips the properties file with 0600 permissions", () => {
        const file = path.join(tempDir(), "credentials", "android", "keystore.properties")
        writeKeystoreProperties(file, { keyAlias: "upload", storePassword: "s3cr=t", keyPassword: "k" })
        expect(readKeystoreProperties(file)).toEqual({
            storeFile: "upload.jks",
            keyAlias: "upload",
            storePassword: "s3cr=t",
            keyPassword: "k",
        })
        if (process.platform !== "win32") expect(mode(file)).toBe(0o600)
    })

    it("reads nothing from a missing file", () => {
        expect(readKeystoreProperties(path.join(tempDir(), "nope.properties"))).toEqual({})
    })

    it("appends credentials/ once, and respects an existing rule", () => {
        const app = tempDir()
        fs.writeFileSync(path.join(app, ".gitignore"), "node_modules")
        expect(ensureGitignored(app)).toBe(true)
        expect(fs.readFileSync(path.join(app, ".gitignore"), "utf8")).toBe("node_modules\ncredentials/\n")
        expect(ensureGitignored(app)).toBe(false)

        const other = tempDir()
        fs.writeFileSync(path.join(other, ".gitignore"), "/credentials\n")
        expect(ensureGitignored(other)).toBe(false)
    })

    it("creates .gitignore when the app has none", () => {
        const app = tempDir()
        expect(ensureGitignored(app)).toBe(true)
        expect(fs.readFileSync(path.join(app, ".gitignore"), "utf8")).toBe("credentials/\n")
    })
})

describe("keytool use", () => {
    it("builds and escapes the certificate DN", () => {
        expect(
            distinguishedName({ companyName: "Acme, Inc", city: "Pune", state: "MH", countryCode: "IN" })
        ).toBe("CN=Acme\\, Inc, O=Acme\\, Inc, L=Pune, ST=MH, C=IN")
        expect(distinguishedName(undefined, "My App")).toBe("CN=My App")
    })

    it("hands passwords to keytool in its environment, never argv", () => {
        const { exec, calls } = fakeKeytool()
        const store = path.join(tempDir(), "upload.jks")
        createUploadKeystore(store, { keyAlias: "upload", password: "hunter2" }, { exec, env: {} })
        verifyKeystore({ storeFile: store, keyAlias: "upload", storePassword: "hunter2" }, { exec, env: {} })
        for (const call of calls) {
            expect(call.args.join(" ")).not.toContain("hunter2")
            expect(call.env.CATALYST_KEYTOOL_STOREPASS).toBe("hunter2")
        }
        expect(calls[0].args).toEqual(expect.arrayContaining(["-storepass:env", "-keypass:env", "PKCS12"]))
        if (process.platform !== "win32") expect(mode(store)).toBe(0o600)
    })

    it("reports a rejected password as ANDROID-006", () => {
        const { exec } = fakeKeytool({ rejectList: true })
        const error = (() => {
            try {
                verifyKeystore(
                    { storeFile: "/x/upload.jks", keyAlias: "upload", storePassword: "bad" },
                    { exec, env: {} }
                )
            } catch (e) {
                return e as any
            }
        })()
        expect(error.code).toBe("ANDROID-006")
        expect(error.message).toContain("password was incorrect")
    })
})

describe("resolveAndroidSigning", () => {
    const noPrompt = async () => {
        throw new Error("should not prompt")
    }

    it("decodes CATALYST_ANDROID_KEYSTORE_BASE64 to a 0600 temp file and removes it on cleanup", async () => {
        const { exec } = fakeKeytool()
        const env = {
            CATALYST_ANDROID_KEYSTORE_BASE64: Buffer.from("binary-keystore").toString("base64"),
            CATALYST_ANDROID_STORE_PASSWORD: "store-pw",
            CATALYST_ANDROID_KEY_ALIAS: "ci",
        }
        const signing = await resolveAndroidSigning({
            appRoot: tempDir(),
            env,
            isTTY: false,
            prompt: noPrompt,
            exec,
        })
        expect(fs.readFileSync(signing.storeFile, "utf8")).toBe("binary-keystore")
        if (process.platform !== "win32") expect(mode(signing.storeFile)).toBe(0o600)
        expect(signing).toMatchObject({ storePassword: "store-pw", keyPassword: "store-pw", keyAlias: "ci" })
        signing.cleanup()
        expect(fs.existsSync(signing.storeFile)).toBe(false)
    })

    it("fails a base64 key with no password (ANDROID-006) and still removes the temp file", async () => {
        const { exec } = fakeKeytool()
        const appRoot = tempDir()
        const before = fs
            .readdirSync(os.tmpdir())
            .filter((name) => name.startsWith("catalyst-android-signing-")).length
        const error = await rejection(
            resolveAndroidSigning({
                appRoot,
                env: { CATALYST_ANDROID_KEYSTORE_BASE64: "AAAA" },
                isTTY: false,
                exec,
            })
        )
        expect(error.code).toBe("ANDROID-006")
        const after = fs
            .readdirSync(os.tmpdir())
            .filter((name) => name.startsWith("catalyst-android-signing-")).length
        expect(after).toBe(before)
    })

    it("uses the app's credentials/android key and its keystore.properties", async () => {
        const app = tempDir()
        const paths = credentialPaths(app)
        fs.mkdirSync(paths.dir, { recursive: true })
        fs.writeFileSync(paths.storeFile, "keystore")
        writeKeystoreProperties(paths.propertiesFile, {
            keyAlias: "upload",
            storePassword: "p1",
            keyPassword: "p2",
        })
        const { exec } = fakeKeytool()
        const signing = await resolveAndroidSigning({
            appRoot: app,
            env: {},
            isTTY: false,
            prompt: noPrompt,
            exec,
        })
        expect(signing).toMatchObject({
            storeFile: paths.storeFile,
            keyAlias: "upload",
            storePassword: "p1",
            keyPassword: "p2",
        })
        expect(fs.readFileSync(path.join(app, ".gitignore"), "utf8")).toContain("credentials/")
    })

    it("lets CI variables override keystore.properties", async () => {
        const app = tempDir()
        const paths = credentialPaths(app)
        fs.mkdirSync(paths.dir, { recursive: true })
        fs.writeFileSync(paths.storeFile, "keystore")
        writeKeystoreProperties(paths.propertiesFile, {
            keyAlias: "upload",
            storePassword: "p1",
            keyPassword: "p1",
        })
        const { exec } = fakeKeytool()
        const signing = await resolveAndroidSigning({
            appRoot: app,
            env: { CATALYST_ANDROID_STORE_PASSWORD: "env-pw" },
            isTTY: false,
            exec,
        })
        expect(signing.storePassword).toBe("env-pw")
        expect(signing.keyPassword).toBe("p1")
    })

    it("uses android.signing.storeFile, relative to the app", async () => {
        const app = tempDir()
        fs.mkdirSync(path.join(app, "keys"))
        fs.writeFileSync(path.join(app, "keys", "my.jks"), "keystore")
        const { exec } = fakeKeytool()
        const signing = await resolveAndroidSigning({
            appRoot: app,
            androidConfig: { signing: { storeFile: "keys/my.jks", keyAlias: "mine" } },
            env: { CATALYST_ANDROID_STORE_PASSWORD: "pw" },
            isTTY: false,
            exec,
        })
        expect(signing.storeFile).toBe(path.join(app, "keys", "my.jks"))
        expect(signing.keyAlias).toBe("mine")

        const missing = await rejection(
            resolveAndroidSigning({
                appRoot: app,
                androidConfig: { signing: { storeFile: "keys/none.jks" } },
                env: {},
                isTTY: false,
                exec,
            })
        )
        expect(missing.code).toBe("ANDROID-006")
    })

    it("fails without a key and without a terminal (ANDROID-005)", async () => {
        const error = await rejection(
            resolveAndroidSigning({ appRoot: tempDir(), env: {}, isTTY: false, prompt: noPrompt })
        )
        expect(error.code).toBe("ANDROID-005")
        expect(error.hint).toMatch(/CATALYST_ANDROID_KEYSTORE_BASE64/)
    })

    it("names a legacy build-output keystore when there is no terminal", async () => {
        const app = tempDir()
        const legacy = path.join(app, "build-output", "shop-keystore.jks")
        fs.mkdirSync(path.dirname(legacy))
        fs.writeFileSync(legacy, "old")
        const error = await rejection(
            resolveAndroidSigning({ appRoot: app, env: {}, isTTY: false, legacyKeystorePath: legacy })
        )
        expect(error.code).toBe("ANDROID-005")
        expect(error.message).toContain("adopt")
    })

    it("creates a key after a yes, with a generated password kept out of argv", async () => {
        const app = tempDir()
        const { exec, calls } = fakeKeytool()
        const questions: string[] = []
        const logs: string[] = []
        const signing = await resolveAndroidSigning({
            appRoot: app,
            androidConfig: { keystoreConfig: { organizationInfo: { companyName: "Acme" } } },
            env: {},
            isTTY: true,
            prompt: async (question: string) => {
                questions.push(question)
                return "y"
            },
            log: (message: string) => logs.push(message),
            exec,
        })
        const paths = credentialPaths(app)
        expect(questions).toHaveLength(1)
        expect(signing.storeFile).toBe(paths.storeFile)
        expect(signing.keyAlias).toBe("upload")
        expect(signing.storePassword).toMatch(/^[A-Za-z0-9_-]{32}$/)
        expect(readKeystoreProperties(paths.propertiesFile).storePassword).toBe(signing.storePassword)
        if (process.platform !== "win32") expect(mode(paths.propertiesFile)).toBe(0o600)
        expect(fs.readFileSync(path.join(app, ".gitignore"), "utf8")).toBe("credentials/\n")
        for (const call of calls) expect(call.args.join(" ")).not.toContain(signing.storePassword)
        expect(calls[0].args).toContain("CN=Acme, O=Acme")
    })

    it("fails when the user declines to create a key", async () => {
        const error = await rejection(
            resolveAndroidSigning({ appRoot: tempDir(), env: {}, isTTY: true, prompt: async () => "n" })
        )
        expect(error.code).toBe("ANDROID-005")
    })

    it("adopts a legacy keystore with the config's passwords and warns about them", async () => {
        const app = tempDir()
        const legacy = path.join(app, "build-output", "shop-keystore.jks")
        fs.mkdirSync(path.dirname(legacy))
        fs.writeFileSync(legacy, "old-key")
        const { exec } = fakeKeytool()
        const logs: Array<[string, string | undefined]> = []
        const signing = await resolveAndroidSigning({
            appRoot: app,
            androidConfig: { keystoreConfig: { keyAlias: "release", storePassword: "legacy-pw" } },
            env: {},
            isTTY: true,
            prompt: async () => "yes",
            log: (message: string, type?: string) => logs.push([message, type]),
            legacyKeystorePath: legacy,
            exec,
        })
        expect(fs.readFileSync(signing.storeFile, "utf8")).toBe("old-key")
        expect(signing).toMatchObject({ keyAlias: "release", storePassword: "legacy-pw" })
        expect(
            logs.some(([message, type]) => type === "warning" && /holds keystore passwords/.test(message))
        ).toBe(true)
    })

    it("detects passwords in either legacy config shape", () => {
        expect(configHasPasswords({ keystore: { storePassword: "x" } })).toBe(true)
        expect(configHasPasswords({ keystoreConfig: { organizationInfo: {} } })).toBe(false)
    })

    it("maps the key to Gradle project properties", () => {
        expect(
            signingGradleEnv({ storeFile: "/k.jks", storePassword: "s", keyAlias: "a", keyPassword: "k" })
        ).toEqual({
            ORG_GRADLE_PROJECT_catalystStoreFile: "/k.jks",
            ORG_GRADLE_PROJECT_catalystStorePassword: "s",
            ORG_GRADLE_PROJECT_catalystKeyAlias: "a",
            ORG_GRADLE_PROJECT_catalystKeyPassword: "k",
        })
    })
})

function hasKeytool() {
    try {
        execFileSync("keytool", ["-help"], { stdio: "ignore" })
        return true
    } catch {
        return false
    }
}

describe.skipIf(!hasKeytool())("with the real keytool", () => {
    it("creates a PKCS12 upload key that verifies, and rejects a wrong password", () => {
        const store = path.join(tempDir(), "upload.jks")
        createUploadKeystore(store, { keyAlias: "upload", password: "correct-horse", commonName: "Test" })
        expect(() =>
            verifyKeystore({ storeFile: store, keyAlias: "upload", storePassword: "correct-horse" })
        ).not.toThrow()
        expect(() =>
            verifyKeystore({ storeFile: store, keyAlias: "upload", storePassword: "wrong-pass" })
        ).toThrow(/Upload key settings/)
    }, 30000)
})
