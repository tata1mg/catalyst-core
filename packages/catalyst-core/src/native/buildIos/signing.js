import { execFileSync } from "child_process"
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { expandHome, nativeError } from "../utils.js"

// iOS signing without opening Xcode.
//
// Three ways to sign, picked in this order:
//
//   1. CI manual signing: CATALYST_IOS_P12_BASE64 + CATALYST_IOS_PROFILE_BASE64
//      (+ CATALYST_IOS_P12_PASSWORD). The p12 goes into a temporary keychain
//      and the profile into Xcode's profile folders, and both are removed
//      again when the build ends, also on Ctrl+C.
//   2. Manual signing with an installed profile: ios.provisioningProfile.
//   3. Automatic signing for ios.developmentTeam, with an App Store Connect
//      API key (ios.ascApiKey or CATALYST_ASC_*) or whatever Apple account is
//      signed in to Xcode.
//
// `security` takes the p12 password (`import -P`) and the throwaway keychain
// password (`create-keychain -p`, `unlock-keychain -p`, `set-key-partition-list
// -k`) only as arguments: it has no environment or stdin form for them, and
// leaving them out makes it ask through a GUI prompt. They are never logged,
// and every error from these commands is scrubbed of both before it is shown.

// Xcode 26's names. The pre-Xcode 15.3 names still work there, with a warning.
const EXPORT_METHODS = ["app-store-connect", "release-testing", "enterprise", "debugging"]
const LEGACY_EXPORT_METHODS = {
    "app-store": "app-store-connect",
    "ad-hoc": "release-testing",
    development: "debugging",
}

const KEYCHAIN_LOCK_TIMEOUT_SECONDS = 6 * 60 * 60

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

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

/**
 * The App Store Connect API key for automatic signing, or null when none of
 * its settings is given. The environment wins over ios.ascApiKey field by
 * field. CATALYST_ASC_KEY_BASE64 (or the key's PEM text) is written to a 0600
 * file in a private temp folder that `cleanup()` removes.
 *
 * @param {object} [options]
 * @param {Record<string, any>} [options.iosConfig]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {string} [options.appRoot]
 * @param {(message: string, type?: string) => void} [options.log]
 * @returns {{ keyPath: string, keyId: string, issuerId: string, source: string, cleanup: () => void } | null}
 */
function resolveAscApiKey({
    iosConfig = {},
    env = process.env,
    appRoot = process.cwd(),
    log = () => {},
} = {}) {
    const config = isPlainObject(iosConfig.ascApiKey) ? iosConfig.ascApiKey : {}
    const keyId = String(env.CATALYST_ASC_KEY_ID || config.keyId || "").trim()
    const issuerId = String(env.CATALYST_ASC_ISSUER_ID || config.issuerId || "").trim()
    const inline = env.CATALYST_ASC_KEY_BASE64 ? String(env.CATALYST_ASC_KEY_BASE64).trim() : ""
    const configuredPath = env.CATALYST_ASC_KEY_PATH || config.path
    if (!keyId && !issuerId && !inline && !configuredPath) return null

    const missing = []
    if (!inline && !configuredPath) {
        missing.push("the key file (ios.ascApiKey.path, CATALYST_ASC_KEY_PATH or CATALYST_ASC_KEY_BASE64)")
    }
    if (!keyId) missing.push("the key ID (ios.ascApiKey.keyId or CATALYST_ASC_KEY_ID)")
    if (!issuerId) missing.push("the issuer ID (ios.ascApiKey.issuerId or CATALYST_ASC_ISSUER_ID)")
    if (missing.length) throw nativeError("IOS-011", `missing ${missing.join(", ")}`)
    if (!/^[A-Za-z0-9]+$/.test(keyId)) {
        throw nativeError("IOS-011", `the key ID "${keyId}" should be letters and digits only`)
    }

    if (inline) {
        const contents = inline.includes("BEGIN PRIVATE KEY")
            ? Buffer.from(`${inline}\n`, "utf8")
            : Buffer.from(inline, "base64")
        if (!contents.length) throw nativeError("IOS-011", "CATALYST_ASC_KEY_BASE64 is not base64")
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-asc-key-"))
        fs.chmodSync(dir, 0o700)
        const keyPath = path.join(dir, `AuthKey_${keyId}.p8`)
        fs.writeFileSync(keyPath, contents, { mode: 0o600 })
        return {
            keyPath,
            keyId,
            issuerId,
            source: "CATALYST_ASC_KEY_BASE64",
            cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
        }
    }

    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - The key path is the developer's own setting for their own machine.
    const keyPath = path.resolve(appRoot, expandHome(String(configuredPath)))
    if (!fs.existsSync(keyPath)) throw nativeError("IOS-011", `the key file does not exist: ${keyPath}`)
    const relative = path.relative(appRoot, keyPath)
    if (!relative.startsWith("..") && !path.isAbsolute(relative) && !relative.startsWith("credentials")) {
        log(
            `The App Store Connect key ${relative} is inside the app. Keep it outside the repository (or in the git-ignored credentials/ folder).`,
            "warning"
        )
    }
    return {
        keyPath,
        keyId,
        issuerId,
        source: env.CATALYST_ASC_KEY_PATH ? "CATALYST_ASC_KEY_PATH" : "ios.ascApiKey.path",
        cleanup: () => {},
    }
}

/**
 * xcodebuild flags that let automatic signing create and fetch certificates
 * and profiles: with the API key when there is one, otherwise with the
 * Apple account signed in to Xcode.
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
 * How this build signs, decided from the config and environment alone (no
 * side effects), so the entitlements can be written before Xcode runs.
 *
 * aps-environment: Xcode's entitlements merger takes aps-environment from the
 * provisioning profile it signs with. An automatic-signing archive is signed
 * for development and export re-signs it with the distribution profile, so
 * the archive keeps "development". A manual release archive is signed with
 * the distribution profile directly, so it must already say "production".
 *
 * @param {object} options
 * @param {Record<string, any>} [options.iosConfig]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {boolean} [options.release]
 * @param {boolean} [options.noSign]
 * @param {string} [options.exportMethod]
 */
function planIosSigning({
    iosConfig = {},
    env = process.env,
    release = false,
    noSign = false,
    exportMethod = "app-store-connect",
} = {}) {
    const teamId = String(iosConfig.developmentTeam || "").trim()
    const distribution = release && exportMethod !== "debugging"
    if (release && noSign) {
        return { style: "none", source: "--no-sign", ci: false, teamId, apsEnvironment: "development" }
    }
    const hasP12 = Boolean(env.CATALYST_IOS_P12_BASE64)
    const hasProfile = Boolean(env.CATALYST_IOS_PROFILE_BASE64)
    if (release && (hasP12 || hasProfile)) {
        if (!hasP12)
            throw nativeError(
                "IOS-012",
                "CATALYST_IOS_PROFILE_BASE64 is set but CATALYST_IOS_P12_BASE64 is not"
            )
        if (!hasProfile)
            throw nativeError(
                "IOS-012",
                "CATALYST_IOS_P12_BASE64 is set but CATALYST_IOS_PROFILE_BASE64 is not"
            )
        return {
            style: "manual",
            source: "CATALYST_IOS_P12_BASE64",
            ci: true,
            teamId,
            apsEnvironment: distribution ? "production" : "development",
        }
    }
    if (iosConfig.provisioningProfile) {
        return {
            style: "manual",
            source: "ios.provisioningProfile",
            ci: false,
            teamId,
            provisioningProfile: String(iosConfig.provisioningProfile),
            apsEnvironment: distribution ? "production" : "development",
        }
    }
    return { style: "automatic", source: "automatic", ci: false, teamId, apsEnvironment: "development" }
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
        throw nativeError("IOS-012", "CATALYST_IOS_PROFILE_BASE64 is not a provisioning profile")
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
 * CI manual signing: import CATALYST_IOS_P12_BASE64 into a temporary keychain,
 * put that keychain on the user search list, and install
 * CATALYST_IOS_PROFILE_BASE64 where Xcode looks for profiles.
 *
 * `cleanup()` restores the exact search list read before anything changed,
 * deletes the keychain, removes the profile files this call created and the
 * decoded secrets. It runs on failure here, and on SIGINT/SIGTERM until the
 * caller has run it. Call it in a `finally`.
 *
 * @param {object} options
 * @param {string} [options.bundleId] - checked against the profile
 * @param {Record<string, string | undefined>} [options.env]
 * @param {(command: string, args: string[], options?: object) => string} [options.run]
 * @param {string} [options.homeDir]
 * @param {string} [options.tmpRoot]
 * @param {(message: string, type?: string) => void} [options.log]
 * @param {{ once: Function, removeListener: Function }} [options.signals]
 * @param {(code: number) => void} [options.exit]
 * @param {() => Date} [options.now]
 */
function setupCiSigning({
    bundleId,
    env = process.env,
    run = defaultRun,
    homeDir = os.homedir(),
    tmpRoot = os.tmpdir(),
    log = () => {},
    signals = process,
    exit = (code) => process.exit(code),
    now = () => new Date(),
} = {}) {
    const p12Password = env.CATALYST_IOS_P12_PASSWORD ?? ""
    const keychainPassword = crypto.randomBytes(24).toString("base64url")
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
    const onSignal = (signal) => {
        cleanup()
        exit(signal === "SIGINT" ? 130 : 143)
    }
    function cleanup() {
        if (cleaned) return
        cleaned = true
        signals.removeListener("SIGINT", onSignal)
        signals.removeListener("SIGTERM", onSignal)
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
        step("remove the decoded signing files", () => fs.rmSync(workDir, { recursive: true, force: true }))
    }
    signals.once("SIGINT", onSignal)
    signals.once("SIGTERM", onSignal)

    try {
        const p12File = path.join(workDir, "signing.p12")
        const profileFile = path.join(workDir, "signing.mobileprovision")
        fs.writeFileSync(p12File, Buffer.from(String(env.CATALYST_IOS_P12_BASE64 || ""), "base64"), {
            mode: 0o600,
        })
        fs.writeFileSync(profileFile, Buffer.from(String(env.CATALYST_IOS_PROFILE_BASE64 || ""), "base64"), {
            mode: 0o600,
        })

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
                `could not import CATALYST_IOS_P12_BASE64; check CATALYST_IOS_P12_PASSWORD (${error.message})`
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
            throw nativeError("IOS-012", "CATALYST_IOS_P12_BASE64 holds no valid code signing identity")
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
    isReleaseBuildType,
    resolveExportMethod,
    resolveAscApiKey,
    xcodeAuthArgs,
    planIosSigning,
    parseKeychainList,
    parseIdentity,
    profileMatchesBundleId,
    profileDirectories,
    readProvisioningProfile,
    setupCiSigning,
    buildExportOptions,
    writeExportOptionsPlist,
    isSigningFailure,
    signingSetupError,
}
