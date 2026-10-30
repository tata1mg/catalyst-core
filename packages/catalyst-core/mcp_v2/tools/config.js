"use strict"
const fs = require("fs")
const path = require("path")

let _projectInfo

function init(projectInfo) {
    _projectInfo = projectInfo
}

function projectPath(root, rel) {
    const normalized = path.normalize(rel)
    if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
        return null
    }
    return `${root}${path.sep}${normalized}`
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

    // ── App identity and production URL (catalyst-core 1.3.0+) ─────────────────
    // appId and appName apply to both platforms and win over the per-platform
    // keys. url is the origin a release build loads; debug builds ignore it.
    const PLACEHOLDER_APP_IDS = [
        "io.yourname.androidproject",
        "com.catalyst.framework.app",
        "com.debug.webview",
    ]
    const legacyAppId = wc.android?.packageName || wc.ios?.appBundleId || wc.ios?.bundleIdentifier
    const appId = typeof wc.appId === "string" && wc.appId.trim() ? wc.appId.trim() : null
    if (appId) {
        if (
            appId.toLowerCase().startsWith("com.example.") ||
            PLACEHOLDER_APP_IDS.includes(appId.toLowerCase())
        ) {
            warnings.push({
                field: "WEBVIEW_CONFIG.appId",
                message: `appId "${appId}" is a placeholder. Debug builds work, but a release build refuses it (NATIVE-003). Set your own reverse-DNS id, e.g. "com.yourcompany.app"; it cannot change after the first store upload.`,
            })
        } else {
            passed.push({ field: "WEBVIEW_CONFIG.appId", value: appId })
        }
    } else if (!legacyAppId) {
        warnings.push({
            field: "WEBVIEW_CONFIG.appId",
            message:
                'WEBVIEW_CONFIG.appId not set. It is the Android application id and the iOS bundle id (e.g. "com.yourcompany.app"); a release build refuses to ship without one (NATIVE-003).',
        })
    }
    if (typeof wc.appName === "string" && wc.appName.trim()) {
        passed.push({ field: "WEBVIEW_CONFIG.appName", value: wc.appName })
    }
    if (wc.url) {
        let parsed = null
        try {
            parsed = new URL(String(wc.url))
        } catch {
            parsed = null
        }
        if (
            !parsed ||
            !["http:", "https:"].includes(parsed.protocol) ||
            (parsed.pathname && parsed.pathname !== "/")
        ) {
            issues.push({
                field: "WEBVIEW_CONFIG.url",
                severity: "error",
                message: `WEBVIEW_CONFIG.url "${wc.url}" must be an http(s) origin without a path, e.g. "https://shop.acme.com". A release build fails with NATIVE-004.`,
            })
        } else if (
            /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/i.test(
                parsed.hostname
            ) &&
            wc.allowPrivateHost !== true
        ) {
            warnings.push({
                field: "WEBVIEW_CONFIG.url",
                message: `WEBVIEW_CONFIG.url "${wc.url}" is a local or private host. A release build refuses it (NATIVE-001) unless WEBVIEW_CONFIG.allowPrivateHost is true.`,
            })
        } else {
            passed.push({ field: "WEBVIEW_CONFIG.url", value: wc.url })
        }
    } else {
        warnings.push({
            field: "WEBVIEW_CONFIG.url",
            message:
                'WEBVIEW_CONFIG.url not set. Release builds load this production origin (e.g. "https://shop.acme.com"); without it they fall back to LOCAL_IP/port/useHttps. Debug builds do not need it.',
        })
    }

    // ── WEBVIEW_CONFIG.LOCAL_IP ───────────────────────────────────────────────
    // Debug builds reach the dev server on their own (adb reverse on Android,
    // localhost on the simulator, <mac>.local on an iPhone), so LOCAL_IP stays
    // localhost. A LAN address saved by an older setup is put back to
    // localhost by the first 1.3.0 build.
    if (
        wc.LOCAL_IP &&
        !["localhost", "127.0.0.1"].includes(wc.LOCAL_IP) &&
        /^\d{1,3}(\.\d{1,3}){3}$/.test(wc.LOCAL_IP)
    ) {
        warnings.push({
            field: "WEBVIEW_CONFIG.LOCAL_IP",
            message: `WEBVIEW_CONFIG.LOCAL_IP is "${wc.LOCAL_IP}". Keep it "localhost": debug builds work out the dev server address themselves, and the first build on catalyst-core 1.3.0 resets a private address to localhost. Put the production address in WEBVIEW_CONFIG.url.`,
        })
    } else {
        passed.push({ field: "WEBVIEW_CONFIG.LOCAL_IP", value: wc.LOCAL_IP || "localhost (default)" })
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
    } else if (
        !(typeof wc.port === "number" || (typeof wc.port === "string" && /^\d+$/.test(wc.port.trim()))) ||
        !(Number(wc.port) >= 1 && Number(wc.port) <= 65535)
    ) {
        // The template ships "3005": both shells read it as text.
        issues.push({
            field: "WEBVIEW_CONFIG.port",
            severity: "error",
            message: `WEBVIEW_CONFIG.port must be a port number from 1 to 65535 (a number or a string such as "3005"), got ${JSON.stringify(wc.port)}.`,
        })
    } else {
        if (config.NODE_SERVER_PORT !== undefined && Number(wc.port) !== Number(config.NODE_SERVER_PORT)) {
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
    // Everything here is optional: buildApp:android finds or installs the SDK,
    // JDK and emulator itself, after asking (or with --yes / --accept-licenses).
    if ((platform === "android" || platform === "both") && wc.android) {
        const a = wc.android
        if (a.sdkPath && !fs.existsSync(a.sdkPath.replace(/^~(?=$|\/)/, process.env.HOME || "~"))) {
            warnings.push({
                field: "WEBVIEW_CONFIG.android.sdkPath",
                message: `android.sdkPath "${a.sdkPath}" does not exist on this machine. Remove it to let the build use ANDROID_HOME, ANDROID_SDK_ROOT or the default SDK location (and install the SDK there).`,
            })
        } else if (a.sdkPath) {
            passed.push({ field: "WEBVIEW_CONFIG.android.sdkPath", value: a.sdkPath })
        }
        if (a.emulatorName)
            passed.push({ field: "WEBVIEW_CONFIG.android.emulatorName", value: a.emulatorName })
        if (!wc.appName && a.appName)
            passed.push({ field: "WEBVIEW_CONFIG.android.appName", value: a.appName })
        if (!wc.appId && a.packageName) {
            passed.push({ field: "WEBVIEW_CONFIG.android.packageName", value: a.packageName })
        }
        if (String(a.buildType || "").toLowerCase() === "release") {
            warnings.push({
                field: "WEBVIEW_CONFIG.android.buildType",
                message:
                    'android.buildType "release" is deprecated. Use `npm run android:release` (catalyst buildApp:android --release) and set buildType back to "debug" or remove it.',
            })
        }
        const keystoreBlocks = [a.keystore, a.keystoreConfig].filter(Boolean)
        if (keystoreBlocks.some((block) => block.storePassword || block.keyPassword)) {
            warnings.push({
                field: "WEBVIEW_CONFIG.android.keystoreConfig",
                message:
                    "Keystore passwords in config.json are not used for signing. The upload key lives in credentials/android/ (created by the first release build in a terminal; CI uses the CATALYST_ANDROID_CREDENTIALS secret from `catalyst credentials:export android`). Delete the passwords.",
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

    // ── iOS fields ─────────────────────────────────────────────────────────────
    // buildApp:ios picks an existing iPhone simulator (ios.simulatorName
    // first), creates "Catalyst iPhone" only when there is none, and
    // finishes Xcode setup itself. Signing files live
    // in credentials/ios/ (CI: CATALYST_IOS_CREDENTIALS), never in config.json.
    if (platform === "ios" || platform === "both") {
        const ios = wc.ios || {}
        if (!wc.appId && ios.appBundleId) {
            if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,}$/i.test(ios.appBundleId)) {
                warnings.push({
                    field: "WEBVIEW_CONFIG.ios.appBundleId",
                    message: `appBundleId "${ios.appBundleId}" may not be valid; expected reverse-DNS format like "com.company.app". Prefer WEBVIEW_CONFIG.appId.`,
                })
            } else {
                passed.push({ field: "WEBVIEW_CONFIG.ios.appBundleId", value: ios.appBundleId })
            }
        }
        if (ios.simulatorName)
            passed.push({ field: "WEBVIEW_CONFIG.ios.simulatorName", value: ios.simulatorName })
        if (String(ios.buildType || "").toLowerCase() === "release") {
            warnings.push({
                field: "WEBVIEW_CONFIG.ios.buildType",
                message:
                    'ios.buildType "release" is deprecated. Use `npm run ios:release` (catalyst buildApp:ios --release) and set buildType back to "debug" or remove it.',
            })
        }
        if (ios.developmentTeam) {
            passed.push({ field: "WEBVIEW_CONFIG.ios.developmentTeam", value: ios.developmentTeam })
        } else {
            warnings.push({
                field: "WEBVIEW_CONFIG.ios.developmentTeam",
                message:
                    "ios.developmentTeam not set. The simulator does not need it, but a physical iPhone (--device) and a release with cloud or Xcode-account signing do (IOS-010). Set your 10-character Apple team ID.",
            })
        }
        // iOS reads an array of patterns; a string becomes one literal
        // pattern (not split on commas, unlike android.cachePattern).
        const iosPattern = ios.cachePattern
        const iosPatternOk = Array.isArray(iosPattern)
            ? iosPattern.every((item) => typeof item === "string")
            : typeof iosPattern === "string"
        if (iosPattern !== undefined && !iosPatternOk) {
            warnings.push({
                field: "WEBVIEW_CONFIG.ios.cachePattern",
                message: `ios.cachePattern should be an array of glob strings (e.g. ["*.css", "*.js"]), got ${JSON.stringify(iosPattern)}.`,
            })
        } else if (typeof iosPattern === "string" && iosPattern.includes(",")) {
            warnings.push({
                field: "WEBVIEW_CONFIG.ios.cachePattern",
                message: `ios.cachePattern "${iosPattern}" is one literal pattern on iOS, not a comma-separated list. Use an array, e.g. ["*.css", "*.js"].`,
            })
        } else if (iosPattern && iosPattern.length) {
            passed.push({ field: "WEBVIEW_CONFIG.ios.cachePattern", value: iosPattern })
        }
    }

    // ── splashScreen (inside WEBVIEW_CONFIG; the native builds read only that) ──
    const splash = wc.splashScreen
    const hasSplashHtml = fs.existsSync(path.join(root, "public", "splashscreen.html"))
    if (!splash) {
        warnings.push({
            field: "WEBVIEW_CONFIG.splashScreen",
            message: config.splashScreen
                ? "splashScreen is at the top level of config/config.json, where the native builds never read it. Move it into WEBVIEW_CONFIG.splashScreen."
                : `WEBVIEW_CONFIG.splashScreen not set, so the native splash screen is off${hasSplashHtml ? " and public/splashscreen.html is ignored" : ""}. Add WEBVIEW_CONFIG.splashScreen (e.g. { "backgroundColor": "#ffffff" }) to turn it on.`,
        })
    } else {
        // Images are optional: Android falls back to the launcher icon, iOS to a loader.
        const found = (dir, exts) =>
            exts
                .map((ext) => `public/${dir}/splashscreen.${ext}`)
                // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - root is the local project root; f comes from a fixed candidate list.
                .find((f) => fs.existsSync(path.join(root, f)))
        const androidImage = found("android", ["png", "jpg", "jpeg", "gif", "bmp", "webp"])
        const iosImage = found("ios", ["png", "jpg", "jpeg"])
        passed.push({
            field: "WEBVIEW_CONFIG.splashScreen",
            note: `android image: ${androidImage || "none (launcher icon)"}, ios image: ${iosImage || "none (loader)"}`,
        })
        // Same rule as the iOS build (buildIos/config.js): anything else is ignored with a warning.
        const { minDuration } = splash
        if (
            minDuration !== undefined &&
            !(typeof minDuration === "number" && Number.isFinite(minDuration) && minDuration >= 0)
        ) {
            warnings.push({
                field: "WEBVIEW_CONFIG.splashScreen.minDuration",
                message: `splashScreen.minDuration must be a non-negative number of milliseconds. Got ${JSON.stringify(minDuration)}; the build ignores it and uses 0.`,
            })
        }
        if (hasSplashHtml) {
            passed.push({
                field: "public/splashscreen.html",
                note: `HTML splash on (catalyst-core 1.0.2+): shown after the native image until the first page loads, for at least minDuration (${minDuration || 0} ms), at most 10 s; duration is ignored`,
            })
        }
    }

    // ── notifications (optional, validate if present) ─────────────────────────
    if (wc.notifications && wc.notifications.enabled) {
        const missingFirebase = ["google-services.json", "GoogleService-Info.plist"].filter((f) => {
            const filePath = projectPath(root, f)
            return !filePath || !fs.existsSync(filePath)
        })
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

    // ── ai (optional, on-device AI via catalyst-ai) ───────────────────────────
    if (wc.ai && wc.ai.enabled) {
        const aiPkg = path.join(root, "node_modules", "catalyst-ai", "package.json")
        if (!fs.existsSync(aiPkg)) {
            issues.push({
                field: "WEBVIEW_CONFIG.ai",
                severity: "error",
                message:
                    "ai.enabled=true but catalyst-ai is not installed. The native AI plugin is silently skipped and on-device AI will not work. Run: npm install catalyst-ai",
            })
        } else {
            passed.push({ field: "WEBVIEW_CONFIG.ai", note: "enabled=true and catalyst-ai installed" })
        }
        const browser = (config.AI_CONFIG && config.AI_CONFIG.browser) || {}
        const engine = browser.engine
        if (engine !== undefined && !["auto", "litert", "foundation-models"].includes(engine)) {
            issues.push({
                field: "AI_CONFIG.browser.engine",
                severity: "error",
                message: `Unknown engine "${engine}". Use "auto", "litert" (Gemma 4 E2B) or "foundation-models" (Apple, iOS 26+).`,
            })
        }
        if (browser.provider === "foundation-models" && platform === "android") {
            warnings.push({
                field: "AI_CONFIG.browser.provider",
                message:
                    "foundation-models is iOS-only (iOS 26+, Apple Intelligence devices). Android needs provider 'litert' or 'native'.",
            })
        }
    } else if (
        config.AI_CONFIG &&
        config.AI_CONFIG.browser &&
        /^(native|litert|foundation-models)$/.test(config.AI_CONFIG.browser.provider || "")
    ) {
        warnings.push({
            field: "WEBVIEW_CONFIG.ai.enabled",
            message: `AI_CONFIG.browser.provider is "${config.AI_CONFIG.browser.provider}" (on-device) but WEBVIEW_CONFIG.ai.enabled is not true — the native AI module is not built into the app.`,
        })
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
