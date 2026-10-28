"use strict"
const fs = require("fs")
const path = require("path")
const { inspectWebBridgeInit, WEBBRIDGE_INIT_SNIPPET } = require("../lib/helpers")

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

    _checkRouting(config, wc, platform, issues, warnings, passed)
    _checkWebBridgeInit(root, warnings, passed)

    return _buildResult({ root, configPath, platform, config, issues, warnings, passed })
}

// Native hooks silently run with isNative=false in the WebView when WebBridge.init() is missing from the client entry.
function _checkWebBridgeInit(root, warnings, passed) {
    const r = inspectWebBridgeInit(root)
    const field = "client/index.js: WebBridge.init()"
    const used = `${r.hookFiles.length} file(s) import native hooks from catalyst-core/hooks (e.g. ${r.hookFiles[0]})`
    if (r.state === "ok") passed.push({ field, note: `present in ${r.entry}, inside hydrationReady` })
    else if (r.state === "no-entry") warnings.push({ field, message: `${used} but no client entry (client/index.js) was found, so WebBridge.init() cannot run. Native hooks will report isNative=false.` })
    else if (r.state === "missing-init") warnings.push({ field, message: `${used}, but ${r.entry} never calls WebBridge.init(). Native hooks silently run with isNative=false in the Android/iOS WebView. Add it inside hydrationReady().then(...) just before hydrateRoot:\n${WEBBRIDGE_INIT_SNIPPET}` })
    else if (r.state === "missing-import") warnings.push({ field, message: `${r.entry} calls WebBridge.init() but does not import WebBridge. Add: import WebBridge from "catalyst-core/WebBridge"` })
    else if (r.state === "misplaced") warnings.push({ field, message: `${r.entry} calls WebBridge.init() before hydrationReady(). At module scope it can throw "Cannot read properties of null (reading 'useContext')" during hydration. Move it inside hydrationReady().then(...) just before hydrateRoot:\n${WEBBRIDGE_INIT_SNIPPET}` })
}

const ROUTING_OBJECTIVES = ["balanced", "cost", "latency", "speed", "order"]
const ROUTING_POLICIES = ["allow", "ask", "deny"]
const ROUTING_MODALITIES = ["text", "image", "audio"]

// AI_CONFIG.routing drives useAI({ provider: "auto" }). Mistakes here do not crash: the browser drops bad entries
// with a console warning, so the app silently routes differently than the config says. Catch them up front.
function _checkRouting(config, wc, platform, issues, warnings, passed) {
    const routing = config.AI_CONFIG && config.AI_CONFIG.routing
    if (routing === undefined) return
    const err = (field, message) => issues.push({ field, severity: "error", message })
    const warn = (field, message) => warnings.push({ field, message })
    if (!routing || typeof routing !== "object" || Array.isArray(routing)) {
        return err("AI_CONFIG.routing", "AI_CONFIG.routing must be an object with policy, onDevice and cloud.")
    }
    const before = issues.length
    const policy = routing.policy || {}
    if (policy.objective !== undefined && !ROUTING_OBJECTIVES.includes(policy.objective)) {
        err("AI_CONFIG.routing.policy.objective", `Unknown objective "${policy.objective}". Use ${ROUTING_OBJECTIVES.join(", ")}.`)
    }
    for (const key of ["cloud", "cloudMedia"]) {
        if (policy[key] !== undefined && !ROUTING_POLICIES.includes(policy[key])) {
            err(`AI_CONFIG.routing.policy.${key}`, `"${policy[key]}" is not valid. Use allow, ask or deny.`)
        }
    }
    if (policy.cloudMedia === "allow" || (policy.cloud === "allow" && policy.cloudMedia === undefined)) {
        warn("AI_CONFIG.routing.policy", "Cloud is allowed for image/audio: photos and voice can leave the device without asking. Keep cloudMedia at ask or deny for sensitive apps.")
    }
    for (const key of ["maxLatencyMs", "minTps", "maxCostUsd"]) {
        const v = policy.constraints && policy.constraints[key]
        if (v !== undefined && !(typeof v === "number" && v >= 0)) err(`AI_CONFIG.routing.policy.constraints.${key}`, `${key} must be a non-negative number.`)
    }

    const candidates = []
    const collect = (list, group, where, platformKey) => {
        if (list === undefined) return
        if (!Array.isArray(list)) return err(where, `${where} must be an array of models.`)
        list.forEach((m, i) => {
            const at = `${where}[${i}]`
            if (!m || typeof m !== "object" || typeof m.id !== "string" || !m.id) return err(at, `Each model needs a string "id".`)
            if (m.modalities !== undefined && (!Array.isArray(m.modalities) || m.modalities.some((x) => !ROUTING_MODALITIES.includes(x)))) {
                err(`${at}.modalities`, `modalities must be a subset of ${ROUTING_MODALITIES.join(", ")}.`)
            }
            for (const key of ["ttftMs", "tps", "loadMs"]) {
                if (m[key] !== undefined && !(typeof m[key] === "number" && m[key] >= 0)) err(`${at}.${key}`, `${key} must be a non-negative number.`)
            }
            if (group === "cloud") {
                const providers = (config.AI_CONFIG && config.AI_CONFIG.providers) || {}
                if (typeof m.provider !== "string") err(`${at}.provider`, `Cloud models need a "provider".`)
                else if (!providers[m.provider]) err(`${at}.provider`, `Provider "${m.provider}" is not in AI_CONFIG.providers, so this model can never be used.`)
            } else if (m.engine !== undefined && !["auto", "litert", "foundation-models"].includes(m.engine)) {
                err(`${at}.engine`, `Unknown engine "${m.engine}". Use litert or foundation-models.`)
            } else if (m.engine === "foundation-models" && platformKey === "android") {
                warn(`${at}.engine`, "foundation-models is iOS-only; this Android entry will never run.")
            }
            candidates.push({ id: m.id, group, where: at })
        })
    }
    const onDevice = routing.onDevice || {}
    for (const key of Object.keys(onDevice)) {
        if (!["ios", "android", "web"].includes(key)) warn(`AI_CONFIG.routing.onDevice.${key}`, `Unknown platform "${key}". Use ios, android or web.`)
        else collect(onDevice[key], "onDevice", `AI_CONFIG.routing.onDevice.${key}`, key)
    }
    collect(routing.cloud, "cloud", "AI_CONFIG.routing.cloud", "cloud")

    const seen = new Map()
    for (const c of candidates) {
        // The same id on two platforms is fine (one model, per-platform numbers); twice on one list is not.
        const key = c.where.replace(/\[\d+\]$/, "") + "|" + c.id
        if (seen.has(key)) err(c.where, `Duplicate id "${c.id}" in the same list. Only the first is used.`)
        seen.set(key, true)
    }
    if (!candidates.length) warn("AI_CONFIG.routing", 'routing has no models, so provider "auto" has nothing to route to.')

    for (const c of candidates) {
        if (["cost", "latency", "tps"].includes(c.id)) warn(c.where, `Model id "${c.id}" collides with the order metric "${c.id}"; in policy.order it is read as the metric. Rename the model.`)
    }
    if (policy.order !== undefined) {
        if (!Array.isArray(policy.order) || policy.order.some((x) => typeof x !== "string")) {
            err("AI_CONFIG.routing.policy.order", 'order must be an array of model ids, the groups "onDevice"/"cloud", and/or the metrics "cost", "latency", "tps".')
        } else {
            const known = new Set(["onDevice", "cloud", "cost", "latency", "tps", ...candidates.map((c) => c.id)])
            for (const entry of policy.order) {
                if (!known.has(entry)) warn("AI_CONFIG.routing.policy.order", `"${entry}" matches no model id, group or metric (cost, latency, tps), so it is ignored.`)
            }
        }
    }
    if (candidates.some((c) => c.group === "onDevice") && !(wc.ai && wc.ai.enabled)) {
        warn("WEBVIEW_CONFIG.ai.enabled", "routing lists on-device models but WEBVIEW_CONFIG.ai.enabled is not true: the native AI module is not built into the app, so only web and cloud models can run.")
    }
    if (issues.length === before) passed.push({ field: "AI_CONFIG.routing", note: `${candidates.length} model(s), valid` })
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
