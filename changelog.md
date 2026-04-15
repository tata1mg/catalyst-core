# Changelog

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
