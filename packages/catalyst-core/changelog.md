# 1.0.0-beta.1

- Replaced the Webpack build and SSR pipeline with Vite and ESM.
- Added React 19 Suspense-aware routing, split components, and manifest-based asset loading.
- Added opt-in request, compression, flush, and bot-aware OpenTelemetry spans.
- Preserved native application builds, internal plugins, Sentry exports, and safe-area SSR hydration.
- Removed the legacy `devBuild` and `devServe` commands.

# Changelog

## [0.4.0] - unreleased

This release freezes the public API. The root entry of `catalyst-core` now exports exactly eight names and nothing else: `RouterDataProvider`, `useCurrentRouteData`, `useRouterData`, `MetaTag`, `split`, `hydrationReady`, `Head`, and `Body`. Anything previously reachable through the root entry but not in that list is no longer public. Applications that import a removed name will fail at build time rather than silently resolving to `undefined`.

### React Router is no longer re-exported

`catalyst-core` used to re-export the whole of React Router from its root entry, so `Link`, `Outlet`, `RouterProvider`, `useParams`, `useNavigate` and every other router name could be imported from `catalyst-core`. That re-export is gone.

React Router is now a peer dependency (`^7.18.2`). Install it in the application:

```bash
npm install react-router@^7.18.2
```

Then import router names from `react-router` directly. An import line that mixed both sources splits into two:

```js
// before
import { useCurrentRouteData, useParams, Link } from "catalyst-core"

// after
import { useCurrentRouteData } from "catalyst-core"
import { useParams, Link } from "react-router"
```

Because the version is now declared by the application, npm will report a peer dependency conflict if the installed React Router major does not satisfy `^7.18.2`. The server also verifies the resolved version at startup and exits with a clear error if React Router is missing or outside the supported range.

### Removed export paths

- `catalyst-core/caching` — removed. The caching feature was withdrawn and has no replacement.
- `catalyst-core/document` — removed. Import `Head` and `Body` from the `catalyst-core` root entry instead.

### No default export from the root entry

`split` was previously exported both as a named export and as the default. The default export is gone; use the named one.

```js
// before
import split from "catalyst-core"

// after
import { split } from "catalyst-core"
```

### Names that are no longer public

These were reachable from the root entry and are now internal: `RouterContext`, `serverDataFetcher`, `mergeHeadElements`, `deleteHeadTagsByDataAttribute`, `getMetaData`, and `useNavigateWithTransition`. In addition, `sanitizeFilePickerOptions` is no longer exported from `catalyst-core/hooks`. None of these have a supported replacement. If an application depends on one of them, open an issue describing the use case before upgrading.

### Native hooks: canonical keys

The native hooks now agree on one set of key names. Every change in this section is additive: no key that a hook returned before has been removed or repointed, so existing components keep working.

Several hooks were missing keys that the rest of the surface already had. `useNotificationPermission` gained `loading`, `data`, `error`, `isNative`, and `isWeb`, and it now reports permission failures as a standard error object instead of only logging them. `useCameraPermission` gained `loading`, `data`, `error`, `execute`, `isNative`, and `isWeb` on the same pattern. `useDeviceInfo` gained `data` alongside its existing `deviceInfo`. `useNativeTransition` gained `loading` alongside `transitioning`. The SSR stub returned by `useAI` reported `isWeb: false`, which was wrong on both counts; it now reports `isWeb: true`.

Where a hook had two names for one value, the shorter one is canonical and the older one is a deprecated alias that will be removed at 2.0: `loading` over `isLoading` and `transitioning`, `data` over `deviceInfo` and `permission`, and `execute` over `request`.

Hooks fall into three categories, and the category decides whether a hook has `execute`. A hook that wraps a single native operation exposes it as `execute` plus a domain-specific alias — `takePhoto`, `pickFile`, `openFile`, `signIn`, `trigger`, `request`. A hook that wraps several distinct operations has no single action to name, so its named functions are the API and it has no `execute` at all: `useVideoStream`, `useDataProtection`, and `useNativeTransition` work this way. A read-only hook reports ambient device state and has no action functions at all: `useNetworkStatus`, `useDeviceInfo`, and `useSafeArea` return state plus the runtime-context keys. `useNotification` is the one exception. It carries `execute` and `schedule` as aliases of `scheduleLocal` for backward compatibility. Both are frozen, both are discouraged, and neither should be read as the pattern for multi-action hooks. `execute` never takes an operation name as a string argument; it takes the arguments of the operation itself.

Hook errors are `CatalystError` values from the framework-wide error registry introduced in this release, carrying a `RUNTIME-NATIVE-*` code, a message, a category, a suggested action, a documentation link, and the originating platform error as `cause`. `useVideoStream` in particular used to report seventeen failures as bare `{ message }` objects with no code at all; those now carry real codes, and a camera denial reports the same code whether it comes from the permission hook or the stream.

One consequence for error logging: `CatalystError` extends `Error`, so `message` now lives on the prototype rather than as an own property. Reading `error.message` is unaffected, but `JSON.stringify(error)` no longer includes it. Log `error.message` explicitly, or use the `code` and `docUrl` fields.

### Node 22.12 is now the minimum

The error registry is loaded from the native bridge, which is built as CommonJS, so the package relies on `require()` of an ES module. That is unflagged only from Node 22.12 onward, and `engines` now declares `>=22.12`. Node 20 installs will warn, and importing `catalyst-core/hooks` or `catalyst-core/WebBridge` there fails with `ERR_REQUIRE_ESM`.

Two hooks are exempt from the error contract. `useNativeTransition` and `useSafeArea` return no `error` key, because transition failures self-heal into a plain navigation and safe-area insets always resolve to numeric defaults. Two others carry the right key with the wrong type: `error` on `useDeviceInfo` and `useNetworkStatus` is still a plain string rather than an error object, and stays a string until 2.0. The shape of `useAI` is owned by the `catalyst-ai` package and sits outside this contract entirely.

`requestHapticFeedback` and `requestCameraPermission` remain available both as `catalyst-core/hooks` exports and as `WebBridge` methods, and the two versions still differ in their defaults and return types. The hooks exports are the ones to prefer in application code: they are SSR-safe and treat a denied permission as a rejection. The two surfaces are unified at 2.0.

### App contract violations are reported at startup

The app contract validators in `server/utils/validator.js` used to log a bare message and return `undefined` when an app was missing a required export, which pushed the real failure into an unrelated `TypeError` deep inside a render. They now report through the shared error reporter instead, naming the specific file and export and what the app must provide, with detail governed by the output mode. Reporting is not fatal: startup continues, so an app that is only partly misconfigured still boots and the startup output explains what will fail.

The route and store checks moved out of the per-request path. `validateGetRoutes` and `validateConfigureStore` now run once when the renderer module loads — at server startup in production, and on the first SSR request in development, where the handler is loaded lazily — rather than once per request inside the handler's `try`/`catch`. The shape of `addMiddlewares` from `server/server.js` is checked during server setup.

Module aliases and `config/config.json` keys are not checked at load time; a missing alias or key still surfaces where it is used. An application that satisfies the contract sees no change. The full contract — the files Catalyst imports by fixed path and the required module aliases — is documented under File Conventions.

## [0.1.0-beta.2] - 2026-05-06

- Moved Catalyst into a monorepo structure with `catalyst-core`, `create-catalyst-app`, the Catalyst docs app, and the Catalyst core test app managed from one repository.
- Replaced the internal-package pre-release flow with a local release sandbox that scaffolds a real app using current-branch CCA and a locally packed current-branch `catalyst-core`.

## [0.1.0-canary.8] - 2026-04-15

- Introduced Catalyst’s internal plugin architecture, adding the `PluginBridge` web API, native plugin runtimes for Android and iOS, and manifest-driven build composition for modular native capabilities.
- Added config-based plugin enablement through `WEBVIEW_CONFIG.plugins` and a `catalyst plugins` CLI for discovering and managing internal framework plugins from the app layer.
- Shipped the first cross-platform migrated plugin, `device_info`

## [0.1.0-beta.1] - 2026-04-15

- Promoted `0.1.0-canary.7` to the first proper beta release after stabilization.
- No code changes from `0.1.0-canary.7`; this release marks the same build as production-ready beta.

## [0.1.0-canary.7] - 2026-03-31

- Introduced Catalyst MCP v2 with a new setup flow, database schema, knowledge base, and source-aware migration tooling for stronger project guidance and conversion workflows.
- Expanded MCP/framework knowledge coverage across SEO, observability, webpack, React Compiler, CLI, file conventions, and native hooks, while improving setup and verification messaging across supported MCP clients.

## [0.1.0-canary.6] - 2026-03-09

- Hardened URL whitelisting with thread-safety improvements, broader test coverage, and related iOS build fixes to make access-control behavior more reliable.
- Improved compatibility and runtime resilience by softening bridge environment mismatch failures and preserving backward compatibility for `useDataProtection` on older native binaries.

## [0.1.0-canary.5] - 2026-02-27

- Strengthened native app security with backup restrictions, screen-capture protection, web data clearing, and related Android/iOS test coverage.
- Improved universal app runtime behavior with safe-area inset support, edge-to-edge rendering, and notification permission override fixes.
- Expanded platform support with offline fallback handling, notification/access-control refinements, localhost HTTP allowances for local development, and file-picker/HTTPS server improvements.

## [0.1.0-canary.4] - 2026-02-12

- Added Google Sign-In support for both Android and iOS in Catalyst, enabling a unified native authentication experience for apps built on the framework.
- Improved release/build reliability with related bridge and CI updates, making integration smoother and more consistent across platforms.

## [0.1.0-canary.3] - 2026-02-04

- Android device security: added root, emulator, and Frida detection with launch-time checks and a Material Design 3 bottom sheet threat alert UI

## [0.1.0-canary.2] - 2026-01-28

- Adds mono-repository support for catalyst
- Notifications sound channel bug fix

## [0.1.0-canary.1] - 2026-01-12

- Universal Merge

## [0.0.3-canary.20] - 2025-12-12

- Patch: Allow localhost traffic to be served from http

## [0.0.3-canary.19] - 2025-12-09

- Offline fallback support: packages `public/offline.html` into Android/iOS bundles and shows it automatically when connectivity drops (with retry handling)
- Notification refactor: streamlined config toggle for local vs push, centralized permission/asset handling, and simpler routing into the web app
- Access control: combined access control config for ios

## [0.0.3-canary.18] - 2025-11-19

- Configuration Files
- Android Native WebView - MainActivity.kt
- Android Native WebView - CustomWebview.kt

## [0.0.3-canary.17] - 2025-11-19

- ✨ Added complete notification system (local & push)
- 🔔 New useNotification() React hook
- 📱 Firebase Cloud Messaging conditional build support
- 🤖 Android notification handling in MainActivity
- 🔧 5 new notification commands + 5 callbacks in NativeBridge
- 📦 Auto-processing of notification icons & sounds
- ⚙️ Conditional dependencies based on notification config
- 🧹 Updated .gitignore & .npmignore
- 📋 Enhanced build process with automatic permission injection
- 🔗 Deep link integration with notifications

## [0.0.3-canary.16] - 2025-11-19

- FeaturesGallery Support for File Picker: Enhanced file picker to open native gallery for selecting images and videos
- HTTPS Framework Server: Enabled HTTPS support for the framework server with self-signed SSL certificate
- MIME Type Handling: Fixed and improved MIME type detection and handling in the file picker

## [0.0.3-canary.15] - 2025-11-19

- Adding Android release support and appInfo key

## [0.0.3-canary.14] - 2025-09-29

- Android custom splashscreen

## [0.0.3-canary.13] - 2025-09-28

- Multi file support in useFilePicker hook
- Android multiple app icon support
- Android whitelisting toggle support

## [0.0.3-canary.12] - 2025-09-26

- Universal App Context: Added comprehensive context support for building universal mobile applications
- OpenTelemetry SDK Integration: Built-in support for observability and performance monitoring with Otel SDK

## [0.0.3-canary.11] - 2025-09-26

- Build organization: Store APKs and iOS builds organized by generation date and time for better tracking and management
- Enhanced Android native support: Add support for native keyboard and webview resizing in Android
- Device info API web support: Web support in device info API

## [0.0.3-canary.10] - 2025-09-11

- **Sentry import bug fix**
- **Open telemetry SDK**

## [0.0.3-canary.9] - 2025-09-11

- **App name configuration**
- **Device Info API**
- **Access control configuration**

## [0.0.3-canary.8] - 2025-01-06

- **App icon configuration**
- **Splash screen integration**
- **Url Whitelisting**

## [0.0.3-canary.7] - 2025-01-06

### 🚀 Features

- **Native API Integration**: Enhanced native module integration for better performance
- **Automated IP Resolution**: Intelligent network detection eliminates manual IP configuration
- **Universal Build System**: Streamlined one-command builds for both Android and iOS platforms
- **Enhanced CLI Interface**: Improved command-line tools for better developer experience

### 🐛 Bug Fixes

- Fixed IP address detection issues on development environments
- Resolved build configuration conflicts between platforms
- Improved error handling and recovery mechanisms

### 🔧 Improvements

- **Performance**: Optimized native module loading and execution
- **Developer Experience**: Enhanced CLI with better error messages and debugging info
- **Configuration**: Dynamic config updates without requiring restarts
- **Build Process**: Faster and more reliable build pipeline

### 🧪 Testing & Validation

- ✅ **Android Build**: Verified APK generation, installation, and runtime behavior
- ✅ **iOS Build**: Tested build process and device compatibility
- ✅ **IP Detection**: Validated automatic network resolution across platforms
- ✅ **Native Modules**: Confirmed API integration and performance benchmarks
- ✅ **CLI Operations**: Tested enhanced command-line workflows and error handling

### 🔄 Breaking Changes

**None** - All changes maintain backward compatibility while enhancing existing functionality

### 📝 Technical Details

- Improved native API bridge for better cross-platform communication
- Enhanced error reporting with detailed stack traces and suggestions
- Optimized build configuration for faster development cycles
- Added comprehensive logging for debugging and monitoring

### 🔗 Migration Notes

- No migration steps required
- Existing projects will automatically benefit from improvements
- Optional: Update CLI usage to leverage new enhanced features

## Version

- Target version: 0.0.3-canary.7
