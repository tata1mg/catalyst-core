import { execFileSync } from "child_process"
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { nativeError, promptUser } from "../utils.js"

// Release signing for Android: one persistent upload key per app.
//
// The key used to be generated inside the temp_build_<pkg> copy, which is
// wiped on every run, so every release was signed with a new key and Play
// rejected all but the first upload. It now lives in the app, outside git:
//
//   <app>/credentials/android/upload.jks
//   <app>/credentials/android/keystore.properties   (0600: alias + passwords)
//
// CI supplies the key through the environment instead. Passwords never go on
// a command line: keytool reads them with -storepass:env, Gradle through
// ORG_GRADLE_PROJECT_* variables.

const CREDENTIALS_DIR = path.join("credentials", "android")
const DEFAULT_ALIAS = "upload"
const GITIGNORE_ENTRY = "credentials/"

function credentialPaths(appRoot) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - appRoot is the local app directory; the rest is fixed.
    const dir = path.join(appRoot, CREDENTIALS_DIR)
    return {
        dir,
        storeFile: path.join(dir, "upload.jks"),
        propertiesFile: path.join(dir, "keystore.properties"),
    }
}

/** Java .properties, the subset Catalyst writes: key=value lines, # comments. */
function readKeystoreProperties(file) {
    const values = {}
    if (!fs.existsSync(file)) return values
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue
        const index = trimmed.search(/[=:]/)
        if (index === -1) continue
        values[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
    }
    return values
}

function writeKeystoreProperties(file, { keyAlias, storePassword, keyPassword }) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const body = [
        "# Catalyst Android upload key. Keep this file and upload.jks out of git and backed up:",
        "# Play only accepts updates signed with this key.",
        "storeFile=upload.jks",
        `keyAlias=${keyAlias}`,
        `storePassword=${storePassword}`,
        `keyPassword=${keyPassword}`,
        "",
    ].join("\n")
    fs.writeFileSync(file, body, { mode: 0o600 })
    fs.chmodSync(file, 0o600)
}

/** Append `credentials/` to the app's .gitignore unless something already covers it. */
function ensureGitignored(appRoot) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - appRoot is the local app directory; the file name is fixed.
    const file = path.join(appRoot, ".gitignore")
    const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
    const covered = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .some((line) => ["credentials", "credentials/", "/credentials", "/credentials/"].includes(line))
    if (covered) return false
    const prefix = content && !content.endsWith("\n") ? "\n" : ""
    fs.writeFileSync(file, `${content}${prefix}${GITIGNORE_ENTRY}\n`)
    return true
}

function generatePassword() {
    return crypto.randomBytes(24).toString("base64url")
}

function keytoolPath(env = process.env) {
    if (env.JAVA_HOME) {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - JAVA_HOME is the local JDK location.
        const candidate = path.join(
            env.JAVA_HOME,
            "bin",
            process.platform === "win32" ? "keytool.exe" : "keytool"
        )
        if (fs.existsSync(candidate)) return candidate
    }
    return "keytool"
}

/**
 * keytool with the passwords handed over in its environment, never argv.
 *
 * @param {string[]} args
 * @param {{ storePassword: string, keyPassword?: string }} passwords
 * @param {{ env?: Record<string, string | undefined>, exec?: Function }} [options]
 */
function runKeytool(args, passwords, { env = process.env, exec = execFileSync } = {}) {
    const childEnv = { ...env, CATALYST_KEYTOOL_STOREPASS: passwords.storePassword }
    if (passwords.keyPassword !== undefined) childEnv.CATALYST_KEYTOOL_KEYPASS = passwords.keyPassword
    return exec(keytoolPath(env), args, {
        env: childEnv,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    })
}

function distinguishedName(organizationInfo = {}, commonName) {
    const escape = (value) => String(value).replace(/([,\\+"<>;=])/g, "\\$1")
    const org = organizationInfo.organization || organizationInfo.companyName
    const parts = [
        ["CN", organizationInfo.companyName || commonName || "Catalyst App"],
        ["OU", organizationInfo.department],
        ["O", org],
        ["L", organizationInfo.city],
        ["ST", organizationInfo.state],
        ["C", organizationInfo.countryCode],
    ]
    return parts
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}=${escape(value)}`)
        .join(", ")
}

/**
 * Create a PKCS12 upload keystore. PKCS12 uses one password for the store
 * and the key, so `password` is both.
 *
 * @param {string} storeFile
 * @param {object} key
 * @param {string} [key.keyAlias]
 * @param {string} key.password
 * @param {Record<string, string>} [key.organizationInfo] - from android.keystoreConfig
 * @param {string} [key.commonName] - CN when organizationInfo has no companyName
 * @param {number} [key.validityYears]
 * @param {{ env?: Record<string, string | undefined>, exec?: Function }} [options]
 */
function createUploadKeystore(
    storeFile,
    { keyAlias = DEFAULT_ALIAS, password, organizationInfo, commonName, validityYears = 25 },
    options = {}
) {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true, mode: 0o700 })
    const args = [
        "-genkeypair",
        "-storetype",
        "PKCS12",
        "-keystore",
        storeFile,
        "-alias",
        keyAlias,
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        String(validityYears * 365),
        "-storepass:env",
        "CATALYST_KEYTOOL_STOREPASS",
        "-keypass:env",
        "CATALYST_KEYTOOL_KEYPASS",
        "-dname",
        distinguishedName(organizationInfo, commonName),
    ]
    try {
        runKeytool(args, { storePassword: password, keyPassword: password }, options)
    } catch (error) {
        const detail = String(error.stderr || error.message || "")
            .trim()
            .split("\n")[0]
        throw new Error(`keytool could not create the upload key: ${detail}`)
    }
    fs.chmodSync(storeFile, 0o600)
    return storeFile
}

/**
 * Fail before Gradle when the store, password or alias don't match.
 *
 * @param {{ storeFile: string, keyAlias: string, storePassword: string }} signing
 * @param {{ env?: Record<string, string | undefined>, exec?: Function }} [options]
 */
function verifyKeystore(signing, options = {}) {
    try {
        runKeytool(
            [
                "-list",
                "-keystore",
                signing.storeFile,
                "-alias",
                signing.keyAlias,
                "-storepass:env",
                "CATALYST_KEYTOOL_STOREPASS",
            ],
            { storePassword: signing.storePassword },
            options
        )
    } catch (error) {
        if (error.code === "ENOENT") throw error
        const detail = String(error.stderr || error.stdout || error.message || "")
            .trim()
            .split("\n")
            .pop()
        throw nativeError(
            "ANDROID-006",
            `keytool could not open ${signing.storeFile} with alias "${signing.keyAlias}"${detail ? ` (${detail})` : ""}`
        )
    }
}

/** True when config.json carries keystore passwords, which belong in credentials/ or CI secrets. */
function configHasPasswords(androidConfig = {}) {
    const blocks = [androidConfig.keystoreConfig, androidConfig.keystore].filter(Boolean)
    return blocks.some((block) => block.storePassword || block.keyPassword)
}

function legacyPasswords(androidConfig = {}) {
    if (androidConfig.keystoreConfig?.storePassword) {
        return {
            keyAlias: androidConfig.keystoreConfig.keyAlias || "release",
            password: androidConfig.keystoreConfig.storePassword,
        }
    }
    if (androidConfig.keystore?.storePassword) {
        return {
            keyAlias: androidConfig.keystore.alias || "release",
            password: androidConfig.keystore.storePassword,
        }
    }
    return null
}

function isYes(answer) {
    return /^y(es)?$/i.test(String(answer || "").trim())
}

/**
 * Work out which upload key signs this release, creating or adopting one
 * after a terminal confirm when there is none.
 *
 * Precedence: CATALYST_ANDROID_KEYSTORE_BASE64, then android.signing.storeFile,
 * then credentials/android/upload.jks. Passwords and alias come from the
 * CATALYST_ANDROID_* variables, else the keystore.properties beside the key.
 *
 * @param {object} [options]
 * @param {string} [options.appRoot]
 * @param {Record<string, any>} [options.androidConfig] - WEBVIEW_CONFIG.android
 * @param {Record<string, string | undefined>} [options.env]
 * @param {boolean} [options.isTTY]
 * @param {(question: string, options?: object) => Promise<string>} [options.prompt]
 * @param {(message: string, type?: string) => void} [options.log]
 * @param {string} [options.legacyKeystorePath] - build-output/<name>-keystore.jks from releases before 1.1.1
 * @param {string} [options.commonName] - certificate CN for a new key
 * @param {Function} [options.exec] - execFileSync stand-in, for tests
 * @returns {Promise<{storeFile: string, storePassword: string, keyAlias: string, keyPassword: string, source: string, cleanup: () => void}>}
 */
async function resolveAndroidSigning({
    appRoot = process.cwd(),
    androidConfig = {},
    env = process.env,
    isTTY = Boolean(process.stdin.isTTY),
    prompt = promptUser,
    log = () => {},
    legacyKeystorePath,
    commonName,
    exec,
} = {}) {
    const keytoolOptions = { env, ...(exec ? { exec } : {}) }
    const paths = credentialPaths(appRoot)
    let cleanup = () => {}

    if (configHasPasswords(androidConfig)) {
        log(
            "config/config.json holds keystore passwords (android.keystoreConfig or android.keystore). " +
                "Move them to credentials/android/keystore.properties or CI secrets and delete them from the config.",
            "warning"
        )
    }

    const finish = (storeFile, values, source) => {
        const storePassword = env.CATALYST_ANDROID_STORE_PASSWORD || values.storePassword
        const keyAlias =
            env.CATALYST_ANDROID_KEY_ALIAS ||
            values.keyAlias ||
            androidConfig.signing?.keyAlias ||
            DEFAULT_ALIAS
        const keyPassword = env.CATALYST_ANDROID_KEY_PASSWORD || values.keyPassword || storePassword
        if (!storePassword) {
            cleanup()
            throw nativeError(
                "ANDROID-006",
                `no store password for ${storeFile}; set CATALYST_ANDROID_STORE_PASSWORD or storePassword in ${path.join(CREDENTIALS_DIR, "keystore.properties")}`
            )
        }
        const signing = { storeFile, storePassword, keyAlias, keyPassword, source, cleanup }
        try {
            verifyKeystore(signing, keytoolOptions)
        } catch (error) {
            cleanup()
            throw error
        }
        return signing
    }

    // 1. CI: the whole keystore in an environment variable.
    if (env.CATALYST_ANDROID_KEYSTORE_BASE64) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-android-signing-"))
        cleanup = () => fs.rmSync(dir, { recursive: true, force: true })
        const storeFile = path.join(dir, "upload.jks")
        fs.writeFileSync(storeFile, Buffer.from(env.CATALYST_ANDROID_KEYSTORE_BASE64, "base64"), {
            mode: 0o600,
        })
        return finish(storeFile, {}, "CATALYST_ANDROID_KEYSTORE_BASE64")
    }

    // 2. A keystore the config points at.
    if (androidConfig.signing?.storeFile) {
        const storeFile = path.resolve(appRoot, androidConfig.signing.storeFile)
        if (!fs.existsSync(storeFile)) {
            throw nativeError("ANDROID-006", `android.signing.storeFile does not exist: ${storeFile}`)
        }
        const values = readKeystoreProperties(path.join(path.dirname(storeFile), "keystore.properties"))
        return finish(storeFile, values, "android.signing.storeFile")
    }

    // 3. The app's own upload key.
    if (fs.existsSync(paths.storeFile)) {
        ensureGitignored(appRoot)
        return finish(paths.storeFile, readKeystoreProperties(paths.propertiesFile), CREDENTIALS_DIR)
    }

    // 4. Nothing yet. Adopting or creating a key needs a person to say yes.
    const legacy = legacyKeystorePath && fs.existsSync(legacyKeystorePath) ? legacyKeystorePath : null
    const legacyPw = legacyPasswords(androidConfig)
    const relStore = path.relative(appRoot, paths.storeFile)

    if (!isTTY) {
        const detail = legacy
            ? `found ${legacy} from an earlier build; run the release build once in a terminal to adopt it`
            : `nothing at ${relStore} and no CATALYST_ANDROID_KEYSTORE_BASE64`
        throw nativeError("ANDROID-005", detail)
    }

    if (legacy && legacyPw) {
        const answer = await prompt(
            `Found ${path.relative(appRoot, legacy)} from an earlier release build. Keep using it as the upload key (moves a copy to ${relStore})? (y/N)`,
            { defaultValue: "n" }
        )
        if (isYes(answer)) {
            fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 })
            fs.copyFileSync(legacy, paths.storeFile)
            fs.chmodSync(paths.storeFile, 0o600)
            writeKeystoreProperties(paths.propertiesFile, {
                keyAlias: legacyPw.keyAlias,
                storePassword: legacyPw.password,
                keyPassword: legacyPw.password,
            })
            if (ensureGitignored(appRoot)) log("Added credentials/ to .gitignore", "info")
            log(`Upload key adopted at ${relStore}. Back up credentials/android/.`, "success")
            return finish(paths.storeFile, readKeystoreProperties(paths.propertiesFile), "adopted")
        }
    }

    const answer = await prompt(
        `No upload key found. Create one at ${relStore}? Back it up: Play only accepts updates signed with it. (y/N)`,
        { defaultValue: "n" }
    )
    if (!isYes(answer)) throw nativeError("ANDROID-005", "creating a new upload key was declined")

    const keyAlias = androidConfig.signing?.keyAlias || DEFAULT_ALIAS
    const password = generatePassword()
    createUploadKeystore(
        paths.storeFile,
        {
            keyAlias,
            password,
            organizationInfo: androidConfig.keystoreConfig?.organizationInfo,
            commonName,
            validityYears: androidConfig.keystoreConfig?.validityYears || 25,
        },
        keytoolOptions
    )
    writeKeystoreProperties(paths.propertiesFile, {
        keyAlias,
        storePassword: password,
        keyPassword: password,
    })
    if (ensureGitignored(appRoot)) log("Added credentials/ to .gitignore", "info")
    log(
        `Created the upload key at ${relStore}. Back up credentials/android/; it cannot be recovered.`,
        "success"
    )
    return finish(paths.storeFile, readKeystoreProperties(paths.propertiesFile), "created")
}

/** The Gradle project properties that sign the release, as environment variables. */
function signingGradleEnv(signing) {
    return {
        ORG_GRADLE_PROJECT_catalystStoreFile: signing.storeFile,
        ORG_GRADLE_PROJECT_catalystStorePassword: signing.storePassword,
        ORG_GRADLE_PROJECT_catalystKeyAlias: signing.keyAlias,
        ORG_GRADLE_PROJECT_catalystKeyPassword: signing.keyPassword,
    }
}

export {
    CREDENTIALS_DIR,
    credentialPaths,
    readKeystoreProperties,
    writeKeystoreProperties,
    ensureGitignored,
    distinguishedName,
    createUploadKeystore,
    verifyKeystore,
    configHasPasswords,
    resolveAndroidSigning,
    signingGradleEnv,
}
