"use strict"

const {
    makeProjectHelpers,
    findCatalystRoot,
    catalystGeneration,
    VITE_RUNTIME_VERSION,
} = require("../lib/helpers")

let _db

function init(db) {
    _db = db
}

// ─── Master flows ────────────────────────────────────────────────────────────
// These are fixed — they describe how the framework works.
// Dynamic sections are filled in at call time from the project's config.

const MASTER_FLOWS = {
    web_dev: [
        {
            step: 1,
            cmd: "catalyst start",
            label: "Start dev server",
            detail: "Starts the Vite middleware-mode development server and Catalyst SSR server on NODE_SERVER_PORT. Hot reload and React Fast Refresh are enabled.",
        },
        {
            step: 2,
            cmd: null,
            label: "Browser / WebView loads",
            detail: "Web: browser hits localhost. Universal: WebView loads http://<LOCAL_IP>:<port>. IP auto-detected by catalyst at startup.",
        },
    ],

    web_build: [
        {
            step: 1,
            cmd: "catalyst build",
            label: "Production build",
            detail: "Runs parallel Vite client and SSR builds. Outputs client assets to build/client, the renderer to build/server, Vite manifests under build/.vite, and offline runtime files at the build root.",
        },
        {
            step: 2,
            cmd: "catalyst serve",
            label: "Serve built app (local)",
            detail: "Serves from build/ — same as production but local. Use for smoke-testing the build before deploy.",
        },
    ],

    web_prod: [
        {
            step: 1,
            cmd: "catalyst build",
            label: "Build",
            detail: "Production Vite client and SSR build. Set BUILD_ENV=production in env or config.",
        },
        {
            step: 2,
            cmd: "NODE_ENV=production BUILD_ENV=production pm2-runtime ./ecosystem.config.js --wait-ready --listen-timeout 15000",
            label: "Serve via PM2 (production)",
            detail: "ecosystem.config.js controls process name, memory limit, restart policy. --wait-ready waits for app to signal ready before PM2 marks it live.",
        },
        {
            step: 3,
            cmd: null,
            label: "PM2 process config",
            detail: "Key fields in ecosystem.config.js: name, autorestart, max_memory_restart (default 1000M), kill_timeout (3000ms). Logs routed to stdout/stderr for container compatibility.",
        },
    ],

    web_staging: [
        {
            step: 1,
            cmd: "catalyst build",
            label: "Build",
            detail: "Same Vite build — staging is config-only, not a different build target.",
        },
        {
            step: 2,
            cmd: "NODE_ENV=production BUILD_ENV=staging pm2-runtime ./ecosystem.config.js --wait-ready",
            label: "Serve via PM2 (staging)",
            detail: "BUILD_ENV=staging changes API URLs and feature flags. NODE_ENV=production keeps Node in production mode for performance.",
        },
    ],

    android_debug: [
        {
            step: 1,
            cmd: null,
            label: "Pre-check: config",
            detail: 'Reads config/config.json → WEBVIEW_CONFIG.android. Requires: sdkPath, emulatorName, buildType="debug" (or "Debug").',
        },
        {
            step: 2,
            cmd: "catalyst build",
            label: "Build web assets",
            detail: "Compiles web app to build/. Android build embeds these as the WebView content.",
        },
        {
            step: 3,
            cmd: "npm run buildApp:android",
            label: "Android debug build",
            detail: "Runs buildAppAndroid.js: validates ADB + emulator path from sdkPath, launches emulator (emulatorName), copies web assets to androidProject/, runs Gradle debug build, installs APK.",
        },
        {
            step: 4,
            cmd: null,
            label: "WebView startup",
            detail: "App launches → WebView loads http://<LOCAL_IP>:<port> → bridge initialises → hooks available.",
        },
    ],

    android_release: [
        {
            step: 1,
            cmd: null,
            label: "Pre-check: config",
            detail: 'Requires WEBVIEW_CONFIG.android.buildType="release". keystoreConfig must be present with real passwords (not placeholder values).',
        },
        {
            step: 2,
            cmd: null,
            label: "Pre-check: keystore fields",
            detail: "Required keystoreConfig fields: keyAlias, storePassword, keyPassword, organizationInfo (companyName, city, state, countryCode).",
        },
        {
            step: 3,
            cmd: "catalyst build",
            label: "Build web assets",
            detail: "Production web build. Assets are consumed by the Android release build.",
        },
        {
            step: 4,
            cmd: "npm run buildApp:android",
            label: "Android release build",
            detail: "Skips emulator validation. Runs Gradle release build. Calls buildAndroidAAB() — renames project, creates/verifies keystore, signs AAB. Output goes to ./deployment/.",
        },
        {
            step: 5,
            cmd: null,
            label: "AAB output",
            detail: "Signed .aab in ./deployment/. Upload to Play Console. Not directly installable — use bundletool to test on device.",
        },
    ],

    ios_debug: [
        {
            step: 1,
            cmd: null,
            label: "Pre-check: config",
            detail: 'Reads WEBVIEW_CONFIG.ios. Requires: appBundleId, simulatorName, buildType (default "debug").',
        },
        {
            step: 2,
            cmd: "catalyst build",
            label: "Build web assets",
            detail: "Compiles web app. iOS build embeds these.",
        },
        {
            step: 3,
            cmd: "npm run buildApp:ios",
            label: "iOS simulator build",
            detail: "Runs buildAppIos.js: generates ConfigConstants.swift from config (bundleId, URL, port, protocol), launches simulator (simulatorName), cleans Xcode artifacts, compiles with xcodebuild, installs .app, launches.",
        },
        {
            step: 4,
            cmd: null,
            label: "GoogleSignIn (if set)",
            detail: "If WEBVIEW_CONFIG.googleSignIn.enabled: injects clientId + iosClientId into Info.plist and Info-Release.plist. GoogleService-Info.plist must exist in project.",
        },
    ],

    ios_release: [
        {
            step: 1,
            cmd: null,
            label: "Pre-check: config",
            detail: 'buildType must be "Release" (capital R — case-sensitive). appBundleId required. If googleSignIn enabled, GoogleService-Info.plist must be present.',
        },
        { step: 2, cmd: "catalyst build", label: "Build web assets", detail: "Production build." },
        {
            step: 3,
            cmd: "npm run buildApp:ios",
            label: "iOS release build",
            detail: "Same script — build type is driven by WEBVIEW_CONFIG.ios.buildType. Generates ConfigConstants.swift with production URL and bundleId. Xcode compiles Release scheme.",
        },
        {
            step: 4,
            cmd: null,
            label: "Archive + export IPA",
            detail: "Post-build: archive via Xcode Organizer or xcodebuild -exportArchive. Requires Apple distribution certificate + provisioning profile configured in Xcode.",
        },
        {
            step: 5,
            cmd: null,
            label: "App Store submission",
            detail: "Upload IPA via Transporter or Xcode Organizer. TestFlight for beta before release.",
        },
    ],
}

const LEGACY_WEB_FLOWS = {
    web_dev: [
        {
            step: 1,
            cmd: "catalyst start",
            label: "Start legacy dev server",
            detail: "Starts the Catalyst 0.2.x webpack development and SSR servers with hot reload.",
        },
        {
            step: 2,
            cmd: null,
            label: "Browser / WebView loads",
            detail: "The browser or native WebView loads the configured development origin.",
        },
    ],
    web_build: [
        {
            step: 1,
            cmd: "catalyst build",
            label: "Legacy production build",
            detail: "Runs the Catalyst 0.2.x webpack build, including loadable metadata and SSR output.",
        },
        {
            step: 2,
            cmd: "catalyst serve",
            label: "Serve legacy build",
            detail: "Serves the webpack-era production output for smoke testing.",
        },
    ],
    web_prod: null,
    web_staging: null,
}
LEGACY_WEB_FLOWS.web_prod = MASTER_FLOWS.web_prod.map((step) => ({
    ...step,
    detail: step.detail.replace("Vite client and SSR", "legacy webpack"),
}))
LEGACY_WEB_FLOWS.web_staging = MASTER_FLOWS.web_staging.map((step) => ({
    ...step,
    detail: step.detail.replace("Vite", "legacy webpack"),
}))

// ─── Architecture diagrams ───────────────────────────────────────────────────

const MASTER_DIAGRAMS = {
    universal_app: {
        title: "Universal App Architecture",
        description: "How a Catalyst web app runs inside a native WebView container.",
        layers: [
            {
                layer: "web",
                label: "React App (Web Layer)",
                detail: "Standard React/SSR app. Runs identically on browser and inside WebView. No React Native code.",
            },
            {
                layer: "server",
                label: "Node SSR Server",
                detail: "Express server runs inside the native app process (via Node-on-Mobile or localhost tunnel). Serves HTML, handles API proxying.",
            },
            {
                layer: "bridge",
                label: "WebBridge (JS ↔ Native)",
                detail: "window.WebBridge injected by native shell. Hooks call WebBridge.postMessage(). Native shell receives, executes platform API, calls back via WebBridge.onMessage().",
            },
            {
                layer: "native",
                label: "Native Shell (Android / iOS)",
                detail: "Android: WebViewActivity + JavascriptInterface. iOS: WKWebView + WKScriptMessageHandler. Handles camera, haptics, file picker, notifications, security checks.",
            },
        ],
        flow: [
            "User action in React component",
            "→ Catalyst hook called (e.g. useCamera, useHapticFeedback)",
            "→ hook checks isNative flag (set by WebBridge at init)",
            "→ [native path] WebBridge.postMessage({ command, payload })",
            "→ Native shell receives, executes platform API",
            "→ Native calls back → hook resolves with { data, isNative: true }",
            "→ [web path] hook falls back to browser API (navigator.vibrate, <input type=file>, etc.)",
        ],
        configurable_today: [
            "port — WebView loads this port from the local server",
            "useHttps — switches WebView URL to https (requires cert setup)",
            "LOCAL_IP — override auto-detected IP for device builds",
            "accessControl.allowedUrls — whitelist for outbound requests from WebView",
            "googleSignIn.enabled / clientId / iosClientId",
            "splashScreen — duration, backgroundColor, logo asset",
            "notifications.enabled — push notification permission prompt",
            "android.buildOptimisation — enables build caching",
            "android.keystoreConfig — signing for release builds",
            "ios.appBundleId — bundle identifier for App Store",
        ],
    },

    request_lifecycle: {
        title: "Request Lifecycle (Tri-Transport)",
        description: "How a data fetch travels from a React component to the API and back.",
        layers: [
            {
                layer: "component",
                label: "React Component",
                detail: "Calls useDataFetching (or fetch/axios). No transport awareness needed.",
            },
            {
                layer: "hook",
                label: "useDataFetching hook",
                detail: "Determines transport based on runtime context: isNative + server reachability.",
            },
            {
                layer: "transport",
                label: "Transport Selection",
                detail: "3 options: (1) Localhost Server — Node server running in-process, fastest. (2) Native Bridge — postMessage to native, native makes HTTP call. (3) Cloudflare proxy — fallback for external domains not in whitelist.",
            },
            {
                layer: "api",
                label: "API / Backend",
                detail: "Response flows back through same transport. Hook normalises response shape regardless of transport used.",
            },
        ],
        flow: [
            "Component calls useDataFetching({ url, method, body })",
            "→ hook checks: is window.WebBridge available? (isNative)",
            "→ [native] checks if url is in WEBVIEW_CONFIG.accessControl.allowedUrls",
            "→   [allowed] sends via localhost Node server (fastest, avoids CORS)",
            "→   [not allowed] routes via native bridge postMessage → native HTTP client",
            "→ [web] standard fetch — browser handles CORS normally",
            "→ response normalised → component receives { data, loading, error }",
        ],
        known_pitfalls: [
            "Localhost server transport requires allowedUrls to include localhost entry",
            "Intent (bridge message) size limit: check KB for limit — large payloads silently fail",
            "Cloudflare routing adds latency — prefer localhost server for internal APIs",
        ],
    },

    build_pipeline: {
        title: "Build Pipeline (Framework Internals)",
        description: "What happens inside catalyst build and how the native build consumes it.",
        layers: [
            {
                layer: "web",
                label: "Vite (catalyst build)",
                detail: "Runs client and SSR builds in parallel. Produces build/client, build/server, Vite manifests, categorized assets, and root offline runtime files.",
            },
            {
                layer: "prepare",
                label: "catalyst-core prepare",
                detail: "Copies the ESM web runtime into dist and Babel-compiles native/CommonJS compatibility outputs. Package metadata, bin, and dist form one package contract.",
            },
            {
                layer: "copy",
                label: "Dev copy workflow",
                detail: "After prepare, copy dist, bin, and package.json together. Copying only dist creates a mixed package with incompatible exports and CLI code.",
            },
            {
                layer: "native",
                label: "Native build consumes dist/",
                detail: 'buildAppAndroid.js and buildAppIos.js resolve catalyst-core via require.resolve("catalyst-core/package.json"). Load androidProject and iosnativeWebView from dist/native/.',
            },
        ],
        flow: [
            "[Framework dev] Edit catalyst-core/src/",
            "→ npm run prepare (in catalyst-core)",
            "→ dist/ updated",
            "→ Replace test-app node_modules/catalyst-core dist + bin + package.json together",
            "",
            "[App build] In app project root:",
            "→ catalyst build (Vite client + SSR output)",
            "→ npm run buildApp:android / buildApp:ios",
            "→ native build script reads WEBVIEW_CONFIG from config/config.json",
            "→ copies build/ assets into native project",
            "→ compiles native project (Gradle / xcodebuild)",
            "→ installs on emulator/simulator or produces APK/AAB/IPA",
        ],
    },

    bridge_architecture: {
        title: "Native Bridge Architecture",
        description: "How JS hooks communicate with native platform APIs through the bridge.",
        layers: [
            {
                layer: "js",
                label: "JS Hook Layer",
                detail: "useCamera, useFilePicker, useHapticFeedback, useNetworkStatus, useSafeArea, useDeviceInfo, useNotification, useDataProtection, useLocation, useStorage. All check isNative at runtime.",
            },
            {
                layer: "bridge",
                label: "WebBridge Interface",
                detail: "Android: JavascriptInterface (@JavascriptInterface annotated methods). iOS: WKScriptMessageHandler. Both expose postMessage(jsonString) and trigger JS callback via evaluateJavascript.",
            },
            {
                layer: "android",
                label: "Android Bridge",
                detail: "WebViewActivity hosts WebView. Bridge file: src/native/androidProject/app/src/main/java/.../WebAppInterface.java. 11 native commands + 14 callback events implemented.",
            },
            {
                layer: "ios",
                label: "iOS Bridge",
                detail: "WKWebView with WKUserContentController. Bridge file: src/native/iosnativeWebView/. ConfigConstants.swift generated at build time from WEBVIEW_CONFIG (bundleId, URL, port).",
            },
        ],
        flow: [
            "JS: hook.execute() called",
            "→ hook serialises command + payload to JSON",
            "→ window.WebBridge.postMessage(JSON.stringify({ command, requestId, payload }))",
            "→ Native receives in JavascriptInterface (Android) / messageHandler (iOS)",
            "→ Native dispatches to command handler (camera, filepicker, haptic, etc.)",
            "→ Native executes platform API",
            '→ Native calls back: webView.evaluateJavascript("WebBridgeCallback(requestId, result)")',
            "→ JS resolves hook promise → { data, isNative: true, isWeb: false }",
        ],
    },

    routing: {
        title: "Routing Architecture",
        description: "How routes are defined, loaded, and rendered in a Catalyst app.",
        layers: [
            {
                layer: "definition",
                label: "routes.js / routes.jsx",
                detail: "Central route definitions. Each route: { path, component, exact, data (for RouterDataProvider), preload }.",
            },
            {
                layer: "provider",
                label: "RouterDataProvider",
                detail: "Wraps app. Fetches route-level data server-side (SSR) or client-side on navigation. Passes data as props to route component.",
            },
            {
                layer: "shell",
                label: "App Shell",
                detail: "Persistent layout wrapper. Renders header/footer/nav outside route transitions. Route component renders inside shell outlet.",
            },
            {
                layer: "ssr",
                label: "SSR + Hydration",
                detail: "Server renders full HTML from routes. Client hydrates. RouterDataProvider re-fetches data on client transitions after hydration.",
            },
        ],
        flow: [
            "Request arrives at Node server",
            "→ Router matches path to route definition",
            "→ RouterDataProvider fetches route.data() server-side",
            "→ App Shell rendered with matched route component + fetched data",
            "→ HTML streamed to client",
            "→ Client hydrates React tree",
            "→ Client-side navigation: RouterDataProvider intercepts link clicks",
            "→ Fetches next route data client-side",
            "→ Route component swaps inside shell (no full page reload)",
        ],
    },
}

const LEGACY_BUILD_PIPELINE = {
    title: "Legacy Build Pipeline (Catalyst 0.2.x)",
    description: "The webpack-era Catalyst build and native consumption flow.",
    layers: [
        {
            layer: "web",
            label: "Webpack",
            detail: "Produces webpack client chunks, SSR output, and @loadable/component metadata.",
        },
        {
            layer: "prepare",
            label: "Babel prepare",
            detail: "Compiles catalyst-core source into the legacy dist package.",
        },
        {
            layer: "native",
            label: "Native build",
            detail: "buildApp:android and buildApp:ios consume the prepared web and native assets.",
        },
    ],
    flow: [
        "catalyst build (webpack)",
        "→ catalyst serve for production-style validation",
        "→ npm run buildApp:android or npm run buildApp:ios",
    ],
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getProjectContext(root) {
    const { readJson, fileExists } = makeProjectHelpers(root)
    const config = readJson("config/config.json") || {}
    const pkg = readJson("package.json") || {}
    const wv = config.WEBVIEW_CONFIG || {}
    const scripts = pkg.scripts || {}

    return {
        wv,
        scripts,
        hasAndroid: !!wv.android,
        hasIos: !!wv.ios,
        androidBuildType: (wv.android?.buildType || "debug").toLowerCase(),
        iosBuildType: (wv.ios?.buildType || "debug").toLowerCase(),
        hasKeystore: !!wv.android?.keystoreConfig,
        hasGoogleSignIn: !!wv.googleSignIn?.enabled,
        hasEcosystem: fileExists("ecosystem.config.js"),
        port: wv.port,
        useHttps: !!wv.useHttps,
        accessControl: wv.accessControl || {},
    }
}

function getKnownErrors(keywords) {
    if (!keywords || !keywords.length) return []
    // Score known_errors rows by keyword overlap
    const rows = _db
        .prepare(
            `
    SELECT title, content, tags FROM framework_knowledge
    WHERE section = 'known_errors'
  `
        )
        .all()

    const tokens = keywords.map((k) => k.toLowerCase())
    return rows
        .map((r) => {
            const blob = [r.title, r.content, r.tags].join(" ").toLowerCase()
            const score = tokens.filter((t) => blob.includes(t)).length
            return { ...r, score }
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ title, content }) => ({ title, content }))
}

// ─── Tool: get_build_flow ────────────────────────────────────────────────────

function handle_get_build_flow({ platform, mode, symptom } = {}) {
    const catalystRoot = findCatalystRoot()
    if (!catalystRoot) {
        return { error: "No catalyst-core project found. Run from inside a Catalyst app." }
    }

    const ctx = getProjectContext(catalystRoot.dir)
    const installedVersion = catalystRoot.installedVersion || catalystRoot.catalystVersion
    const generation = catalystGeneration(installedVersion)
    if (generation === "unknown") {
        return {
            error: "catalyst_version_required",
            message: `Unable to determine whether this project targets legacy 0.2.x or current ${VITE_RUNTIME_VERSION}+. Confirm the target version before applying build guidance.`,
        }
    }
    const p = (platform || "web").toLowerCase()
    const m = (mode || "dev").toLowerCase() // dev | build | production | staging | release

    let flow_key
    let warnings = []
    let notes = []

    // ── Web ──────────────────────────────────────────────────────────────────
    if (p === "web") {
        if (m === "production" || m === "prod") {
            flow_key = "web_prod"
            if (!ctx.hasEcosystem)
                warnings.push(
                    "ecosystem.config.js not found — PM2 serve step will fail. Create one or use `catalyst serve` for local serving."
                )
        } else if (m === "staging" || m === "stag") {
            flow_key = "web_staging"
            if (!ctx.hasEcosystem)
                warnings.push("ecosystem.config.js not found — staging serve step will fail.")
        } else if (m === "build") {
            flow_key = "web_build"
        } else {
            flow_key = "web_dev"
        }

        notes.push(`Port: ${ctx.port || "not set in WEBVIEW_CONFIG"}`)
        notes.push(`useHttps: ${ctx.useHttps}`)
        if (ctx.accessControl.allowedUrls) {
            notes.push(`accessControl.allowedUrls: ${ctx.accessControl.allowedUrls.join(", ")}`)
        }
    }

    // ── Android ──────────────────────────────────────────────────────────────
    else if (p === "android") {
        if (!ctx.hasAndroid) {
            warnings.push(
                "WEBVIEW_CONFIG.android block missing from config/config.json. Android build will fail immediately."
            )
        }

        const isRelease = m === "release" || ctx.androidBuildType === "release"
        flow_key = isRelease ? "android_release" : "android_debug"

        if (isRelease) {
            if (!ctx.hasKeystore) {
                warnings.push(
                    "WEBVIEW_CONFIG.android.keystoreConfig missing — release build will fail at AAB signing step. Add keystoreConfig with keyAlias, storePassword, keyPassword, organizationInfo."
                )
            }
        } else {
            if (!ctx.wv.android?.sdkPath) {
                warnings.push(
                    "WEBVIEW_CONFIG.android.sdkPath not set — ADB and emulator validation will fail."
                )
            }
            if (!ctx.wv.android?.emulatorName) {
                warnings.push("WEBVIEW_CONFIG.android.emulatorName not set — emulator launch step will fail.")
            }
        }

        notes.push(`buildType detected: ${ctx.androidBuildType}`)
        if (ctx.wv.android?.sdkPath) notes.push(`sdkPath: ${ctx.wv.android.sdkPath}`)
        if (ctx.wv.android?.emulatorName) notes.push(`emulatorName: ${ctx.wv.android.emulatorName}`)
        if (ctx.wv.android?.buildOptimisation) notes.push("buildOptimisation: enabled")
    }

    // ── iOS ──────────────────────────────────────────────────────────────────
    else if (p === "ios") {
        if (!ctx.hasIos) {
            warnings.push(
                "WEBVIEW_CONFIG.ios block missing from config/config.json. iOS build will fail immediately."
            )
        }

        const isRelease = m === "release" || ctx.iosBuildType === "release"
        flow_key = isRelease ? "ios_release" : "ios_debug"

        if (!ctx.wv.ios?.appBundleId) {
            warnings.push(
                'WEBVIEW_CONFIG.ios.appBundleId not set — Xcode build will use fallback "com.debug.webview".'
            )
        }
        if (!ctx.wv.ios?.simulatorName && !isRelease) {
            warnings.push("WEBVIEW_CONFIG.ios.simulatorName not set — simulator launch step will fail.")
        }
        if (ctx.hasGoogleSignIn && !ctx.wv.ios?.simulatorName) {
            warnings.push(
                "googleSignIn.enabled=true but iosClientId may be missing — check WEBVIEW_CONFIG.googleSignIn.iosClientId."
            )
        }
        if (isRelease && ctx.iosBuildType !== "release") {
            warnings.push(
                'ios.buildType is not "Release" (case-sensitive). Release builds require exactly "Release" — not "release".'
            )
        }

        notes.push(`buildType detected: ${ctx.wv.ios?.buildType || "not set (defaults to debug)"}`)
        if (ctx.wv.ios?.appBundleId) notes.push(`appBundleId: ${ctx.wv.ios.appBundleId}`)
        if (ctx.wv.ios?.simulatorName) notes.push(`simulatorName: ${ctx.wv.ios.simulatorName}`)
        if (ctx.hasGoogleSignIn) notes.push("googleSignIn: enabled")
    } else {
        return { error: `Unknown platform "${platform}". Use: web | android | ios` }
    }

    // ── Related errors (debug assist) ────────────────────────────────────────
    const errorKeywords = [p, flow_key.replace("_", " ")]
    if (symptom) errorKeywords.push(...symptom.toLowerCase().split(/\s+/))
    const related_errors = getKnownErrors(errorKeywords)

    return {
        platform: p,
        mode: flow_key,
        project_root: catalystRoot.dir,
        catalyst_version: catalystRoot.catalystVersion,
        catalyst_generation: generation,
        steps:
            generation === "legacy" && LEGACY_WEB_FLOWS[flow_key]
                ? LEGACY_WEB_FLOWS[flow_key]
                : MASTER_FLOWS[flow_key],
        project_config: notes,
        warnings: warnings.length ? warnings : undefined,
        related_errors: related_errors.length ? related_errors : undefined,
    }
}

// ─── Tool: get_architecture_diagram ─────────────────────────────────────────

function handle_get_architecture_diagram({ feature, symptom } = {}) {
    const catalystRoot = findCatalystRoot()
    if (!catalystRoot) {
        return { error: "No catalyst-core project found. Run from inside a Catalyst app." }
    }

    const ctx = getProjectContext(catalystRoot.dir)
    const generation = catalystGeneration(catalystRoot.installedVersion || catalystRoot.catalystVersion)

    // Match feature to a diagram key
    const f = (feature || "").toLowerCase()
    let diagram_key = null

    if (/universal|webview|native.*app|app.*arch/i.test(f)) diagram_key = "universal_app"
    else if (/request|fetch|data.*fetch|transport|api.*flow/i.test(f)) diagram_key = "request_lifecycle"
    else if (/build.*pipe|pipeline|webpack|compile|prepare/i.test(f)) diagram_key = "build_pipeline"
    else if (/bridge|postmessage|js.*native|native.*js/i.test(f)) diagram_key = "bridge_architecture"
    else if (/rout|navigation|page.*flow/i.test(f)) diagram_key = "routing"

    if (!diagram_key) {
        // Fall back: search KB for the feature
        const rows = _db
            .prepare(
                `
      SELECT title, content, section FROM framework_knowledge
      WHERE title LIKE ? OR content LIKE ?
      ORDER BY id LIMIT 5
    `
            )
            .all(`%${feature}%`, `%${feature}%`)

        return {
            feature,
            matched_diagram: null,
            note: `No master diagram for "${feature}". Here are related KB entries:`,
            kb_matches: rows,
        }
    }

    if (diagram_key === "build_pipeline" && generation === "unknown") {
        return {
            error: "catalyst_version_required",
            message: `Build architecture differs between legacy 0.2.x and current ${VITE_RUNTIME_VERSION}+. Confirm the target Catalyst version.`,
        }
    }

    const diagram =
        diagram_key === "build_pipeline" && generation === "legacy"
            ? LEGACY_BUILD_PIPELINE
            : MASTER_DIAGRAMS[diagram_key]

    // ── Annotate with project-specific context ────────────────────────────────
    const project_context = []

    if (diagram_key === "universal_app") {
        project_context.push(`Port: ${ctx.port || "not configured"}`)
        project_context.push(`useHttps: ${ctx.useHttps}`)
        project_context.push(`Android configured: ${ctx.hasAndroid}`)
        project_context.push(`iOS configured: ${ctx.hasIos}`)
        if (ctx.hasGoogleSignIn) project_context.push("googleSignIn: enabled")
        const { readJson } = makeProjectHelpers(catalystRoot.dir)
        const splash = (readJson("config/config.json") || {}).splashScreen
        if (splash)
            project_context.push(`splashScreen: configured (duration: ${splash.duration || "default"})`)
    }

    if (diagram_key === "request_lifecycle") {
        project_context.push(
            `allowedUrls: ${(ctx.accessControl.allowedUrls || []).join(", ") || "none configured"}`
        )
        project_context.push(`accessControl.enabled: ${ctx.accessControl.enabled ?? "not set"}`)
        project_context.push(`port: ${ctx.port || "not set"}`)
    }

    if (diagram_key === "build_pipeline") {
        project_context.push(`catalyst version: ${catalystRoot.catalystVersion}`)
        project_context.push(`android build type: ${ctx.androidBuildType || "not configured"}`)
        project_context.push(`iOS build type: ${ctx.iosBuildType || "not configured"}`)
    }

    if (diagram_key === "routing") {
        const { grepSrc } = makeProjectHelpers(catalystRoot.dir)
        const routeFiles = grepSrc(/RouterDataProvider|createBrowserRouter|<Route/)
        project_context.push(
            `RouterDataProvider found in: ${routeFiles.length ? routeFiles.slice(0, 3).join(", ") : "not detected"}`
        )
    }

    // ── Related errors ────────────────────────────────────────────────────────
    const errorKeywords = [diagram_key.replace(/_/g, " ")]
    if (symptom) errorKeywords.push(...symptom.toLowerCase().split(/\s+/))
    const related_errors = getKnownErrors(errorKeywords)

    return {
        feature,
        catalyst_generation: generation,
        matched_diagram: diagram_key,
        title: diagram.title,
        description: diagram.description,
        layers: diagram.layers,
        flow: diagram.flow,
        configurable_today: diagram.configurable_today || undefined,
        known_pitfalls: diagram.known_pitfalls || undefined,
        project_context,
        related_errors: related_errors.length ? related_errors : undefined,
    }
}

module.exports = { init, handle_get_build_flow, handle_get_architecture_diagram }
