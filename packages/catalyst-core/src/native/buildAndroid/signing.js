import { execFileSync } from "child_process"
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { askConsent, confirm, nativeError, promptUser } from "../utils.js"
import { maskSecret, resolveCredentials } from "../credentials.js"

// Release signing for Android: one persistent upload key per app (#508).
//
// The key used to be generated inside the temp_build_<pkg> copy, which is
// wiped on every run, so every release was signed with a new key and Play
// rejected all but the first upload. It now lives in the app, outside git:
//
//   <app>/credentials/android/upload.jks
//   <app>/credentials/android/keystore.properties   (0600: alias + passwords)
//
// CI gets the same folder from the CATALYST_ANDROID_CREDENTIALS secret
// (catalyst credentials:export android), through resolveCredentials.
// Passwords never go on a command line: keytool reads them with
// -storepass:env, Gradle through ORG_GRADLE_PROJECT_* variables. No code
// path here deletes or overwrites an existing key.

const CREDENTIALS_DIR = path.join("credentials", "android")
const DEFAULT_ALIAS = "upload"
const DEFAULT_STORE_FILE = "upload.jks"
const GITIGNORE_ENTRY = "credentials/"
// Play Console Help, "Use Play App Signing": resetting a lost or compromised upload key.
const PLAY_UPLOAD_KEY_RESET_URL = "https://support.google.com/googleplay/android-developer/answer/9842756"
const BACKUP_REMINDER =
    "Back it up now: run catalyst credentials:export android and keep the value somewhere safe, such as a password manager. Play only accepts updates signed with this key."

/** The key files in a credentials folder; keystore.properties may name another storeFile in the same folder. */
function keyPaths(dir) {
    const propertiesFile = path.join(dir, "keystore.properties")
    const named = path.basename(
        String(readKeystoreProperties(propertiesFile).storeFile || DEFAULT_STORE_FILE)
    )
    return { dir, storeFile: path.join(dir, named), propertiesFile }
}

/**
 * Where releases before 1.1.1 left a copy of their keystore:
 * <android.outputPath or build-output>/<name>-keystore.jks, with the name
 * those releases used (newProjectName, then appName, then the last part of
 * packageName). Pass WEBVIEW_CONFIG.android as written in config.json, not
 * the resolved block: appId and appName overwrite packageName and appName.
 *
 * @param {Record<string, any>} [androidConfig]
 * @param {object} [options]
 * @param {string} [options.cwd]
 */
function legacyKeystorePath(androidConfig = {}, { cwd = process.cwd() } = {}) {
    const name =
        androidConfig.newProjectName ||
        androidConfig.appName ||
        androidConfig.packageName?.split(".").pop() ||
        "catalystapp"
    const outputPath = androidConfig.outputPath || path.join(cwd, "build-output")
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - outputPath and the name come from the app's own config.
    return path.resolve(cwd, outputPath, `${name}-keystore.jks`)
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

/** Write keystore.properties for a new key. Refuses to replace an existing file. */
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
    // "wx": fail rather than replace the passwords of a key that exists.
    fs.writeFileSync(file, body, { mode: 0o600, flag: "wx" })
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
 * and the key, so `password` is both. Never replaces an existing file.
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
    if (fs.existsSync(storeFile)) {
        throw new Error(`Refusing to replace the existing upload key at ${storeFile}`)
    }
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

/**
 * Write the upload certificate as PEM (`keytool -exportcert -rfc`). Play asks
 * for it when an upload key is registered or reset, and it identifies which
 * key signed a bundle (#508).
 *
 * @param {{ storeFile: string, keyAlias: string, storePassword: string }} signing
 * @param {string} destFile
 * @param {{ env?: Record<string, string | undefined>, exec?: Function }} [options]
 * @returns {string} destFile
 */
function exportUploadCertificate(signing, destFile, options = {}) {
    fs.mkdirSync(path.dirname(destFile), { recursive: true })
    try {
        runKeytool(
            [
                "-exportcert",
                "-rfc",
                "-keystore",
                signing.storeFile,
                "-alias",
                signing.keyAlias,
                "-storepass:env",
                "CATALYST_KEYTOOL_STOREPASS",
                "-file",
                destFile,
            ],
            { storePassword: signing.storePassword },
            options
        )
    } catch (error) {
        const detail = String(error.stderr || error.message || "")
            .trim()
            .split("\n")[0]
        throw new Error(`keytool could not export the upload certificate: ${detail}`)
    }
    return destFile
}

/**
 * Work out which upload key signs this release.
 *
 * The key comes from credentials/android/ (upload.jks and keystore.properties),
 * or in CI from the CATALYST_ANDROID_CREDENTIALS secret (resolveCredentials).
 * When there is none, a person at a terminal may adopt a keystore an older
 * release left in build-output/, or create a new key. Without a terminal no
 * key is ever created, whatever the flags. A new key is refused for an app
 * that is already on Google Play: its updates must be signed with the key
 * Play knows, and only Play can reset that.
 *
 * Every password read is masked in GitHub Actions logs (maskSecret).
 *
 * @param {object} [options]
 * @param {string} [options.appRoot]
 * @param {Record<string, any>} [options.androidConfig] - WEBVIEW_CONFIG.android
 * @param {Record<string, string | undefined>} [options.env]
 * @param {boolean} [options.isTTY]
 * @param {(question: string, options?: object) => Promise<string>} [options.prompt]
 * @param {(message: string, type?: string) => void} [options.log]
 * @param {string} [options.legacyKeystorePath] - build-output/<name>-keystore.jks from earlier releases
 * @param {string} [options.commonName] - certificate CN for a new key
 * @param {Function} [options.exec] - execFileSync stand-in, for tests
 * @param {(value: string, options?: object) => unknown} [options.mask] - maskSecret stand-in, for tests
 * @returns {Promise<{storeFile: string, storePassword: string, keyAlias: string, keyPassword: string, source: string, created: boolean, cleanup: () => void}>}
 */
async function resolveAndroidSigning({
    appRoot = process.cwd(),
    androidConfig = {},
    env = process.env,
    isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompt = promptUser,
    log = () => {},
    legacyKeystorePath,
    commonName,
    exec,
    mask = maskSecret,
} = {}) {
    const keytoolOptions = { env, ...(exec ? { exec } : {}) }

    if (configHasPasswords(androidConfig)) {
        log(
            "config/config.json holds keystore passwords (android.keystoreConfig or android.keystore). " +
                "Move them to credentials/android/keystore.properties and delete them from the config.",
            "warning"
        )
    }

    const credentials = resolveCredentials("android", { cwd: appRoot, env, log })
    const { cleanup } = credentials
    const paths = keyPaths(credentials.dir)
    const where =
        credentials.source === "env"
            ? credentials.envName
            : path.relative(appRoot, paths.dir) || CREDENTIALS_DIR

    const fail = (code, detail, extra) => {
        cleanup()
        return nativeError(code, detail, extra)
    }

    const finish = (storeFile, source, created = false) => {
        const values = readKeystoreProperties(paths.propertiesFile)
        const storePassword = values.storePassword
        const keyAlias = values.keyAlias || DEFAULT_ALIAS
        const keyPassword = values.keyPassword || storePassword
        if (!storePassword) {
            throw fail("ANDROID-006", `no storePassword in keystore.properties (${where})`)
        }
        mask(storePassword, { env })
        if (keyPassword !== storePassword) mask(keyPassword, { env })
        const signing = { storeFile, storePassword, keyAlias, keyPassword, source, created, cleanup }
        try {
            verifyKeystore(signing, keytoolOptions)
        } catch (error) {
            cleanup()
            throw error
        }
        return signing
    }

    // 1. The key is there: the app's folder, or the CI secret.
    if (fs.existsSync(paths.storeFile)) {
        if (credentials.source === "folder") ensureGitignored(appRoot)
        return finish(paths.storeFile, credentials.source === "env" ? credentials.envName : CREDENTIALS_DIR)
    }
    if (credentials.source === "env") {
        throw fail("ANDROID-006", `${credentials.envName} has no ${path.basename(paths.storeFile)}`)
    }
    // Settings without their key: the key was lost or not copied. A new key
    // would not match the one Play knows, so stop here.
    if (fs.existsSync(paths.propertiesFile)) {
        throw fail(
            "ANDROID-006",
            `${where}/keystore.properties is there but ${path.basename(paths.storeFile)} is not; restore the key from your backup`
        )
    }

    // 2. Nothing yet. Adopting or creating a key needs a person to say yes.
    const legacy = legacyKeystorePath && fs.existsSync(legacyKeystorePath) ? legacyKeystorePath : null
    const legacyPw = legacyPasswords(androidConfig)
    const relStore = path.relative(appRoot, paths.storeFile)

    if (!isTTY) {
        const detail = legacy
            ? `found ${legacy} from an earlier build; run the release build once in a terminal to adopt it`
            : `nothing in ${CREDENTIALS_DIR} and no ${credentials.envName}`
        throw fail("ANDROID-005", detail)
    }

    if (legacy && legacyPw) {
        const adopt = await askConsent(
            "key",
            `Found ${path.relative(appRoot, legacy)} from an earlier release build. Keep using it as the upload key (copies it to ${relStore})`,
            { isTTY, prompt }
        )
        if (adopt) {
            fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 })
            fs.copyFileSync(legacy, paths.storeFile, fs.constants.COPYFILE_EXCL)
            fs.chmodSync(paths.storeFile, 0o600)
            writeKeystoreProperties(paths.propertiesFile, {
                keyAlias: legacyPw.keyAlias,
                storePassword: legacyPw.password,
                keyPassword: legacyPw.password,
            })
            if (ensureGitignored(appRoot)) log("Added credentials/ to .gitignore", "info")
            log(`Upload key adopted at ${relStore}. ${BACKUP_REMINDER}`, "warning")
            return finish(paths.storeFile, "adopted")
        }
    }

    const create = await askConsent(
        "key",
        `No upload key found. Create one in ${CREDENTIALS_DIR}/ (PKCS12, kept out of git)`,
        { isTTY, prompt }
    )
    if (!create) throw fail("ANDROID-005", "creating a new upload key was declined")

    const onPlay = await confirm("Has this app been uploaded to Google Play before", {
        defaultYes: false,
        prompt,
        isTTY: true,
    })
    if (onPlay) {
        throw fail(
            "ANDROID-005",
            "this app is already on Google Play, so a new upload key would be rejected",
            {
                hint: `Put the upload key the app was signed with in ${CREDENTIALS_DIR}/ (upload.jks and keystore.properties). If it is lost, ask Google Play to reset the upload key: ${PLAY_UPLOAD_KEY_RESET_URL}`,
            }
        )
    }

    const keyAlias = DEFAULT_ALIAS
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
    log(`Created the upload key at ${relStore}. ${BACKUP_REMINDER}`, "warning")
    return finish(paths.storeFile, "created", true)
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
    PLAY_UPLOAD_KEY_RESET_URL,
    keyPaths,
    legacyKeystorePath,
    readKeystoreProperties,
    writeKeystoreProperties,
    ensureGitignored,
    distinguishedName,
    createUploadKeystore,
    verifyKeystore,
    exportUploadCertificate,
    configHasPasswords,
    resolveAndroidSigning,
    signingGradleEnv,
}
