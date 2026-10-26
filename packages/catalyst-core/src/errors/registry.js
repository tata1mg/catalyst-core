const REPO_BLOB_BASE = "https://github.com/tata1mg/catalyst-core/blob/main/errors"

export const ERROR_CODES = {
    PREFLIGHT_CONFIG_MISSING: "PREFLIGHT-001",
    PREFLIGHT_CONFIG_NOT_OBJECT: "PREFLIGHT-002",
    PREFLIGHT_CONFIG_KEY_MISSING: "PREFLIGHT-003",
    PREFLIGHT_PACKAGE_JSON_MISSING: "PREFLIGHT-004",
    PREFLIGHT_PACKAGE_JSON_INVALID: "PREFLIGHT-005",
    PREFLIGHT_MODULE_ALIAS_MISSING: "PREFLIGHT-006",
    PREFLIGHT_MODULE_ALIAS_NOT_OBJECT: "PREFLIGHT-007",
    PREFLIGHT_MODULE_ALIAS_RESTRICTED: "PREFLIGHT-008",
    PREFLIGHT_MODULE_ALIAS_KEY_MISSING: "PREFLIGHT-009",
    PREFLIGHT_PRE_SERVER_INIT_MISSING: "PREFLIGHT-010",
    PREFLIGHT_PRE_SERVER_INIT_NOT_FUNCTION: "PREFLIGHT-011",
    PREFLIGHT_MIDDLEWARE_MISSING: "PREFLIGHT-012",
    PREFLIGHT_MIDDLEWARE_NOT_FUNCTION: "PREFLIGHT-013",
    PREFLIGHT_REDUCER_MISSING: "PREFLIGHT-014",
    PREFLIGHT_REDUCER_NOT_FUNCTION: "PREFLIGHT-015",
    PREFLIGHT_CONFIGURE_STORE_MISSING: "PREFLIGHT-016",
    PREFLIGHT_CONFIGURE_STORE_NOT_FUNCTION: "PREFLIGHT-017",
    PREFLIGHT_GET_ROUTES_MISSING: "PREFLIGHT-018",
    PREFLIGHT_GET_ROUTES_NOT_FUNCTION: "PREFLIGHT-019",
    PREFLIGHT_CUSTOM_DOCUMENT_MISSING: "PREFLIGHT-020",
    PREFLIGHT_CUSTOM_DOCUMENT_NOT_FUNCTION: "PREFLIGHT-021",
    PREFLIGHT_BUILD_STALE: "PREFLIGHT-022",

    PROCESS_SERVER_INIT_FAILED: "PROCESS-001",
    PROCESS_USER_HOOK_FAILED: "PROCESS-002",

    BUNDLE_UPSTREAM_ERROR: "BUNDLE-000",
    IOS_UPSTREAM_ERROR: "IOS-000",
    IOS_SIMULATOR_APP_NOT_FOUND: "IOS-001",
    IOS_XCODE_NOT_INSTALLED: "IOS-002",
    IOS_XCODE_SETUP_PENDING: "IOS-003",
    IOS_SIMULATOR_RUNTIME_MISSING: "IOS-004",
    IOS_APP_ICON_INVALID: "IOS-005",
    IOS_APP_ICON_HAS_ALPHA: "IOS-006",
    IOS_RELEASE_PRIVATE_HOST: "IOS-007",
    IOS_MISSING_BUILD_NUMBER: "IOS-008",
    IOS_INVALID_BUILD_NUMBER: "IOS-009",
    IOS_SIGNING_NOT_SET_UP: "IOS-010",
    IOS_ASC_API_KEY_INVALID: "IOS-011",
    IOS_MANUAL_SIGNING_INVALID: "IOS-012",
    IOS_EXPORT_METHOD_INVALID: "IOS-013",
    ANDROID_UPSTREAM_ERROR: "ANDROID-000",
    ANDROID_EMULATOR_BOOT_TIMEOUT: "ANDROID-001",
    ANDROID_RELEASE_PRIVATE_HOST: "ANDROID-002",
    ANDROID_RELEASE_BUILD_NUMBER_MISSING: "ANDROID-003",
    ANDROID_INVALID_BUILD_NUMBER: "ANDROID-004",
    ANDROID_UPLOAD_KEY_MISSING: "ANDROID-005",
    ANDROID_UPLOAD_KEY_INVALID: "ANDROID-006",
    ANDROID_JDK_NOT_FOUND: "ANDROID-007",
    ANDROID_SDK_SETUP_NEEDS_CONSENT: "ANDROID-008",
    ANDROID_CMDLINE_TOOLS_INSTALL_FAILED: "ANDROID-009",
    ANDROID_APP_ICON_INVALID: "ANDROID-010",

    RUNTIME_NATIVE_PERMISSION_DENIED: "RUNTIME-NATIVE-001",
    RUNTIME_NATIVE_PERMISSION_REQUIRED: "RUNTIME-NATIVE-002",
    RUNTIME_NATIVE_NETWORK_UNAVAILABLE: "RUNTIME-NATIVE-003",
    RUNTIME_NATIVE_DOWNLOAD_FAILED: "RUNTIME-NATIVE-004",
    RUNTIME_NATIVE_FILE_NOT_FOUND: "RUNTIME-NATIVE-005",
    RUNTIME_NATIVE_FILE_TOO_LARGE: "RUNTIME-NATIVE-006",
    RUNTIME_NATIVE_STORAGE_FULL: "RUNTIME-NATIVE-007",
    RUNTIME_NATIVE_FILE_CORRUPTED: "RUNTIME-NATIVE-008",
    RUNTIME_NATIVE_OPERATION_CANCELLED: "RUNTIME-NATIVE-009",
    RUNTIME_NATIVE_NO_FILE_SELECTED: "RUNTIME-NATIVE-010",
    RUNTIME_NATIVE_INVALID_FILE_TYPE: "RUNTIME-NATIVE-011",
    RUNTIME_NATIVE_INVALID_PARAMETERS: "RUNTIME-NATIVE-012",
    RUNTIME_NATIVE_BRIDGE_UNAVAILABLE: "RUNTIME-NATIVE-013",
    RUNTIME_NATIVE_FEATURE_UNSUPPORTED: "RUNTIME-NATIVE-014",
    RUNTIME_NATIVE_INTERNAL_ERROR: "RUNTIME-NATIVE-015",
    RUNTIME_NATIVE_CAMERA_UNAVAILABLE: "RUNTIME-NATIVE-016",
    RUNTIME_NATIVE_CAMERA_IN_USE: "RUNTIME-NATIVE-017",

    RUNTIME_NATIVE_BRIDGE_INVALID_CALLBACK: "RUNTIME-NATIVE-018",
    RUNTIME_NATIVE_BRIDGE_HANDLER_NOT_REGISTERED: "RUNTIME-NATIVE-019",
    RUNTIME_NATIVE_BRIDGE_HANDLER_THREW: "RUNTIME-NATIVE-020",
    RUNTIME_NATIVE_BRIDGE_INVALID_REGISTRATION: "RUNTIME-NATIVE-021",
    RUNTIME_NATIVE_BRIDGE_INIT_FAILED: "RUNTIME-NATIVE-022",

    RUNTIME_WEB_RENDER_FAILED: "RUNTIME-WEB-001",
    RUNTIME_WEB_FETCHER_FAILED: "RUNTIME-WEB-002",
    RUNTIME_WEB_SERVER_SIDE_FUNCTION_FAILED: "RUNTIME-WEB-003",
    RUNTIME_WEB_REQUEST_HANDLING_FAILED: "RUNTIME-WEB-004",

    AI_UPSTREAM_ERROR: "AI-000",
    AI_DISABLED: "AI-001",
    AI_PROVIDER_NOT_CONFIGURED: "AI-002",
    AI_INVALID_REQUEST_BODY: "AI-003",
    AI_NATIVE_BRIDGE_UNAVAILABLE: "AI-004",
    AI_NATIVE_STREAM_NOT_READY: "AI-005",
    AI_NATIVE_REQUEST_FAILED: "AI-006",
    AI_NATIVE_CALLBACK_ERROR: "AI-007",
    AI_WEB_WORKER_UNAVAILABLE: "AI-008",
    AI_WEB_WORKER_CRASHED: "AI-009",
}

// One entry per catalyst-owned code. Foreign/wrapped errors (see wrapForeignError)
// intentionally do not get an entry here beyond their per-stage wrapper code —
// we don't author docs or specific meanings for errors we don't originate.
export const ERROR_DEFINITIONS = {
    [ERROR_CODES.PREFLIGHT_CONFIG_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "config not found in config folder",
        defaultDetails: "A config object must be exported from the config folder in your project root.",
        suggestedAction:
            "Create config/config.json (or config/index.js) exporting the required config object.",
    },
    [ERROR_CODES.PREFLIGHT_CONFIG_NOT_OBJECT]: {
        category: "PREFLIGHT",
        defaultMessage: "config export is not an object",
        defaultDetails: "The config folder must export a plain object.",
        suggestedAction: "Ensure config/config.json exports an object, not a string, array, or function.",
    },
    [ERROR_CODES.PREFLIGHT_CONFIG_KEY_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "required key missing inside config.json",
        defaultDetails: "config.json is missing one or more required keys.",
        suggestedAction:
            "Add the missing key to config.json. See the config.json reference in the framework docs.",
    },
    [ERROR_CODES.PREFLIGHT_PACKAGE_JSON_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "package.json not found in the project",
        defaultDetails: "A package.json must exist in the project root directory.",
        suggestedAction: "Run this command from the project root, or restore package.json.",
    },
    [ERROR_CODES.PREFLIGHT_PACKAGE_JSON_INVALID]: {
        category: "PREFLIGHT",
        defaultMessage: "package.json should be defined in project root directory",
        defaultDetails: "package.json exists but could not be parsed as an object.",
        suggestedAction: "Check package.json for valid JSON syntax.",
    },
    [ERROR_CODES.PREFLIGHT_MODULE_ALIAS_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "moduleAliases not found in package.json",
        defaultDetails: "package.json must export a moduleAliases object.",
        suggestedAction: "Add a moduleAliases object to package.json.",
    },
    [ERROR_CODES.PREFLIGHT_MODULE_ALIAS_NOT_OBJECT]: {
        category: "PREFLIGHT",
        defaultMessage: "moduleAliases named object should be exported from package.json",
        defaultDetails: "moduleAliases was found in package.json but is not an object.",
        suggestedAction: "Ensure moduleAliases is exported as an object in package.json.",
    },
    [ERROR_CODES.PREFLIGHT_MODULE_ALIAS_RESTRICTED]: {
        category: "PREFLIGHT",
        defaultMessage: "catalyst keyword is restricted for defining aliases",
        defaultDetails: "Module alias keys containing 'catalyst' are reserved by the framework.",
        suggestedAction: "Rename the alias to something that does not contain 'catalyst'.",
    },
    [ERROR_CODES.PREFLIGHT_MODULE_ALIAS_KEY_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "required module alias not defined inside package.json",
        defaultDetails: "One or more required module aliases are missing from moduleAliases.",
        suggestedAction: "Add the missing alias to the moduleAliases object in package.json.",
    },
    [ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "preServerInit named function should be defined in server/index.js",
        defaultDetails: "server/index.js must export a preServerInit function.",
        suggestedAction:
            "Export a preServerInit function from server/index.js, or remove the reference to it.",
    },
    [ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "preServerInit should be a function present in server/index.js",
        defaultDetails: "preServerInit was found but is not a function.",
        suggestedAction: "Ensure preServerInit is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_MIDDLEWARE_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "addMiddlewares named function not found in server/server.js",
        defaultDetails: "server/server.js must export an addMiddlewares function.",
        suggestedAction: "Export an addMiddlewares function from server/server.js.",
    },
    [ERROR_CODES.PREFLIGHT_MIDDLEWARE_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "addMiddlewares should be a function present in server/server.js",
        defaultDetails: "addMiddlewares was found but is not a function.",
        suggestedAction: "Ensure addMiddlewares is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_REDUCER_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "reducer not found in src/js/containers/App/reducer",
        defaultDetails: "A reducer must be exported from src/js/containers/App/reducer.",
        suggestedAction: "Export a reducer from src/js/containers/App/reducer.",
    },
    [ERROR_CODES.PREFLIGHT_REDUCER_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "reducer should be present in src/js/containers/App/reducer",
        defaultDetails: "The reducer export was found but is not a function.",
        suggestedAction: "Ensure the reducer is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "configureStore not found in file src/js/store/index.js",
        defaultDetails: "src/js/store/index.js must export a configureStore function.",
        suggestedAction: "Export a configureStore function from src/js/store/index.js.",
    },
    [ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "configureStore should be a function exported from src/js/store/index.js",
        defaultDetails: "configureStore was found but is not a function.",
        suggestedAction: "Ensure configureStore is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_GET_ROUTES_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "getRoutes not found in file src/js/routes/utils.js",
        defaultDetails: "src/js/routes/utils.js must export a getRoutes function.",
        suggestedAction: "Export a getRoutes function from src/js/routes/utils.js.",
    },
    [ERROR_CODES.PREFLIGHT_GET_ROUTES_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "getRoutes should be a function exported from src/js/routers/index.js",
        defaultDetails: "getRoutes was found but is not a function.",
        suggestedAction: "Ensure getRoutes is exported as a function.",
    },
    [ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_MISSING]: {
        category: "PREFLIGHT",
        defaultMessage: "document not found in file server/document.js",
        defaultDetails: "server/document.js must export a document component.",
        suggestedAction: "Export a document React component from server/document.js.",
    },
    [ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_NOT_FUNCTION]: {
        category: "PREFLIGHT",
        defaultMessage: "document should be a react component exported from server/document.js",
        defaultDetails: "document was found but is not a function/component.",
        suggestedAction: "Ensure document is exported as a React component (function).",
    },
    [ERROR_CODES.PREFLIGHT_BUILD_STALE]: {
        category: "PREFLIGHT",
        defaultMessage: "The build is stale: config/config.json changed since it was built",
        defaultDetails:
            "PUBLIC_STATIC_ASSET_URL, PUBLIC_STATIC_ASSET_PATH and the CLIENT_ENV_VARIABLES values are inlined into the bundles at build time, so serving this build would use the old values.",
        suggestedAction: "Run `npm run build` again, then `npm run serve`.",
    },

    [ERROR_CODES.PROCESS_SERVER_INIT_FAILED]: {
        category: "PROCESS",
        defaultMessage: "preServerInit threw an error during server startup",
        defaultDetails:
            "The preServerInit hook failed. Note: server startup currently continues despite this error (tracked separately as a fix — see issue #298); this code only identifies which hook failed.",
        suggestedAction: "Fix the error thrown inside your preServerInit hook (see the cause above).",
    },
    [ERROR_CODES.PROCESS_USER_HOOK_FAILED]: {
        category: "PROCESS",
        defaultMessage: "A user-defined hook threw an error",
        defaultDetails:
            "A user-defined hook (e.g. onRouteMatch, onFetcherError, onServerError) threw. It was caught so the SSR pipeline keeps running; see the cause above for which hook and why.",
        suggestedAction: "Fix the error thrown inside the hook (see the cause above).",
    },

    [ERROR_CODES.BUNDLE_UPSTREAM_ERROR]: {
        category: "BUNDLE",
        defaultMessage: "Build failed in an upstream bundler step",
        defaultDetails:
            "This is a wrapper around an error from Vite/Rollup or another upstream build tool. See the printed upstream code/message for the actual cause — catalyst-core does not reinterpret it.",
        suggestedAction: "Read the upstream error message/code printed above and fix the underlying issue.",
    },
    [ERROR_CODES.IOS_UPSTREAM_ERROR]: {
        category: "IOS",
        defaultMessage: "iOS build failed in an upstream toolchain step",
        defaultDetails:
            "This wraps an error from Xcode/CocoaPods. See the printed upstream output for the cause.",
        suggestedAction:
            "Read the upstream Xcode/CocoaPods error printed above and fix the underlying issue.",
    },
    [ERROR_CODES.IOS_SIMULATOR_APP_NOT_FOUND]: {
        category: "IOS",
        defaultMessage: "Could not find an installed iOS Simulator app",
        defaultDetails:
            "Neither DeviceHub.app (Xcode 27+, bundle id com.apple.dt.Devices) nor the legacy Simulator.app (bundle id com.apple.iphonesimulator) is installed under Xcode's Contents/Applications. The simulator itself may still boot headlessly via simctl, but catalyst-core cannot open or focus its window.",
        suggestedAction:
            "Confirm a full Xcode.app (not just Command Line Tools) is installed and selected via xcode-select -p, then reopen it once from Spotlight so macOS registers its app bundle.",
    },
    // The messages and suggested actions of IOS-002..006 are copied into
    // src/native/utils.js NATIVE_ERRORS; test/native/releaseConfig.test.ts
    // keeps the two equal.
    [ERROR_CODES.IOS_XCODE_NOT_INSTALLED]: {
        category: "IOS",
        defaultMessage: "Full Xcode is not installed or selected",
        defaultDetails:
            "setupEmulator:ios and buildApp:ios need Xcode.app, not only the Command Line Tools. xcode-select -p does not point inside an Xcode app bundle, so there is no simulator, iOS SDK or app-building xcodebuild.",
        suggestedAction:
            "Install Xcode from the Mac App Store, then run sudo xcode-select -s /Applications/Xcode.app/Contents/Developer.",
    },
    [ERROR_CODES.IOS_XCODE_SETUP_PENDING]: {
        category: "IOS",
        defaultMessage: "Xcode setup is not finished",
        defaultDetails:
            "The Xcode licence has not been accepted or its first-launch components are not installed, so xcodebuild and simctl refuse to run. Both steps need an administrator password, so they only run after a yes in an interactive terminal.",
        suggestedAction:
            "Run sudo xcodebuild -license accept and sudo xcodebuild -runFirstLaunch, then retry.",
    },
    [ERROR_CODES.IOS_SIMULATOR_RUNTIME_MISSING]: {
        category: "IOS",
        defaultMessage: "No iOS simulator runtime installed",
        defaultDetails:
            "Xcode has no available iOS simulator runtime, so there is no simulator to create or boot. The runtime is a download of several gigabytes and is only fetched after a yes in an interactive terminal or with --yes.",
        suggestedAction:
            "Run catalyst setupEmulator:ios in a terminal or with --yes, or run xcodebuild -downloadPlatform iOS yourself.",
    },
    [ERROR_CODES.IOS_APP_ICON_INVALID]: {
        category: "IOS",
        defaultMessage: "App icon is not usable",
        defaultDetails:
            "public/icon.png becomes the app's single 1024x1024 universal AppIcon, so it must be a PNG file, square, and at least 1024 by 1024 pixels.",
        suggestedAction:
            "Replace public/icon.png with a square PNG of at least 1024x1024 pixels, or add the sized icons in public/ios/appIcons.",
    },
    [ERROR_CODES.IOS_APP_ICON_HAS_ALPHA]: {
        category: "IOS",
        defaultMessage: "App icon has transparency",
        defaultDetails:
            "App Store Connect rejects app icons with an alpha channel (ITMS-90717). public/icon.png has an alpha channel or a transparency chunk, which fails an iOS release build. Debug builds only warn.",
        suggestedAction:
            "Export public/icon.png without an alpha channel (flatten it onto a solid background), then rebuild.",
    },
    // IOS-007..013 are copied into src/native/utils.js NATIVE_ERRORS too.
    [ERROR_CODES.IOS_RELEASE_PRIVATE_HOST]: {
        category: "IOS",
        defaultMessage: "Release build points at a local or private host",
        defaultDetails:
            "An iOS release build (buildApp:ios --release, or ios.buildType release) would open a start URL on localhost, a loopback, private (RFC 1918), link-local or .local address, or this machine's own address. Devices of App Store users can never reach it. The start URL comes from WEBVIEW_CONFIG.release merged over the base config.",
        suggestedAction:
            "Set WEBVIEW_CONFIG.release.LOCAL_IP (and port/useHttps) to your production host, or set WEBVIEW_CONFIG.release.allowPrivateHost to true for an internal app on a private network.",
    },
    [ERROR_CODES.IOS_MISSING_BUILD_NUMBER]: {
        category: "IOS",
        defaultMessage: "Release build has no build number",
        defaultDetails:
            "Every build uploaded to App Store Connect needs a CFBundleVersion higher than the last one for that version. A release build takes it from --build-number, then CATALYST_BUILD_NUMBER, then WEBVIEW_CONFIG.ios.version.buildNumber, and none of them is set.",
        suggestedAction:
            "Pass --build-number <n>, set CATALYST_BUILD_NUMBER in CI, or set WEBVIEW_CONFIG.ios.version.buildNumber.",
    },
    [ERROR_CODES.IOS_INVALID_BUILD_NUMBER]: {
        category: "IOS",
        defaultMessage: "Invalid build number",
        defaultDetails:
            "The build number becomes CFBundleVersion (CURRENT_PROJECT_VERSION). It must be a whole number from 1 to 2100000000.",
        suggestedAction:
            "Use a whole number from 1 to 2100000000 that is higher than the last one you uploaded for this version.",
    },
    [ERROR_CODES.IOS_SIGNING_NOT_SET_UP]: {
        category: "IOS",
        defaultMessage: "iOS code signing is not set up",
        defaultDetails:
            "A device or release build needs a signing identity and provisioning profile. Automatic signing needs WEBVIEW_CONFIG.ios.developmentTeam plus either an App Store Connect API key or an Apple account signed in to Xcode; manual signing needs ios.provisioningProfile or the CI signing variables. xcodebuild reported a signing failure, or a release build has no team to sign for.",
        suggestedAction:
            "Set WEBVIEW_CONFIG.ios.developmentTeam and an App Store Connect API key (ios.ascApiKey, or CATALYST_ASC_KEY_PATH or CATALYST_ASC_KEY_BASE64 with CATALYST_ASC_KEY_ID and CATALYST_ASC_ISSUER_ID) for automatic signing, or sign manually with ios.provisioningProfile, or in CI with CATALYST_IOS_P12_BASE64, CATALYST_IOS_P12_PASSWORD and CATALYST_IOS_PROFILE_BASE64.",
    },
    [ERROR_CODES.IOS_ASC_API_KEY_INVALID]: {
        category: "IOS",
        defaultMessage: "App Store Connect API key settings are incomplete or wrong",
        defaultDetails:
            "Automatic signing without Xcode uses an App Store Connect API key, which takes three values: the .p8 key file, its key ID and the issuer ID. Some of them are set but not all, or the key file does not exist.",
        suggestedAction:
            "Give all three of the key file (ios.ascApiKey.path, CATALYST_ASC_KEY_PATH or CATALYST_ASC_KEY_BASE64), the key ID (ios.ascApiKey.keyId or CATALYST_ASC_KEY_ID) and the issuer ID (ios.ascApiKey.issuerId or CATALYST_ASC_ISSUER_ID).",
    },
    [ERROR_CODES.IOS_MANUAL_SIGNING_INVALID]: {
        category: "IOS",
        defaultMessage: "Manual signing inputs are incomplete or wrong",
        defaultDetails:
            "CI signing imports a .p12 into a temporary keychain and installs a provisioning profile for the build. Only one of CATALYST_IOS_P12_BASE64 and CATALYST_IOS_PROFILE_BASE64 is set, the p12 or its password is wrong, the p12 has no code signing identity, or the profile is unreadable, expired or for another bundle ID.",
        suggestedAction:
            "Set CATALYST_IOS_P12_BASE64 (a base64 .p12 holding the distribution certificate and its private key), CATALYST_IOS_P12_PASSWORD and CATALYST_IOS_PROFILE_BASE64 (a base64 .mobileprovision for WEBVIEW_CONFIG.ios.appBundleId), and check that they belong together.",
    },
    [ERROR_CODES.IOS_EXPORT_METHOD_INVALID]: {
        category: "IOS",
        defaultMessage: "Unknown iOS export method",
        defaultDetails:
            "WEBVIEW_CONFIG.ios.exportMethod picks how the release archive is exported to an IPA. Xcode 26 accepts app-store-connect, release-testing, enterprise and debugging; the older names app-store, ad-hoc and development are mapped to them with a warning.",
        suggestedAction:
            "Set WEBVIEW_CONFIG.ios.exportMethod to app-store-connect (the default), release-testing, enterprise or debugging.",
    },
    [ERROR_CODES.ANDROID_UPSTREAM_ERROR]: {
        category: "ANDROID",
        defaultMessage: "Android build failed in an upstream toolchain step",
        defaultDetails: "This wraps an error from Gradle. See the printed upstream output for the cause.",
        suggestedAction: "Read the upstream Gradle error printed above and fix the underlying issue.",
    },
    [ERROR_CODES.ANDROID_EMULATOR_BOOT_TIMEOUT]: {
        category: "ANDROID",
        defaultMessage: "Timed out waiting for the Android emulator to boot",
        defaultDetails:
            "buildApp:android launched the configured AVD but it did not appear in `adb devices` or did not finish booting (sys.boot_completed=1 and init.svc.bootanim=stopped) within the timeout.",
        suggestedAction:
            "Try booting the AVD manually first (emulator -avd <name>) to see the actual startup error, check available disk space/RAM, or increase the emulator's cold-boot allowance if the device is unusually slow.",
    },
    // The messages and suggested actions of ANDROID-002..006 are copied into
    // src/native/utils.js NATIVE_ERRORS (the CJS native subtree can't import
    // this module); test/native/releaseConfig.test.ts keeps the two equal.
    [ERROR_CODES.ANDROID_RELEASE_PRIVATE_HOST]: {
        category: "ANDROID",
        defaultMessage: "Release build points at a local or private host",
        defaultDetails:
            "The release start URL, built from WEBVIEW_CONFIG.release merged over WEBVIEW_CONFIG (useHttps, LOCAL_IP, port), names localhost, a loopback, RFC 1918, link-local or .local address, or this machine's own address. Users' devices cannot reach it, so the store build would open on an error page.",
        suggestedAction:
            "Set WEBVIEW_CONFIG.release.LOCAL_IP (and port/useHttps) to your production host, or set WEBVIEW_CONFIG.release.allowPrivateHost to true for an internal app on a private network.",
    },
    [ERROR_CODES.ANDROID_RELEASE_BUILD_NUMBER_MISSING]: {
        category: "ANDROID",
        defaultMessage: "Release build has no build number",
        defaultDetails:
            "Google Play needs a new, higher versionCode for every upload. None was given through --build-number, the CATALYST_BUILD_NUMBER environment variable, or WEBVIEW_CONFIG.android.version.buildNumber.",
        suggestedAction:
            "Pass --build-number <n>, set CATALYST_BUILD_NUMBER in CI, or set WEBVIEW_CONFIG.android.version.buildNumber.",
    },
    [ERROR_CODES.ANDROID_INVALID_BUILD_NUMBER]: {
        category: "ANDROID",
        defaultMessage: "Invalid build number",
        defaultDetails:
            "The build number becomes the app's versionCode, which must be a whole number from 1 to 2100000000 (the largest value Google Play accepts).",
        suggestedAction:
            "Use a whole number from 1 to 2100000000 that is higher than the last one you uploaded.",
    },
    [ERROR_CODES.ANDROID_UPLOAD_KEY_MISSING]: {
        category: "ANDROID",
        defaultMessage: "No upload key for the release build",
        defaultDetails:
            "A release build signs the app bundle with the app's upload key. None was found at credentials/android/upload.jks, android.signing.storeFile or CATALYST_ANDROID_KEYSTORE_BASE64, and a new key is only created after a yes in an interactive terminal.",
        suggestedAction:
            "Run the release build once in a terminal to create credentials/android/upload.jks, or in CI set CATALYST_ANDROID_KEYSTORE_BASE64 and CATALYST_ANDROID_STORE_PASSWORD (plus CATALYST_ANDROID_KEY_ALIAS and CATALYST_ANDROID_KEY_PASSWORD when they differ from the defaults).",
    },
    [ERROR_CODES.ANDROID_UPLOAD_KEY_INVALID]: {
        category: "ANDROID",
        defaultMessage: "Upload key settings are incomplete or wrong",
        defaultDetails:
            "An upload keystore was found but cannot be used: its file is missing, no store password was given, or keytool rejected the password or alias.",
        suggestedAction:
            "Check credentials/android/keystore.properties, or the CATALYST_ANDROID_* environment variables, against the keystore.",
    },
    // ANDROID-007..010 are copied into src/native/utils.js NATIVE_ERRORS too.
    [ERROR_CODES.ANDROID_JDK_NOT_FOUND]: {
        category: "ANDROID",
        defaultMessage: "Java 17 or newer not found",
        defaultDetails:
            "Gradle and the Android SDK tools need JDK 17 or newer. None was found in JAVA_HOME, /usr/libexec/java_home or Android Studio's bundled runtime, and installing one with Homebrew needs a yes in an interactive terminal on macOS.",
        suggestedAction:
            "Install JDK 17 or newer (macOS: brew install --cask zulu@17; Linux: your distribution's openjdk-17-jdk package) and set JAVA_HOME, or run catalyst setupEmulator:android in a terminal to install it.",
    },
    [ERROR_CODES.ANDROID_SDK_SETUP_NEEDS_CONSENT]: {
        category: "ANDROID",
        defaultMessage: "Android SDK setup needs your confirmation",
        defaultDetails:
            "setupEmulator:android found Android SDK pieces to download (command-line tools, packages or a system image), an emulator to create, or SDK licences to accept. Downloads only happen after a yes in an interactive terminal or with --yes, and licences are only accepted interactively or with --accept-licenses.",
        suggestedAction:
            "Run catalyst setupEmulator:android in a terminal, or pass --yes to allow the downloads and --accept-licenses to accept the Android SDK licences (for CI).",
    },
    [ERROR_CODES.ANDROID_CMDLINE_TOOLS_INSTALL_FAILED]: {
        category: "ANDROID",
        defaultMessage: "Could not install the Android command-line tools",
        defaultDetails:
            "The pinned Android command-line tools archive could not be downloaded, did not match its published SHA-256, or could not be unpacked into <sdk>/cmdline-tools/latest.",
        suggestedAction:
            "Check your network or proxy and retry, or download the command-line tools from https://developer.android.com/studio#command-tools and unzip them so that <sdk>/cmdline-tools/latest/bin/sdkmanager exists.",
    },
    [ERROR_CODES.ANDROID_APP_ICON_INVALID]: {
        category: "ANDROID",
        defaultMessage: "App icon is not usable",
        defaultDetails:
            "public/icon.png becomes the Android launcher icon when public/android/appIcons has no per-density icons, so it must be a PNG file, square, and at least 1024 by 1024 pixels.",
        suggestedAction:
            "Replace public/icon.png with a square PNG of at least 1024x1024 pixels, or add per-density icons in public/android/appIcons.",
    },

    [ERROR_CODES.RUNTIME_NATIVE_PERMISSION_DENIED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Permission denied",
        defaultDetails: "Required permission was not granted by the user",
        suggestedAction: "Grant permission in device settings and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_PERMISSION_REQUIRED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Permission required",
        defaultDetails: "This operation requires additional permissions",
        suggestedAction: "Grant the required permission to continue",
    },
    [ERROR_CODES.RUNTIME_NATIVE_NETWORK_UNAVAILABLE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "No internet connection",
        defaultDetails: "Network connection is required for this operation",
        suggestedAction: "Check your internet connection and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_DOWNLOAD_FAILED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Download failed",
        defaultDetails: "The download could not be completed",
        suggestedAction: "Check your connection and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_FILE_NOT_FOUND]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "File not found",
        defaultDetails: "The requested file could not be located",
        suggestedAction: "The file may have been moved or deleted",
    },
    [ERROR_CODES.RUNTIME_NATIVE_FILE_TOO_LARGE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "File too large",
        defaultDetails: "File exceeds the maximum size limit",
        suggestedAction: "Choose a smaller file or compress the current file",
    },
    [ERROR_CODES.RUNTIME_NATIVE_STORAGE_FULL]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Storage full",
        defaultDetails: "Device storage is full and cannot save the file",
        suggestedAction: "Free up some storage space and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_FILE_CORRUPTED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "File corrupted",
        defaultDetails: "The file could not be read or is corrupted",
        suggestedAction: "Try selecting a different file",
    },
    [ERROR_CODES.RUNTIME_NATIVE_OPERATION_CANCELLED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Operation cancelled",
        defaultDetails: "The operation was cancelled by the user",
        suggestedAction: "Try again if you want to complete the operation",
    },
    [ERROR_CODES.RUNTIME_NATIVE_NO_FILE_SELECTED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "No file selected",
        defaultDetails: "No file was selected by the user",
        suggestedAction: "Select a file and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_INVALID_FILE_TYPE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Invalid file type",
        defaultDetails: "The selected file type is not supported",
        suggestedAction: "Choose a file with a supported format",
    },
    [ERROR_CODES.RUNTIME_NATIVE_INVALID_PARAMETERS]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Invalid parameters",
        defaultDetails: "One or more parameters passed to the native call were invalid",
        suggestedAction: "Check the parameters passed to the native API call",
    },
    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_UNAVAILABLE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Native feature unavailable",
        defaultDetails: "The native bridge is not available or not initialized",
        suggestedAction: "Use web fallback if available",
    },
    [ERROR_CODES.RUNTIME_NATIVE_FEATURE_UNSUPPORTED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Feature not supported",
        defaultDetails: "This feature is not supported on the current platform",
        suggestedAction: "Try using an alternative method or device",
    },
    [ERROR_CODES.RUNTIME_NATIVE_INTERNAL_ERROR]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "An unexpected error occurred",
        defaultDetails: "An internal error occurred while processing the request",
        suggestedAction: "Try again or contact support if the problem persists",
    },
    [ERROR_CODES.RUNTIME_NATIVE_CAMERA_UNAVAILABLE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Camera unavailable",
        defaultDetails: "Camera hardware is not available or accessible",
        suggestedAction: "Check if your device has a camera and try again",
    },
    [ERROR_CODES.RUNTIME_NATIVE_CAMERA_IN_USE]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Camera in use",
        defaultDetails: "Camera is being used by another application",
        suggestedAction: "Close other camera apps and try again",
    },

    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_INVALID_CALLBACK]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Invalid callback interface",
        defaultDetails:
            "The native platform invoked WebBridge.callback() with an interface name that isn't recognized.",
        suggestedAction:
            "Check the interface name against the registered NATIVE_CALLBACKS list; this usually indicates a native/JS version mismatch.",
    },
    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_HANDLER_NOT_REGISTERED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "No handler registered for this bridge interface",
        defaultDetails:
            "Native sent a callback for this interface, but your webview hasn't registered a handler for it yet.",
        suggestedAction: "Call WebBridge.register() for this interface before native calls arrive.",
    },
    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_HANDLER_THREW]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "A registered bridge callback handler threw",
        defaultDetails:
            "The JS handler registered for this native callback interface threw an error while processing the callback.",
        suggestedAction: "Fix the error thrown inside the registered handler (see the cause above).",
    },
    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_INVALID_REGISTRATION]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "Invalid bridge callback registration",
        defaultDetails:
            "WebBridge.register() was called with a non-function callback or an unrecognized interface name.",
        suggestedAction: "Pass a function as the callback and a valid interface name from NATIVE_CALLBACKS.",
    },
    [ERROR_CODES.RUNTIME_NATIVE_BRIDGE_INIT_FAILED]: {
        category: "RUNTIME-NATIVE",
        defaultMessage: "WebBridge could not be initialized",
        defaultDetails: "WebBridge.init() was called outside a browser environment (no `window` available).",
        suggestedAction: "Call WebBridge.init() in a browser environment, before using bridge features.",
    },

    [ERROR_CODES.AI_UPSTREAM_ERROR]: {
        category: "AI",
        defaultMessage: "AI provider request failed",
        defaultDetails:
            "This is a wrapper around a non-2xx response or thrown error from the upstream AI provider (OpenAI/Gemini). See the printed upstream status/message for the actual cause — catalyst-ai does not reinterpret it.",
        suggestedAction:
            "Read the upstream provider error printed above and fix the underlying issue (auth, rate limit, invalid request).",
    },
    [ERROR_CODES.AI_DISABLED]: {
        category: "AI",
        defaultMessage: "AI is disabled",
        defaultDetails: "AI_CONFIG.enabled is not set to true.",
        suggestedAction: "Set AI_CONFIG.enabled=true in your environment configuration.",
    },
    [ERROR_CODES.AI_PROVIDER_NOT_CONFIGURED]: {
        category: "AI",
        defaultMessage: "AI provider not configured",
        defaultDetails:
            "The requested provider is unknown, or has no apiKey configured in AI_CONFIG.providers.",
        suggestedAction: "Add the provider's apiKey to AI_CONFIG.providers, or use a configured provider.",
    },
    [ERROR_CODES.AI_INVALID_REQUEST_BODY]: {
        category: "AI",
        defaultMessage: "Invalid AI request body",
        defaultDetails:
            "The request body is missing a non-empty messages array, or no model could be resolved.",
        suggestedAction: "Pass a non-empty messages array, and either a model or a provider defaultModel.",
    },
    [ERROR_CODES.AI_NATIVE_BRIDGE_UNAVAILABLE]: {
        category: "AI",
        defaultMessage: "Native AI bridge unavailable",
        defaultDetails:
            "window.NativeBridge.initAI or window.WebBridge was not found when useNativeAI mounted.",
        suggestedAction:
            "Update catalyst-core to >=0.2.0, add the native AI module, and call WebBridge.init() before mounting useNativeAI.",
    },
    [ERROR_CODES.AI_NATIVE_STREAM_NOT_READY]: {
        category: "AI",
        defaultMessage: "Native AI stream not ready",
        defaultDetails:
            "generate() was called before the native side reported a ready stream URL (initAI has not fired ON_AI_READY yet).",
        suggestedAction: "Wait for modelReady to become true before calling generate().",
    },
    [ERROR_CODES.AI_NATIVE_REQUEST_FAILED]: {
        category: "AI",
        defaultMessage: "Native AI request failed",
        defaultDetails:
            "The native AI HTTP endpoint returned a non-ok status or reported an error in its response body.",
        suggestedAction: "See the cause above for the native-reported status/message.",
    },
    [ERROR_CODES.AI_NATIVE_CALLBACK_ERROR]: {
        category: "AI",
        defaultMessage: "Native AI reported an error",
        defaultDetails:
            "The native platform invoked ON_AI_ERROR — a failure during model load, init, or inference on the native side, not an HTTP request made by this JS code.",
        suggestedAction: "See the cause above for the native-reported message.",
    },
    [ERROR_CODES.AI_WEB_WORKER_UNAVAILABLE]: {
        category: "AI",
        defaultMessage: "Web AI worker unavailable",
        defaultDetails:
            "Constructing the module Worker for in-browser AI failed — module workers may be unsupported in this browser.",
        suggestedAction: "Use a browser with module Worker support, or fall back to useCloudAI/useNativeAI.",
    },
    [ERROR_CODES.AI_WEB_WORKER_CRASHED]: {
        category: "AI",
        defaultMessage: "Web AI worker crashed",
        defaultDetails:
            "The in-browser AI worker threw during model load or generation (e.g. all device backends failed, or an uncaught exception). See the cause above for the worker's reported message.",
        suggestedAction:
            "Check that the model is compatible with this browser/device, or use useCloudAI/useNativeAI instead.",
    },

    [ERROR_CODES.RUNTIME_WEB_RENDER_FAILED]: {
        category: "RUNTIME-WEB",
        defaultMessage: "Rendering failed on the server",
        defaultDetails:
            "An error was thrown while streaming or rendering the document on the server. This may originate from app code, a third-party dependency, or catalyst-core itself — see the cause above for the actual error.",
        suggestedAction: "See the cause above for the error thrown during rendering.",
    },
    [ERROR_CODES.RUNTIME_WEB_FETCHER_FAILED]: {
        category: "RUNTIME-WEB",
        defaultMessage: "serverFetcher failed",
        defaultDetails:
            "An error was thrown while executing a route's serverFetcher function(s). This may originate from app code, a third-party dependency, or catalyst-core itself — see the cause above for the actual error.",
        suggestedAction: "See the cause above for the error thrown inside serverFetcher.",
    },
    [ERROR_CODES.RUNTIME_WEB_SERVER_SIDE_FUNCTION_FAILED]: {
        category: "RUNTIME-WEB",
        defaultMessage: "App.serverSideFunction failed",
        defaultDetails:
            "An error was thrown while executing the app-level serverSideFunction hook. This may originate from app code, a third-party dependency, or catalyst-core itself — see the cause above for the actual error.",
        suggestedAction: "See the cause above for the error thrown inside serverSideFunction.",
    },
    [ERROR_CODES.RUNTIME_WEB_REQUEST_HANDLING_FAILED]: {
        category: "RUNTIME-WEB",
        defaultMessage: "Failed to handle document request",
        defaultDetails:
            "An unhandled error reached the top level of the SSR request handler. This may originate from app code, a third-party dependency, or catalyst-core itself — see the cause above for the actual error.",
        suggestedAction: "See the cause above for the underlying error.",
    },
}

export function getDefinition(code) {
    if (ERROR_DEFINITIONS[code]) return ERROR_DEFINITIONS[code]
    // Fall back to a generic definition for unrecognized codes, but never
    // inherit the fallback's own category — that would mislabel an unknown
    // code as RUNTIME-NATIVE in verbose/debug output, which is misleading
    // rather than merely imprecise.
    return { ...ERROR_DEFINITIONS[ERROR_CODES.RUNTIME_NATIVE_INTERNAL_ERROR], category: "UNKNOWN" }
}

export function getDocUrl(code) {
    const def = ERROR_DEFINITIONS[code]
    if (!def) return null
    return `${REPO_BLOB_BASE}/${def.category}/${code}.md`
}
