# Catalyst Core — Claude Context Reference

> Machine-first. Dense. No prose filler. Read this when MCP is unavailable.
> Source: https://github.com/tata1mg/catalyst-core | Version: 1.3.1

---

## 1. What Catalyst Is

React SSR framework + universal native app builder (Android/iOS via WebView).
**Not** a bare React app. **Not** Next.js. Opinionated SSR lifecycle, static route array, server/client fetcher pattern.

Key exports from `catalyst-core` package:

- `catalyst-core` — SSR engine. Exports exactly eight names: `RouterDataProvider`, `useCurrentRouteData`, `useRouterData`, `MetaTag`, `split`, `hydrationReady`, `Head`, `Body`. No default export.
- `react-router` — peer dependency (`^7.18.2`). `Outlet`, `Link`, `useNavigate`, `useParams` and all other router names are imported from here, not from `catalyst-core`. The one exception is `RouterProvider`, which `client/index.js` imports from `react-router/dom`, the DOM build that wires React DOM's `flushSync` into the router.
- `catalyst-core/hooks` — native bridge hooks: `useCamera`, `useFilePicker`, `useHapticFeedback`, `useDeviceInfo`, `useIntent`
- `catalyst-core/WebBridge` — low-level WebBridge (JS↔native), prefer hooks over this

**GitHub:** `https://github.com/tata1mg/catalyst-core` (MIT, public)
**Hooks source:** `src/native/bridge/hooks.ts` (ships as `dist/native/bridge/hooks.js`)
**Entry point:** `dist/index.jsx`

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
│   ├── offline.html         ← native: shown when device offline
│   ├── icon.png             ← native app icon, both platforms (1.2.0+). square PNG >= 1024px, no alpha for iOS release
│   ├── splashscreen.html    ← optional animated HTML splash, both platforms (1.0.2+)
│   ├── android/
│   │   ├── splashscreen.png ← optional native splash image (else launcher icon)
│   │   └── appIcons/        ← optional override: icon-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}.png
│   └── ios/
│       ├── splashscreen.png ← optional native splash image (else loader)
│       └── appIcons/        ← optional override: icon-{WxH}-{scale}.png, e.g. icon-60x60-3x.png
├── credentials/             ← signing files, credentials/android/ + credentials/ios/. git-ignored. back up
├── build-output/            ← native outputs: android/debug/, <platform>/<version>-<build>/. git-ignored
├── .catalyst/               ← per-machine CLI state (local.json). git-ignored
└── package.json             ← anchor. must have catalyst-core in deps
```

**MCP anchor rule:** Every MCP tool hard-fails if `package.json` has no `catalyst-core` dependency.

---

## 3. config/config.json — Full Schema

```json
{
    "NODE_SERVER_PORT": 3005,
    "API_URL": "https://api.example.com",
    "CLIENT_ENV_VARIABLES": ["API_URL"],

    "CSP_NONCE_ENABLE": false,
    "SCRIPT_INTEGRITY_ENABLE": false,
    "OFFLINE_SNAPSHOTS_ENABLE": true,

    "WEBVIEW_CONFIG": {
        "appId": "com.yourcompany.myapp",
        "appName": "MyApp",
        "url": "https://www.myapp.com",
        "LOCAL_IP": "localhost",
        "port": "3005",

        "splashScreen": {
            "backgroundColor": "#ffffff",
            "minDuration": 1200
        },

        "android": {
            "buildOptimisation": false,
            "cachePattern": "*.css,*.js"
        },

        "ios": {
            "developmentTeam": "ABCDE12345"
        },

        "accessControl": {
            "enabled": true,
            "allowedUrls": ["https://api.example.com/*", "*.example.com"]
        },

        "notifications": {
            "enabled": false
        },

        "location": {
            "enabled": false,
            "usageDescription": "Shown in the iOS location prompt"
        }
    }
}
```

**Field rules:**

- `splashScreen` goes inside `WEBVIEW_CONFIG`; a top-level `splashScreen` is never read. Options: `backgroundColor` (#rrggbb), `duration` (image splash), `minDuration` (HTML splash), `imageWidth`, `imageHeight`, `cornerRadius`. The native build passes the colour to `public/splashscreen.html` as `window.__CATALYST_SPLASH__ = { backgroundColor }`
- `appId`: reverse-DNS `com.org.appname`; Android application id and iOS bundle id. The platform keys win over it: `android.packageName` on Android, `ios.bundleIdentifier` then `ios.appBundleId` on iOS
- iOS bundle id: letters, digits, `-` and `.` only. An underscore (valid on Android) fails every iOS build with NATIVE-010 (1.2.0+); set `ios.bundleIdentifier` without it
- `android` / `ios` blocks are optional from 1.2.0; before 1.2.0 the builds read sdkPath, emulatorName, appBundleId, simulatorName from them
- `url`: https origin the release app loads; debug builds ignore it
- `android.buildType` / `ios.buildType`: leave `"debug"` or omit; `"release"` is deprecated, use `--release`
- `CLIENT_ENV_VARIABLES`: only listed keys are sent to browser bundle — security boundary
- `accessControl.enabled: false` → all URLs allowed; `true` → only allowedUrls pass
- `CSP_NONCE_ENABLE: true` (1.3.0+): every script and modulepreload tag Catalyst renders carries a per-request nonce, not styles. The `Content-Security-Policy` header is the app's to set. Catalyst sets `res.locals.cspNonce` after the app's middlewares have run, so a middleware from `addMiddlewares` that only reads it gets `undefined` (header `'nonce-undefined'`): generate the nonce in the middleware and assign `res.locals.cspNonce`; Catalyst uses that value for the tags (a value outside the base64 alphabet is replaced)
- `SCRIPT_INTEGRITY_ENABLE: true` (1.3.1+): `catalyst build` writes sha384 hashes to `build/.vite/integrity.json`; the production server adds `integrity` + `crossorigin="anonymous"` to the script and modulepreload tags in the document. Read at build time: rebuild after turning it on (flag on + no file → startup warning, scripts served without integrity). Not covered: scripts loaded by static `import` or `import()`, CSS, scripts added in `server/document.js`. No effect in `catalyst start`. Assets on another origin need CORS headers
- `OFFLINE_SNAPSHOTS_ENABLE: false` (1.3.0+): the build skips `catalyst-sw.js` and `catalyst-offline-manifest.json` and the client never registers the worker; route `offline` flags are ignored. For apps that ship their own service worker
- `location.enabled: true` (1.3.0+): adds the Android location permissions and the WebView geolocation prompt, and `NSLocationWhenInUseUsageDescription` on iOS (`location.usageDescription` sets the text). Off → `navigator.geolocation` requests in the app are denied

---

## 4. SSR Lifecycle & Data Fetching

### Execution order on first page load:

1. `preServerInit()` → server starts
2. `App.serverSideFunction({ store, req, res, runInParallel })` → runs on every request. Promises passed to `runInParallel(...promises)` run alongside step 3, and the request waits for them before step 4 (or before returning, when a response was already sent). If one rejects and no response has been sent, the rejection takes the same path as a rejected `serverSideFunction`, after `onAppServerSideSuccess` has already run. If a fetcher or hook has already sent a response (e.g. a redirect), that response wins: the rejection does not reach `onAppServerSideError` and is only recorded on the `App.serverSideFunction.runInParallel` span when OTEL is on. Call it before `serverSideFunction` returns, and only pass work that page fetchers don't depend on.
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
// Named exports only. Hooks inside `export default { ... }` are never called; startup warns (1.2.0+).
export const preServerInit = async () => {} // once, before server starts; awaited
export const onRouteMatch = ({ req, res, matches, store }) => {} // each page request, after route matching
export const onAppServerSideSuccess = ({ req, res, store }) => {} // App.serverSideFunction resolved
export const onAppServerSideError = ({ req, res, store, error }) => {} // App.serverSideFunction threw
export const onFetcherSuccess = ({ req, res, store }) => {} // route serverFetcher resolved
export const onFetcherError = ({ req, res, store, error }) => {} // route data or page prep (metadata, assets) failed
export const onRenderError = ({ req, res, store, error }) => {} // React server render failed
export const onRequestError = ({ req, res, error }) => {} // anything else in the request threw
```

- Request hooks are not awaited: keep them synchronous. Use `req.originalUrl` (`req.path` is `/` inside hooks). Sending a response ends the request
- `onServerError` is read but never called in practice (Express 4 never passes an error to `listen`)
- A throwing hook is logged and skipped: PROCESS-001 (preServerInit), PROCESS-002 (request hooks)
- A `server/index.js` that exists but fails to import stops startup with the import error (1.3.0+); before 1.3.0 it was skipped. From 1.1.0 to 1.2.1 an import of a `_moduleAliases` alias in it failed this way, so `preServerInit` never ran
- `Otel.init({ errorSampling: { ENABLED: true } })` (1.3.0+): unsampled traces wait in memory until the request ends and the failed ones are exported; the server logs a memory heartbeat while it is on
- `setMetaData` tags are rendered by `MetaTag` only, apart from the title (1.3.0+). `<script type="application/ld+json">` renders in the page body, not `<head>`

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

| ID                 | Task                                                                                                                                                  | Key check      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| T9_WEBVIEW_ANDROID | WEBVIEW_CONFIG.appId (not com.example.*), appName, url (https origin)                                                                                 | all 3 fields   |
| T10_WEBVIEW_IOS    | T9 fields + WEBVIEW_CONFIG.ios.developmentTeam (iPhone and release builds)                                                                            | team ID set    |
| T11_ACCESS_CONTROL | WEBVIEW_CONFIG.accessControl.enabled=true + allowedUrls non-empty                                                                                     | both set       |
| T12_SPLASH_SCREEN  | WEBVIEW_CONFIG.splashScreen set (images optional; HTML splash in public/splashscreen.html)                                                            | config present |
| T13_ANDROID_ICONS  | 1.2.0+: public/icon.png (square PNG >= 1024px, else ANDROID-010) or public/android/appIcons/icon-{density}.png; before 1.2.0 all 5 icon-{density}.png | icon present   |
| T14_IOS_ICONS      | 1.2.0+: public/icon.png (else IOS-005; alpha fails a release with IOS-006) or public/ios/appIcons/icon-{WxH}-{scale}.png; before 1.2.0 all 9 sizes    | icon present   |
| T15_OFFLINE_HTML   | public/offline.html                                                                                                                                   | file exists    |

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
npm run start                    # dev server: port 3005
npm run build                    # production build
npm run serve                    # serve production build
npm run android                  # catalyst buildApp:android: install toolchain if missing, start dev server, run on emulator or phone
npm run ios                      # catalyst buildApp:ios: same on simulator or iPhone (macOS)
npm run android:release          # signed AAB + APK in build-output/android/<version>-<build>/
npm run ios:release              # signed IPA + dSYM zip in build-output/ios/<version>-<build>/
npx catalyst credentials:export android|ios   # CI secret value + backup of credentials/<platform>/
```

Older apps have `buildApp:android` / `buildApp:ios` scripts: same commands.

### Debug build (`npm run android` / `npm run ios`):

- Installs missing JDK 17 to 23, Android SDK packages, emulator, iOS runtime or simulator after asking
- Starts `catalyst start` when nothing answers on NODE_SERVER_PORT; no need to run it first
- Emulator/simulator by default; `--device` uses the connected phone; the pick is remembered in `.catalyst/local.json`
- Loads the dev server, never `url`: Android via `adb reverse` on localhost, simulator on localhost, iPhone on `<mac>.local`
- Keep `LOCAL_IP` as `localhost`; never put a LAN IP in config.json. A `LOCAL_IP` that is a real host (staging, not this machine) is loaded instead of the dev server
- First debug build per checkout (1.2.0+) rewrites config.json once: values equal to this machine's LAN IP, and a private `LOCAL_IP` that `NODE_SERVER_HOSTNAME` also holds, go back to `localhost`. Each change is printed. Never for a release, in CI or with `allowPrivateHost: true`
- A connected phone is no longer picked by itself (1.2.0): a terminal run asks once; without a terminal the emulator/simulator is used
- Android also writes a shareable debug APK to `build-output/android/debug/`
- Physical iPhone needs `ios.developmentTeam` and an Apple account signed in to Xcode once

### Release build (`npm run android:release` / `npm run ios:release`):

- Loads `WEBVIEW_CONFIG.url` (or `--url <u>`); refuses localhost/private hosts (NATIVE-001) unless `allowPrivateHost: true`
- Refuses `com.example.*` and template app ids (NATIVE-003); an invalid id (e.g. underscore on iOS) fails with NATIVE-010
- In a terminal, a missing or placeholder app id or website is asked once and saved to config.json
- Version from package.json; build number = minutes since 2024-01-01 UTC, or `CATALYST_BUILD_NUMBER`
- Android: upload key in `credentials/android/` (created once, in a terminal only; back it up, Play only accepts updates signed with it); writes .aab, a signed .apk for test phones and upload_certificate.pem. targetSdk 36, native libraries 16 KB page aligned
- Android: passwords in `android.keystoreConfig` / `android.keystore` are no longer used (1.2.0). An app that uploaded a build signed with the template keystore or an earlier generated key needs an upload key reset in Play Console
- iOS: writes .ipa + `<name>-dSYMs.zip`. Signs with the first of: (1) .p12 + .mobileprovision + p12Password in `credentials/ios/`; (2) `ios.provisioningProfile` (installed profile); (3) App Store Connect API key `AuthKey_<KEYID>.p8` + ascIssuerId in `credentials/ios/signing.properties`; (4) an App Store profile installed on this Mac for the bundle id (saved as `ios.provisioningProfile` in a terminal); (5) the Apple account signed in to Xcode (team saved as `ios.developmentTeam`). A Mac signed in to Xcode needs no files; none of the five → IOS-010
- CI: secrets `CATALYST_ANDROID_CREDENTIALS` / `CATALYST_IOS_CREDENTIALS` from `credentials:export`
- Store upload is manual (Play Console, Transporter)
- `buildType: "release"` still works but is deprecated

### Agents and CI (no TTY, or CI set):

- Nothing is prompted. Flags: `--release`, `--device`, `--url <u>`, `--yes` (installs), `--accept-licenses` (Android SDK and Xcode licences)
- A missing answer fails at once with NATIVE-005 naming the flag
- `--yes` never creates a signing key; the Android upload key needs a person at a terminal

### buildOptimisation (Android only):

- `buildOptimisation: true` → static assets bundled into APK, loaded from device storage
- ~90% faster initial load, near-zero network requests for JS/CSS
- Disable during development (`buildOptimisation: false`)

### Cache behaviour:

- Fresh (< 24h): served from cache, no network
- Stale (24–25h): served from cache + background revalidation
- Expired (> 25h): network fetch, cache updated

---

## 9. Known Errors & Debugging

Use MCP `debug_issue` with symptom text. Matches via keyword scoring against known_errors table.

### Most common native build errors:

**Android SDK error**

- The SDK is found in `android.sdkPath`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, then the default location; run `npm run android` in a terminal (or with `--yes --accept-licenses`) to install what is missing

**NATIVE-003 placeholder app id**

- Set `WEBVIEW_CONFIG.appId` to your own reverse-DNS id, e.g. `com.yourcompany.myapp`

**NATIVE-001 release host**

- Set `WEBVIEW_CONFIG.url` to the deployed https origin, or pass `--url`

**NATIVE-010 invalid app id**

- iOS bundle ids allow letters, digits, `-` and `.`; an `appId` with `_` fails every iOS build (1.2.0+). Set `ios.bundleIdentifier` without the underscore; Android keeps `appId`

**App icon errors (1.2.0+)**

- ANDROID-010 / IOS-005: `public/icon.png` is not a PNG, not square or under 1024px
- IOS-006: `public/icon.png` has an alpha channel; flatten it before an iOS release

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
