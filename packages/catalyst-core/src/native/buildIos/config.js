"use strict"

const fs = require("fs")
const path = require("path")

// ─── Pure helpers (no ctx dependency) ────────────────────────────────────────

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function deepEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right)
}

function mergeStructuredValues(existing, incoming, fieldName) {
    if (existing === undefined) return JSON.parse(JSON.stringify(incoming))

    if (Array.isArray(existing) && Array.isArray(incoming)) {
        const merged = []
        const seen = new Set()
        for (const value of [...existing, ...incoming]) {
            const key = JSON.stringify(value)
            if (seen.has(key)) continue
            seen.add(key)
            merged.push(value)
        }
        return merged
    }

    if (isPlainObject(existing) && isPlainObject(incoming)) {
        const merged = { ...existing }
        for (const [key, value] of Object.entries(incoming)) {
            merged[key] = mergeStructuredValues(merged[key], value, `${fieldName}.${key}`)
        }
        return merged
    }

    if (deepEqual(existing, incoming)) return existing
    throw new Error(`Conflicting values for '${fieldName}' while composing iOS build metadata`)
}

function generateSwiftProperty(key, value, indent = "    ") {
    if (value === null || value === undefined) return `${indent}public static let ${key}: String? = nil`

    if (key === "cachePattern") {
        if (typeof value === "string") return `${indent}public static let ${key}: [String] = ["${value}"]`
        if (Array.isArray(value)) {
            const arrayValues = value.map((v) => `"${v}"`).join(", ")
            return `${indent}public static let ${key}: [String] = [${arrayValues}]`
        }
    }

    if (typeof value === "string") return `${indent}public static let ${key} = "${value}"`
    if (typeof value === "number") return `${indent}public static let ${key} = ${value}`
    if (typeof value === "boolean") return `${indent}public static let ${key} = ${value}`

    if (Array.isArray(value)) {
        if (value.length === 0) return `${indent}public static let ${key}: [String] = []`
        const firstElement = value[0]
        if (typeof firstElement === "string") {
            const arrayValues = value.map((v) => `"${v}"`).join(", ")
            return `${indent}public static let ${key}: [String] = [${arrayValues}]`
        } else if (typeof firstElement === "number") {
            const arrayType = Number.isInteger(firstElement) ? "Int" : "Double"
            return `${indent}public static let ${key}: [${arrayType}] = [${value.join(", ")}]`
        } else if (typeof firstElement === "boolean") {
            return `${indent}public static let ${key}: [Bool] = [${value.join(", ")}]`
        } else {
            const arrayValues = value.map((v) => `"${v}"`).join(", ")
            return `${indent}public static let ${key}: [String] = [${arrayValues}]`
        }
    }

    if (typeof value === "object" && value !== null) {
        let nestedContent = `${indent}public enum ${key.charAt(0).toUpperCase() + key.slice(1)} {\n`
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
            nestedContent += generateSwiftProperty(nestedKey, nestedValue, indent + "    ") + "\n"
        }
        nestedContent += `${indent}}`
        return nestedContent
    }

    return `${indent}public static let ${key} = "${value}"`
}

// ios.* keys that only steer the build and never reach ConfigConstants.
// ascApiKey is no longer read (the key lives in credentials/ios/), but an
// older config that still has it must not ship it in the binary either.
const BUILD_ONLY_IOS_KEYS = new Set(["ascApiKey", "exportMethod"])

// WEBVIEW_CONFIG keys the generic emitter skips: the platform blocks, and
// nativeConfig.js RESOLVER_ONLY_KEYS, which only the resolver reads (it turns
// url, appId and appName into the legacy keys, so ConfigConstants gets one
// url). Copied, not required: this CJS file is loaded with plain require in
// tests, which cannot load the ESM resolver.
const SKIPPED_TOP_LEVEL_KEYS = new Set(["ios", "android", "url", "appId", "appName", "allowPrivateHost"])

/**
 * The xcconfig signing block. Manual (an explicit profile) keeps the
 * settings existing ios.provisioningProfile users had; everything else is
 * Automatic for DEVELOPMENT_TEAM, with no identity or profile pinned, so
 * Xcode (or -allowProvisioningUpdates) picks them.
 *
 * @param {object} signing
 * @param {"manual"|"automatic"|"none"} [signing.style]
 * @param {string} [signing.provisioningProfile]
 * @param {string} [signing.identity] - CODE_SIGN_IDENTITY for device builds
 */
function xcconfigSigningBlock({ style, provisioningProfile, identity } = {}) {
    if (style === "manual" && provisioningProfile) {
        return [
            "CODE_SIGN_STYLE = Manual",
            "CODE_SIGN_IDENTITY = Apple Development",
            `CODE_SIGN_IDENTITY[sdk=iphoneos*] = ${identity || "iPhone Developer"}`,
            "PROVISIONING_PROFILE_SPECIFIER =",
            `PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*] = ${provisioningProfile}`,
        ].join("\n")
    }
    return "CODE_SIGN_STYLE = Automatic"
}

/** MARKETING_VERSION must be one to three dot-separated integers; "2.5.0-beta.1" becomes "2.5.0". */
function marketingVersionOf(versionName) {
    const match = /^\d+(?:\.\d+){0,2}/.exec(String(versionName || ""))
    return match ? match[0] : null
}

// ─── Module factory ───────────────────────────────────────────────────────────

module.exports = function createConfigPhase(ctx) {
    const {
        WEBVIEW_CONFIG,
        iosConfig,
        PROJECT_DIR,
        PUBLIC_PATH,
        url,
        progress,
        restoreManagedFileFromBaseline,
        readPlistObject,
        writePlistObject,
    } = ctx

    /**
     * CFBundleShortVersionString and CFBundleVersion: package.json's version
     * and the build number (nativeConfig.js resolveAppVersion), falling back
     * to ios.version as shipped.
     */
    function appVersion(version) {
        const resolvedVersion = version || ctx.version
        const configuredVersion = iosConfig.version
            ? `${iosConfig.version.major || 1}.${iosConfig.version.minor || 0}.${iosConfig.version.patch || 0}`
            : "1.0.0"
        return {
            marketingVersion: marketingVersionOf(resolvedVersion?.versionName) || configuredVersion,
            buildNumber: resolvedVersion?.buildNumber || iosConfig.version?.buildNumber || 1,
        }
    }

    function mergeIntoTopLevelObject(target, source, fieldName) {
        for (const [key, value] of Object.entries(source || {})) {
            target[key] = mergeStructuredValues(target[key], value, `${fieldName}.${key}`)
        }
    }

    function mergeUrlSchemes(plistObject, entries) {
        const existing = Array.isArray(plistObject.CFBundleURLTypes) ? plistObject.CFBundleURLTypes : []
        const merged = existing.map((entry) => ({
            ...entry,
            CFBundleURLSchemes: Array.isArray(entry?.CFBundleURLSchemes)
                ? [...new Set(entry.CFBundleURLSchemes)]
                : [],
        }))
        for (const entry of entries) {
            const targetName = entry.name || null
            let match = merged.find((item) => item.CFBundleURLName === targetName)
            if (!match) {
                match = { CFBundleURLName: targetName, CFBundleURLSchemes: [] }
                merged.push(match)
            }
            match.CFBundleURLSchemes = [...new Set([...match.CFBundleURLSchemes, ...entry.schemes])]
        }
        if (merged.length > 0) plistObject.CFBundleURLTypes = merged
    }

    function mergeQuerySchemes(plistObject, schemes) {
        const existing = Array.isArray(plistObject.LSApplicationQueriesSchemes)
            ? plistObject.LSApplicationQueriesSchemes
            : []
        const merged = [...new Set([...existing, ...schemes.filter(Boolean)])]
        if (merged.length > 0) plistObject.LSApplicationQueriesSchemes = merged
    }

    async function generateConfigConstants() {
        progress.start("config")
        try {
            // CatalystCoreLogic (#432): ConfigConstants moved into the nested
            // CoreLogic/ package so it can be consumed by swift-test-only code
            // without pulling in UIKit. This generator must write to the new
            // location, not the old Sources/Core/Constants/ path.
            const appConfigPath = path.join(
                PROJECT_DIR, // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - PROJECT_DIR is the fixed generated iOS project directory.
                "CoreLogic",
                "Sources",
                "CatalystCoreLogic",
                "Constants",
                "ConfigConstants.swift"
            )
            const appConfigDir = path.dirname(appConfigPath)
            if (!fs.existsSync(appConfigDir)) fs.mkdirSync(appConfigDir, { recursive: true })

            // CatalystCoreLogic's Package.swift declares platforms: [.iOS(.v17),
            // .macOS(.v13)] so `swift test` can run this file on plain macOS (no
            // simulator). UIKit doesn't exist there, so CGFloat needs the same
            // canImport guard already used in the checked-in CatalystConstants.swift.
            let configContent = `// This file is auto-generated. Do not edit.
import Foundation
#if canImport(UIKit)
import UIKit
#elseif canImport(CoreGraphics)
import CoreGraphics
#endif

public enum ConfigConstants {
    public static let url = "${url}"`

            const addedKeys = new Set()

            if (WEBVIEW_CONFIG && typeof WEBVIEW_CONFIG === "object") {
                for (const [key, value] of Object.entries(WEBVIEW_CONFIG)) {
                    if (SKIPPED_TOP_LEVEL_KEYS.has(key)) continue
                    if (key === "notifications")
                        progress.log(`Processing notifications config: ${JSON.stringify(value)}`, "info")
                    configContent += "\n" + generateSwiftProperty(key, value)
                    addedKeys.add(key)
                }
            }

            if (iosConfig && typeof iosConfig === "object") {
                configContent += "\n    \n    // iOS-specific configuration"
                for (const [key, value] of Object.entries(iosConfig)) {
                    if (addedKeys.has(key)) continue
                    // Build-machine signing settings, not app config: key paths
                    // and IDs have no business in the shipped binary.
                    if (BUILD_ONLY_IOS_KEYS.has(key)) continue
                    configContent += "\n" + generateSwiftProperty(key, value)
                    addedKeys.add(key)
                }
            }

            if (WEBVIEW_CONFIG.accessControl) {
                const accessControl = WEBVIEW_CONFIG.accessControl
                configContent += `\n    public static let accessControlEnabled = ${accessControl.enabled || false}`
                if (accessControl.allowedUrls && Array.isArray(accessControl.allowedUrls)) {
                    const allowedUrls = accessControl.allowedUrls.map((u) => `"${u}"`).join(", ")
                    configContent += `\n    public static let allowedUrls: [String] = [${allowedUrls}]`
                } else if (accessControl.allowedUrls && typeof accessControl.allowedUrls === "string") {
                    const allowedUrls = accessControl.allowedUrls
                        .split(",")
                        .map((u) => u.trim())
                        .filter((u) => u.length > 0)
                        .map((u) => `"${u}"`)
                        .join(", ")
                    configContent += `\n    public static let allowedUrls: [String] = [${allowedUrls}]`
                }
            } else {
                configContent += `\n    public static let accessControlEnabled = false\n    public static let allowedUrls: [String] = []`
            }

            const splashConfig = WEBVIEW_CONFIG.splashScreen
            if (splashConfig) {
                configContent += `\n\n    // Splash Screen Configuration\n    public static let splashScreenEnabled = true`
                configContent += splashConfig.duration
                    ? `\n    public static let splashScreenDuration: TimeInterval? = ${splashConfig.duration / 1000.0}`
                    : `\n    public static let splashScreenDuration: TimeInterval? = nil`
                configContent += splashConfig.backgroundColor
                    ? `\n    public static let splashScreenBackgroundColor = "${splashConfig.backgroundColor}"`
                    : `\n    public static let splashScreenBackgroundColor = "#ffffff"`
                configContent += `\n    public static let splashScreenImageWidth: CGFloat = ${splashConfig.imageWidth || 120}`
                configContent += `\n    public static let splashScreenImageHeight: CGFloat = ${splashConfig.imageHeight || 120}`
                configContent += `\n    public static let splashScreenCornerRadius: CGFloat = ${splashConfig.cornerRadius || 20}`

                // Optional HTML splash: public/splashscreen.html is embedded as base64 so no
                // bundle resource or Xcode project registration is needed.
                const splashHtmlPath = path.join(PUBLIC_PATH, "splashscreen.html") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - PUBLIC_PATH is the app's fixed public directory.
                if (fs.existsSync(splashHtmlPath)) {
                    const splashHtml = fs.readFileSync(splashHtmlPath)
                    if (splashHtml.length > 1024 * 1024) {
                        progress.log(
                            `splashscreen.html is ${(splashHtml.length / (1024 * 1024)).toFixed(1)} MB; it is embedded in the app binary, keep it small`,
                            "warning"
                        )
                    }
                    configContent += `\n    public static let splashScreenHtml: String? = "${splashHtml.toString("base64")}"`
                } else {
                    configContent += `\n    public static let splashScreenHtml: String? = nil`
                }
                const minDuration = splashConfig.minDuration
                const validMinDuration =
                    typeof minDuration === "number" && Number.isFinite(minDuration) && minDuration >= 0
                if (minDuration !== undefined && !validMinDuration) {
                    progress.log(
                        `Ignoring invalid splashScreen.minDuration: ${JSON.stringify(minDuration)}`,
                        "warning"
                    )
                }
                configContent += `\n    public static let splashScreenMinDuration: TimeInterval = ${validMinDuration ? minDuration / 1000.0 : 0}`
            } else {
                configContent += `\n\n    // Splash Screen Configuration\n    public static let splashScreenEnabled = false\n    public static let splashScreenDuration: TimeInterval? = nil\n    public static let splashScreenBackgroundColor = "#ffffff"\n    public static let splashScreenImageWidth: CGFloat = 120\n    public static let splashScreenImageHeight: CGFloat = 120\n    public static let splashScreenCornerRadius: CGFloat = 20\n    public static let splashScreenHtml: String? = nil\n    public static let splashScreenMinDuration: TimeInterval = 0`
            }

            if (!addedKeys.has("notifications")) {
                configContent +=
                    "\n    public enum Notifications {\n        public static let enabled = false\n    }"
                addedKeys.add("notifications")
            } else {
                progress.log("Notifications config was processed from WEBVIEW_CONFIG", "info")
            }

            if (!addedKeys.has("googleSignIn")) {
                configContent +=
                    '\n    public enum GoogleSignIn {\n        public static let enabled = false\n        public static let clientId = ""\n        public static let iosClientId = ""\n    }'
                addedKeys.add("googleSignIn")
            }

            if (!addedKeys.has("profiler")) {
                configContent +=
                    "\n    public enum Profiler {\n        public static let enabled = false\n    }"
                addedKeys.add("profiler")
            }

            if (!addedKeys.has("edgeToEdge")) {
                progress.log("EdgeToEdge not found in config, adding default (false)", "info")
                configContent +=
                    "\n    public enum EdgeToEdge {\n        public static let enabled = false\n    }"
                addedKeys.add("edgeToEdge")
            }

            if (!addedKeys.has("initial_url")) {
                configContent += '\n    public static let initial_url = ""'
                addedKeys.add("initial_url")
            }

            // Ensure appInfo always exists (default to empty string if not configured)
            if (!addedKeys.has("appInfo")) {
                configContent += '\n    public static let appInfo = ""'
                addedKeys.add("appInfo")
            }

            // Ensure cachePattern always exists (default to no patterns, i.e. caching
            // opt-in disabled) — CacheManager.swift references ConfigConstants.cachePattern
            // unconditionally, and it's only emitted above when WEBVIEW_CONFIG.ios.cachePattern
            // is set, which every create-catalyst-app scaffold omits by default (#485).
            if (!addedKeys.has("cachePattern")) {
                progress.log("cachePattern not found in config, adding default (no patterns)", "info")
                configContent += "\n" + generateSwiftProperty("cachePattern", [])
                addedKeys.add("cachePattern")
            }

            configContent += `\n}`

            fs.writeFileSync(appConfigPath, configContent, "utf8")
            progress.complete("config")
        } catch (error) {
            progress.fail("config", error.message)
            throw error
        }
    }

    /**
     * @param {object} [options]
     * @param {object} [options.signing] - from planIosSigning (plus the CI profile and identity); defaults to ios.provisioningProfile or Automatic
     * @param {{ versionName?: string, buildNumber?: number }} [options.version] - from resolveAppVersion
     */
    async function generateXCConfig({ signing, version } = {}) {
        try {
            const xconfigPath = path.join(PROJECT_DIR, "Configurations", "Shared.xcconfig") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
            const configDir = path.dirname(xconfigPath)
            if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })
            const bundleId =
                iosConfig.bundleIdentifier || iosConfig.appBundleId || "com.catalyst.framework.app"
            const appName = iosConfig.appName || "Catalyst App"
            const signingPlan = signing || {
                style: iosConfig.provisioningProfile ? "manual" : "automatic",
                provisioningProfile: iosConfig.provisioningProfile,
            }
            const teamId = signingPlan.teamId || iosConfig.developmentTeam || ""
            const swiftVersion = iosConfig.deployment?.swiftVersion || "5.9"
            const deploymentTarget = iosConfig.deployment?.target || "17.0"
            const { marketingVersion, buildNumber } = appVersion(version)
            const xconfigContent = `// This file is auto-generated by buildAppIos.js. Do not edit.
//
// Shared configuration for both Debug and Release builds
// All values are dynamically injected from config.json
//

// Product Configuration
PRODUCT_BUNDLE_IDENTIFIER = ${bundleId}
APP_DISPLAY_NAME = ${appName}

// Version Information
MARKETING_VERSION = ${marketingVersion}
CURRENT_PROJECT_VERSION = ${buildNumber}

// Development Team (for code signing)
DEVELOPMENT_TEAM = ${teamId}

// Swift Configuration
SWIFT_VERSION = ${swiftVersion}

// iOS Deployment Target (minimum iOS version)
IPHONEOS_DEPLOYMENT_TARGET = ${deploymentTarget}

// Common build settings
TARGETED_DEVICE_FAMILY = 1,2
ENABLE_PREVIEWS = YES
SWIFT_EMIT_LOC_STRINGS = YES
ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon
ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor

// Code signing
${xcconfigSigningBlock(signingPlan)}

// Module settings
CLANG_ENABLE_MODULES = NO
GENERATE_INFOPLIST_FILE = YES

// Run path search paths
LD_RUNPATH_SEARCH_PATHS = $(inherited) @executable_path/Frameworks

// Development assets
DEVELOPMENT_ASSET_PATHS = "iosnativeWebView/Preview Content"

// Privacy descriptions
INFOPLIST_KEY_NSCameraUsageDescription = This app requires camera access to capture images
INFOPLIST_KEY_NSLocalNetworkUsageDescription = Debug web content in Safari Web Inspector

// UI Configuration
INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES
INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents = YES
INFOPLIST_KEY_UILaunchScreen_Generation = YES
INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight
INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight
`
            fs.writeFileSync(xconfigPath, xconfigContent, "utf8")
            // Detail the step's own check line already covers, so it rides the
            // spinner row rather than escaping the gutter at column 0.
            progress.status(`xcconfig · Swift ${swiftVersion} · iOS ${deploymentTarget}`)
        } catch (error) {
            // Keep the original error (its code and stack); only say which file.
            error.message = `Failed to generate Shared.xcconfig: ${error.message}`
            throw error
        }
    }

    async function updateInfoPlist(pluginComposition = {}) {
        const PROJECT_NAME = ctx.PROJECT_NAME
        const isGoogleSignInEnabled = ctx.isGoogleSignInEnabled
        const GOOGLE_SERVICES_FILENAME = "GoogleService-Info.plist"
        const infoPlistPath = path.join(PROJECT_DIR, PROJECT_NAME, "Info.plist") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        const infoReleasePlistPath = path.join(PROJECT_DIR, PROJECT_NAME, "Info-Release.plist") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        const googleServicesPlistPath = path.join(PROJECT_DIR, PROJECT_NAME, GOOGLE_SERVICES_FILENAME) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        const googleClientId =
            WEBVIEW_CONFIG.googleSignIn?.clientId || WEBVIEW_CONFIG.googleSignIn?.webClientId || ""
        const iosClientId = WEBVIEW_CONFIG.googleSignIn?.iosClientId || ""

        const googleServicesContent = fs.existsSync(googleServicesPlistPath)
            ? fs.readFileSync(googleServicesPlistPath, "utf8")
            : null
        const reversedClientIdFromServices = googleServicesContent
            ? (googleServicesContent.match(/<key>REVERSED_CLIENT_ID<\/key>\s*<string>([^<]+)<\/string>/) ||
                  [])[1]
            : null
        const clientIdFromServices = googleServicesContent
            ? (googleServicesContent.match(/<key>CLIENT_ID<\/key>\s*<string>([^<]+)<\/string>/) || [])[1]
            : null

        const computeReversed = (value) => (!value ? "" : value.split(".").reverse().join("."))
        const resolvedClientIdForScheme = iosClientId || googleClientId || clientIdFromServices || ""
        const resolvedReversedClientId =
            reversedClientIdFromServices || computeReversed(resolvedClientIdForScheme)

        if (isGoogleSignInEnabled && !resolvedReversedClientId) {
            throw new Error("Google Sign-In enabled but no valid clientId found")
        }

        const plistTargets = [infoPlistPath, infoReleasePlistPath]
        const { marketingVersion, buildNumber } = appVersion()
        const pluginUrlSchemes = pluginComposition.urlSchemes || []
        const pluginQuerySchemes = pluginComposition.querySchemes || []
        const pluginInfoPlist = pluginComposition.infoPlist || {}

        plistTargets.forEach((plistPath) => {
            if (!fs.existsSync(plistPath)) return
            restoreManagedFileFromBaseline(plistPath)
            const plistObject = readPlistObject(plistPath)
            plistObject.CFBundleDisplayName = iosConfig.appName || "Catalyst Application"
            mergeIntoTopLevelObject(plistObject, pluginInfoPlist, "ios.infoPlist")
            if (isGoogleSignInEnabled && resolvedReversedClientId) {
                mergeUrlSchemes(plistObject, [{ name: "googleSignIn", schemes: [resolvedReversedClientId] }])
                mergeQuerySchemes(plistObject, ["google", resolvedReversedClientId])
            }
            mergeUrlSchemes(plistObject, pluginUrlSchemes)
            mergeQuerySchemes(plistObject, pluginQuerySchemes)
            // Literal values, so the plist says what the IPA carries.
            plistObject.CFBundleShortVersionString = String(marketingVersion)
            plistObject.CFBundleVersion = String(buildNumber)
            if (plistPath === infoReleasePlistPath) {
                // Without it App Store Connect asks the export compliance
                // questions for every upload. A plugin that ships non-exempt
                // encryption sets it to true through its infoPlist.
                if (plistObject.ITSAppUsesNonExemptEncryption === undefined) {
                    plistObject.ITSAppUsesNonExemptEncryption = false
                }
            } else {
                applyDebugTransportSecurity(plistObject)
            }
            writePlistObject(plistPath, plistObject)
        })
    }

    /**
     * Info.plist is the Debug configuration's plist. When a debug build loads
     * the dev server (ctx.localNetworking), NSAllowsLocalNetworking lets it
     * reach `<mac>.local`, a LAN IP or localhost over plain HTTP. On iOS 10
     * and later its presence makes the OS ignore NSAllowsArbitraryLoads, so
     * it is added only when the plist does not already allow arbitrary loads
     * (the template's debug plist does, and that already covers local hosts).
     * Release builds use Info-Release.plist and never get it.
     */
    function applyDebugTransportSecurity(plistObject) {
        const ats = isPlainObject(plistObject.NSAppTransportSecurity)
            ? { ...plistObject.NSAppTransportSecurity }
            : {}
        if (ctx.localNetworking && ats.NSAllowsArbitraryLoads !== true) ats.NSAllowsLocalNetworking = true
        else delete ats.NSAllowsLocalNetworking
        plistObject.NSAppTransportSecurity = ats
    }

    /**
     * The app's entitlements: the template, the plugins' additions, and
     * aps-environment only when notifications are on. A push entitlement
     * nobody uses makes App Store Connect warn and needs a push-enabled
     * profile for nothing. The value follows the signing profile (see
     * planIosSigning): "development", or "production" for a manually signed
     * release.
     */
    async function updateEntitlements(pluginComposition = {}) {
        const PROJECT_NAME = ctx.PROJECT_NAME
        const entitlementsPath = path.join(PROJECT_DIR, PROJECT_NAME, `${PROJECT_NAME}.entitlements`) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        if (!fs.existsSync(entitlementsPath)) return
        restoreManagedFileFromBaseline(entitlementsPath)
        const entitlementsObject = readPlistObject(entitlementsPath)
        // A baseline saved by an older Catalyst still has the key.
        delete entitlementsObject["aps-environment"]
        mergeIntoTopLevelObject(entitlementsObject, pluginComposition.entitlements || {}, "ios.entitlements")
        if (WEBVIEW_CONFIG.notifications?.enabled) {
            entitlementsObject["aps-environment"] = ctx.apsEnvironment || "development"
        }
        writePlistObject(entitlementsPath, entitlementsObject)
    }

    return { generateConfigConstants, generateXCConfig, updateInfoPlist, updateEntitlements }
}
