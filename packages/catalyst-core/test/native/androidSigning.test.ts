import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

import {
    PLAY_UPLOAD_KEY_RESET_URL,
    configHasPasswords,
    createUploadKeystore,
    distinguishedName,
    ensureGitignored,
    exportUploadCertificate,
    legacyKeystorePath,
    readKeystoreProperties,
    resolveAndroidSigning,
    signingGradleEnv,
    verifyKeystore,
    writeKeystoreProperties,
} from "../../src/native/buildAndroid/signing.js"
import { releaseArtifactPaths, releaseOutputDir } from "../../src/native/buildAndroid/output.js"
import { assertReleaseFolderFree } from "../../src/native/releaseOutput.js"

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

/** The key files in an app's credentials/android/. */
function credentialPaths(app: string) {
    const dir = path.join(app, "credentials", "android")
    return {
        dir,
        storeFile: path.join(dir, "upload.jks"),
        propertiesFile: path.join(dir, "keystore.properties"),
    }
}

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

/** A CATALYST_ANDROID_CREDENTIALS value: base64 of a gzipped tar of the given files. */
function packSecret(files: Record<string, string>) {
    const dir = tempDir()
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body)
    return execFileSync("tar", ["-czf", "-", "-C", dir, "."], {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
    }).toString("base64")
}

const properties = (storePassword: string, keyAlias = "upload") =>
    `storeFile=upload.jks\nkeyAlias=${keyAlias}\nstorePassword=${storePassword}\nkeyPassword=${storePassword}\n`

/** Answers by question: create the key, never uploaded to Play, unless told otherwise. */
function answers({ create = "y", onPlay = "n" } = {}) {
    const questions: string[] = []
    const prompt = async (question: string) => {
        questions.push(question)
        return /Google Play/.test(question) ? onPlay : create
    }
    return { questions, prompt }
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

    it("unpacks CATALYST_ANDROID_CREDENTIALS to a private temp folder, masks the passwords, and cleans up", async () => {
        const { exec } = fakeKeytool()
        const app = tempDir()
        const masked: string[] = []
        const env = {
            CATALYST_ANDROID_CREDENTIALS: packSecret({
                "upload.jks": "binary-keystore",
                "keystore.properties": properties("store-pw", "ci"),
            }),
        }
        const signing = await resolveAndroidSigning({
            appRoot: app,
            env,
            isTTY: false,
            prompt: noPrompt,
            exec,
            mask: (value: string) => void masked.push(value),
        })
        expect(fs.readFileSync(signing.storeFile, "utf8")).toBe("binary-keystore")
        expect(signing.storeFile.startsWith(app)).toBe(false)
        expect(signing).toMatchObject({
            storePassword: "store-pw",
            keyPassword: "store-pw",
            keyAlias: "ci",
            source: "CATALYST_ANDROID_CREDENTIALS",
        })
        expect(masked).toEqual(["store-pw"])
        // The project folder is never written from the secret.
        expect(fs.existsSync(path.join(app, "credentials"))).toBe(false)
        signing.cleanup()
        expect(fs.existsSync(signing.storeFile)).toBe(false)
    })

    it("fails a secret without a password or without the key (ANDROID-006) and removes the temp folder", async () => {
        const { exec } = fakeKeytool()
        const count = () =>
            fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("catalyst-android-credentials-"))
                .length
        const before = count()
        const noPassword = await rejection(
            resolveAndroidSigning({
                appRoot: tempDir(),
                env: { CATALYST_ANDROID_CREDENTIALS: packSecret({ "upload.jks": "k" }) },
                isTTY: false,
                exec,
            })
        )
        expect(noPassword.code).toBe("ANDROID-006")
        const noKey = await rejection(
            resolveAndroidSigning({
                appRoot: tempDir(),
                env: {
                    CATALYST_ANDROID_CREDENTIALS: packSecret({ "keystore.properties": properties("pw") }),
                },
                isTTY: true,
                prompt: noPrompt,
                exec,
            })
        )
        expect(noKey.code).toBe("ANDROID-006")
        expect(noKey.message).toContain("CATALYST_ANDROID_CREDENTIALS has no upload.jks")
        expect(count()).toBe(before)
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

    it("uses the keystore file keystore.properties names, inside credentials/android", async () => {
        const app = tempDir()
        const dir = path.join(app, "credentials", "android")
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, "play.keystore"), "keystore")
        fs.writeFileSync(
            path.join(dir, "keystore.properties"),
            "storeFile=../../elsewhere/play.keystore\nkeyAlias=mine\nstorePassword=pw\n"
        )
        const { exec } = fakeKeytool()
        const signing = await resolveAndroidSigning({ appRoot: app, env: {}, isTTY: false, exec })
        expect(signing.storeFile).toBe(path.join(dir, "play.keystore"))
        expect(signing.keyAlias).toBe("mine")
    })

    it("refuses to create a key when keystore.properties is there without its keystore", async () => {
        const app = tempDir()
        const paths = credentialPaths(app)
        fs.mkdirSync(paths.dir, { recursive: true })
        fs.writeFileSync(paths.propertiesFile, properties("old-pw"))
        const { prompt, questions } = answers()
        const error = await rejection(resolveAndroidSigning({ appRoot: app, env: {}, isTTY: true, prompt }))
        expect(error.code).toBe("ANDROID-006")
        expect(error.message).toContain("restore the key")
        expect(questions).toEqual([])
        expect(fs.readFileSync(paths.propertiesFile, "utf8")).toBe(properties("old-pw"))
        expect(fs.existsSync(paths.storeFile)).toBe(false)
    })

    it("fails without a key and without a terminal (ANDROID-005)", async () => {
        const error = await rejection(
            resolveAndroidSigning({ appRoot: tempDir(), env: {}, isTTY: false, prompt: noPrompt })
        )
        expect(error.code).toBe("ANDROID-005")
        expect(error.hint).toContain("CATALYST_ANDROID_CREDENTIALS")
        expect(error.hint).toContain("catalyst credentials:export android")
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

    it("never creates a key without a terminal, even with every flag", async () => {
        const app = tempDir()
        const error = await rejection(
            resolveAndroidSigning({ appRoot: app, env: { CI: "true" }, isTTY: false, prompt: noPrompt })
        )
        expect(error.code).toBe("ANDROID-005")
        expect(fs.existsSync(path.join(app, "credentials"))).toBe(false)
    })

    it("creates a key after a yes and a 'not on Play', with a generated password kept out of argv", async () => {
        const app = tempDir()
        const { exec, calls } = fakeKeytool()
        const { prompt, questions } = answers()
        const logs: string[] = []
        const signing = await resolveAndroidSigning({
            appRoot: app,
            androidConfig: { keystoreConfig: { organizationInfo: { companyName: "Acme" } } },
            env: {},
            isTTY: true,
            prompt,
            log: (message: string) => logs.push(message),
            exec,
        })
        const paths = credentialPaths(app)
        expect(questions).toHaveLength(2)
        expect(questions[0]).toContain("Create one in")
        expect(questions[1]).toContain("Google Play")
        expect(signing).toMatchObject({ storeFile: paths.storeFile, keyAlias: "upload", created: true })
        expect(signing.storePassword).toMatch(/^[A-Za-z0-9_-]{32}$/)
        expect(readKeystoreProperties(paths.propertiesFile).storePassword).toBe(signing.storePassword)
        if (process.platform !== "win32") expect(mode(paths.propertiesFile)).toBe(0o600)
        expect(fs.readFileSync(path.join(app, ".gitignore"), "utf8")).toBe("credentials/\n")
        for (const call of calls) expect(call.args.join(" ")).not.toContain(signing.storePassword)
        expect(calls[0].args).toContain("CN=Acme, O=Acme")
        expect(logs.some((line) => line.includes("catalyst credentials:export android"))).toBe(true)
    })

    it("refuses a new key for an app already on Google Play, pointing to the upload key reset", async () => {
        const app = tempDir()
        const { exec, calls } = fakeKeytool()
        const { prompt } = answers({ onPlay: "y" })
        const error = await rejection(
            resolveAndroidSigning({ appRoot: app, env: {}, isTTY: true, prompt, exec })
        )
        expect(error.code).toBe("ANDROID-005")
        expect(error.hint).toContain(PLAY_UPLOAD_KEY_RESET_URL)
        expect(calls).toEqual([])
        expect(fs.existsSync(credentialPaths(app).storeFile)).toBe(false)
    })

    it("fails when the user declines to create a key", async () => {
        const { prompt, questions } = answers({ create: "n" })
        const error = await rejection(
            resolveAndroidSigning({ appRoot: tempDir(), env: {}, isTTY: true, prompt })
        )
        expect(error.code).toBe("ANDROID-005")
        expect(questions).toHaveLength(1)
    })

    it("never overwrites an existing key or its settings (#508)", () => {
        const dir = tempDir()
        const store = path.join(dir, "upload.jks")
        const props = path.join(dir, "keystore.properties")
        fs.writeFileSync(store, "the key Play knows")
        fs.writeFileSync(props, properties("original"))
        const { exec, calls } = fakeKeytool()
        expect(() => createUploadKeystore(store, { password: "new" }, { exec, env: {} })).toThrow(
            /Refusing to replace/
        )
        expect(() =>
            writeKeystoreProperties(props, { keyAlias: "upload", storePassword: "new", keyPassword: "new" })
        ).toThrow(/EEXIST/)
        expect(calls).toEqual([])
        expect(fs.readFileSync(store, "utf8")).toBe("the key Play knows")
        expect(fs.readFileSync(props, "utf8")).toBe(properties("original"))
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

    it("adopts a legacy keystore from the older android.keystore shape, with its alias", async () => {
        const app = tempDir()
        const legacy = path.join(app, "build-output", "shop-keystore.jks")
        fs.mkdirSync(path.dirname(legacy))
        fs.writeFileSync(legacy, "old-key")
        const { exec, calls } = fakeKeytool()
        const signing = await resolveAndroidSigning({
            appRoot: app,
            androidConfig: { keystore: { alias: "shop", storePassword: "older-pw" } },
            env: {},
            isTTY: true,
            prompt: async () => "yes",
            legacyKeystorePath: legacy,
            exec,
        })
        expect(signing).toMatchObject({ keyAlias: "shop", storePassword: "older-pw", source: "adopted" })
        expect(readKeystoreProperties(credentialPaths(app).propertiesFile)).toMatchObject({
            keyAlias: "shop",
            storePassword: "older-pw",
        })
        expect(calls.map((call) => call.args[0])).toEqual(["-list"])
    })

    it("removes the unpacked secret when its key does not open (ANDROID-006)", async () => {
        const { exec, calls } = fakeKeytool({ rejectList: true })
        const masked: string[] = []
        const error = await rejection(
            resolveAndroidSigning({
                appRoot: tempDir(),
                env: {
                    CATALYST_ANDROID_CREDENTIALS: packSecret({
                        "upload.jks": "k",
                        "keystore.properties": `storeFile=upload.jks\nkeyAlias=ci\nstorePassword=pw1\nkeyPassword=pw2\n`,
                    }),
                },
                isTTY: false,
                exec,
                mask: (value: string) => void masked.push(value),
            })
        )
        expect(error.code).toBe("ANDROID-006")
        expect(error.message).toContain("keystore password was incorrect")
        // Both passwords are masked, and the folder the secret was unpacked to is gone.
        expect(masked).toEqual(["pw1", "pw2"])
        const storeFile = calls[0].args[calls[0].args.indexOf("-keystore") + 1]
        expect(path.basename(storeFile)).toBe("upload.jks")
        expect(fs.existsSync(path.dirname(storeFile))).toBe(false)
    })

    it("names keytool's first line when the key cannot be created or exported", () => {
        const failing = () => {
            throw Object.assign(new Error("Command failed"), {
                stderr: "keytool error: java.lang.Exception: bad dname\n\tat sun.security.tools\n",
            })
        }
        const dir = tempDir()
        expect(() =>
            createUploadKeystore(
                path.join(dir, "upload.jks"),
                { password: "pw", organizationInfo: {} },
                { exec: failing, env: {} }
            )
        ).toThrow("keytool could not create the upload key: keytool error: java.lang.Exception: bad dname")
        expect(fs.existsSync(path.join(dir, "upload.jks"))).toBe(false)

        expect(() =>
            exportUploadCertificate(
                { storeFile: "/k/upload.jks", keyAlias: "upload", storePassword: "pw" },
                path.join(dir, "out", "upload_certificate.pem"),
                { exec: failing, env: {} }
            )
        ).toThrow(
            "keytool could not export the upload certificate: keytool error: java.lang.Exception: bad dname"
        )

        const silent = () => {
            throw new Error("spawn keytool EACCES")
        }
        expect(() =>
            exportUploadCertificate(
                { storeFile: "/k/upload.jks", keyAlias: "upload", storePassword: "pw" },
                path.join(dir, "out", "upload_certificate.pem"),
                { exec: silent, env: {} }
            )
        ).toThrow("keytool could not export the upload certificate: spawn keytool EACCES")
    })

    it("appends to a .gitignore without a trailing newline through one descriptor", () => {
        const app = tempDir()
        fs.writeFileSync(path.join(app, ".gitignore"), "node_modules\r\ndist")
        expect(ensureGitignored(app)).toBe(true)
        expect(fs.readFileSync(path.join(app, ".gitignore"), "utf8")).toBe(
            "node_modules\r\ndist\ncredentials/\n"
        )
        expect(ensureGitignored(app)).toBe(false)
    })

    it("detects passwords in either legacy config shape", () => {
        expect(configHasPasswords({ keystore: { storePassword: "x" } })).toBe(true)
        expect(configHasPasswords({ keystoreConfig: { organizationInfo: {} } })).toBe(false)
    })

    it("exports the upload certificate as PEM, password in the environment", () => {
        const { exec, calls } = fakeKeytool()
        const dest = path.join(tempDir(), "build-output", "android", "1.2.0-42", "upload_certificate.pem")
        const out = exportUploadCertificate(
            { storeFile: "/k/upload.jks", keyAlias: "upload", storePassword: "secret-pw" },
            dest,
            { exec, env: {} }
        )
        expect(out).toBe(dest)
        expect(fs.existsSync(path.dirname(dest))).toBe(true)
        expect(calls[0].args).toEqual(
            expect.arrayContaining(["-exportcert", "-rfc", "-keystore", "/k/upload.jks", "-file", dest])
        )
        expect(calls[0].args.join(" ")).not.toContain("secret-pw")
        expect(calls[0].env.CATALYST_KEYTOOL_STOREPASS).toBe("secret-pw")
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
        const pem = exportUploadCertificate(
            { storeFile: store, keyAlias: "upload", storePassword: "correct-horse" },
            path.join(path.dirname(store), "upload_certificate.pem")
        )
        expect(fs.readFileSync(pem, "utf8")).toMatch(/^-----BEGIN CERTIFICATE-----/)
    }, 30000)
})

describe("release output", () => {
    const version = { versionName: "1.2.0", buildNumber: 1440 }

    it("puts each release in build-output/android/<version>-<build>/", () => {
        const dir = releaseOutputDir({ appRoot: "/app", version })
        expect(dir).toBe(path.join("/app", "build-output", "android", "1.2.0-1440"))
        expect(releaseArtifactPaths(dir, "shop")).toEqual({
            aab: path.join(dir, "shop.aab"),
            certificate: path.join(dir, "upload_certificate.pem"),
        })
    })

    it("honours android.outputPath and a missing version", () => {
        expect(
            releaseOutputDir({
                appRoot: "/app",
                androidConfig: { outputPath: "dist/store" },
                version: { buildNumber: 7 },
            })
        ).toBe(path.join("/app", "dist", "store", "1.0.0-7"))
    })

    it("makes the app name and version safe for file names", () => {
        const dir = releaseOutputDir({
            appRoot: "/app",
            version: { versionName: "2.0.0/beta 1", buildNumber: 3 },
        })
        expect(dir).toBe(path.join("/app", "build-output", "android", "2.0.0-beta-1-3"))
        expect(releaseArtifactPaths(dir, 'My Shop: "Pro"').aab).toBe(path.join(dir, "My-Shop-Pro.aab"))
        expect(releaseArtifactPaths(dir, "").aab).toBe(path.join(dir, "app.aab"))
    })

    it("refuses to build over an earlier release with the same build number (NATIVE-011)", () => {
        const dir = path.join(tempDir(), "1.2.0-1440")
        expect(() => assertReleaseFolderFree(dir, [".aab"])).not.toThrow()
        fs.mkdirSync(dir)
        fs.writeFileSync(path.join(dir, "upload_certificate.pem"), "pem")
        expect(() => assertReleaseFolderFree(dir, [".aab"])).not.toThrow()
        fs.writeFileSync(path.join(dir, "shop.aab"), "aab")
        let error: any
        try {
            assertReleaseFolderFree(dir, [".aab"])
        } catch (caught) {
            error = caught
        }
        expect(error.code).toBe("NATIVE-011")
        expect(error.message).toContain("shop.aab")
        expect(error.hint).toContain("CATALYST_BUILD_NUMBER")
    })
})

describe("legacyKeystorePath", () => {
    it("names the keystore the way releases before 1.1.1 did, from the config as written", () => {
        // A config that now also sets the top-level appName and appId: the
        // resolved android block carries those, the raw one still has the
        // names the old release used.
        const raw = { appName: "shop", packageName: "com.acme.shop" }
        expect(legacyKeystorePath(raw, { cwd: "/app" })).toBe(
            path.join("/app", "build-output", "shop-keystore.jks")
        )
        expect(legacyKeystorePath({ newProjectName: "store", appName: "shop" }, { cwd: "/app" })).toBe(
            path.join("/app", "build-output", "store-keystore.jks")
        )
        expect(legacyKeystorePath({ packageName: "com.acme.market" }, { cwd: "/app" })).toBe(
            path.join("/app", "build-output", "market-keystore.jks")
        )
        expect(legacyKeystorePath({ outputPath: "dist" }, { cwd: "/app" })).toBe(
            path.join("/app", "dist", "catalystapp-keystore.jks")
        )
        expect(legacyKeystorePath(undefined, { cwd: "/app" })).toBe(
            path.join("/app", "build-output", "catalystapp-keystore.jks")
        )
    })
})
