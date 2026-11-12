import { execFileSync } from "child_process"
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { isInteractive, nativeError, needsAnswerError, select } from "../utils.js"
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
//   3. Automatically with the App Store Connect API key (cloud signing).
//   4. Manually with an App Store profile this Mac already has for the
//      bundle id, when its certificate is in the keychain (app-store-connect
//      exports only).
//   5. Automatically with the Apple account signed in to Xcode, for
//      ios.developmentTeam (buildAppIos.js picks and saves the team when it
//      is unset).
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
 * How this build signs, decided from the config, the credentials and the
 * installed profiles alone (no side effects), so the team check, the
 * entitlements and the xcconfig all see the same plan.
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
 * @param {string} [options.bundleId] - PRODUCT_BUNDLE_IDENTIFIER, for picking an installed profile
 * @param {boolean} [options.notifications] - push is on: a picked profile needs aps-environment
 * @param {() => ReturnType<typeof scanInstalledProfiles>} [options.scanProfiles] - called only when a release could sign with an installed profile
 * @param {Date} [options.now]
 */
function planIosSigning({
    iosConfig = {},
    credentials = null,
    release = false,
    exportMethod = "app-store-connect",
    bundleId,
    notifications = false,
    scanProfiles,
    now = new Date(),
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
    const automatic = (source) => ({
        style: "automatic",
        source,
        p12: false,
        teamId,
        apsEnvironment: "development",
    })
    if (release && credentials?.apiKey) return automatic("App Store Connect API key")
    if (release && exportMethod === "app-store-connect" && bundleId && scanProfiles) {
        const scan = scanProfiles()
        const { identity, missing } = pickInstalledProfile(scan, {
            bundleId,
            teamId,
            needsPush: notifications,
            now,
        })
        // Nothing else to sign with: IOS-010 leads with the missing profile.
        if (missing) return { ...automatic("Xcode account"), missingProfileFor: bundleId }
        if (identity) {
            // By name, as people know it, unless another installed profile shares it.
            const sameName = scan.profiles.filter((profile) => profile.name === identity.profileName).length
            return {
                style: "manual",
                source: "installed profile",
                p12: false,
                teamId: identity.teamId || teamId,
                provisioningProfile: sameName === 1 ? identity.profileName : identity.uuid,
                profileName: identity.profileName,
                identity: identity.sha1,
                signingCertificate: identity.sha1,
                certificateName: identity.name,
                apsEnvironment: "production",
            }
        }
    }
    return automatic("Xcode account")
}

/** PRODUCT_BUNDLE_IDENTIFIER as Shared.xcconfig sets it (generateXCConfig). */
function productBundleId(iosConfig = {}) {
    return iosConfig.bundleIdentifier || iosConfig.appBundleId || "com.catalyst.framework.app"
}

/**
 * planIosSigning for a resolved WEBVIEW_CONFIG (resolveNativeConfig), so
 * buildAppIos.js, which asks for the team, and createIosBuild, which signs,
 * cannot disagree.
 *
 * @param {object} options
 * @param {Record<string, any>} options.WEBVIEW_CONFIG - resolved
 * @param {ReturnType<typeof readIosCredentials> | null} [options.credentials]
 * @param {boolean} [options.release]
 * @param {string} [options.exportMethod]
 * @param {() => ReturnType<typeof scanInstalledProfiles>} [options.scanProfiles]
 * @param {Date} [options.now]
 */
function planSigningForConfig({
    WEBVIEW_CONFIG = {},
    credentials = null,
    release,
    exportMethod,
    scanProfiles,
    now,
}) {
    const iosConfig = WEBVIEW_CONFIG.ios || {}
    return planIosSigning({
        iosConfig,
        credentials,
        release,
        exportMethod,
        bundleId: productBundleId(iosConfig),
        notifications: Boolean(WEBVIEW_CONFIG.notifications?.enabled),
        scanProfiles,
        now,
    })
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

/** The SHA-1 of every valid identity `security find-identity -v -p codesigning` lists. */
function parseIdentities(output) {
    return [...String(output || "").matchAll(/^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"([^"]+)"/gm)].map((match) => ({
        sha1: match[1].toUpperCase(),
        name: match[2],
    }))
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
 * Every provisioning profile installed on this Mac and every valid signing
 * identity in the keychain, decoded once so a build reads them once
 * (createProfileScanner). Nothing at all when the keychain has no identity:
 * no profile could sign then. Never throws; a profile that does not decode
 * is skipped.
 *
 * @param {object} [options]
 * @param {(command: string, args: string[], options?: object) => string} [options.run]
 * @param {string} [options.homeDir]
 * @param {string} [options.workDir] - scratch folder for the decoded plist; a private temp folder by default
 * @param {string} [options.tmpRoot]
 */
function scanInstalledProfiles({
    run = defaultRun,
    homeDir = os.homedir(),
    workDir,
    tmpRoot = os.tmpdir(),
} = {}) {
    let identities = []
    try {
        identities = parseIdentities(run("security", ["find-identity", "-v", "-p", "codesigning"]))
    } catch (error) {
        return { identities: [], profiles: [] }
    }
    if (!identities.length) return { identities, profiles: [] }

    // mkdtemp makes the folder 0700.
    const scratch = workDir || fs.mkdtempSync(path.join(tmpRoot, "catalyst-ios-profiles-"))
    const decoded = path.join(scratch, "installed-profile.plist")
    const extract = (keyPath) => {
        try {
            return String(run("plutil", ["-extract", keyPath, "raw", "-o", "-", decoded])).trim() || undefined
        } catch (error) {
            return undefined
        }
    }
    const flag = (keyPath) => {
        const value = extract(keyPath)
        return value === undefined ? undefined : value === "true" || value === "1"
    }
    const profiles = []
    const seen = new Set()
    try {
        for (const dir of profileDirectories(homeDir)) {
            let files = []
            try {
                files = fs
                    .readdirSync(dir)
                    .filter((file) => /\.(mobileprovision|provisionprofile)$/.test(file))
            } catch (error) {
                continue
            }
            for (const file of files) {
                try {
                    run("security", ["cms", "-D", "-i", path.join(dir, file), "-o", decoded])
                } catch (error) {
                    continue
                }
                const uuid = extract("UUID")
                // Xcode keeps the same profile in both folders.
                if (!uuid || seen.has(uuid.toLowerCase())) continue
                seen.add(uuid.toLowerCase())
                const expirationDate = extract("ExpirationDate")
                const expires = Date.parse(expirationDate || "")
                const count = Number(extract("DeveloperCertificates")) || 0
                const certificates = []
                for (let index = 0; index < count; index += 1) {
                    const der = extract(`DeveloperCertificates.${index}`)
                    if (der) {
                        certificates.push(
                            crypto
                                .createHash("sha1")
                                .update(Buffer.from(der, "base64"))
                                .digest("hex")
                                .toUpperCase()
                        )
                    }
                }
                profiles.push({
                    file,
                    uuid,
                    name: extract("Name"),
                    teamId: extract("TeamIdentifier.0"),
                    applicationIdentifier: extract("Entitlements.application-identifier"),
                    apsEnvironment: extract("Entitlements.aps-environment"),
                    getTaskAllow: flag("Entitlements.get-task-allow"),
                    devices: Number(extract("ProvisionedDevices")) || 0,
                    allDevices: flag("ProvisionsAllDevices") === true,
                    expirationDate,
                    expires: Number.isFinite(expires) ? expires : 0,
                    certificates,
                })
            }
        }
    } finally {
        if (workDir) fs.rmSync(decoded, { force: true })
        else fs.rmSync(scratch, { recursive: true, force: true })
    }
    return { identities, profiles }
}

/** scanInstalledProfiles, run on the first call only: one scan per build. */
function createProfileScanner(options = {}) {
    let scan = null
    return () => {
        if (!scan) scan = scanInstalledProfiles(options)
        return scan
    }
}

/** An App Store distribution profile: no device list, not enterprise, not debuggable. */
function isAppStoreProfile(profile) {
    return profile.devices === 0 && !profile.allDevices && profile.getTaskAllow === false
}

/**
 * The installed profile to sign with, and the keychain identity it was made
 * for. Xcode resolves a generic "iPhone Distribution" to whichever
 * distribution certificate it finds first, which fails when the keychain
 * holds more than one and the profile lists another.
 *
 * With `profile` (ios.provisioningProfile, by name or UUID) that profile,
 * for the bundle id or a wildcard covering it. Without, an App Store
 * profile (.mobileprovision, no devices, get-task-allow false) for exactly
 * this bundle id, for `teamId` when set, with aps-environment when
 * `needsPush`. Expired profiles are skipped; the newest one whose
 * certificate is in the keychain wins. Without a match, `reason` says why,
 * and `missing` is true when no App Store profile for the bundle id is
 * installed at all.
 *
 * @param {ReturnType<typeof scanInstalledProfiles>} scan
 * @param {object} options
 * @param {string} [options.profile]
 * @param {string} [options.bundleId]
 * @param {string} [options.teamId]
 * @param {boolean} [options.needsPush]
 * @param {Date} [options.now]
 * @returns {{ identity: { sha1: string, name: string, teamId?: string, uuid: string, profileName?: string } | null, reason?: string, missing?: boolean }}
 */
function pickInstalledProfile(scan, { profile, bundleId, teamId, needsPush = false, now = new Date() } = {}) {
    const wanted = String(profile || "").trim()
    const bySha1 = new Map((scan?.identities || []).map((identity) => [identity.sha1, identity]))
    const appIdOf = (candidate) => {
        const id = String(candidate.applicationIdentifier || "")
        return id.slice(id.indexOf(".") + 1)
    }
    // scanInstalledProfiles reads no profile then.
    if (!bySha1.size) return { identity: null, reason: "the keychain has no valid signing certificate" }
    let candidates = scan?.profiles || []
    /** Keep the candidates that pass; when none does, that check is the reason. */
    const steps = wanted
        ? [
              [
                  (c) => c.name === wanted || String(c.uuid).toLowerCase() === wanted.toLowerCase(),
                  () => "no installed profile has that name or UUID",
              ],
              [
                  (c) => !(c.expires && c.expires <= now.getTime()),
                  (left) => `it expired on ${left[0].expirationDate}`,
              ],
              [
                  (c) => profileMatchesBundleId(c.applicationIdentifier, bundleId),
                  (left) => `it is for ${appIdOf(left[0])}, not ${bundleId}`,
              ],
          ]
        : [
              [
                  (c) =>
                      c.file.endsWith(".mobileprovision") &&
                      c.applicationIdentifier &&
                      appIdOf(c) === bundleId,
                  () => `no installed profile is for exactly ${bundleId}`,
                  true,
              ],
              [isAppStoreProfile, () => `no installed App Store profile is for ${bundleId}`, true],
              [
                  (c) => !teamId || c.teamId === teamId,
                  () => `no installed App Store profile for ${bundleId} is for team ${teamId}`,
              ],
              [
                  (c) => !needsPush || Boolean(c.apsEnvironment),
                  () => `no installed App Store profile for ${bundleId} has push notifications`,
              ],
              [
                  (c) => !(c.expires && c.expires <= now.getTime()),
                  () => `every installed App Store profile for ${bundleId} has expired`,
              ],
          ]
    for (const [keep, reason, missing] of steps) {
        const left = candidates.filter(keep)
        if (!left.length) {
            return missing
                ? { identity: null, reason: reason(candidates), missing: true }
                : { identity: null, reason: reason(candidates) }
        }
        candidates = left
    }
    const newestFirst = [...candidates].sort((a, b) => b.expires - a.expires)
    for (const match of newestFirst) {
        const identity = match.certificates.map((sha1) => bySha1.get(sha1)).find(Boolean)
        if (identity) {
            return {
                identity: { ...identity, teamId: match.teamId, uuid: match.uuid, profileName: match.name },
            }
        }
    }
    return {
        identity: null,
        reason: wanted
            ? "its certificate is not in the keychain"
            : `the certificate of the App Store profile for ${bundleId} is not in the keychain`,
    }
}

/**
 * The keychain identity for an installed profile: pickInstalledProfile over
 * `scan`, or over a fresh scanInstalledProfiles. Null when nothing matches.
 *
 * @param {object} options
 * @param {string} [options.profile] - ios.provisioningProfile; unset picks an App Store profile for the bundle id
 * @param {string} [options.bundleId]
 * @param {string} [options.teamId]
 * @param {boolean} [options.needsPush]
 * @param {ReturnType<typeof scanInstalledProfiles>} [options.scan]
 * @param {string} [options.workDir]
 * @param {(command: string, args: string[], options?: object) => string} [options.run]
 * @param {string} [options.homeDir]
 * @param {Date} [options.now]
 * @returns {{ sha1: string, name: string, teamId?: string, uuid: string, profileName?: string } | null}
 */
function findInstalledProfileIdentity({
    profile,
    bundleId,
    teamId,
    needsPush,
    scan,
    workDir,
    run = defaultRun,
    homeDir = os.homedir(),
    now = new Date(),
} = {}) {
    const profiles = scan || scanInstalledProfiles({ run, homeDir, workDir })
    return pickInstalledProfile(profiles, { profile, bundleId, teamId, needsPush, now }).identity
}

// ─── The team for signing with the Apple account in Xcode ──────────────────

const XCODE_TEAM_HINT =
    "Open Xcode > Settings > Accounts and sign in with the Apple account that has your company's team, or set WEBVIEW_CONFIG.ios.developmentTeam."

/**
 * IOS-010's detail and hint for an App Store release that found no installed
 * App Store profile for its bundle id (plan.missingProfileFor) and has no
 * other signing source: the missing profile first, then every way to sign,
 * the Xcode account last. Null for any other plan.
 *
 * @param {string | undefined} bundleId - plan.missingProfileFor
 * @param {string} [detail] - what failed after that, e.g. the Xcode account
 * @returns {{ detail: string, hint: string } | null}
 */
function missingProfileError(bundleId, detail) {
    if (!bundleId) return null
    const missing = `no App Store provisioning profile for ${bundleId} is installed on this Mac`
    return {
        detail: detail ? `${missing}, and ${detail}` : missing,
        hint: `Install the App Store profile for ${bundleId} (download it from developer.apple.com, or with Xcode > Settings > Accounts > Download Manual Profiles), set WEBVIEW_CONFIG.ios.provisioningProfile to an installed profile's name, put a .p12 and its profile or an App Store Connect API key in credentials/ios/, or sign in to Xcode (Xcode > Settings > Accounts) with the Apple account that has your company's team.`,
    }
}

/**
 * The teams in IDEProvisioningTeamByIdentifier (account id -> teams), one
 * per team id. `free` is isFreeProvisioningTeam, undefined when Xcode did
 * not say. Null when the value is not that shape.
 *
 * @param {string} json
 * @returns {{ teamId: string, teamName: string, free: boolean | undefined }[] | null}
 */
function parseXcodeTeams(json) {
    let byAccount
    try {
        byAccount = JSON.parse(String(json || ""))
    } catch (error) {
        return null
    }
    if (!byAccount || typeof byAccount !== "object" || Array.isArray(byAccount)) return null
    const teams = new Map()
    for (const list of Object.values(byAccount)) {
        for (const team of Array.isArray(list) ? list : []) {
            const teamId = String(team?.teamID || "").trim()
            if (!/^[A-Za-z0-9]+$/.test(teamId)) continue
            const raw = team.isFreeProvisioningTeam
            const free = raw === true || raw === 1 ? true : raw === false || raw === 0 ? false : undefined
            const known = teams.get(teamId)
            if (!known) teams.set(teamId, { teamId, teamName: String(team.teamName || "").trim(), free })
            else if (known.free === undefined) known.free = free
        }
    }
    return [...teams.values()]
}

/**
 * The teams of the Apple accounts signed in to Xcode. Reads only the
 * IDEProvisioningTeamByIdentifier key of Xcode's preferences, through
 * plutil's stdin: no file, and the account emails stored beside it are
 * never extracted or shown. Null when Xcode's preferences cannot be read.
 *
 * @param {object} [options]
 * @param {(command: string, args: string[], options?: object) => string} [options.run]
 */
function readXcodeTeams({ run = defaultRun } = {}) {
    try {
        const preferences = run("defaults", ["export", "com.apple.dt.Xcode", "-"])
        return parseXcodeTeams(
            run("plutil", ["-extract", "IDEProvisioningTeamByIdentifier", "json", "-o", "-", "-"], {
                input: preferences,
            })
        )
    } catch (error) {
        return null
    }
}

/** True when this release signs with the Apple account in Xcode and has no team yet. */
function needsXcodeTeam(plan, { release = false } = {}) {
    return Boolean(release && plan?.style === "automatic" && plan.source === "Xcode account" && !plan.teamId)
}

/**
 * The Xcode team to sign with. A personal (free) team cannot sign an App
 * Store, release-testing or enterprise export, so it is left out unless the
 * export is for debugging; a team Xcode did not mark either way is kept.
 * One team is used; several are a question, NATIVE-005 without a terminal;
 * none is IOS-010, which leads with `missingProfileFor` when that is set.
 *
 * @param {object} options
 * @param {ReturnType<typeof parseXcodeTeams>} options.teams - from readXcodeTeams
 * @param {string} [options.exportMethod]
 * @param {boolean} [options.isTTY]
 * @param {typeof select} [options.choose]
 * @param {string} [options.missingProfileFor] - plan.missingProfileFor
 * @returns {Promise<{ teamId: string, teamName: string, free: boolean | undefined }>}
 */
async function chooseXcodeTeam({
    teams,
    exportMethod = "app-store-connect",
    isTTY,
    choose = select,
    missingProfileFor,
}) {
    const noTeam = (detail) => {
        const missing = missingProfileError(missingProfileFor, detail)
        return missing
            ? nativeError("IOS-010", missing.detail, { hint: missing.hint })
            : nativeError("IOS-010", detail, { hint: XCODE_TEAM_HINT })
    }
    if (!teams) throw noTeam("could not read which teams are signed in to Xcode")
    const usable = exportMethod === "debugging" ? teams : teams.filter((team) => team.free !== true)
    if (!usable.length) {
        throw noTeam(
            teams.length
                ? `Xcode is signed in with a personal team only, and a personal team cannot sign ${exportMethod} builds`
                : "no Apple account with a team is signed in to Xcode"
        )
    }
    if (usable.length === 1) return usable[0]
    const label = (team) => `${team.teamName || "Unnamed team"} (${team.teamId})`
    const question = "Which team signs this app?"
    if (!(isTTY ?? isInteractive())) {
        throw needsAnswerError(question, {
            hint: `Set WEBVIEW_CONFIG.ios.developmentTeam in config/config.json to one of ${usable
                .map(label)
                .join(", ")}, or run the command in an interactive terminal.`,
        })
    }
    const teamId = await choose(
        question,
        usable.map((team) => ({ label: label(team), value: team.teamId })),
        { isTTY: true }
    )
    return usable.find((team) => team.teamId === teamId) || usable[0]
}

/**
 * The team step for a release that signs with the Xcode account and has no
 * ios.developmentTeam: choose the team (chooseXcodeTeam), then in a terminal
 * save it with `save`; without one (CI, agents) only use it for this build,
 * since config.json is never written there. Null when no team is needed.
 *
 * @param {object} options
 * @param {ReturnType<typeof planIosSigning>} options.plan - from planSigningForConfig
 * @param {boolean} [options.release]
 * @param {string} [options.exportMethod]
 * @param {boolean} [options.isTTY] - defaults to isInteractive()
 * @param {() => ReturnType<typeof parseXcodeTeams>} [options.readTeams]
 * @param {typeof select} [options.choose]
 * @param {(teamId: string) => void} options.save - writes WEBVIEW_CONFIG.ios.developmentTeam
 * @param {(message: string, type?: string) => void} [options.log]
 * @returns {Promise<{ teamId: string, saved: boolean } | null>}
 */
async function settleXcodeTeam({
    plan,
    release = false,
    exportMethod,
    isTTY,
    readTeams = readXcodeTeams,
    choose = select,
    save,
    log = () => {},
}) {
    if (!needsXcodeTeam(plan, { release })) return null
    const interactive = isTTY ?? isInteractive()
    const team = await chooseXcodeTeam({
        teams: readTeams(),
        exportMethod,
        isTTY: interactive,
        choose,
        missingProfileFor: plan.missingProfileFor,
    })
    const label = `${team.teamName || "Unnamed team"} (${team.teamId})`
    if (!interactive) {
        log(`Using team ${label} from Xcode. Set WEBVIEW_CONFIG.ios.developmentTeam to keep it.`, "note")
        return { teamId: team.teamId, saved: false }
    }
    log(`Signing for ${label}, signed in to Xcode`, "info")
    save(team.teamId)
    return { teamId: team.teamId, saved: true }
}

/**
 * The profile step for a release that auto-picked an installed App Store
 * profile (planIosSigning's "installed profile"): in a terminal save it as
 * ios.provisioningProfile with `save`, so later builds sign with the same
 * one; without a terminal (CI, agents) only use it for this build, since
 * config.json is never written there. Null for any other plan.
 *
 * @param {object} options
 * @param {ReturnType<typeof planIosSigning>} options.plan - from planSigningForConfig
 * @param {boolean} [options.isTTY] - defaults to isInteractive()
 * @param {(profile: string) => void} options.save - writes WEBVIEW_CONFIG.ios.provisioningProfile
 * @param {(message: string, type?: string) => void} [options.log]
 * @returns {{ provisioningProfile: string, saved: boolean } | null}
 */
function settleInstalledProfile({ plan, isTTY, save, log = () => {} }) {
    if (plan?.source !== "installed profile") return null
    // The name, or the UUID when another installed profile shares the name.
    const profile = plan.provisioningProfile
    if (!(isTTY ?? isInteractive())) {
        log(
            `Using the installed profile "${plan.profileName}". Set WEBVIEW_CONFIG.ios.provisioningProfile to keep it.`,
            "note"
        )
        return { provisioningProfile: profile, saved: false }
    }
    log(`Signing with the installed profile "${plan.profileName}" (team ${plan.teamId})`, "info")
    save(profile)
    return { provisioningProfile: profile, saved: true }
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
    /Provisioning profile ".*" (?:doesn't|does not|is not|has expired|has app ID)/i,
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
 * The first line of xcodebuild's output that names the signing problem
 * (an error line when there is one),
 * without the file path before ": error:", at most 300 characters.
 *
 * @param {string} [output]
 * @returns {string | null}
 */
function signingFailureLine(output) {
    const matching = String(output || "")
        .split(/\r?\n/)
        .filter((text) => SIGNING_FAILURE_PATTERNS.some((pattern) => pattern.test(text)))
    // An error line over the echoed command line, which names -authenticationKeyPath.
    const line = matching.find((text) => /\berror\b/i.test(text)) || matching[0]
    if (!line) return null
    let text = line
        .trim()
        .replace(/^.*?:\s*error:\s*/i, "")
        .replace(/^error:\s*/i, "")
    if (text.length > 300) text = `${text.slice(0, 297)}...`
    return text || null
}

/**
 * The coded error for a signing failure, keeping xcodebuild's transcript for
 * the diagnostic. The detail ends with the line that says what went wrong,
 * and starts with the missing App Store profile when `missingProfileFor` is set.
 *
 * @param {string} detail
 * @param {any} [cause]
 * @param {object} [options]
 * @param {string} [options.missingProfileFor] - plan.missingProfileFor
 * @returns {any}
 */
function signingSetupError(detail, cause, { missingProfileFor } = {}) {
    const said = signingFailureLine(cause?.output)
    const failed = said ? `${detail}: ${said}` : detail
    const missing = missingProfileError(missingProfileFor, failed)
    const error = missing
        ? nativeError("IOS-010", missing.detail, { hint: missing.hint })
        : nativeError("IOS-010", failed)
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
    planSigningForConfig,
    productBundleId,
    parseKeychainList,
    parseIdentity,
    parseIdentities,
    scanInstalledProfiles,
    createProfileScanner,
    pickInstalledProfile,
    findInstalledProfileIdentity,
    XCODE_TEAM_HINT,
    missingProfileError,
    parseXcodeTeams,
    readXcodeTeams,
    needsXcodeTeam,
    chooseXcodeTeam,
    settleXcodeTeam,
    settleInstalledProfile,
    profileMatchesBundleId,
    profileDirectories,
    readProvisioningProfile,
    setupP12Signing,
    buildExportOptions,
    writeExportOptionsPlist,
    isSigningFailure,
    signingFailureLine,
    signingSetupError,
}
