"use strict"

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { execSync } = require("child_process")

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

// ─── Module factory ───────────────────────────────────────────────────────────

module.exports = function createConfigPhase(ctx) {
    const { WEBVIEW_CONFIG, iosConfig, PROJECT_DIR, SCHEME_NAME, url, progress,
            restoreManagedFileFromBaseline, readPlistObject, writePlistObject } = ctx

    function mergeIntoTopLevelObject(target, source, fieldName) {
        for (const [key, value] of Object.entries(source || {})) {
            target[key] = mergeStructuredValues(target[key], value, `${fieldName}.${key}`)
        }
    }

    function mergeUrlSchemes(plistObject, entries) {
        const existing = Array.isArray(plistObject.CFBundleURLTypes) ? plistObject.CFBundleURLTypes : []
        const merged = existing.map((entry) => ({
            ...entry,
            CFBundleURLSchemes: Array.isArray(entry?.CFBundleURLSchemes) ? [...new Set(entry.CFBundleURLSchemes)] : [],
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
        const existing = Array.isArray(plistObject.LSApplicationQueriesSchemes) ? plistObject.LSApplicationQueriesSchemes : []
        const merged = [...new Set([...existing, ...schemes.filter(Boolean)])]
        if (merged.length > 0) plistObject.LSApplicationQueriesSchemes = merged
    }

    async function generateConfigConstants() {
        progress.start("config")
        try {
            const appConfigPath = path.join(PROJECT_DIR, "Sources", "Core", "Constants", "ConfigConstants.swift")
            const appConfigDir = path.dirname(appConfigPath)
            if (!fs.existsSync(appConfigDir)) fs.mkdirSync(appConfigDir, { recursive: true })

            let configContent = `// This file is auto-generated. Do not edit.
import Foundation

public enum ConfigConstants {
    public static let url = "${url}"`

            const addedKeys = new Set()

            if (WEBVIEW_CONFIG && typeof WEBVIEW_CONFIG === "object") {
                for (const [key, value] of Object.entries(WEBVIEW_CONFIG)) {
                    if (key === "ios" || key === "android") continue
                    if (key === "notifications") progress.log(`Processing notifications config: ${JSON.stringify(value)}`, "info")
                    configContent += "\n" + generateSwiftProperty(key, value)
                    addedKeys.add(key)
                }
            }

            if (iosConfig && typeof iosConfig === "object") {
                configContent += "\n    \n    // iOS-specific configuration"
                for (const [key, value] of Object.entries(iosConfig)) {
                    if (addedKeys.has(key)) continue
                    configContent += "\n" + generateSwiftProperty(key, value)
                }
            }

            if (WEBVIEW_CONFIG.accessControl) {
                const accessControl = WEBVIEW_CONFIG.accessControl
                configContent += `\n    public static let accessControlEnabled = ${accessControl.enabled || false}`
                if (accessControl.allowedUrls && Array.isArray(accessControl.allowedUrls)) {
                    const allowedUrls = accessControl.allowedUrls.map((u) => `"${u}"`).join(", ")
                    configContent += `\n    public static let allowedUrls: [String] = [${allowedUrls}]`
                } else if (accessControl.allowedUrls && typeof accessControl.allowedUrls === "string") {
                    const allowedUrls = accessControl.allowedUrls.split(",").map((u) => u.trim()).filter((u) => u.length > 0).map((u) => `"${u}"`).join(", ")
                    configContent += `\n    public static let allowedUrls: [String] = [${allowedUrls}]`
                }
            } else {
                configContent += `\n    public static let accessControlEnabled = false\n    public static let allowedUrls: [String] = []`
            }

            const splashConfig = WEBVIEW_CONFIG.splashScreen
            if (splashConfig) {
                configContent += `\n\n    // Splash Screen Configuration\n    public static let splashScreenEnabled = true`
                configContent += splashConfig.duration ? `\n    public static let splashScreenDuration: TimeInterval? = ${splashConfig.duration / 1000.0}` : `\n    public static let splashScreenDuration: TimeInterval? = nil`
                configContent += splashConfig.backgroundColor ? `\n    public static let splashScreenBackgroundColor = "${splashConfig.backgroundColor}"` : `\n    public static let splashScreenBackgroundColor = "#ffffff"`
                configContent += `\n    public static let splashScreenImageWidth: CGFloat = ${splashConfig.imageWidth || 120}`
                configContent += `\n    public static let splashScreenImageHeight: CGFloat = ${splashConfig.imageHeight || 120}`
                configContent += `\n    public static let splashScreenCornerRadius: CGFloat = ${splashConfig.cornerRadius || 20}`
            } else {
                configContent += `\n\n    // Splash Screen Configuration\n    public static let splashScreenEnabled = false\n    public static let splashScreenDuration: TimeInterval? = nil\n    public static let splashScreenBackgroundColor = "#ffffff"\n    public static let splashScreenImageWidth: CGFloat = 120\n    public static let splashScreenImageHeight: CGFloat = 120\n    public static let splashScreenCornerRadius: CGFloat = 20`
            }

            if (!addedKeys.has("notifications")) {
                progress.log("Notifications not found in config, adding default (false)", "info")
                configContent += "\n    public enum Notifications {\n        public static let enabled = false\n    }"
                addedKeys.add("notifications")
            } else {
                progress.log("Notifications config was processed from WEBVIEW_CONFIG", "info")
            }

            if (!addedKeys.has("googleSignIn")) {
                progress.log("Google Sign-In not found in config, adding defaults (disabled)", "info")
                configContent += '\n    public enum GoogleSignIn {\n        public static let enabled = false\n        public static let clientId = ""\n        public static let iosClientId = ""\n    }'
                addedKeys.add("googleSignIn")
            }

            if (!addedKeys.has("edgeToEdge")) {
                progress.log("EdgeToEdge not found in config, adding default (false)", "info")
                configContent += "\n    public enum EdgeToEdge {\n        public static let enabled = false\n    }"
                addedKeys.add("edgeToEdge")
            } else {
                progress.log("EdgeToEdge config was processed from WEBVIEW_CONFIG", "info")
            }

            configContent += `\n}`

            fs.writeFileSync(appConfigPath, configContent, "utf8")
            progress.log("Configuration constants generated successfully (SPM Package)", "success")
            progress.complete("config")
        } catch (error) {
            progress.fail("config", error.message)
            throw error
        }
    }

    async function generateXCConfig() {
        try {
            const xconfigPath = path.join(PROJECT_DIR, "Configurations", "Shared.xcconfig")
            const configDir = path.dirname(xconfigPath)
            if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })
            const bundleId = iosConfig.bundleIdentifier || iosConfig.appBundleId || "com.catalyst.framework.app"
            const appName = iosConfig.appName || "Catalyst App"
            const teamId = iosConfig.developmentTeam || ""
            const swiftVersion = iosConfig.deployment?.swiftVersion || "5.9"
            const deploymentTarget = iosConfig.deployment?.target || "17.0"
            const marketingVersion = iosConfig.version ? `${iosConfig.version.major || 1}.${iosConfig.version.minor || 0}.${iosConfig.version.patch || 0}` : "1.0.0"
            const buildNumber = iosConfig.version?.buildNumber || 1
            const provisioningProfile = iosConfig.provisioningProfile || ""
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
CODE_SIGN_IDENTITY = Apple Development
CODE_SIGN_IDENTITY[sdk=iphoneos*] = iPhone Developer
CODE_SIGN_STYLE = Manual
PROVISIONING_PROFILE_SPECIFIER =
PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*] = ${provisioningProfile}

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
            console.log(`✅ Generated Shared.xcconfig with Swift ${swiftVersion}, iOS ${deploymentTarget}, Bundle ID: ${bundleId}`)
        } catch (error) {
            console.error(`❌ Failed to generate Shared.xcconfig: ${error.message}`)
            throw error
        }
    }

    async function updateInfoPlist(pluginComposition = {}) {
        const PROJECT_NAME = ctx.PROJECT_NAME
        const isGoogleSignInEnabled = ctx.isGoogleSignInEnabled
        const GOOGLE_SERVICES_FILENAME = "GoogleService-Info.plist"
        try {
            const infoPlistPath = path.join(PROJECT_DIR, PROJECT_NAME, "Info.plist")
            const infoReleasePlistPath = path.join(PROJECT_DIR, PROJECT_NAME, "Info-Release.plist")
            const googleServicesPlistPath = path.join(PROJECT_DIR, PROJECT_NAME, GOOGLE_SERVICES_FILENAME)
            const googleClientId = WEBVIEW_CONFIG.googleSignIn?.clientId || WEBVIEW_CONFIG.googleSignIn?.webClientId || ""
            const iosClientId = WEBVIEW_CONFIG.googleSignIn?.iosClientId || ""

            const googleServicesContent = fs.existsSync(googleServicesPlistPath) ? fs.readFileSync(googleServicesPlistPath, "utf8") : null
            const reversedClientIdFromServices = googleServicesContent
                ? (googleServicesContent.match(/<key>REVERSED_CLIENT_ID<\/key>\s*<string>([^<]+)<\/string>/) || [])[1] : null
            const clientIdFromServices = googleServicesContent
                ? (googleServicesContent.match(/<key>CLIENT_ID<\/key>\s*<string>([^<]+)<\/string>/) || [])[1] : null

            const computeReversed = (value) => !value ? "" : value.split(".").reverse().join(".")
            const resolvedClientIdForScheme = iosClientId || googleClientId || clientIdFromServices || ""
            const resolvedReversedClientId = reversedClientIdFromServices || computeReversed(resolvedClientIdForScheme)

            if (isGoogleSignInEnabled && !resolvedReversedClientId) {
                throw new Error("Google Sign-In enabled but no valid clientId found")
            }

            const plistTargets = [infoPlistPath, infoReleasePlistPath]
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
                writePlistObject(plistPath, plistObject)
            })
        } catch (err) {
            throw err
        }
    }

    async function updateEntitlements(pluginComposition = {}) {
        const PROJECT_NAME = ctx.PROJECT_NAME
        const entitlementsPath = path.join(PROJECT_DIR, PROJECT_NAME, `${PROJECT_NAME}.entitlements`)
        if (!fs.existsSync(entitlementsPath)) return
        restoreManagedFileFromBaseline(entitlementsPath)
        const entitlementsObject = readPlistObject(entitlementsPath)
        mergeIntoTopLevelObject(entitlementsObject, pluginComposition.entitlements || {}, "ios.entitlements")
        writePlistObject(entitlementsPath, entitlementsObject)
    }

    return { generateConfigConstants, generateXCConfig, updateInfoPlist, updateEntitlements }
}
