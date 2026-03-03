'use strict';
const fs   = require('fs');
const path = require('path');
const { makeProjectHelpers, versionOlderThan } = require('../lib/helpers');

// Tasks that require a minimum catalyst-core version.
// Key = task ID, value = { minVersion, reason, upgradeNote }
const VERSION_GATES = {
  T7b_NATIVE_SCRIPTS: {
    minVersion: '0.0.3-canary.7',
    reason: 'Native build scripts (buildApp:android, buildApp:ios, setupEmulator) were added in canary.7.',
    upgradeNote: 'Update catalyst-core to ^0.0.3-canary.7 or later and run npm install.',
  },
  T8_CLIENT_ENTRY: {
    minVersion: '0.1.0-canary.1',
    reason: 'WebBridge and the universal client entry pattern (WebBridge.init() + clientRouter) require canary.1+.',
    upgradeNote: 'Update catalyst-core to ^0.1.0-canary.1 or later and run npm install. Also ensure client/index.js follows the new template pattern.',
  },
};

let _projectInfo;
let _conversionTasks;

function init(projectInfo, conversionTasks) {
  _projectInfo    = projectInfo;
  _conversionTasks = conversionTasks;
}

// ── get_conversion_status ────────────────────────────────────────────────────

function handle_get_conversion_status({ project_path, include_not_applicable = false } = {}) {
  const root = project_path || _projectInfo.dir;
  const { fileExists, readJson, readText, grepSrc } = makeProjectHelpers(root);

  // ── Version gate: read installed catalyst-core version ────────────────────
  const installedVersion = _projectInfo.installedVersion || null;

  // ── Load project state once ────────────────────────────────────────────────
  const config      = readJson('config/config.json');
  const webviewConfig = config && config.WEBVIEW_CONFIG ? config.WEBVIEW_CONFIG : null;
  const pkg         = readJson('package.json') || _projectInfo.pkg;
  const allDeps     = { ...pkg.dependencies, ...pkg.devDependencies };

  // ── Per-task detectors (3-step model) ─────────────────────────────────────
  //
  // Each detector returns one of:
  //   { status: 'completed', note? }
  //   { status: 'gap',            native_risk, reason, files? }
  //   { status: 'needs_review',   native_risk, reason, review_context }
  //   { status: 'not_applicable', reason }
  //   { status: 'blocked',        blocked_by }
  //
  // Step 1 — feature_present:  is this web feature used at all?
  // Step 2 — risk_assessment:  what's the usage pattern? (derives native_risk from code)
  // Step 3 — mitigation_check: is the risk already handled?

  const detectors = {

    // ── Tier 1: Critical (always applicable — these are structural) ──────────

    T1_CONFIG: () => {
      if (!config) return { status: 'gap', native_risk: 'App will not start — catalyst-core requires config/config.json at boot.', reason: 'config/config.json not found' };
      const missing = ['NODE_SERVER_PORT', 'WEBVIEW_CONFIG', 'API_URL'].filter(k => config[k] === undefined);
      if (missing.length) return { status: 'gap', native_risk: `Missing required fields will cause build or runtime failures: ${missing.join(', ')}.`, reason: `Missing fields: ${missing.join(', ')}` };
      return { status: 'completed' };
    },

    T2_ROUTER_DEP: () => {
      if (!allDeps['@tata1mg/router']) return { status: 'gap', native_risk: 'react-router-dom does not support SSR + hydration required by catalyst-core. App routing will break on native.', reason: '@tata1mg/router not in package.json dependencies' };
      return { status: 'completed' };
    },

    T3_ROUTES_FILE: () => {
      const text = readText('src/js/routes/index.js');
      if (!text) return { status: 'gap', native_risk: 'catalyst-core expects a static route array for SSR. Without it, server-side rendering fails and native app shell cannot hydrate.', reason: 'src/js/routes/index.js not found' };
      const hasArray = /const\s+\w+\s*=\s*\[[\s\S]*?\]\s*\n[\s\S]*export default\s+\w+|export default\s*\[|module\.exports\s*=\s*\[/.test(text);
      if (!hasArray) return { status: 'gap', native_risk: 'Route file exists but no route array found — RouterDataProvider cannot build the route tree.', reason: 'src/js/routes/index.js exists but does not export a route array' };
      return { status: 'completed' };
    },

    T4_DATA_FETCHING: () => {
      const useEffectFiles = grepSrc('useEffect.*fetch|useEffect.*axios|useEffect.*\\.get\\(|useEffect.*\\.post\\(');
      const fetcherFiles   = grepSrc('\\.serverFetcher\\s*=|\\.clientFetcher\\s*=');
      if (useEffectFiles.length === 0) return { status: 'completed' };
      return {
        status: 'needs_review',
        native_risk: 'useEffect+fetch for page data works on web but breaks SSR hydration in catalyst-core. Native app will have blank pages or hydration mismatches on first load.',
        reason: `${useEffectFiles.length} file(s) with useEffect+fetch patterns. Review: are these unconverted page-level data loads or legitimate side effects?`,
        review_context: {
          question: 'Do the files using useEffect for data fetching represent unconverted page-level data loading, or are they legitimate non-page effects (timers, subscriptions, animations)?',
          what_correct_looks_like: 'Page components have .serverFetcher or .clientFetcher static functions attached. useEffect is only used for side effects (subscriptions, DOM mutations, timers), not initial data loads.',
          what_gap_looks_like: 'Page components (in src/js/pages/ or src/js/containers/) call fetch/axios inside useEffect to load initial data, with no .serverFetcher or .clientFetcher attached.',
          signal_files: {
            old_pattern_files: useEffectFiles,
            converted_files:   fetcherFiles,
          },
        },
      };
    },

    T5_ROUTER_DATA_PROVIDER: () => {
      const text = readText('src/js/routes/utils.js');
      if (!text) return { status: 'gap', native_risk: 'Without RouterDataProvider, useCurrentRouteData() returns undefined in all components. Data-dependent pages will crash.', reason: 'src/js/routes/utils.js not found' };
      if (!text.includes('RouterDataProvider')) return { status: 'gap', native_risk: 'utils.js exists but RouterDataProvider not wired in — same crash risk as missing file.', reason: 'utils.js exists but RouterDataProvider not used' };
      return { status: 'completed' };
    },

    T6_APP_SHELL: () => {
      const text = readText('src/js/containers/App/index.js');
      if (!text) return { status: 'gap', native_risk: 'App shell is required by catalyst-core SSR. Missing file means native app renders blank screen.', reason: 'src/js/containers/App/index.js not found' };
      if (!text.includes('Outlet')) return { status: 'gap', native_risk: '<Outlet /> is how catalyst-core injects SSR-rendered route content. Without it, all pages render empty inside the native shell.', reason: 'App/index.js exists but <Outlet /> not rendered' };
      return { status: 'completed' };
    },

    T7_SERVER_FILES: () => {
      const missing = ['server/index.js', 'server/server.js', 'server/document.js'].filter(f => !fileExists(f));
      if (missing.length) return { status: 'gap', native_risk: 'Missing server files prevent catalyst-core SSR from running. Native app will fail at boot with module-not-found errors.', reason: `Missing: ${missing.join(', ')}` };
      return { status: 'completed' };
    },

    T8_CLIENT_ENTRY: () => {
      const missing = ['client/index.js', 'client/styles.js'].filter(f => !fileExists(f));
      if (missing.length) return { status: 'gap', native_risk: 'Client entry files are required for hydration. Without them the native WebView loads server HTML but JS never hydrates — app is non-interactive.', reason: `Missing: ${missing.join(', ')}` };
      return { status: 'completed' };
    },

    // ── Tier 2: Native Build (always applicable once T1 passes) ─────────────

    T9_WEBVIEW_ANDROID: () => {
      if (!webviewConfig) return { status: 'gap', native_risk: 'No WEBVIEW_CONFIG — Android build cannot start.', reason: 'WEBVIEW_CONFIG missing (see T1_CONFIG)' };
      const android  = webviewConfig.android;
      if (!android) return { status: 'gap', native_risk: 'WEBVIEW_CONFIG.android block missing — catalyst-core cannot generate the Android project.', reason: 'WEBVIEW_CONFIG.android block missing' };
      const missing = ['buildType', 'sdkPath', 'emulatorName', 'appName'].filter(k => android[k] === undefined);
      if (missing.length) return { status: 'gap', native_risk: `Android build will fail or produce unnamed app. Missing: ${missing.join(', ')}.`, reason: `WEBVIEW_CONFIG.android missing fields: ${missing.join(', ')}` };
      return { status: 'completed' };
    },

    T10_WEBVIEW_IOS: () => {
      if (!webviewConfig) return { status: 'gap', native_risk: 'No WEBVIEW_CONFIG — iOS build cannot start.', reason: 'WEBVIEW_CONFIG missing (see T1_CONFIG)' };
      const ios = webviewConfig.ios;
      if (!ios) return { status: 'gap', native_risk: 'WEBVIEW_CONFIG.ios block missing — catalyst-core cannot generate the Xcode project.', reason: 'WEBVIEW_CONFIG.ios block missing' };
      const missing = ['buildType', 'appBundleId', 'simulatorName', 'appName'].filter(k => ios[k] === undefined);
      if (missing.length) return { status: 'gap', native_risk: `iOS build will fail or be rejected by App Store. Missing: ${missing.join(', ')}.`, reason: `WEBVIEW_CONFIG.ios missing fields: ${missing.join(', ')}` };
      return { status: 'completed' };
    },

    T11_ACCESS_CONTROL: () => {
      if (!webviewConfig) return { status: 'gap', native_risk: 'No WEBVIEW_CONFIG — access control cannot be configured.', reason: 'WEBVIEW_CONFIG missing (see T1_CONFIG)' };
      const ac = webviewConfig.accessControl;
      if (!ac) return { status: 'gap', native_risk: 'Without accessControl, the WebView allows navigation to any URL. Deep links or redirects could take users outside your app with no way back.', reason: 'WEBVIEW_CONFIG.accessControl block missing' };
      if (!ac.enabled) return { status: 'gap', native_risk: 'accessControl.enabled=false means URL allowlist is ignored — same risk as missing block.', reason: 'accessControl.enabled is not true' };
      if (!Array.isArray(ac.allowedUrls) || ac.allowedUrls.length === 0)
        return { status: 'gap', native_risk: 'allowedUrls is empty — ALL navigation URLs will be blocked including your own API calls. App will appear to hang on every network request.', reason: 'accessControl.allowedUrls is empty — ALL URLs will be blocked' };
      return { status: 'completed' };
    },

    T12_SPLASH_SCREEN: () => {
      if (!config) return { status: 'gap', native_risk: 'No config — splash screen config cannot be read.', reason: 'config/config.json not found' };
      if (!config.splashScreen) return { status: 'gap', native_risk: 'Without splashScreen config, native app shows a blank white screen during JS load. Not a crash, but poor UX and noticeable on slow devices.', reason: 'splashScreen key missing from top level of config/config.json (not inside WEBVIEW_CONFIG)' };
      const missing = ['public/android/splashscreen.png', 'public/ios/splashscreen.png'].filter(f => !fileExists(f));
      if (missing.length) return { status: 'gap', native_risk: 'Splash config exists but asset files missing — build will fail when packaging the native app.', reason: `Splash asset files missing: ${missing.join(', ')}` };
      return { status: 'completed' };
    },

    T13_ANDROID_ICONS: () => {
      const required = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].map(d => `public/android/appIcons/icon-${d}.png`);
      const missing  = required.filter(f => !fileExists(f));
      if (missing.length) return { status: 'gap', native_risk: 'Missing Android icon densities — build will fall back to bundled catalyst icon. Expected naming: icon-mdpi.png, icon-hdpi.png, icon-xhdpi.png, icon-xxhdpi.png, icon-xxxhdpi.png inside public/android/appIcons/.', reason: `Missing Android icons: ${missing.join(', ')}` };
      return { status: 'completed' };
    },

    T14_IOS_ICONS: () => {
      const required = [
        'icon-20x20-2x', 'icon-20x20-3x',
        'icon-29x29-2x', 'icon-29x29-3x',
        'icon-40x40-2x', 'icon-40x40-3x',
        'icon-60x60-2x', 'icon-60x60-3x',
        'icon-1024x1024-1x',
      ].map(name => `public/ios/appIcons/${name}.png`);
      const missing  = required.filter(f => !fileExists(f));
      if (missing.length) return { status: 'gap', native_risk: 'Missing iOS icon sizes — Xcode build may fail or App Store submission will be rejected. Expected naming: icon-{WxH}-{scale}.png e.g. icon-60x60-3x.png inside public/ios/appIcons/.', reason: `Missing iOS icons: ${missing.join(', ')}` };
      return { status: 'completed' };
    },

    T15_OFFLINE_HTML: () => {
      if (!fileExists('public/offline.html')) return { status: 'gap', native_risk: 'Without offline.html, the native WebView shows a system error page when the device goes offline. Bad UX; should show a branded offline screen.', reason: 'public/offline.html not found' };
      return { status: 'completed' };
    },

    // ── Tier 3: Enhancements (feature-presence gated) ───────────────────────

    T17a_USE_FILEPICKER: () => {
      const oldPatternFiles = grepSrc('<input[^>]*type=[\'"]file[\'"]');
      if (oldPatternFiles.length === 0) return { status: 'not_applicable', reason: 'No <input type="file"> found in project — file upload feature not used.' };
      const hookUsageFiles = grepSrc('useFilePicker');
      return {
        status: 'needs_review',
        native_risk: '<input type="file"> may work in some WebView configs but behaviour is inconsistent across Android/iOS versions. On Android, file picker may silently do nothing without proper WebView flags. useFilePicker guarantees native picker on both platforms.',
        reason: `${oldPatternFiles.length} file(s) with <input type="file"> found. Review: does useFilePicker exist in the component tree (hook may be in a parent)?`,
        review_context: {
          question: 'Do files with <input type=\'file\'> have a native branch using useFilePicker, or is the hook used somewhere in the component tree (parent passes execute/isNative as props)?',
          what_correct_looks_like: 'Component uses useFilePicker from catalyst-core/hooks. Checks isNative and calls execute() on native. May keep <input type=\'file\'> as web fallback only. Hook may live in a parent and be passed down as props.',
          what_gap_looks_like: '<input type=\'file\'> used directly with no useFilePicker anywhere in the component tree. No isNative check. No native branch.',
          signal_files: {
            old_pattern_files: oldPatternFiles,
            hook_usage_files:  hookUsageFiles,
          },
        },
      };
    },

    T17b_USE_CAMERA: () => {
      const oldPatternFiles = grepSrc('accept=[\'"]image[^>]*capture|<input[^>]+capture');
      if (oldPatternFiles.length === 0) return { status: 'not_applicable', reason: 'No camera capture inputs (<input capture>) found — camera feature not used.' };
      const hookUsageFiles = grepSrc('useCamera');
      return {
        status: 'needs_review',
        native_risk: 'Camera capture via <input capture> does NOT work reliably in native WebView. On iOS it may trigger the permission flow but fail silently. On Android it often does nothing. useCamera is required for guaranteed camera access with proper permission handling.',
        reason: `${oldPatternFiles.length} file(s) with camera capture inputs. Review: does useCamera exist in the component tree?`,
        review_context: {
          question: 'Do files with <input accept=\'image/*\' capture> have a native branch using useCamera, or is the hook in the component tree?',
          what_correct_looks_like: 'Component uses useCamera from catalyst-core/hooks. Checks isNative and calls takePhoto() on native. May keep capture input as web fallback.',
          what_gap_looks_like: '<input capture> used with no useCamera in component tree. No isNative check. No native camera branch.',
          signal_files: {
            old_pattern_files: oldPatternFiles,
            hook_usage_files:  hookUsageFiles,
          },
        },
      };
    },

    T18_USE_HAPTIC: () => {
      const oldPatternFiles = grepSrc('navigator\\.vibrate');
      if (oldPatternFiles.length === 0) return { status: 'not_applicable', reason: 'No navigator.vibrate() calls found — haptic feedback not used.' };
      const hookUsageFiles = grepSrc('useHapticFeedback');
      return {
        status: 'needs_review',
        native_risk: 'navigator.vibrate() is a web API that silently does nothing inside native WebView on both Android and iOS. The vibration call succeeds but the device never vibrates. useHapticFeedback routes to the native haptic engine.',
        reason: `${oldPatternFiles.length} file(s) with navigator.vibrate. Review: are these in active component code (gap) or test/polyfill files (acceptable)?`,
        review_context: {
          question: 'Are navigator.vibrate() calls unconverted haptic triggers, or are they in test files, comments, or polyfills?',
          what_correct_looks_like: 'useHapticFeedback imported from catalyst-core/hooks. trigger() called with type string. navigator.vibrate only appears in web polyfills (if at all).',
          what_gap_looks_like: 'navigator.vibrate() called directly in component or utility code with no useHapticFeedback import.',
          signal_files: {
            old_pattern_files: oldPatternFiles,
            hook_usage_files:  hookUsageFiles,
          },
        },
      };
    },

    T19_USE_NOTIFICATIONS: () => {
      if (!webviewConfig || !webviewConfig.notifications || !webviewConfig.notifications.enabled) {
        const pushFiles = grepSrc('firebase|FCM|pushNotif|useNotification');
        if (pushFiles.length === 0) return { status: 'not_applicable', reason: 'notifications.enabled not set and no push notification code found.' };
        return {
          status: 'gap',
          native_risk: 'Project appears to use push notifications but notifications.enabled is not set in WEBVIEW_CONFIG. Firebase integration will not be wired into the native build — push notifications will silently not work.',
          reason: `Push notification code found (${pushFiles.length} file(s)) but WEBVIEW_CONFIG.notifications.enabled is not true.`,
          files: pushFiles,
        };
      }
      const missing = ['google-services.json', 'GoogleService-Info.plist'].filter(f => !fileExists(f));
      if (missing.length) return { status: 'gap', native_risk: 'notifications.enabled=true but Firebase config files missing — native build will fail at compile time.', reason: `notifications.enabled=true but Firebase files missing: ${missing.join(', ')}` };
      return { status: 'completed' };
    },

    T20_USE_DEVICE_INFO: () => {
      const oldPatternFiles = grepSrc('navigator\\.userAgent|/Android/i\\.test|/iPhone/i\\.test|/iPad/i\\.test');
      if (oldPatternFiles.length === 0) return { status: 'not_applicable', reason: 'No navigator.userAgent / UA-sniffing found — platform detection not used.' };
      const correctPatternFiles = grepSrc('isNative|window\\.NativeBridge|nativeBridge\\.isAndroid|nativeBridge\\.isIOS');
      return {
        status: 'needs_review',
        native_risk: 'navigator.userAgent inside native WebView returns the WebView UA string, not Android/iOS. UA-sniffing for platform branching gives wrong results — features guarded by /Android/i.test() may never activate on native.',
        reason: `${oldPatternFiles.length} file(s) with UA-sniffing. Review: is this platform detection in component code (gap) or analytics/server code (acceptable)?`,
        review_context: {
          question: 'Are navigator.userAgent patterns used for platform detection in component/utility code, or in analytics, SSR utilities, or third-party code where UA is acceptable?',
          what_correct_looks_like: 'Platform detection uses isNative from catalyst hooks (e.g. const { isNative } = useNetworkStatus()), or window.NativeBridge presence for imperative code. navigator.userAgent only in analytics or server-side code.',
          what_gap_looks_like: 'Component or utility code branches UI/behavior on navigator.userAgent. Unreliable inside WebView.',
          signal_files: {
            old_pattern_files:     oldPatternFiles,
            correct_pattern_files: correctPatternFiles,
          },
        },
      };
    },
  };

  // ── Run all detectors, respect depends_on + version gates ─────────────────
  const taskMap = Object.fromEntries(_conversionTasks.map(t => [t.id, t]));
  const results = {};

  function runTask(id) {
    if (results[id]) return results[id];
    const task = taskMap[id];

    // Check version gate before anything else
    const gate = VERSION_GATES[id];
    if (gate && installedVersion && versionOlderThan(installedVersion, gate.minVersion)) {
      results[id] = {
        status: 'blocked_by_version',
        installed_version: installedVersion,
        required_version: gate.minVersion,
        reason: gate.reason,
        upgrade_note: gate.upgradeNote,
      };
      return results[id];
    }

    for (const dep of task.depends_on) {
      const depResult = runTask(dep);
      if (depResult.status !== 'completed' && depResult.status !== 'not_applicable') {
        results[id] = { status: 'blocked', blocked_by: dep };
        return results[id];
      }
    }
    const detector = detectors[id];
    results[id] = detector ? detector() : { status: 'gap', native_risk: 'Unknown', reason: 'No detector implemented' };
    return results[id];
  }

  for (const task of _conversionTasks) runTask(task.id);

  // ── Build output ───────────────────────────────────────────────────────────
  const completed          = [];
  const gaps               = [];
  const needs_review       = [];
  const blocked            = [];
  const blocked_by_version = [];
  const not_applicable     = [];

  for (const task of _conversionTasks) {
    const r = results[task.id];
    switch (r.status) {
      case 'completed':
        completed.push({ id: task.id, tier: task.tier, title: task.title, note: r.note || null });
        break;
      case 'blocked':
        blocked.push({ id: task.id, tier: task.tier, title: task.title, blocked_by: r.blocked_by });
        break;
      case 'blocked_by_version':
        blocked_by_version.push({
          id: task.id, tier: task.tier, title: task.title,
          installed_version: r.installed_version,
          required_version:  r.required_version,
          reason:            r.reason,
          upgrade_note:      r.upgrade_note,
        });
        break;
      case 'needs_review':
        needs_review.push({ id: task.id, tier: task.tier, title: task.title, native_risk: r.native_risk, reason: r.reason, review_context: r.review_context, fix_guide: task.fix_guide, depends_on: task.depends_on });
        break;
      case 'not_applicable':
        not_applicable.push({ id: task.id, tier: task.tier, title: task.title, reason: r.reason });
        break;
      default: // gap
        gaps.push({ id: task.id, tier: task.tier, title: task.title, native_risk: r.native_risk, reason: r.reason, files: r.files || null, fix_guide: task.fix_guide, depends_on: task.depends_on });
    }
  }

  const applicableTotal = _conversionTasks.length - not_applicable.length;
  const tierSummary = { 1: { total: 0, done: 0 }, 2: { total: 0, done: 0 }, 3: { total: 0, done: 0 } };
  for (const task of _conversionTasks) {
    if (results[task.id].status === 'not_applicable') continue;
    tierSummary[task.tier].total++;
    if (results[task.id].status === 'completed') tierSummary[task.tier].done++;
  }

  // Version banner — shown when any tasks are blocked by version
  const versionBanner = blocked_by_version.length > 0 ? {
    warning: `⚠️  catalyst-core version too old for ${blocked_by_version.length} task(s)`,
    installed: installedVersion || 'unknown',
    tasks_blocked: blocked_by_version.map(t => t.id),
    action: `Update catalyst-core in package.json to the required version and run npm install. After upgrading, run node .catalyst/mcp/setup.js to re-sync the knowledge base.`,
    upgrade_options: [
      'npm install catalyst-core@latest',
      'Or pin to specific: npm install github:tata1mg/catalyst-core#v0.1.0-canary.4',
    ],
  } : null;

  const output = {
    project:    pkg.name || root,
    scanned_at: new Date().toISOString(),
    catalyst_core_version: installedVersion || 'unknown',
    ...(versionBanner ? { version_warning: versionBanner } : {}),
    summary: {
      applicable_total:    applicableTotal,
      completed:           completed.length,
      gaps:                gaps.length,
      needs_review:        needs_review.length,
      blocked:             blocked.length,
      blocked_by_version:  blocked_by_version.length,
      not_applicable:      not_applicable.length,
      tier_1: `${tierSummary[1].done}/${tierSummary[1].total} critical`,
      tier_2: `${tierSummary[2].done}/${tierSummary[2].total} native build`,
      tier_3: `${tierSummary[3].done}/${tierSummary[3].total} enhancements`,
    },
    gaps,
    needs_review,
    blocked,
    blocked_by_version,
    completed,
  };

  if (include_not_applicable) output.not_applicable = not_applicable;
  return output;
}

// ── get_conversion_tasks ──────────────────────────────────────────────────────

function handle_get_conversion_tasks({ project_path, filter = 'all', include_not_applicable = false } = {}) {
  const status = handle_get_conversion_status({ project_path, include_not_applicable });

  const TIER_FILTERS = { all: null, critical: [1], native: [2], enhancements: [3] };
  const tierFilter   = TIER_FILTERS[filter] || null;
  const taskMap      = Object.fromEntries(_conversionTasks.map(t => [t.id, t]));

  function applyFilter(arr) {
    if (!tierFilter) return arr;
    return arr.filter(item => tierFilter.includes(taskMap[item.id]?.tier));
  }

  const actionable = applyFilter(status.gaps).map(g => {
    const task = taskMap[g.id];
    return { id: g.id, tier: task.tier, title: task.title, status: 'gap', native_risk: g.native_risk, reason: g.reason, files: g.files || null, fix_guide: task.fix_guide, how_to_check: task.how_to_check, depends_on: task.depends_on, blocked_by: null };
  });

  const reviewList = applyFilter(status.needs_review).map(r => {
    const task = taskMap[r.id];
    return { id: r.id, tier: task.tier, title: task.title, status: 'needs_review', native_risk: r.native_risk, reason: r.reason, review_context: r.review_context, fix_guide: task.fix_guide, how_to_check: task.how_to_check, depends_on: task.depends_on, blocked_by: null };
  });

  const blockedList = applyFilter(status.blocked).map(b => {
    const task = taskMap[b.id];
    return { id: b.id, tier: task.tier, title: task.title, status: 'blocked', reason: `Blocked by ${b.blocked_by} — fix that first`, files: null, fix_guide: task.fix_guide, how_to_check: task.how_to_check, depends_on: task.depends_on, blocked_by: b.blocked_by };
  });

  const blockedByVersionList = applyFilter(status.blocked_by_version || []).map(b => {
    const task = taskMap[b.id];
    return {
      id: b.id, tier: task.tier, title: task.title,
      status: 'blocked_by_version',
      reason: b.reason,
      installed_version: b.installed_version,
      required_version:  b.required_version,
      upgrade_note:      b.upgrade_note,
      fix_guide: task.fix_guide,
      how_to_check: task.how_to_check,
      depends_on: task.depends_on,
    };
  });

  const notApplicableList = include_not_applicable
    ? applyFilter(status.not_applicable || []).map(n => {
        const task = taskMap[n.id];
        return { id: n.id, tier: task.tier, title: task.title, status: 'not_applicable', reason: n.reason };
      })
    : [];

  return {
    project:    status.project,
    scanned_at: status.scanned_at,
    filter,
    summary: {
      total_gaps:                actionable.length,
      total_needs_review:        reviewList.length,
      total_blocked:             blockedList.length,
      total_blocked_by_version:  blockedByVersionList.length,
      total_not_applicable:      (status.not_applicable || []).length,
      completed:                 status.completed.length,
      overall:                   `${status.summary.completed}/${status.summary.applicable_total} applicable done`,
    },
    ...(status.version_warning ? { version_warning: status.version_warning } : {}),
    tasks: [...actionable, ...reviewList, ...blockedList, ...blockedByVersionList, ...notApplicableList],
  };
}

module.exports = { init, handle_get_conversion_status, handle_get_conversion_tasks };
