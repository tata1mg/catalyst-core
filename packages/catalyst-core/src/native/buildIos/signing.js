import { execFileSync } from "child_process"
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { nativeError } from "../utils.js"
import { cleanupOnSignal, maskSecret } from "../credentials.js"

// iOS signing without opening Xcode. Signing files live in the app's
// git-ignored credentials/ios/ folder, or in CI in the one
// CATALYST_IOS_CREDENTIALS secret (`catalyst credentials:export ios`), which
// resolveCredentials("ios") unpacks to a private temp folder:
//
//   credentials/ios/
//     AuthKey_<KEYID>.p8     App Store Connect API key: cloud signing
//     <name>.p12             distribution certificate and its private key: local signing
//     <name>.mobileprovision the provisioning profile for that certificate
//     signing.properties     ascIssuerId=<uuid>, ascKeyId=<id> (optional, else from
//                            the .p8 file name), p12Password=<password of the .p12>
//
// A release signs, in this order:
//
//   1. Locally with the .p12 and profile: the p12 goes into a temporary
//      keychain and the profile into Xcode's profile folders, and both are
//      removed again when the build ends, also on Ctrl+C.
//   2. Manually with an installed profile: ios.provisioningProfile.
//   3. Automatically for ios.developmentTeam: cloud signing with the API key,
//      or whatever Apple account is signed in to Xcode.
//
// `security` takes the p12 password (`import -P`) and the throwaway keychain
// password (`create-keychain -p`, `unlock-keychain -p`, `set-key-partition-list
// -k`) only as arguments: it has no environment or stdin form for them, and
// leaving them out makes it ask through a GUI prompt. They are never logged,
// they are masked under GitHub Actions (maskSecret), and every error from
// these commands is scrubbed of both before it is shown.

// Xcode 26's names. The pre-Xcode 15.3 names still work there, with a warning.
const EXPORT_METHODS = ["app-store-connect", "release-testing", "enterprise", "debugging"]
const LEGACY_EXPORT_METHODS = {
    "app-store": "app-store-connect",
    "ad-hoc": "release-testing",
    development: "debugging",
}

const KEYCHAIN_LOCK_TIMEOUT_SECONDS = 6 * 60 * 60

const SIGNING_PROPERTIES = "signing.properties"

/** `ios.buildType: "release"`, in any case, asks for a release build like `--release`. */
function isReleaseBuildType(buildType) {
    return (
        String(buildType || "")
            .trim()
            .toLowerCase() === "release"
    )
}

function defaultRun(command, args, { input, env } = {}) {
    return execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        input,
        env: env || process.env,
        maxBuffer: 64 * 1024 * 1024,
    })
}

/**
 * The export method for `-exportArchive`: ios.exportMethod, default
 * app-store-connect. Legacy names map to their Xcode 26 equivalent.
 *
 * @param {Record<string, any>} [iosConfig]
 * @param {{ log?: (message: string, type?: string) => void }} [options]
 */
function resolveExportMethod(iosConfig = {}, { log = () => {} } = {}) {
    const raw = iosConfig.exportMethod
    if (raw === undefined || raw === null || String(raw).trim() === "") return "app-store-connect"
    const value = String(raw).trim().toLowerCase()
    if (EXPORT_METHODS.includes(value)) return value
    if (LEGACY_EXPORT_METHODS[value]) {
        log(
            `ios.exportMethod "${raw}" is the old name; use "${LEGACY_EXPORT_METHODS[value]}" instead.`,
            "warning"
        )
        return LEGACY_EXPORT_METHODS[value]
    }
    throw nativeError("IOS-013", `"${raw}"`)
}

/** Java-style .properties, the subset people write by hand: key=value (or key: value) lines, # and ! comments. */
function parseProperties(text) {
    const values = {}
    for (const raw of String(text || "").split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith("#") || line.startsWith("!")) continue
        const match = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(line)
        if (match) values[match[1]] = match[2].trim()
    }
    return values
}

/**
 * What credentials/ios/ (or the unpacked CATALYST_IOS_CREDENTIALS) holds.
 * Each password read is masked under GitHub Actions before anything else can
 * print it.
 *
 * @param {string} dir - from resolveCredentials("ios")
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env] - for maskSecret
 * @param {(value: string, options?: object) => boolean} [options.mask]
 * @returns {{
 *   dir: string,
 *   apiKey: { keyPath: string, keyId: string, issuerId: string } | null,
 *   p12: { file: string, password: string, profileFile: string } | null,
 * }}
 */
function readIosCredentials(dir, { env = process.env, mask = maskSecret } = {}) {
    let names = []
    try {
        names = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile())
    } catch (error) {
        return { dir, apiKey: null, p12: null }
    }
    const withExt = (ext) => names.filter((name) => name.toLowerCase().endsWith(ext))
    const one = (ext, code) => {
        const found = withExt(ext)
        if (found.length > 1) {
            throw nativeError(
                code,
                `credentials/ios/ holds ${found.length} ${ext} files (${found.join(", ")}); keep one`
            )
        }
        return found[0] ? path.join(dir, found[0]) : null
    }
    const props = names.includes(SIGNING_PROPERTIES)
        ? parseProperties(fs.readFileSync(path.join(dir, SIGNING_PROPERTIES), "utf8"))
        : {}
    if (props.p12Password) mask(props.p12Password, { env })

    // App Store Connect API key.
    let apiKey = null
    const keyFile = one(".p8", "IOS-011")
    if (keyFile || props.ascKeyId || props.ascIssuerId) {
        const fromName = keyFile ? /^AuthKey_([A-Za-z0-9]+)\.p8$/i.exec(path.basename(keyFile)) : null
        const keyId = String(props.ascKeyId || fromName?.[1] || "").trim()
        const issuerId = String(props.ascIssuerId || "").trim()
        const missing = []
        if (!keyFile) missing.push("the key file (AuthKey_<KEYID>.p8)")
        if (!keyId)
            missing.push(
                `the key ID (ascKeyId in ${SIGNING_PROPERTIES}, or the AuthKey_<KEYID>.p8 file name)`
            )
        if (!issuerId) missing.push(`the issuer ID (ascIssuerId in ${SIGNING_PROPERTIES})`)
        if (missing.length) throw nativeError("IOS-011", `credentials/ios/ is missing ${missing.join(", ")}`)
        if (!/^[A-Za-z0-9]+$/.test(keyId)) {
            throw nativeError("IOS-011", `the key ID "${keyId}" should be letters and digits only`)
        }
        apiKey = { keyPath: keyFile, keyId, issuerId }
    }

    // Distribution certificate and profile.
    let p12 = null
    const p12File = one(".p12", "IOS-012")
    const profileFile = one(".mobileprovision", "IOS-012")
    if (p12File && !profileFile) {
        throw nativeError("IOS-012", "credentials/ios/ has a .p12 but no .mobileprovision for it")
    }
    if (profileFile && !p12File) {
        throw nativeError("IOS-012", "credentials/ios/ has a .mobileprovision but no .p12 to sign with")
    }
    if (p12File) p12 = { file: p12File, password: props.p12Password ?? "", profileFile }

    return { dir, apiKey, p12 }
}

/**
 * xcodebuild flags that let automatic signing create and fetch certificates
 * and profiles: with the API key when there is one (cloud signing),
 * otherwise with the Apple account signed in to Xcode.
 */
function xcodeAuthArgs(apiKey) {
    const args = ["-allowProvisioningUpdates", "-allowProvisioningDeviceRegistration"]
    if (apiKey) {
        args.push(
            "-authenticationKeyPath",
            apiKey.keyPath,
            "-authenticationKeyID",
            apiKey.keyId,
            "-authenticationKeyIssuerID",
            apiKey.issuerId
        )
    }
    return args
}

/**
 * How this build signs, decided from the config and the credentials alone
 * (no side effects), so the entitlements can be written before Xcode runs.
 *
 * aps-environment: Xcode's entitlements merger takes aps-environment from the
 * provisioning profile it signs with. An automatic-signing archive is signed
 * for development and export re-signs it with the distribution profile, so
 * the archive keeps "development". A manual release archive is signed with
 * the distribution profile directly, so it must already say "production".
 *
 * @param {object} options
 * @param {Record<string, any>} [options.iosConfig]
 * @param {ReturnType<typeof readIosCredentials> | null} [options.credentials]
 * @param {boolean} [options.release]
 * @param {string} [options.exportMethod]
 */
function planIosSigning({
    iosConfig = {},
    credentials = null,
    release = false,
    exportMethod = "app-store-connect",
} = {}) {
    const teamId = String(iosConfig.developmentTeam || "").trim()
    const distribution = release && exportMethod !== "debugging"
    if (release && credentials?.p12) {
        return {
            style: "manual",
            source: "credentials/ios .p12",
            p12: true,
            teamId,
            apsEnvironment: distribution ? "production" : "development",
        }
    }
    if (iosConfig.provisioningProfile) {
        return {
            style: "manual",
            source: "ios.provisioningProfile",
            p12: false,
            teamId,
            provisioningProfile: String(iosConfig.provisioningProfile),
            apsEnvironment: distribution ? "production" : "development",
        }
    }
    return {
        style: "automatic",
        source: credentials?.apiKey ? "App Store Connect API key" : "Xcode account",
        p12: false,
        teamId,
        apsEnvironment: "development",
    }
}

/** The quoted paths `security list-keychains` prints, one per line. */
function parseKeychainList(output) {
    return [...String(output || "").matchAll(/"([^"]+)"/g)].map((match) => match[1])
}

/** The first valid identity `security find-identity -v -p codesigning` lists. */
function parseIdentity(output) {
    const match = /^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"([^"]+)"/m.exec(String(output || ""))
    return match ? { sha1: match[1].toUpperCase(), name: match[2] } : null
}

/** Whether a profile's application-identifier (TEAM.bundle, maybe ending in *) covers the bundle id. */
function profileMatchesBundleId(applicationIdentifier, bundleId) {
    if (!applicationIdentifier || !bundleId) return true
    const appId = applicationIdentifier.slice(applicationIdentifier.indexOf(".") + 1)
    if (appId === "*" || appId === bundleId) return true
    return appId.endsWith("*") && bundleId.startsWith(appId.slice(0, -1))
}

/** Xcode 16+ keeps profiles under UserData; older Xcode (and Xcode 26 still) also reads MobileDevice. */
function profileDirectories(homeDir = os.homedir()) {
    return [
        path.join(homeDir, "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles"),
        path.join(homeDir, "Library", "MobileDevice", "Provisioning Profiles"),
    ]
}

/**
 * Turn a failed command into an error that carries neither secret, wherever
 * the tool or Node put it (execFileSync's message holds the whole argv).
 */
function scrubbedFailure(error, secrets, prefix) {
    const scrub = (text) =>
        secrets.reduce((acc, secret) => (secret ? acc.split(secret).join("***") : acc), String(text || ""))
    const said = String(error?.stderr || error?.stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop()
    const failure = new Error(scrub(`${prefix}${said ? `: ${said}` : ""}`))
    if (error?.code === "ENOENT") failure.code = "ENOENT"
    return failure
}

/**
 * Read the fields a build needs from a .mobileprovision (a CMS-signed plist).
 *
 * @param {string} file
 * @param {object} options
 * @param {string} options.workDir - a private folder for the decoded plist
 * @param {Function} [options.run]
 */
function readProvisioningProfile(file, { workDir, run = defaultRun }) {
    const decoded = path.join(workDir, "profile.plist")
    try {
        run("security", ["cms", "-D", "-i", file, "-o", decoded])
    } catch (error) {
        throw nativeError("IOS-012", `${path.basename(file)} is not a provisioning profile`)
    }
    const extract = (keyPath) => {
        try {
            return String(run("plutil", ["-extract", keyPath, "raw", "-o", "-", decoded])).trim() || undefined
        } catch (error) {
            return undefined
        }
    }
    const profile = {
        uuid: extract("UUID"),
        name: extract("Name"),
        teamId: extract("TeamIdentifier.0"),
        applicationIdentifier: extract("Entitlements.application-identifier"),
        apsEnvironment: extract("Entitlements.aps-environment"),
        expirationDate: extract("ExpirationDate"),
    }
    if (!profile.uuid || !/^[0-9A-Fa-f-]+$/.test(profile.uuid)) {
        throw nativeError("IOS-012", "the provisioning profile has no UUID")
    }
    return profile
}

/**
 * Local signing with credentials/ios/: import the .p12 into a temporary
 * keychain, put that keychain on the user search list, and install the
 * .mobileprovision where Xcode looks for profiles.
 *
 * `cleanup()` restores the exact search list read before anything changed,
 * deletes the keychain (and the decoded profile beside it), and removes the
 * profile files this call created. It never touches credentials/ios/. It runs on failure here, and on SIGINT/SIGTERM until the
 * caller has run it. Call it in a `finally`.
 *
 * @param {object} options
 * @param {{ file: string, password?: string, profileFile: string }} options.p12 - from readIosCredentials
 * @param {string} [options.bundleId] - checked against the profile
 * @param {Record<string, string | undefined>} [options.env] - for maskSecret
 * @param {(value: string, options?: object) => boolean} [options.mask]
 * @param {(command: string, args: string[], options?: object) => string} [options.run]
 * @param {string} [options.homeDir]
 * @param {string} [options.tmpRoot]
 * @param {(message: string, type?: string) => void} [options.log]
 * @param {{ once: Function, removeListener: Function }} [options.signals]
 * @param {(code: number) => void} [options.exit]
 * @param {() => Date} [options.now]
 */
function setupP12Signing({
    p12,
    bundleId,
    env = process.env,
    mask = maskSecret,
    run = defaultRun,
    homeDir = os.homedir(),
    tmpRoot = os.tmpdir(),
    log = () => {},
    signals = process,
    exit = (code) => process.exit(code),
    now = () => new Date(),
} = {}) {
    const p12Password = p12?.password ?? ""
    const keychainPassword = crypto.randomBytes(24).toString("base64url")
    if (p12Password) mask(p12Password, { env })
    mask(keychainPassword, { env })
    const p12Name = path.basename(p12?.file || "the .p12")
    const secrets = [p12Password, keychainPassword].filter(Boolean)
    const exec = (command, args, prefix) => {
        try {
            return run(command, args)
        } catch (error) {
            throw scrubbedFailure(error, secrets, prefix)
        }
    }

    const workDir = fs.mkdtempSync(path.join(tmpRoot, "catalyst-ios-signing-"))
    fs.chmodSync(workDir, 0o700)
    const keychainPath = path.join(workDir, "catalyst-signing.keychain-db")
    const state = { originalList: null, keychainCreated: false, installed: [], createdDirs: [] }

    let cleaned = false
    let releaseSignals = () => {}
    function cleanup() {
        if (cleaned) return
        cleaned = true
        releaseSignals()
        const step = (what, fn) => {
            try {
                fn()
            } catch (error) {
                log(
                    `Signing cleanup could not ${what}: ${scrubbedFailure(error, secrets, "").message}`,
                    "warning"
                )
            }
        }
        if (state.originalList) {
            step("restore the keychain search list", () =>
                run("security", ["list-keychains", "-d", "user", "-s", ...state.originalList])
            )
        }
        if (state.keychainCreated) {
            step("delete the temporary keychain", () => run("security", ["delete-keychain", keychainPath]))
        }
        for (const file of state.installed) step(`remove ${file}`, () => fs.rmSync(file, { force: true }))
        for (const dir of state.createdDirs.reverse()) {
            step(`remove ${dir}`, () => {
                if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
            })
        }
        step("remove the temporary signing folder", () =>
            fs.rmSync(workDir, { recursive: true, force: true })
        )
    }
    releaseSignals = cleanupOnSignal(cleanup, { signals, exit })

    try {
        const p12File = p12.file
        const profileFile = p12.profileFile

        // Read first: whatever happens next, cleanup puts exactly this back.
        state.originalList = parseKeychainList(
            exec("security", ["list-keychains", "-d", "user"], "Could not read the keychain search list")
        )
        state.keychainCreated = true
        exec(
            "security",
            ["create-keychain", "-p", keychainPassword, keychainPath],
            "Could not create the temporary keychain"
        )
        exec(
            "security",
            ["set-keychain-settings", "-lut", String(KEYCHAIN_LOCK_TIMEOUT_SECONDS), keychainPath],
            "Could not configure the temporary keychain"
        )
        exec(
            "security",
            ["unlock-keychain", "-p", keychainPassword, keychainPath],
            "Could not unlock the temporary keychain"
        )
        try {
            exec(
                "security",
                [
                    "import",
                    p12File,
                    "-k",
                    keychainPath,
                    "-P",
                    p12Password,
                    "-f",
                    "pkcs12",
                    "-T",
                    "/usr/bin/codesign",
                    "-T",
                    "/usr/bin/security",
                ],
                "security import failed"
            )
        } catch (error) {
            throw nativeError(
                "IOS-012",
                `could not import ${p12Name}; check p12Password in credentials/ios/signing.properties (${error.message})`
            )
        }
        exec(
            "security",
            [
                "set-key-partition-list",
                "-S",
                "apple-tool:,apple:,codesign:",
                "-s",
                "-k",
                keychainPassword,
                keychainPath,
            ],
            "Could not allow codesign to use the imported key"
        )
        exec(
            "security",
            ["list-keychains", "-d", "user", "-s", keychainPath, ...state.originalList],
            "Could not add the temporary keychain to the search list"
        )

        const identity = parseIdentity(
            exec(
                "security",
                ["find-identity", "-v", "-p", "codesigning", keychainPath],
                "Could not list the imported identities"
            )
        )
        if (!identity) {
            throw nativeError("IOS-012", `${p12Name} holds no valid code signing identity`)
        }

        const profile = readProvisioningProfile(profileFile, { workDir, run })
        if (profile.expirationDate && new Date(profile.expirationDate) < now()) {
            throw nativeError(
                "IOS-012",
                `the provisioning profile "${profile.name}" expired on ${profile.expirationDate}`
            )
        }
        if (!profileMatchesBundleId(profile.applicationIdentifier, bundleId)) {
            throw nativeError(
                "IOS-012",
                `the provisioning profile "${profile.name}" is for ${profile.applicationIdentifier}, not ${bundleId}`
            )
        }

        for (const dir of profileDirectories(homeDir)) {
            if (!fs.existsSync(dir)) {
                // Track each new level, so cleanup removes only what it added.
                let missing = dir
                const created = []
                while (!fs.existsSync(missing)) {
                    created.unshift(missing)
                    missing = path.dirname(missing)
                }
                fs.mkdirSync(dir, { recursive: true })
                state.createdDirs.push(...created)
            }
            const target = path.join(dir, `${profile.uuid}.mobileprovision`)
            // A profile already there is the developer's own: use it, never remove it.
            if (fs.existsSync(target)) continue
            fs.copyFileSync(profileFile, target)
            fs.chmodSync(target, 0o600)
            state.installed.push(target)
        }

        log(`Signing with "${identity.name}" and profile "${profile.name}" (${profile.uuid})`, "info")
        return { keychainPath, identity, profile, cleanup }
    } catch (error) {
        cleanup()
        throw error
    }
}

/**
 * The ExportOptions.plist contents for `xcodebuild -exportArchive`.
 *
 * manageAppVersionAndBuildNumber is off so the IPA carries exactly the
 * version and build number Catalyst set.
 *
 * @param {object} options
 * @param {string} options.method
 * @param {string} [options.teamId]
 * @param {string} options.signingStyle - "automatic" or "manual"
 * @param {string} [options.bundleId]
 * @param {string} [options.profileName]
 * @param {string} [options.signingCertificate]
 * @returns {Record<string, any>}
 */
function buildExportOptions({ method, teamId, signingStyle, bundleId, profileName, signingCertificate }) {
    const options = { method, signingStyle, destination: "export", stripSwiftSymbols: true }
    if (teamId) options.teamID = teamId
    if (signingStyle === "manual") {
        if (bundleId && profileName) options.provisioningProfiles = { [bundleId]: profileName }
        if (signingCertificate) options.signingCertificate = signingCertificate
    }
    if (method === "app-store-connect") {
        options.uploadSymbols = true
        options.manageAppVersionAndBuildNumber = false
    }
    return options
}

/**
 * Write the export options as an XML plist. plutil does the encoding, so a
 * profile name or team with &, < or quotes comes out escaped.
 */
function writeExportOptionsPlist(options, file, { run = defaultRun } = {}) {
    const json = `${file}.json`
    fs.writeFileSync(json, JSON.stringify(options), { mode: 0o600 })
    try {
        run("plutil", ["-convert", "xml1", "-o", file, json])
    } finally {
        fs.rmSync(json, { force: true })
    }
    return file
}

const SIGNING_FAILURE_PATTERNS = [
    /requires a development team/i,
    /No Accounts?\b/i,
    /No Account for Team/i,
    /No profiles? for ['"].*['"] (?:were|was) found/i,
    /No signing certificate/i,
    /requires a provisioning profile/i,
    /Provisioning profile ".*" (?:doesn't|does not|is not|has expired)/i,
    /doesn't match the entitlements file's value/i,
    /errSecInternalComponent/i,
    /Code ?Sign(?:ing)? error/i,
    /Automatic signing is (?:disabled|unable)/i,
    /authentication ?key/i,
    /Failed Registering Bundle Identifier/i,
]

/** True when xcodebuild failed because of signing rather than the code. */
function isSigningFailure(output) {
    const text = String(output || "")
    return SIGNING_FAILURE_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * The coded error for a signing failure, keeping xcodebuild's transcript for the diagnostic.
 *
 * @param {string} detail
 * @param {any} [cause]
 * @returns {any}
 */
function signingSetupError(detail, cause) {
    const error = nativeError("IOS-010", detail)
    if (cause) {
        error.cause = cause
        if (cause.output) error.output = cause.output
    }
    return error
}

export {
    EXPORT_METHODS,
    SIGNING_PROPERTIES,
    isReleaseBuildType,
    resolveExportMethod,
    parseProperties,
    readIosCredentials,
    xcodeAuthArgs,
    planIosSigning,
    parseKeychainList,
    parseIdentity,
    profileMatchesBundleId,
    profileDirectories,
    readProvisioningProfile,
    setupP12Signing,
    buildExportOptions,
    writeExportOptionsPlist,
    isSigningFailure,
    signingSetupError,
}
