# Catalyst Core — Claude Context Reference

> Machine-first. Dense. No prose filler. Read this when MCP is unavailable.
> Source: https://github.com/tata1mg/catalyst-core | Version: 0.1.0-canary.4

---

## 1. What Catalyst Is

React SSR framework + universal native app builder (Android/iOS via WebView).
**Not** a bare React app. **Not** Next.js. Opinionated SSR lifecycle, static route array, server/client fetcher pattern.

Key exports from `catalyst-core` package:

- `catalyst-core` — SSR engine, `<Head>`, `<Body>`, `<Outlet>`
- `@tata1mg/router` — router package (react-router-v6 wrapper), `useNavigate`, `Link`, `useCurrentRouteData`, `RouterDataProvider`
- `catalyst-core/hooks` — native bridge hooks: `useCamera`, `useFilePicker`, `useHapticFeedback`, `useDeviceInfo`, `useIntent`
- `catalyst-core/WebBridge` — low-level WebBridge (JS↔native), prefer hooks over this
- `catalyst-core/caching` — server-side caching utilities

**GitHub:** `https://github.com/tata1mg/catalyst-core` (MIT, public)
**Hooks source:** `src/native/bridge/hooks.js`
**Entry point:** `dist/index.js`

---

## 2. Project File Structure (Required)

```
<project-root>/
├── config/
│   └── config.json          ← required. env vars + WEBVIEW_CONFIG
├── src/
│   └── js/
│       ├── routes/
│       │   └── index.js     ← required. exports default route array
│       ├── containers/
│       │   └── App/
│       │       └── index.js ← required. App shell with <Outlet />
│       └── store/
│           └── index.js     ← optional. configureStore(initialState, request)
├── server/
│   ├── index.js             ← required. lifecycle hooks (preServerInit etc)
│   ├── server.js            ← required. addMiddlewares(app)
│   └── document.js          ← required. Document component
├── client/
│   ├── index.js             ← required. client hydration entry
│   └── styles.js            ← required. global CSS imports
├── public/
│   ├── offline.html         ← required for native. shown when device offline
│   ├── android/
│   │   ├── splashscreen.png ← required for native Android
│   │   └── appIcons/        ← mdpi hdpi xhdpi xxhdpi xxxhdpi .png
│   └── ios/
│       ├── splashscreen.png ← required for native iOS
│       └── appIcons/        ← 20 29 40 58 60 80 87 120 1024 .png
└── package.json             ← anchor. must have catalyst-core in deps
```

**MCP anchor rule:** Every MCP tool hard-fails if `package.json` has no `catalyst-core` dependency.

---

## 3. config/config.json — Full Schema

```json
{
    "NODE_SERVER_PORT": 3005,
    "API_URL": "https://api.example.com",
    "CLIENT_ENV_KEYS": ["API_URL"],

    "splashScreen": {
        "duration": 1000,
        "backgroundColor": "#ffffff"
    },

    "WEBVIEW_CONFIG": {
        "useHttps": false,

        "android": {
            "buildType": "debug",
            "sdkPath": "/path/to/android/sdk",
            "emulatorName": "Pixel_6_API_33",
            "appName": "MyApp",
            "appBundleId": "com.example.myapp",
            "buildOptimisation": false,
            "cachePattern": "*.css,*.js"
        },

        "ios": {
            "buildType": "Debug",
            "simulatorName": "iPhone 15",
            "appName": "MyApp",
            "appBundleId": "com.example.myapp"
        },

        "accessControl": {
            "enabled": true,
            "allowedUrls": ["https://api.example.com/*", "*.example.com"]
        },

        "notifications": {
            "enabled": false
        }
    }
}
```

**Field rules:**

- `splashScreen` is top-level, NOT inside `WEBVIEW_CONFIG`
- `android.buildType`: lowercase `"debug"` | `"release"` — debug disables caching (required for HMR)
- `ios.buildType`: PascalCase `"Debug"` | `"Release"` — case-sensitive
- `appBundleId`: reverse-DNS format `com.org.appname`
- `CLIENT_ENV_KEYS`: only listed keys are sent to browser bundle — security boundary
- `accessControl.enabled: false` → all URLs allowed; `true` → only allowedUrls pass

---

## 4. SSR Lifecycle & Data Fetching

### Execution order on first page load:

1. `preServerInit()` → server starts
2. `App.serverSideFunction({ store, req, res })` → runs on every request
3. `Page.serverFetcher({ route, location, params, searchParams, navigate }, { store })` → runs for matched route
4. React SSR renders HTML → sent to client
5. Client hydrates → `Page.clientFetcher` runs on next client navigation

### serverFetcher vs clientFetcher:

|            | serverFetcher                              | clientFetcher                           |
| ---------- | ------------------------------------------ | --------------------------------------- |
| Runs on    | Server only                                | Client only (on navigation)             |
| When       | First request / `window.location.href` nav | `<Link>`, `useNavigate()`, `<Navigate>` |
| Bundle     | Excluded from client bundle                | Included                                |
| navigate() | Server redirect (response.send)            | Client-side redirect                    |
| Safe for   | Server secrets, DB calls                   | User interactions                       |

### Patterns:

```js
// Page component
const Page = () => <div>{data}</div>

Page.serverFetcher = async ({ route, params, navigate }, { store }) => {
    return await fetch("/api/data").then((r) => r.json())
}

Page.clientFetcher = async ({ route, params, navigate }, { store }, customArg) => {
    return await fetch("/api/data").then((r) => r.json())
}
```

```js
// Consuming fetcher data
import { useCurrentRouteData } from "@tata1mg/router"
const Page = () => {
    const { data, isFetching, error, refetch, clear } = useCurrentRouteData()
}
```

### Lifecycle hooks (server/index.js):

```js
export const preServerInit = () => {} // before server starts
export const onServerError = (err) => {} // server failed to start
export const onRouteMatch = (ctx) => {} // after route matching (hit or miss)
export const onFetcherSuccess = (ctx) => {} // after serverFetcher runs
export const onRenderError = (err, ctx) => {} // render failed
export const onRequestError = (err, ctx) => {} // outermost catch
```

---

## 5. Routing

```js
// src/js/routes/index.js
import HomePage from "@containers/HomePage"
import AboutPage from "@containers/AboutPage"

const routes = [
    { path: "/", end: true, component: HomePage },
    { path: "/about", end: false, component: AboutPage },
]

export default routes
```

```js
// src/js/routes/utils.js — must export RouterDataProvider
import { RouterDataProvider } from "@tata1mg/router"
export { RouterDataProvider }
```

```js
// App shell — src/js/containers/App/index.js
import React from "react"
import { Outlet } from "@tata1mg/router"

const App = () => (
    <>
        <Outlet />
    </>
)

App.serverSideFunction = ({ store, req, res }) => new Promise((resolve) => resolve())

export default App
```

**Navigation:**

- `useNavigate()` from `@tata1mg/router` — client nav
- `<Link to="/path">` — client nav
- `navigate()` inside `serverFetcher` — server redirect
- `navigate()` inside `clientFetcher` — client redirect

---

## 6. Native Hooks — Full API Reference

All hooks live in `catalyst-core/hooks`. All hooks expose `isNative` (bool) and `isWeb` (bool).
Hooks throw if `window.WebBridge` is not initialized (native-only context).

### useCamera

```js
import { useCamera } from "catalyst-core/hooks"
const { data, loading, isNative, isWeb, execute, takePhoto, permission } = useCamera()
// data: { fileSrc, fileName, size, mimeType, transport }
// execute() / takePhoto() — triggers camera
// permission: permission state object
```

### useFilePicker

```js
import { useFilePicker } from "catalyst-core/hooks"
const { data, isNative, isWeb, execute, pickFile, getFileObject, getAsBase64 } = useFilePicker()
// execute(mimeType?) / pickFile(mimeType?)
// data: { fileSrc, fileName, size, mimeType, transport }
// getFileObject(idx) — returns File-like object
// getAsBase64(idx) — returns base64 string
```

### useHapticFeedback

```js
import { useHapticFeedback } from "catalyst-core/hooks"
const { execute, trigger, isSupported, isNative, isWeb } = useHapticFeedback()
// execute(type) / trigger(type)
// type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'
// isSupported: bool — false on web or unsupported devices
```

### useDeviceInfo

```js
import { useDeviceInfo } from "catalyst-core/hooks"
const { data, isNative, isWeb } = useDeviceInfo()
// data: { model, manufacturer, platform, screenWidth, screenHeight, screenDensity }
// platform: 'android' | 'ios'
```

### useIntent

```js
import { useIntent } from "catalyst-core/hooks"
const { execute } = useIntent()
// execute(url, mimeType) — opens file/URL in native app
```

### Platform detection (correct pattern):

```js
// CORRECT — works inside native WebView
const isNative = window.__PLATFORM__ === "android" || window.__PLATFORM__ === "ios"
const platform = window.__PLATFORM__ // 'android' | 'ios' | undefined

// WRONG — unreliable inside WebView
navigator.userAgent / // returns WebView UA string, NOT 'Android'/'iPhone'
    Android /
    i.test(navigator.userAgent) // may return false inside native WebView
```

### WebBridge (low-level):

```js
const { getDeviceInfo } = WebBridge.init() // init and destructure
const { getDeviceInfo } = window.WebBridge // direct access
const info = await getDeviceInfo()
// Returns: { model, manufacturer, platform, screenWidth, screenHeight, screenDensity }
```

---

## 7. Universal App — Conversion Checklist

20 conversion tasks across 3 tiers. Use MCP `get_conversion_status` to auto-detect state.

### Tier 1 — Critical (app won't start without these)

| ID                      | Task                                                              | Key check                         |
| ----------------------- | ----------------------------------------------------------------- | --------------------------------- |
| T1_CONFIG               | config/config.json with NODE_SERVER_PORT, WEBVIEW_CONFIG, API_URL | file exists + fields present      |
| T2_ROUTER_DEP           | @tata1mg/router in package.json deps                              | not react-router-dom              |
| T3_ROUTES_FILE          | src/js/routes/index.js exports route array                        | exports default [...]             |
| T4_DATA_FETCHING        | Page data via serverFetcher/clientFetcher, not useEffect+fetch    | no page-level useEffect fetch     |
| T5_ROUTER_DATA_PROVIDER | RouterDataProvider wired in routes/utils.js                       | file + RouterDataProvider present |
| T6_APP_SHELL            | App/index.js renders `<Outlet />`                                 | Outlet present                    |
| T7_SERVER_FILES         | server/index.js, server/server.js, server/document.js             | all 3 exist                       |
| T8_CLIENT_ENTRY         | client/index.js, client/styles.js                                 | both exist                        |

### Tier 2 — Native Build (first native build won't run without these)

| ID                 | Task                                                                                      | Key check      |
| ------------------ | ----------------------------------------------------------------------------------------- | -------------- |
| T9_WEBVIEW_ANDROID | WEBVIEW_CONFIG.android with buildType, sdkPath, emulatorName, appName                     | all 4 fields   |
| T10_WEBVIEW_IOS    | WEBVIEW_CONFIG.ios with buildType, appBundleId, simulatorName, appName                    | all 4 fields   |
| T11_ACCESS_CONTROL | WEBVIEW_CONFIG.accessControl.enabled=true + allowedUrls non-empty                         | both set       |
| T12_SPLASH_SCREEN  | splashScreen at top level + public/android/splashscreen.png + public/ios/splashscreen.png | config + files |
| T13_ANDROID_ICONS  | public/android/appIcons/{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}.png                              | all 5          |
| T14_IOS_ICONS      | public/ios/appIcons/{20,29,40,58,60,80,87,120,1024}.png                                   | all 9          |
| T15_OFFLINE_HTML   | public/offline.html                                                                       | file exists    |

### Tier 3 — Enhancements (feature-gated, only if feature is used)

| ID                    | Task                               | Trigger                                     | Correct pattern |
| --------------------- | ---------------------------------- | ------------------------------------------- | --------------- |
| T17a_USE_FILEPICKER   | `<input type="file">` found        | useFilePicker from catalyst-core/hooks      |
| T17b_USE_CAMERA       | `<input capture>` found            | useCamera from catalyst-core/hooks          |
| T18_USE_HAPTIC        | navigator.vibrate() found          | useHapticFeedback from catalyst-core/hooks  |
| T19_USE_NOTIFICATIONS | push notification code found       | notifications.enabled=true + Firebase files |
| T20_USE_DEVICE_INFO   | navigator.userAgent sniffing found | window.**PLATFORM**                         |

**depends_on graph:**

```
T1 → T2 → T3 → T4
                T3 → T5 → T6 → T8 → T17a, T17b, T18, T20
T1 → T7
T1 → T9 → T13
T1 → T10 → T14
T1 → T11, T12, T15
T9 + T10 → T19
```

---

## 8. Native App Build Flows

### Commands:

```bash
npm run start                    # dev server — port 3005
npm run build                    # production build
npm run serve                    # serve production build
npm run setupEmulator:android    # configure Android emulator
npm run setupEmulator:ios        # configure iOS simulator
npm run buildApp:android         # build + install on Android emulator
npm run buildApp:ios             # build + install on iOS simulator
```

### Android build sequence:

1. `npm run start` (keep running)
2. `npm run buildApp:android`
    - Reads `WEBVIEW_CONFIG.android` from config.json
    - Requires: `sdkPath`, `emulatorName`, `appName`, `buildType`
    - For release: requires keystore + `appBundleId` → produces `.aab`
    - For debug: HMR works, no caching (`buildType: "debug"`)

### iOS build sequence:

1. `npm run start` (keep running)
2. `npm run buildApp:ios`
    - Reads `WEBVIEW_CONFIG.ios` from config.json
    - Requires: `buildType` (PascalCase), `simulatorName`, `appName`, `appBundleId`
    - Requires Xcode + `xcode-select --install`

### buildOptimisation (Android only):

- `buildOptimisation: true` → static assets bundled into APK, loaded from device storage
- ~90% faster initial load, near-zero network requests for JS/CSS
- Disable during development (`buildOptimisation: false`, `buildType: "debug"`)

### Cache behaviour:

- Fresh (< 24h): served from cache, no network
- Stale (24–25h): served from cache + background revalidation
- Expired (> 25h): network fetch, cache updated

---

## 9. Known Errors & Debugging

Use MCP `debug_issue` with symptom text. Matches via keyword scoring against known_errors table.

### Most common native build errors:

**`sdkPath not found` / Android SDK error**

- Check `WEBVIEW_CONFIG.android.sdkPath` points to actual SDK dir (not Studio install dir)
- Find it: Android Studio → SDK Manager → SDK Location at top

**`appBundleId invalid`**

- Must be reverse-DNS: `com.org.app` — no uppercase, no spaces, 3+ segments

**`buildType case error`**

- Android: lowercase `"debug"` / `"release"`
- iOS: PascalCase `"Debug"` / `"Release"`

**Blank page on native / hydration mismatch**

- `<Outlet />` missing from App/index.js
- RouterDataProvider not in routes/utils.js
- serverFetcher not returning data (check server logs)

**Push notifications silent failure**

- `notifications.enabled` not set to `true` in WEBVIEW_CONFIG
- `google-services.json` (Android) or `GoogleService-Info.plist` (iOS) missing from project root

**useEffect+fetch data not loading on native**

- Page-level data must use `serverFetcher` / `clientFetcher`
- `useEffect` + `fetch` works on web, fails SSR hydration → blank page on native first load

**navigator.vibrate() does nothing on device**

- Native WebView ignores Web Vibration API silently
- Replace with `useHapticFeedback().execute('medium')`

**File picker / camera silently does nothing on Android**

- `<input type="file">` / `<input capture>` unreliable in WebView
- Replace with `useFilePicker().execute()` / `useCamera().execute()`

**`window.WebBridge is not defined`**

- Hook called outside native context, or before bridge initialised
- Add `isNative` guard: `const { isNative, execute } = useCamera(); if (isNative) execute()`

---

## 10. MCP Tools Reference

MCP server lives at `mcp_v2/mcp.js`. Reads `context.db` (SQLite). Requires catalyst-core project root.

| Tool                       | When to call                                             | Key params                                    |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| `get_conversion_status`    | Full project scan — gaps / done / needs_review / blocked | `include_not_applicable`                      |
| `get_conversion_tasks`     | Filtered actionable task list                            | `filter: all\|critical\|native\|enhancements` |
| `check_config`             | Validate config/config.json against schema               | `platform: android\|ios\|both`                |
| `debug_issue`              | "Why is X failing?" — keyword matches known errors       | `symptom: string`                             |
| `get_build_flow`           | Step-by-step build instructions                          | `platform`, `mode`, `symptom?`                |
| `get_architecture_diagram` | ASCII architecture diagram                               | `feature: string (free text)`                 |
| `create_task_plan`         | Start tracked conversion plan from live scan             | `goal: string`                                |
| `update_task_step`         | Mark step done/blocked/in_progress                       | `step_index`, `status`, `note?`               |
| `get_active_task`          | Resume after context reset — show current step           | `include_all_steps?`                          |
| `sync_catalyst_docs`       | Sync latest docs from GitHub                             | (no params)                                   |

**MCP design rules:**

- No tool re-reads package.json — it's loaded once at startup
- `create_task_plan` runs live `get_conversion_status` scan before writing plan
- `needs_review` tasks are resolved inline (signal_files read from disk) before plan is written
- Final plan has no `needs_review` steps — only `pending`, `done`, `blocked`
- `bare_minimum` in plan output = Tier 1 + Tier 2 gaps, topologically sorted = first native build checklist
- `get_active_task` is the cold-start resume tool — call this first after any context reset

**Task plan step statuses:** `pending` → `in_progress` → `done` | `blocked` | `skipped`
