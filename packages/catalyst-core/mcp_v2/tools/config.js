"use strict"
const fs = require("fs")
const os = require("os")
const path = require("path")
const {
    versionOlderThan,
    installedCatalystVersion,
    checkSingleAppIcon,
    hasAndroidSizedIcons,
    hasIosSizedIcons,
    inspectWebBridgeInit,
    WEBBRIDGE_INIT_SNIPPET,
} = require("../lib/helpers")

// The release that added appId/url, NATIVE-010 and public/icon.png.
const NATIVE_120 = "1.2.0"


/**
 * The model names catalyst-ai has built-in prices for, read as TEXT from its pricing.js. The file is never required: the
 * project root is whatever the caller points the tool at, and loading its dependencies would run their code. Looks in the
 * project's node_modules and then its parents (hoisted and workspace installs). Null when it cannot be found or read, in
 * which case the missing-price warnings are skipped.
 */
function readBuiltInPriceKeys(root) {
    let dir = root
    for (let depth = 0; depth < 8; depth++) {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - root is the local project directory; the rest is a fixed literal
        const file = path.join(dir, "node_modules", "catalyst-ai", "src", "pricing.js")
        if (fs.existsSync(file)) return priceKeysFromSource(safeRead(file))
        const parent = path.dirname(dir)
        if (parent === dir) break
        dir = parent
    }
    return null
}

function safeRead(file) {
    try {
        return fs.readFileSync(file, "utf8")
    } catch (_) {
        return null
    }
}

/** The keys of one object literal that starts at source[open] === "{", found by scanning the text (nothing is evaluated). */
function keysOfObjectLiteral(source, open) {
    const keys = []
    let depth = 0
    let lineStart = open + 1
    for (let i = open; i < source.length; i++) {
        const ch = source[i]
        if (ch === "/" && source[i + 1] === "/") {
            i = source.indexOf("\n", i)
            if (i === -1) break
            lineStart = i + 1
            continue
        }
        if (ch === "{") depth++
        else if (ch === "}") {
            depth--
            if (depth === 0) break
        } else if (ch === "\n" && depth === 1) lineStart = i + 1
        if (ch === ":" && depth === 1) {
            const key = /^\s*["']?([A-Za-z0-9._:/-]+)["']?\s*$/.exec(source.slice(lineStart, i))
            if (key) keys.push(key[1])
        }
    }
    return keys
}

/** Every model name priced in pricing.js: `const PRICING = { ... }` (or a `PRICING: { ... }` property) plus each `Object.assign(PRICING, { ... })` block. */
function priceKeysFromSource(source) {
    if (typeof source !== "string") return null
    const starts = [...source.matchAll(/const PRICING = \{|Object\.assign\(\s*PRICING\s*,\s*\{|\bPRICING\s*:\s*\{/g)]
    if (!starts.length) return null
    const keys = []
    for (const m of starts) keys.push(...keysOfObjectLiteral(source, m.index + m[0].length - 1))
    return keys
}

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

/** This machine's own addresses and hostname, as nativeConfig.js localMachineHosts() sees them. */
function _machineAddresses() {
    const hosts = new Set()
    try {
        for (const entries of Object.values(os.networkInterfaces())) {
            for (const entry of entries || []) hosts.add(String(entry.address).toLowerCase())
        }
        hosts.add(os.hostname().toLowerCase())
    } catch {
        // Nothing to compare against.
    }
    return hosts
}

// 10/8, 172.16/12, 192.168/16 and link-local 169.254/16, as in
// planLanAddressMigration (src/native/setupServer.js).
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/
const PRIVATE_LAN_IPV4 = /^(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168|169\.254)\./

/**
 * True when WEBVIEW_CONFIG.LOCAL_IP is a private IPv4 address that
 * NODE_SERVER_HOSTNAME also holds: an older setup wrote this machine's LAN
 * address (maybe from another network) into both. The first debug build on
 * catalyst-core 1.2.0 puts localhost back, once per checkout, unless
 * allowPrivateHost is true.
 */
function isStaleLanAddress(config) {
    const wv = config?.WEBVIEW_CONFIG || {}
    if (wv.allowPrivateHost === true) return false
    const localIp = typeof wv.LOCAL_IP === "string" ? wv.LOCAL_IP.trim() : ""
    return (
        IPV4.test(localIp) &&
        PRIVATE_LAN_IPV4.test(localIp) &&
        typeof config.NODE_SERVER_HOSTNAME === "string" &&
        config.NODE_SERVER_HOSTNAME.trim() === localIp
    )
}

const STALE_LAN_ADDRESS_MESSAGE = (ip) =>
    `WEBVIEW_CONFIG.LOCAL_IP and NODE_SERVER_HOSTNAME are both "${ip}", a LAN address an older setup saved. If this machine's address has changed, the dev server cannot start on it and the app cannot reach it. The first debug build on catalyst-core 1.2.0 (npm run android or npm run ios) puts localhost back in both and prints the change, but only once per checkout (recorded in .catalyst/local.json). If this checkout already ran a 1.2.0 debug build (for example a canary), set WEBVIEW_CONFIG.LOCAL_IP and NODE_SERVER_HOSTNAME to "localhost" by hand (or to this machine's current IP for a phone on the same Wi-Fi).`

function handle_check_config({ project_path, platform = "both" } = {}) {
    const root = project_path || _projectInfo.dir
    const configPath = path.join(root, "config", "config.json")
    const catalystVersion =
        (_projectInfo && root === _projectInfo.dir && _projectInfo.installedVersion) ||
        installedCatalystVersion(root)
    // Unknown counts as current: the checks then describe the latest builds.
    const before120 = Boolean(catalystVersion) && versionOlderThan(catalystVersion, NATIVE_120)
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

    // The keys `catalyst start`, `build` and `serve` refuse to start without
    // (validateConfigFile in src/server/utils/validator.ts). NODE_SERVER_PORT
    // is checked above.
    for (const key of [
        "NODE_SERVER_HOSTNAME",
        "BUILD_OUTPUT_PATH",
        "PUBLIC_STATIC_ASSET_PATH",
        "PUBLIC_STATIC_ASSET_URL",
        "CLIENT_ENV_VARIABLES",
    ]) {
        if (config[key] === undefined) {
            issues.push({
                field: key,
                severity: "error",
                message: `${key} is required: catalyst start, build and serve exit before starting without it.`,
            })
        }
    }

    // API_URL is the app's own key: the template ships it empty and lists it
    // in CLIENT_ENV_VARIABLES, and nothing in catalyst-core requires it.
    if (config.API_URL !== undefined && config.API_URL !== null && typeof config.API_URL !== "string") {
        warnings.push({
            field: "API_URL",
            message: `API_URL is usually a string (your backend's base URL), got ${typeof config.API_URL}.`,
        })
    } else if (config.API_URL) {
        passed.push({ field: "API_URL", value: config.API_URL })
    }

    if (!config.WEBVIEW_CONFIG) {
        issues.push({
            field: "WEBVIEW_CONFIG",
            severity: "error",
            message: "WEBVIEW_CONFIG object is required. Missing this will prevent native builds.",
        })
        // The routing check does not depend on WEBVIEW_CONFIG: report its errors too, so one missing block does not hide the rest.
        _checkRouting(config, {}, platform, issues, warnings, passed)
        _checkReleaseFlags(config, {}, platform, warnings, passed)
        return _buildResult({ root, configPath, platform, config, issues, warnings, passed })
    } else {
        passed.push({ field: "WEBVIEW_CONFIG", note: "block present" })
    }

    const wc = config.WEBVIEW_CONFIG

    // ── App identity and production URL (catalyst-core 1.2.0+) ─────────────────
    // appName applies to both platforms and wins over the per-platform appName.
    // appId applies to both platforms, but a platform key wins over it
    // (android.packageName; ios.bundleIdentifier, then ios.appBundleId). url is
    // the origin a release build loads; debug builds ignore it.
    const PLACEHOLDER_APP_IDS = [
        "io.yourname.androidproject",
        "com.catalyst.framework.app",
        "com.debug.webview",
    ]
    const isPlaceholderId = (id) =>
        String(id).toLowerCase().startsWith("com.example.") ||
        PLACEHOLDER_APP_IDS.includes(String(id).toLowerCase())
    const legacyAppId = wc.android?.packageName || wc.ios?.bundleIdentifier || wc.ios?.appBundleId
    const appId = typeof wc.appId === "string" && wc.appId.trim() ? wc.appId.trim() : null
    if (appId) {
        if (isPlaceholderId(appId)) {
            warnings.push({
                field: "WEBVIEW_CONFIG.appId",
                message: `appId "${appId}" is a placeholder. Debug builds work; a release build in a terminal asks for your own id once and saves it, and without a terminal refuses it (NATIVE-003). Set your own reverse-DNS id, e.g. "com.yourcompany.app"; it cannot change after the first store upload.`,
            })
        } else {
            passed.push({ field: "WEBVIEW_CONFIG.appId", value: appId })
        }
    } else if (!legacyAppId) {
        warnings.push({
            field: "WEBVIEW_CONFIG.appId",
            message:
                'WEBVIEW_CONFIG.appId not set. It is the Android application id and the iOS bundle id (e.g. "com.yourcompany.app"); a release build in a terminal asks for it once and saves it, and without a terminal refuses to ship without one (NATIVE-003).',
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
        // The same rules as parseAppUrl in src/native/nativeConfig.js.
        let urlProblem = null
        if (!String(wc.url).trim()) {
            urlProblem = "is empty"
        } else if (!parsed) {
            urlProblem = "is not a URL (expected e.g. https://shop.acme.com)"
        } else if (!["http:", "https:"].includes(parsed.protocol)) {
            urlProblem = "must start with https:// or http://"
        } else if (parsed.username || parsed.password) {
            urlProblem = "must not contain a user name or password"
        } else if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
            urlProblem = "must be an origin only, without a path, query or fragment"
        } else if (!parsed.hostname) {
            urlProblem = "has no host"
        } else if (parsed.protocol === "https:" && parsed.port && parsed.port !== "443") {
            urlProblem = "uses HTTPS on a port other than 443"
        }
        if (urlProblem) {
            issues.push({
                field: "WEBVIEW_CONFIG.url",
                severity: "error",
                message: `WEBVIEW_CONFIG.url "${wc.url}" ${urlProblem}. Use an http(s) origin, e.g. "https://shop.acme.com". A release build fails with NATIVE-004.`,
            })
        } else if (
            /^(localhost|::1|0\.0\.0\.0)$|^(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01]))\.|\.local(host)?$/i.test(
                parsed.hostname.replace(/^\[|\]$/g, "")
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
    // With LOCAL_IP localhost, debug builds reach the dev server on their own
    // (adb reverse on Android, localhost on the simulator, <mac>.local on an
    // iPhone). A real host (public, or a private VPN/LAN staging server) is
    // loaded by debug builds instead. This machine's own address, saved by an
    // older setup, is put back to localhost by the first debug build (once
    // per checkout).
    const localIp = String(wc.LOCAL_IP || "")
        .trim()
        .toLowerCase()
    if (localIp && !["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(localIp)) {
        if (isStaleLanAddress(config)) {
            warnings.push({
                field: "WEBVIEW_CONFIG.LOCAL_IP",
                message: STALE_LAN_ADDRESS_MESSAGE(wc.LOCAL_IP),
            })
        } else if (_machineAddresses().has(localIp)) {
            warnings.push({
                field: "WEBVIEW_CONFIG.LOCAL_IP",
                message: `WEBVIEW_CONFIG.LOCAL_IP is "${wc.LOCAL_IP}", this machine's own address, so debug builds use the dev server. The first 1.2.0 debug build puts it back to "localhost", once per checkout; if this checkout already ran one (for example a canary), set it to "localhost" by hand. Put the production address in WEBVIEW_CONFIG.url.`,
            })
        } else {
            passed.push({
                field: "WEBVIEW_CONFIG.LOCAL_IP",
                value: wc.LOCAL_IP,
                note: 'debug builds load this host instead of the dev server; set it to "localhost" to develop against the dev server',
            })
        }
    } else {
        passed.push({ field: "WEBVIEW_CONFIG.LOCAL_IP", value: wc.LOCAL_IP || "localhost (default)" })
    }

    // ── WEBVIEW_CONFIG.appInfo (optional) ─────────────────────────────────────
    // A free-form string useDeviceInfo() reports. The iOS build writes "" when
    // it is missing (buildIos/config.js), so nothing breaks without it.
    if (wc.appInfo) {
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

    // ── accessControl (optional) ───────────────────────────────────────────────
    // Both shells default to accessControlEnabled = false, and the template
    // ships without the block, so its absence is a suggestion, not an error.
    // An empty allowlist only matters once it is enabled. iOS also accepts a
    // comma-separated string.
    const allowedUrlList = (value) =>
        Array.isArray(value)
            ? value
            : typeof value === "string"
              ? value
                    .split(",")
                    .map((u) => u.trim())
                    .filter(Boolean)
              : []
    if (!wc.accessControl) {
        warnings.push({
            field: "WEBVIEW_CONFIG.accessControl",
            message:
                'Optional: no accessControl block, so the WebView may load any URL. To keep navigation inside your domains, add { "enabled": true, "allowedUrls": [...] }. Debug builds add the dev server to allowedUrls themselves.',
        })
    } else {
        const allowedUrls = allowedUrlList(wc.accessControl.allowedUrls)
        if (!wc.accessControl.enabled) {
            warnings.push({
                field: "WEBVIEW_CONFIG.accessControl.enabled",
                message: "accessControl.enabled is not true, so allowedUrls is ignored and any URL may load.",
            })
        } else {
            passed.push({ field: "WEBVIEW_CONFIG.accessControl.enabled", value: true })
        }
        if (allowedUrls.length === 0 && wc.accessControl.enabled) {
            issues.push({
                field: "WEBVIEW_CONFIG.accessControl.allowedUrls",
                severity: "error",
                message:
                    "allowedUrls is empty. When accessControl is enabled and allowedUrls is empty, ALL URLs are blocked — including your own API calls. App will hang on every network request.",
            })
        } else if (allowedUrls.length) {
            const hasLocalhost = allowedUrls.some((u) => String(u).includes("localhost"))
            if (!hasLocalhost) {
                warnings.push({
                    field: "WEBVIEW_CONFIG.accessControl.allowedUrls",
                    message:
                        'No localhost entry in allowedUrls. If your app uses the localhost server transport (file downloads, progress tracking), add "http://localhost:*" to allowedUrls.',
                })
            }
            passed.push({
                field: "WEBVIEW_CONFIG.accessControl.allowedUrls",
                value: `${allowedUrls.length} entries${hasLocalhost ? " (localhost included)" : ""}`,
            })
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
        // packageName wins over appId for Android.
        if (a.packageName && isPlaceholderId(a.packageName)) {
            warnings.push({
                field: "WEBVIEW_CONFIG.android.packageName",
                message: `android.packageName "${a.packageName}" is a placeholder and wins over WEBVIEW_CONFIG.appId. Remove it to use appId, or set your own id; a release build refuses it (NATIVE-003).`,
            })
        } else if (a.packageName) {
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
        // bundleIdentifier, then appBundleId, wins over appId for iOS.
        const iosKey = ios.bundleIdentifier ? "bundleIdentifier" : ios.appBundleId ? "appBundleId" : null
        if (iosKey) {
            const iosId = String(ios[iosKey])
            if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,}$/i.test(iosId)) {
                // From 1.2.0 the build checks the id first and stops with NATIVE-010;
                // before, it reached Xcode unchecked.
                const finding = {
                    field: `WEBVIEW_CONFIG.ios.${iosKey}`,
                    message: before120
                        ? `${iosKey} "${iosId}" is not a valid iOS bundle id: use letters, digits, "-" and "." only, like "com.company.app". It wins over WEBVIEW_CONFIG.appId. From catalyst-core 1.2.0 every iOS build fails on it with NATIVE-010.`
                        : `${iosKey} "${iosId}" is not a valid iOS bundle id, so every iOS build fails with NATIVE-010 (catalyst-core 1.2.0+). Use letters, digits, "-" and "." only, like "${iosId.replace(/_/g, "")}". It wins over WEBVIEW_CONFIG.appId.`,
                }
                if (platform === "ios" && !before120) issues.push({ ...finding, severity: "error" })
                else warnings.push(finding)
            } else if (isPlaceholderId(iosId)) {
                warnings.push({
                    field: `WEBVIEW_CONFIG.ios.${iosKey}`,
                    message: `ios.${iosKey} "${iosId}" is a placeholder and wins over WEBVIEW_CONFIG.appId. Remove it to use appId, or set your own id; a release build refuses it (NATIVE-003).`,
                })
            } else {
                passed.push({ field: `WEBVIEW_CONFIG.ios.${iosKey}`, value: iosId })
            }
        } else if (appId && appId.includes("_")) {
            // Valid on Android, but an iOS bundle id allows only letters,
            // digits, "-" and ".". A breaking change in 1.2.0: every iOS build
            // now stops with NATIVE-010 instead of passing the id to Xcode.
            const finding = {
                field: "WEBVIEW_CONFIG.appId",
                message: `appId "${appId}" has an underscore, which an iOS bundle id cannot contain. Since catalyst-core 1.2.0 every iOS build fails on it with NATIVE-010 (1.1.x and earlier passed it to Xcode unchecked). Set WEBVIEW_CONFIG.ios.bundleIdentifier to an id without one (e.g. "${appId.replace(/_/g, "")}"); it wins over appId on iOS, and Android keeps appId.`,
            }
            if (platform === "ios") issues.push({ ...finding, severity: "error" })
            else warnings.push(finding)
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

    // ── App icon (public/icon.png, catalyst-core 1.2.0+) ──────────────────────
    // Each build prefers its sized icons (public/android/appIcons icon-<density>,
    // public/ios/appIcons), then public/icon.png, then a placeholder. Same
    // checks as src/native/appIcon.js: a PNG, square, at least 1024px
    // (ANDROID-010 / IOS-005); alpha fails an iOS release (IOS-006).
    {
        const platforms = platform === "both" ? ["android", "ios"] : [platform]
        const usesSingle = {
            android: !hasAndroidSizedIcons(root),
            ios: !hasIosSizedIcons(root),
        }
        const single = checkSingleAppIcon(root)
        const users = platforms.filter((p) => usesSingle[p])
        if (single && before120) {
            if (users.length)
                warnings.push({
                    field: "public/icon.png",
                    message: `public/icon.png is used as the app icon from catalyst-core 1.2.0; ${catalystVersion} ignores it, so ${users.join(" and ")} builds use ${users.length > 1 ? "their" : "its"} placeholder icon. Upgrade, or add sized icons in public/<platform>/appIcons.`,
                })
        } else if (single && users.length) {
            if (single.problem) {
                for (const p of users) {
                    issues.push({
                        field: "public/icon.png",
                        severity: "error",
                        message: `public/icon.png ${single.problem}, so ${p === "android" ? "Android" : "iOS"} builds fail with ${p === "android" ? "ANDROID-010" : "IOS-005"}. Replace it with a square PNG of at least 1024x1024 pixels, or add sized icons in public/${p}/appIcons.`,
                    })
                }
            } else if (single.info.hasAlpha && users.includes("ios")) {
                const finding = {
                    field: "public/icon.png",
                    message:
                        "public/icon.png has an alpha channel. Debug builds only warn, but an iOS release fails with IOS-006 because the App Store rejects icons with transparency. Flatten it onto a solid background.",
                }
                if (String((wc.ios || {}).buildType || "").toLowerCase() === "release")
                    issues.push({ ...finding, severity: "error" })
                else warnings.push(finding)
            } else {
                passed.push({
                    field: "public/icon.png",
                    note: `${single.info.width}x${single.info.height} PNG, the app icon for ${users.join(" and ")}`,
                })
            }
        } else if (!single && !before120 && users.length) {
            warnings.push({
                field: "public/icon.png",
                message: `No app icon for ${users.join(" and ")}, so the build uses the Catalyst placeholder. Add public/icon.png: a square PNG of at least 1024x1024 pixels with no transparency, used by both platforms.`,
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
        // AI_CONFIG.browser.download tunes the model download on a weak or lost connection. The runtime clamps bad
        // values silently, so a typo would just run on the defaults; catch it here.
        if (browser.download !== undefined) {
            const dl = browser.download
            if (!dl || typeof dl !== "object" || Array.isArray(dl)) {
                issues.push({
                    field: "AI_CONFIG.browser.download",
                    severity: "error",
                    message: "AI_CONFIG.browser.download must be an object: { minBytesPerSec, windowSec, resumeDelaySec, maxIdleRetries, heldRetrySec }.",
                })
            } else {
                const limits = {
                    minBytesPerSec: [0, 50_000_000],
                    windowSec: [5, 300],
                    resumeDelaySec: [1, 600],
                    maxIdleRetries: [1, 50],
                    heldRetrySec: [5, 600],
                }
                for (const key of Object.keys(dl)) {
                    if (!(key in limits)) {
                        warnings.push({
                            field: `AI_CONFIG.browser.download.${key}`,
                            message: `Unknown key "${key}", ignored. Use ${Object.keys(limits).join(", ")}.`,
                        })
                        continue
                    }
                    const [lo, hi] = limits[key]
                    if (typeof dl[key] !== "number" || !Number.isFinite(dl[key])) {
                        issues.push({
                            field: `AI_CONFIG.browser.download.${key}`,
                            severity: "error",
                            message: `${key} must be a number, got ${typeof dl[key]}. The default is used instead.`,
                        })
                    } else if (dl[key] < lo || dl[key] > hi) {
                        warnings.push({
                            field: `AI_CONFIG.browser.download.${key}`,
                            message: `${key}=${dl[key]} is outside ${lo}-${hi} and will be clamped.`,
                        })
                    }
                }
            }
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
    _checkPricing(config, root, issues, warnings, passed)
    _checkImageModels(config, issues, warnings, passed)
    _checkWebBridgeInit(root, warnings, passed)
    _checkReleaseFlags(config, wc, platform, warnings, passed)

    return _buildResult({ root, configPath, platform, config, issues, warnings, passed })
}

/**
 * The on/off switches added in catalyst-core 1.3.0 (CSP_NONCE_ENABLE, OFFLINE_SNAPSHOTS_ENABLE, WEBVIEW_CONFIG.location). Each is read
 * loosely by the framework, so a value of the wrong type does not fail: it quietly does the opposite of what was meant. That is
 * what this reports. `wc` is WEBVIEW_CONFIG ({} when it is missing).
 */
function _checkReleaseFlags(config, wc, platform, warnings, passed) {
    const show = (v) => JSON.stringify(v)

    if (config.CSP_NONCE_ENABLE !== undefined) {
        // The renderer compares with `=== true`.
        if (config.CSP_NONCE_ENABLE === true) passed.push({ field: "CSP_NONCE_ENABLE", note: "on: every script and modulepreload link gets a per-request nonce" })
        else if (config.CSP_NONCE_ENABLE !== false) {
            warnings.push({
                field: "CSP_NONCE_ENABLE",
                message: `CSP_NONCE_ENABLE is ${show(config.CSP_NONCE_ENABLE)}. Only the boolean true turns the CSP nonce on, so it stays OFF. Use true, without quotes.`,
            })
        }
    }

    if (config.OFFLINE_SNAPSHOTS_ENABLE !== undefined) {
        const v = config.OFFLINE_SNAPSHOTS_ENABLE
        // Only false (or the string "false") turns it off; everything else leaves Catalyst's service worker on.
        if (typeof v !== "boolean" && v !== "false" && v !== "true") {
            warnings.push({
                field: "OFFLINE_SNAPSHOTS_ENABLE",
                message: `OFFLINE_SNAPSHOTS_ENABLE is ${show(v)}. Only false turns Catalyst's service worker and offline manifest off; any other value leaves them ON.`,
            })
        }
    }

    if (wc.location !== undefined) {
        const loc = wc.location
        if (loc === null || typeof loc !== "object" || Array.isArray(loc)) {
            warnings.push({ field: "WEBVIEW_CONFIG.location", message: `WEBVIEW_CONFIG.location should be an object like { "enabled": true, "usageDescription": "..." }, got ${show(loc)}. It is ignored.` })
        } else {
            if (loc.enabled !== undefined && typeof loc.enabled !== "boolean") {
                // The build reads it by truthiness: any non-empty string, even "false", turns location ON.
                warnings.push({
                    field: "WEBVIEW_CONFIG.location.enabled",
                    message: `location.enabled is ${show(loc.enabled)}. The build reads it as true or false by truthiness, so ${typeof loc.enabled === "string" && loc.enabled ? "any non-empty string, even \"false\", turns location ON" : "this is not what you meant"}. Use true or false, without quotes.`,
                })
            }
            if (loc.usageDescription !== undefined && typeof loc.usageDescription !== "string") {
                warnings.push({ field: "WEBVIEW_CONFIG.location.usageDescription", message: `location.usageDescription should be a string (the iOS permission prompt text), got ${show(loc.usageDescription)}.` })
            }
            if (loc.enabled === true) {
                passed.push({ field: "WEBVIEW_CONFIG.location", note: "on: Android location permissions and the geolocation prompt, iOS NSLocationWhenInUseUsageDescription" })
                if (platform !== "android" && typeof loc.usageDescription !== "string") {
                    warnings.push({
                        field: "WEBVIEW_CONFIG.location.usageDescription",
                        message: "location.enabled is true but usageDescription is not set: the iOS prompt will use the generic default text. Set a specific reason for the user.",
                    })
                }
            }
        }
    }
}

// Native hooks silently run with isNative=false in the WebView when WebBridge.init() is missing from the client entry.
function _checkWebBridgeInit(root, warnings, passed) {
    const r = inspectWebBridgeInit(root)
    // The detector accepts client/index.{js,jsx,ts,tsx} and returns the one it used, so name that one.
    const field = `${r.entry ?? "client entry (client/index.js, .jsx, .ts or .tsx)"}: WebBridge.init()`
    const used = `${r.hookFiles.length} file(s) import native hooks from catalyst-core/hooks (e.g. ${r.hookFiles[0]})`
    if (r.state === "ok") passed.push({ field, note: `present in ${r.entry}, inside hydrationReady` })
    else if (r.state === "no-entry") warnings.push({ field, message: `${used} but no client entry was found (looked for client/index.js, client/index.jsx, client/index.ts and client/index.tsx), so WebBridge.init() cannot run. Native hooks will report isNative=false.` })
    else if (r.state === "missing-init") warnings.push({ field, message: `${used}, but ${r.entry} never calls WebBridge.init(). Native hooks silently run with isNative=false in the Android/iOS WebView. Add it inside hydrationReady().then(...) just before hydrateRoot:\n${WEBBRIDGE_INIT_SNIPPET}` })
    else if (r.state === "missing-import") warnings.push({ field, message: `${r.entry} calls WebBridge.init() but does not import WebBridge. Add: import WebBridge from "catalyst-core/WebBridge"` })
    else if (r.state === "misplaced") warnings.push({ field, message: `${r.entry} calls WebBridge.init() before hydrationReady(). At module scope it can throw "Cannot read properties of null (reading 'useContext')" during hydration. Move it inside hydrationReady().then(...) just before hydrateRoot:\n${WEBBRIDGE_INIT_SNIPPET}` })
}

const ROUTING_OBJECTIVES = ["balanced", "cost", "latency", "speed", "order"]
const ROUTING_POLICIES = ["allow", "ask", "deny"]
const ROUTING_TASKS = ["text.generate", "vision.read", "speech.transcribe", "speech.synthesize", "image.generate", "embed"]
// One list for the check and its message: what an on-device native entry may name as its engine.
const NATIVE_ROUTING_ENGINES = ["auto", "litert", "foundation-models", "platform-speech"]
const ROUTING_PLATFORMS = ["ios", "android", "web-desktop", "web-mobile", "web"]
const ROUTING_MODALITIES = ["text", "image", "audio"]

// AI_CONFIG.pricing holds the developer's own per-model prices (USD per 1M tokens); `npx catalyst-ai pricing` writes it.
// A cloud model with no price anywhere is costed as free, which skews cost-weighted routing and the cost metrics.
function _checkPricing(config, root, issues, warnings, passed) {
    const ai = config.AI_CONFIG
    if (!ai || typeof ai !== "object") return
    const err = (field, message) => issues.push({ field, severity: "error", message })
    const configured = ai.pricing
    if (configured !== undefined && (!configured || typeof configured !== "object" || Array.isArray(configured))) {
        return err("AI_CONFIG.pricing", "AI_CONFIG.pricing must be an object keyed by model id: { \"<model>\": { \"input\": 2, \"output\": 10 } } (USD per 1M tokens).")
    }
    const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0
    const before = issues.length
    for (const [model, p] of Object.entries(configured || {})) {
        const at = `AI_CONFIG.pricing.${model}`
        if (!p || typeof p !== "object" || Array.isArray(p)) { err(at, "needs { input, output } in USD per 1M tokens, or { perImage } in USD per image."); continue }
        if (p.perImage !== undefined && !isNum(p.perImage)) err(`${at}.perImage`, "perImage must be a non-negative number (USD per generated image).")
        // A model priced per image alone may leave the token rates out.
        const perImageOnly = p.perImage !== undefined && p.input === undefined && p.output === undefined && p.cachedInput === undefined
        if (!perImageOnly) for (const key of ["input", "output"]) if (!isNum(p[key])) err(`${at}.${key}`, `${key} must be a non-negative number (USD per 1M tokens).`)
        if (p.cachedInput !== undefined && !isNum(p.cachedInput)) err(`${at}.cachedInput`, "cachedInput must be a non-negative number.")
        if (p.audioInput !== undefined && p.audioInput !== null && !isNum(p.audioInput)) err(`${at}.audioInput`, "audioInput must be a number or null.")
    }

    // Built-in prices come from the installed catalyst-ai; without it there is no way to say which models are covered.
    const builtIn = readBuiltInPriceKeys(root)
    if (builtIn) {
        const models = new Set()
        for (const cfg of Object.values(ai.providers || {})) if (cfg && typeof cfg.defaultModel === "string") models.add(cfg.defaultModel)
        for (const c of (ai.routing && Array.isArray(ai.routing.cloud) ? ai.routing.cloud : [])) if (c && typeof c.model === "string") models.add(c.model)
        for (const model of [...models].sort()) {
            if (configured && Object.prototype.hasOwnProperty.call(configured, model)) continue
            if (builtIn.includes(model)) continue
            warnings.push({
                field: `AI_CONFIG.pricing.${model}`,
                message: `No price known for "${model}": cost metrics show $0 and cost-based routing treats it as free. Run \`npx catalyst-ai pricing\` to set it.`,
            })
        }
    }
    if (issues.length === before && configured && Object.keys(configured).length) {
        passed.push({ field: "AI_CONFIG.pricing", note: `${Object.keys(configured).length} model price(s) set` })
    }
}

// Providers whose /ai/:provider/image route can draw (see catalyst-ai imageGen.js). Anthropic has no image generation.
const IMAGE_PROVIDERS = ["openai", "gemini"]

// providers.<name>.imageModel is the model POST /ai/:provider/image uses when the request names none.
function _checkImageModels(config, issues, warnings, passed) {
    const providers = config.AI_CONFIG && config.AI_CONFIG.providers
    if (!providers || typeof providers !== "object" || Array.isArray(providers)) return
    const configured = config.AI_CONFIG.pricing && typeof config.AI_CONFIG.pricing === "object" ? config.AI_CONFIG.pricing : {}
    const before = issues.length + warnings.length
    let count = 0
    for (const [name, cfg] of Object.entries(providers)) {
        if (!cfg || typeof cfg !== "object" || cfg.imageModel === undefined) continue
        const at = `AI_CONFIG.providers.${name}.imageModel`
        if (typeof cfg.imageModel !== "string" || !/^[a-zA-Z0-9._:-]+$/.test(cfg.imageModel)) {
            issues.push({ field: at, severity: "error", message: "imageModel must be a model id string of letters, digits and . _ : - (for example \"gpt-image-1\")." })
            continue
        }
        count++
        if (!IMAGE_PROVIDERS.includes(name)) {
            warnings.push({ field: at, message: `Provider "${name}" cannot generate images (supported: ${IMAGE_PROVIDERS.join(", ")}), so this imageModel is never used and POST /ai/${name}/image fails.` })
            continue
        }
        // There are no built-in image prices: without a developer-set one the image cost is reported as unknown.
        if (!Object.prototype.hasOwnProperty.call(configured, cfg.imageModel)) {
            warnings.push({ field: `AI_CONFIG.pricing.${cfg.imageModel}`, message: `No price set for image model "${cfg.imageModel}": image cost is reported as unknown. Add AI_CONFIG.pricing["${cfg.imageModel}"] = { "perImage": <USD per image> } (and/or input/output per 1M tokens).` })
        }
    }
    if (count && issues.length + warnings.length === before) passed.push({ field: "AI_CONFIG.providers.*.imageModel", note: `${count} image model(s), valid` })
}

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
    if (routing.platformSpeech !== undefined && typeof routing.platformSpeech !== "boolean") {
        err("AI_CONFIG.routing.platformSpeech", "platformSpeech must be true or false. Set it to false to stop useTranscribe().listen() using the phone's own speech recogniser.")
    }
    // A block that is present must be an object. The runtime treats anything else as absent, so the config would say one thing and
    // the app do another.
    const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
    const nested = (value, field, what) => {
        if (value === undefined) return {}
        if (!isRecord(value)) {
            err(field, `${field} must be an object${what ? ` ${what}` : ""}.`)
            return {}
        }
        return value
    }
    const policy = nested(routing.policy, "AI_CONFIG.routing.policy", "with objective, order, cloud, cloudMedia, weights and constraints")
    if (policy.objective !== undefined && !ROUTING_OBJECTIVES.includes(policy.objective)) {
        err("AI_CONFIG.routing.policy.objective", `Unknown objective "${policy.objective}". Use ${ROUTING_OBJECTIVES.join(", ")}.`)
    }
    for (const key of ["cloud", "cloudMedia"]) {
        if (policy[key] !== undefined && !ROUTING_POLICIES.includes(policy[key])) {
            err(`AI_CONFIG.routing.policy.${key}`, `"${policy[key]}" is not valid. Use allow, ask or deny.`)
        }
    }
    // Media leaves silently only when BOTH effective policies allow it: cloudMedia defaults to deny, and cloudMedia "allow" cannot
    // override a stricter cloud policy (ask or deny).
    if (policy.cloud === "allow" && policy.cloudMedia === "allow") {
        warn("AI_CONFIG.routing.policy", "Cloud is allowed for image/audio: photos and voice can leave the device without asking. Keep cloudMedia at ask or deny for sensitive apps.")
    }
    const isCount = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0
    const constraints = nested(policy.constraints, "AI_CONFIG.routing.policy.constraints", "with maxLatencyMs, minTps and maxCostUsd")
    for (const key of ["maxLatencyMs", "minTps", "maxCostUsd"]) {
        const v = constraints[key]
        if (v !== undefined && !isCount(v)) err(`AI_CONFIG.routing.policy.constraints.${key}`, `${key} must be a non-negative number.`)
    }
    // The router drops a weight that is not a non-negative number and quietly ranks with the default, so say so here.
    const weights = nested(policy.weights, "AI_CONFIG.routing.policy.weights", "with cost, latency and tps")
    for (const key of ["cost", "latency", "tps"]) {
        if (weights[key] !== undefined && !isCount(weights[key])) err(`AI_CONFIG.routing.policy.weights.${key}`, `${key} must be a non-negative number.`)
    }

    const candidates = []
    const outerWarn = warn
    // `quiet` is for the list of a platform this check is not about (the Android list while checking iOS): its structure is still checked
    // (errors), but warnings that describe how it would behave on a device the target is not are left out.
    const collect = (list, group, where, platformKey, quiet = false) => {
        const warn = quiet ? () => {} : outerWarn
        if (list === undefined) return
        if (!Array.isArray(list)) return err(where, `${where} must be an array of models.`)
        list.forEach((m, i) => {
            const at = `${where}[${i}]`
            if (!m || typeof m !== "object" || typeof m.id !== "string" || !m.id) return err(at, `Each model needs a string "id".`)
            if (m.modalities !== undefined && (!Array.isArray(m.modalities) || m.modalities.length === 0 || m.modalities.some((x) => !ROUTING_MODALITIES.includes(x)))) {
                err(`${at}.modalities`, `modalities must be a non-empty subset of ${ROUTING_MODALITIES.join(", ")}. A model with none is dropped and never used.`)
            }
            if (m.tasks !== undefined) {
                if (!Array.isArray(m.tasks) || !m.tasks.length || m.tasks.some((x) => !ROUTING_TASKS.includes(x))) {
                    err(`${at}.tasks`, `tasks must be a non-empty subset of ${ROUTING_TASKS.join(", ")}. Leave it out to follow the modalities.`)
                }
            }
            for (const key of ["ttftMs", "tps", "loadMs"]) {
                if (m[key] !== undefined && !(typeof m[key] === "number" && m[key] >= 0)) err(`${at}.${key}`, `${key} must be a non-negative number.`)
            }
            if (group === "cloud") {
                const providers = (config.AI_CONFIG && config.AI_CONFIG.providers) || {}
                if (m.price !== undefined) {
                    // A price the router cannot read is dropped, which leaves this model's cost unknown to routing.
                    if (!isRecord(m.price) || !isCount(m.price.input) || !isCount(m.price.output)) {
                        err(`${at}.price`, "price must be { input, output }, both non-negative numbers (USD per 1M tokens).")
                    }
                }
                if (typeof m.provider !== "string") err(`${at}.provider`, `Cloud models need a "provider".`)
                else if (!isRecord(providers) || !Object.prototype.hasOwnProperty.call(providers, m.provider) || !providers[m.provider]) err(`${at}.provider`, `Provider "${m.provider}" is not in AI_CONFIG.providers, so this model can never be used.`)
            } else if (platformKey && platformKey.startsWith("web")) {
                // In a browser: Transformers.js (default) or Chrome's built-in model.
                if (m.engine === "platform-speech") {
                    warn(`${at}.engine`, "platform-speech is the phone's own speech recogniser and only exists in the iOS and Android apps; this browser entry is dropped and will never run.")
                } else if (m.engine !== undefined && !["transformers", "prompt-api"].includes(m.engine)) {
                    err(`${at}.engine`, `Unknown web engine "${m.engine}". Use prompt-api (Chrome's built-in model) or transformers.`)
                } else if (m.engine === "prompt-api" && platformKey === "web-mobile") {
                    warn(`${at}.engine`, "prompt-api is desktop-only; this web-mobile entry is dropped and will never run.")
                }
                // No modality warning for prompt-api: the engine builds image and audio inputs for Chrome's model (expectedInputs), so
                // declaring them is valid. Whether the user's Chrome supports them is answered at run time by the availability check.
            } else if (m.engine !== undefined && !NATIVE_ROUTING_ENGINES.includes(m.engine)) {
                err(`${at}.engine`, `Unknown engine "${m.engine}". Use ${NATIVE_ROUTING_ENGINES.join(", ")} (platform-speech is the phone's own speech recogniser).`)
            } else if (m.engine === "foundation-models" && platformKey === "android") {
                warn(`${at}.engine`, "foundation-models is iOS-only; this Android entry will never run.")
            } else if (m.engine === "platform-speech") {
                // It listens to the live microphone and only transcribes: whatever the entry lists is replaced.
                const onlyAudio = !Array.isArray(m.modalities) || (m.modalities.length === 1 && m.modalities[0] === "audio")
                const onlyTranscribe = !Array.isArray(m.tasks) || (m.tasks.length === 1 && m.tasks[0] === "speech.transcribe")
                if (!onlyAudio || !onlyTranscribe) {
                    warn(`${at}`, "platform-speech always means audio in and speech.transcribe only; the modalities and tasks listed here are ignored. It is only used by useTranscribe().listen(), never by generate().")
                }
            }
            candidates.push({ id: m.id, group, where: at })
        })
    }
    const onDevice = nested(routing.onDevice, "AI_CONFIG.routing.onDevice", "keyed by platform (ios, android, web, web-desktop, web-mobile)")
    for (const key of Object.keys(onDevice)) {
        if (!ROUTING_PLATFORMS.includes(key)) warn(`AI_CONFIG.routing.onDevice.${key}`, `Unknown platform "${key}". Use ${ROUTING_PLATFORMS.join(", ")}.`)
        else collect(onDevice[key], "onDevice", `AI_CONFIG.routing.onDevice.${key}`, key, (platform === "ios" && key === "android") || (platform === "android" && key === "ios"))
    }
    collect(routing.cloud, "cloud", "AI_CONFIG.routing.cloud", "cloud")

    // The router reads ONE on-device list for a platform (the first of its own list, then the shared "web" one) and merges it with the
    // cloud list, keeping the first of each id. So an id may repeat across on-device lists (ios, android, web: they are alternatives),
    // but not between an on-device list and the cloud list, nor twice in one list.
    const listOf = (c) => c.where.replace(/\[\d+\]$/, "")
    const meet = (a, b) => listOf(a) === listOf(b) || a.group !== b.group
    const firstOf = new Map()
    for (const c of candidates) {
        const prior = (firstOf.get(c.id) || []).find((p) => meet(p, c))
        if (prior) {
            err(c.where, listOf(prior) === listOf(c)
                ? `Duplicate id "${c.id}" in the same list. Only the first is used.`
                : `Duplicate id "${c.id}": it is also in ${listOf(prior)}, and the router merges those lists and keeps only the first. Give it a different id.`)
        }
        firstOf.set(c.id, [...(firstOf.get(c.id) || []), c])
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
    // Plugin composition turns native AI on only for exactly true, so "true" or 1 here is NOT enabled.
    if (candidates.some((c) => c.group === "onDevice") && !(wc.ai && wc.ai.enabled === true)) {
        warn("WEBVIEW_CONFIG.ai.enabled", "routing lists on-device models but WEBVIEW_CONFIG.ai.enabled is not true: the native AI module is not built into the app, so the app has no on-device model at all (in-browser models are only used in a plain browser, never inside the app) and only cloud models can run there.")
    }
    // A native app (WebView build) only ever uses onDevice.ios / onDevice.android; onDevice.web is for plain browsers.
    const hasNativeModels = candidates.some((c) => c.group === "onDevice" && /\.(ios|android)\[/.test(c.where))
    const hasWebModels = candidates.some((c) => c.group === "onDevice" && /\.web(-desktop|-mobile)?\[/.test(c.where))
    if (wc.ai && wc.ai.enabled === true && hasWebModels && !hasNativeModels) {
        warn(
            "AI_CONFIG.routing.onDevice",
            "routing lists only in-browser (web) models, but this is a native app build: inside the app the native module owns the on-device model and web models are never used. Add onDevice.ios and/or onDevice.android entries, or the app can only route to the cloud."
        )
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

module.exports = { init, handle_check_config, isStaleLanAddress, STALE_LAN_ADDRESS_MESSAGE, priceKeysFromSource, readBuiltInPriceKeys }
