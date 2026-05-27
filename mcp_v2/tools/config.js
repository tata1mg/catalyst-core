"use strict"
const fs = require("fs")
const path = require("path")

let _projectInfo

function init(projectInfo) {
    _projectInfo = projectInfo
}

function handle_check_config({ project_path, platform = "both" } = {}) {
    const root = project_path || _projectInfo.dir
    const configPath = path.join(root, "config", "config.json")
    const issues = []
    const warnings = []
    const passed = []

    if (!fs.existsSync(configPath)) {
        return {
            project_path: root,
            platform,
            config_found: false,
            config_path: configPath,
            issues: [
                {
                    field: "config/config.json",
                    severity: "error",
                    message:
                        "config/config.json not found. catalyst-core requires this file at project root/config/config.json.",
                },
            ],
            warnings: [],
            passed: [],
            summary: { errors: 1, warnings: 0, passed: 0, valid: false },
        }
    }

    let config
    try {
        config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    } catch (e) {
        return {
            project_path: root,
            platform,
            config_found: true,
            config_path: configPath,
            issues: [
                {
                    field: "config/config.json",
                    severity: "error",
                    message: `config/config.json is not valid JSON: ${e.message}`,
                },
            ],
            warnings: [],
            passed: [],
            summary: { errors: 1, warnings: 0, passed: 0, valid: false },
        }
    }

    // ── Top-level required fields ──────────────────────────────────────────────
    if (config.NODE_SERVER_PORT === undefined) {
        issues.push({
            field: "NODE_SERVER_PORT",
            severity: "error",
            message: "NODE_SERVER_PORT is required. Set to the port your web server runs on (e.g. 3000).",
        })
    } else if (typeof config.NODE_SERVER_PORT !== "number") {
        issues.push({
            field: "NODE_SERVER_PORT",
            severity: "error",
            message: `NODE_SERVER_PORT must be a number, got ${typeof config.NODE_SERVER_PORT}.`,
        })
    } else {
        passed.push({ field: "NODE_SERVER_PORT", value: config.NODE_SERVER_PORT })
    }

    if (!config.API_URL) {
        issues.push({
            field: "API_URL",
            severity: "error",
            message: "API_URL is required. Set to your backend API base URL.",
        })
    } else if (typeof config.API_URL !== "string") {
        issues.push({
            field: "API_URL",
            severity: "error",
            message: `API_URL must be a string, got ${typeof config.API_URL}.`,
        })
    } else {
        passed.push({ field: "API_URL", value: config.API_URL })
    }

    if (!config.WEBVIEW_CONFIG) {
        issues.push({
            field: "WEBVIEW_CONFIG",
            severity: "error",
            message: "WEBVIEW_CONFIG object is required. Missing this will prevent native builds.",
        })
        return _buildResult({ root, configPath, platform, config, issues, warnings, passed })
    } else {
        passed.push({ field: "WEBVIEW_CONFIG", note: "block present" })
    }

    const wc = config.WEBVIEW_CONFIG

    // ── WEBVIEW_CONFIG.LOCAL_IP ───────────────────────────────────────────────
    if (!wc.LOCAL_IP) {
        issues.push({
            field: "WEBVIEW_CONFIG.LOCAL_IP",
            severity: "error",
            message:
                'WEBVIEW_CONFIG.LOCAL_IP is required. Set to your machine LAN IP (e.g. "192.168.0.11"). Do NOT use "localhost" — the native emulator/simulator cannot resolve localhost and will fail to connect to the dev server.',
        })
    } else if (wc.LOCAL_IP === "localhost" || wc.LOCAL_IP === "127.0.0.1") {
        issues.push({
            field: "WEBVIEW_CONFIG.LOCAL_IP",
            severity: "error",
            message: `WEBVIEW_CONFIG.LOCAL_IP is set to "${wc.LOCAL_IP}" — this will not work. The native emulator runs in a separate network namespace and cannot resolve localhost. Use your machine LAN IP (run "ifconfig | grep inet" to find it).`,
        })
    } else {
        passed.push({ field: "WEBVIEW_CONFIG.LOCAL_IP", value: wc.LOCAL_IP })
    }

    // ── WEBVIEW_CONFIG.appInfo ────────────────────────────────────────────────
    if (!wc.appInfo) {
        issues.push({
            field: "WEBVIEW_CONFIG.appInfo",
            severity: "error",
            message:
                'WEBVIEW_CONFIG.appInfo is required. Missing appInfo breaks iOS build at compile time. Set to a build identifier string e.g. "android-5Feb2026-v2.1.0". Place at top level of WEBVIEW_CONFIG (not inside android/ios blocks).',
        })
    } else {
        passed.push({ field: "WEBVIEW_CONFIG.appInfo", value: wc.appInfo })
    }

    // ── WEBVIEW_CONFIG.port ────────────────────────────────────────────────────
    if (wc.port === undefined) {
        issues.push({
            field: "WEBVIEW_CONFIG.port",
            severity: "error",
            message:
                "WEBVIEW_CONFIG.port is required. Must match NODE_SERVER_PORT (e.g. 3000). The native WebView connects to this port.",
        })
    } else if (typeof wc.port !== "number") {
        issues.push({
            field: "WEBVIEW_CONFIG.port",
            severity: "error",
            message: `WEBVIEW_CONFIG.port must be a number, got ${typeof wc.port}.`,
        })
    } else {
        if (config.NODE_SERVER_PORT !== undefined && wc.port !== config.NODE_SERVER_PORT) {
            warnings.push({
                field: "WEBVIEW_CONFIG.port",
                message: `WEBVIEW_CONFIG.port (${wc.port}) does not match NODE_SERVER_PORT (${config.NODE_SERVER_PORT}). WebView may connect to wrong port.`,
            })
        } else {
            passed.push({ field: "WEBVIEW_CONFIG.port", value: wc.port })
        }
    }

    // ── accessControl ──────────────────────────────────────────────────────────
    if (!wc.accessControl) {
        issues.push({
            field: "WEBVIEW_CONFIG.accessControl",
            severity: "error",
            message:
                "accessControl block missing. Without it, WebView navigation is unconstrained — deep links can take users outside the app.",
        })
    } else {
        if (!wc.accessControl.enabled) {
            warnings.push({
                field: "WEBVIEW_CONFIG.accessControl.enabled",
                message:
                    "accessControl.enabled is not true. URL allowlist is ignored — all navigation is permitted.",
            })
        } else {
            passed.push({ field: "WEBVIEW_CONFIG.accessControl.enabled", value: true })
        }
        if (!Array.isArray(wc.accessControl.allowedUrls) || wc.accessControl.allowedUrls.length === 0) {
            issues.push({
                field: "WEBVIEW_CONFIG.accessControl.allowedUrls",
                severity: "error",
                message:
                    "allowedUrls is empty. When accessControl is enabled and allowedUrls is empty, ALL URLs are blocked — including your own API calls. App will hang on every network request.",
            })
        } else {
            const hasLocalhost = wc.accessControl.allowedUrls.some((u) => u.includes("localhost"))
            if (!hasLocalhost) {
                warnings.push({
                    field: "WEBVIEW_CONFIG.accessControl.allowedUrls",
                    message:
                        'No localhost entry in allowedUrls. If your app uses the localhost server transport (file downloads, progress tracking), add "http://localhost:*" to allowedUrls.',
                })
            } else {
                passed.push({
                    field: "WEBVIEW_CONFIG.accessControl.allowedUrls",
                    value: `${wc.accessControl.allowedUrls.length} entries (localhost included)`,
                })
            }
            if (!hasLocalhost) {
                passed.push({
                    field: "WEBVIEW_CONFIG.accessControl.allowedUrls",
                    value: `${wc.accessControl.allowedUrls.length} entries`,
                })
            }
        }
    }

    // ── Android fields ─────────────────────────────────────────────────────────
    if (platform === "android" || platform === "both") {
        if (!wc.android) {
            issues.push({
                field: "WEBVIEW_CONFIG.android",
                severity: "error",
                message: "WEBVIEW_CONFIG.android block missing. Android build cannot start without it.",
            })
        } else {
            const a = wc.android
            // sdkPath and emulatorName are hard required — build exits immediately without them
            if (!a.sdkPath) {
                issues.push({
                    field: "WEBVIEW_CONFIG.android.sdkPath",
                    severity: "error",
                    message:
                        "android.sdkPath is required. Set to absolute path of Android SDK (e.g. /Users/you/Android/). Build exits immediately without it.",
                })
            } else if (!fs.existsSync(a.sdkPath)) {
                issues.push({
                    field: "WEBVIEW_CONFIG.android.sdkPath",
                    severity: "error",
                    message: `android.sdkPath "${a.sdkPath}" does not exist on this machine. Android build will fail immediately.`,
                })
            } else {
                passed.push({ field: "WEBVIEW_CONFIG.android.sdkPath", value: a.sdkPath })
            }
            if (!a.emulatorName) {
                issues.push({
                    field: "WEBVIEW_CONFIG.android.emulatorName",
                    severity: "error",
                    message:
                        "android.emulatorName is required for debug builds. Set to AVD name (run: emulator -list-avds). Build fails if emulator not found.",
                })
            } else {
                passed.push({ field: "WEBVIEW_CONFIG.android.emulatorName", value: a.emulatorName })
            }
            // appName and packageName — optional but strongly recommended
            if (!a.appName) {
                warnings.push({
                    field: "WEBVIEW_CONFIG.android.appName",
                    message:
                        'android.appName not set. App will show "Catalyst Application" as display name on device.',
                })
            } else {
                passed.push({ field: "WEBVIEW_CONFIG.android.appName", value: a.appName })
            }
            if (!a.packageName) {
                warnings.push({
                    field: "WEBVIEW_CONFIG.android.packageName",
                    message:
                        "android.packageName not set (e.g. com.company.app). Will be derived from appName — may produce unexpected package ID.",
                })
            } else {
                passed.push({ field: "WEBVIEW_CONFIG.android.packageName", value: a.packageName })
            }
            // buildType
            if (a.buildType && !["debug", "release"].includes(a.buildType)) {
                issues.push({
                    field: "WEBVIEW_CONFIG.android.buildType",
                    severity: "error",
                    message: `android.buildType must be "debug" or "release", got "${a.buildType}".`,
                })
            } else {
                passed.push({
                    field: "WEBVIEW_CONFIG.android.buildType",
                    value: a.buildType || "debug (default)",
                })
            }
            // release keystore check
            if (a.buildType === "release" && !a.keystore && !a.keystoreConfig) {
                issues.push({
                    field: "WEBVIEW_CONFIG.android.keystore",
                    severity: "error",
                    message:
                        'android.buildType is "release" but no keystore or keystoreConfig provided. Release build cannot sign the APK.',
                })
            }
            if (a.cachePattern !== undefined && typeof a.cachePattern !== "string") {
                warnings.push({
                    field: "WEBVIEW_CONFIG.android.cachePattern",
                    message: `android.cachePattern should be a comma-separated glob string (e.g. "*.css,*.js,*.png"), got ${typeof a.cachePattern}.`,
                })
            } else if (a.cachePattern) {
                passed.push({ field: "WEBVIEW_CONFIG.android.cachePattern", value: a.cachePattern })
            }
            if (a.security && typeof a.security.allowBackup !== "boolean") {
                warnings.push({
                    field: "WEBVIEW_CONFIG.android.security.allowBackup",
                    message:
                        "android.security.allowBackup should be a boolean. Controls Google cloud backup of app data.",
                })
            }
        }
    }

    // ── iOS fields ─────────────────────────────────────────────────────────────
    if (platform === "ios" || platform === "both") {
        if (!wc.ios) {
            issues.push({
                field: "WEBVIEW_CONFIG.ios",
                severity: "error",
                message: "WEBVIEW_CONFIG.ios block missing. iOS build cannot start without it.",
            })
        } else {
            const ios = wc.ios
            // appBundleId — optional but strongly recommended (defaults to com.debug.webview)
            if (!ios.appBundleId) {
                warnings.push({
                    field: "WEBVIEW_CONFIG.ios.appBundleId",
                    message:
                        'ios.appBundleId not set. App will use "com.debug.webview" as bundle ID — fine for testing, must be set for distribution.',
                })
            } else {
                if (!/^[a-z0-9][a-z0-9]*(\.[a-z0-9][a-z0-9]*){1,}$/i.test(ios.appBundleId)) {
                    warnings.push({
                        field: "WEBVIEW_CONFIG.ios.appBundleId",
                        message: `appBundleId "${ios.appBundleId}" may not be valid — expected reverse-DNS format like "com.company.app".`,
                    })
                } else {
                    passed.push({ field: "WEBVIEW_CONFIG.ios.appBundleId", value: ios.appBundleId })
                }
            }
            // simulatorName — optional, auto-detected if missing
            if (!ios.simulatorName) {
                warnings.push({
                    field: "WEBVIEW_CONFIG.ios.simulatorName",
                    message:
                        'ios.simulatorName not set. Will use auto-detected booted simulator. Recommend setting explicitly (e.g. "iPhone 17 Pro"). Run: xcrun simctl list devices.',
                })
            } else {
                passed.push({ field: "WEBVIEW_CONFIG.ios.simulatorName", value: ios.simulatorName })
            }
            // appName — optional, defaults to "Catalyst Application"
            if (!ios.appName) {
                warnings.push({
                    field: "WEBVIEW_CONFIG.ios.appName",
                    message:
                        'ios.appName not set. App will show "Catalyst Application" as display name on device.',
                })
            } else {
                passed.push({ field: "WEBVIEW_CONFIG.ios.appName", value: ios.appName })
            }
            // buildType — case-sensitive (Debug/Release not debug/release)
            if (ios.buildType && !["Debug", "Release"].includes(ios.buildType)) {
                issues.push({
                    field: "WEBVIEW_CONFIG.ios.buildType",
                    severity: "error",
                    message: `ios.buildType must be "Debug" or "Release" (case-sensitive). Got: "${ios.buildType}". Common mistake: using lowercase "debug" breaks Xcode build.`,
                })
            } else {
                passed.push({
                    field: "WEBVIEW_CONFIG.ios.buildType",
                    value: ios.buildType || "Debug (default)",
                })
            }
            // physical device fields
            if (ios.deviceUDID && !ios.developmentTeam) {
                warnings.push({
                    field: "WEBVIEW_CONFIG.ios.developmentTeam",
                    message:
                        "ios.deviceUDID is set (physical device build) but ios.developmentTeam is missing. Physical device builds require Apple Developer Team ID for code signing.",
                })
            }
            if (ios.cachePattern !== undefined && typeof ios.cachePattern !== "string") {
                warnings.push({
                    field: "WEBVIEW_CONFIG.ios.cachePattern",
                    message: `ios.cachePattern should be a comma-separated glob string, got ${typeof ios.cachePattern}.`,
                })
            } else if (ios.cachePattern) {
                passed.push({ field: "WEBVIEW_CONFIG.ios.cachePattern", value: ios.cachePattern })
            }
        }
    }

    // ── splashScreen (top-level, not inside WEBVIEW_CONFIG) ────────────────────
    if (!config.splashScreen) {
        warnings.push({
            field: "splashScreen",
            message:
                'splashScreen key missing from top level of config/config.json. Native app will show a blank white screen during JS load. Add splashScreen: { android: { path: "public/android/splashscreen.png" }, ios: { path: "public/ios/splashscreen.png" } }.',
        })
    } else {
        const missingSplash = ["public/android/splashscreen.png", "public/ios/splashscreen.png"].filter(
            (f) => !fs.existsSync(path.join(root, f))
        )
        if (missingSplash.length) {
            issues.push({
                field: "splashScreen",
                severity: "error",
                message: `splashScreen configured but asset files missing: ${missingSplash.join(", ")}. Native build will fail when packaging.`,
            })
        } else {
            passed.push({ field: "splashScreen", note: "config and both asset files present" })
        }
    }

    // ── notifications (optional, validate if present) ─────────────────────────
    if (wc.notifications && wc.notifications.enabled) {
        const missingFirebase = ["google-services.json", "GoogleService-Info.plist"].filter(
            (f) => !fs.existsSync(path.join(root, f))
        )
        if (missingFirebase.length) {
            issues.push({
                field: "WEBVIEW_CONFIG.notifications",
                severity: "error",
                message: `notifications.enabled=true but Firebase config files missing: ${missingFirebase.join(", ")}. Native build will fail at compile time.`,
            })
        } else {
            passed.push({
                field: "WEBVIEW_CONFIG.notifications",
                note: "enabled=true and Firebase files present",
            })
        }
    }

    return _buildResult({ root, configPath, platform, config, issues, warnings, passed })
}

function _buildResult({ root, configPath, platform, issues, warnings, passed }) {
    const errorCount = issues.filter((i) => i.severity === "error").length
    return {
        project_path: root,
        platform,
        config_found: true,
        config_path: configPath,
        issues,
        warnings,
        passed,
        summary: {
            errors: errorCount,
            warnings: warnings.length,
            passed: passed.length,
            valid: errorCount === 0,
            verdict:
                errorCount === 0
                    ? warnings.length === 0
                        ? "Config is valid."
                        : `Config is valid with ${warnings.length} warning(s).`
                    : `Config has ${errorCount} error(s) that will cause build or runtime failures.`,
        },
    }
}

module.exports = { init, handle_check_config }
