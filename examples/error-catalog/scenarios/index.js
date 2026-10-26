import { preflightScenarios } from "./preflight.js"
import { processScenarios } from "./process.js"
import { runtimeWebScenarios } from "./runtime-web.js"
import { bundleScenarios } from "./bundle.js"
import { ccaScenarios } from "./cca.js"
import { buildNativeScenarios } from "./build-native.js"
import { mappingScenarios } from "./mapping.js"
import { clientScenarios } from "./client.js"
import { aiScenarios } from "./ai.js"

export const scenarios = [
    ...preflightScenarios,
    ...processScenarios,
    ...runtimeWebScenarios,
    ...bundleScenarios,
    ...ccaScenarios,
    ...buildNativeScenarios,
    ...mappingScenarios,
    ...clientScenarios,
    ...aiScenarios,
]

export const LEDGER = {
    // ── RUNTIME-WEB ─────────────────────────────────────────────────────────
    // RUNTIME-WEB-001 IS reproducible — see scenarios/runtime-web.js (a
    // throwing document.js fires it via the renderToPipeableStream onError
    // callback). Not listed here.
    //
    // RUNTIME-WEB-002 (logSSRError("FETCHER", error)) never fires for a real
    // serverFetcher failure: fetchRouteData catches those into routeData.error
    // and Promise.allSettled stops any throw escaping, so
    // tracedServerDataFetcher can't reject. (It used to appear, mislabeled, on
    // the document-throw cascade; #535 reports a render failure once.)
    "RUNTIME-WEB-002": "not-example-reproducible",
    // ── CCA ─────────────────────────────────────────────────────────────────
    // CCA-000 wraps a foreign upstream error (npm/tar/etc.); needs a genuinely
    // broken toolchain to fire — not reliably reproducible from a scenario.
    "CCA-000": "not-example-reproducible",
    // CCA-003: cli.cjs validateOptions() checks `cmd.lang` (throws CCA-003) but
    // never registers a `--lang`/`-l` option, so the check is unreachable dead
    // code. Reproducible only after adding the option upstream.
    "CCA-003": "not-example-reproducible",
    // CCA-006/007/008: pack / template-extraction / MCP-setup failures. Each
    // needs a corrupted tarball or a broken MCP dependency to fire; no
    // deterministic dev mistake produces them from a clean checkout.
    "CCA-006": "not-example-reproducible",
    "CCA-007": "not-example-reproducible",
    "CCA-008": "not-example-reproducible",
    // ── AI ──────────────────────────────────────────────────────────────────
    // AI-004 IS reproducible — see scenarios/client.js + test/ai-hooks.test.ts
    // (mount useNativeAI in jsdom with no window.NativeBridge).
    //
    // AI-005 (stream not ready), AI-006 (native request failed), AI-007 (native
    // reported an error), AI-009 (web worker crashed): each needs a native/
    // worker bridge that first mounts successfully, then fails at a specific
    // later phase. Driving that means scripting a fake bridge through multiple
    // callback stages — the test would assert the mock's behaviour, not a
    // developer mistake. Covered instead by the native bridge suites.
    "AI-005": "not-example-reproducible",
    "AI-006": "not-example-reproducible",
    "AI-007": "not-example-reproducible",
    // AI-008 (web worker unavailable): new Worker() throwing is the trigger.
    // jsdom provides a partial Worker that neither throws nor loads the module
    // worker, so the code path can't be driven deterministically here.
    "AI-008": "not-example-reproducible",
    "AI-009": "not-example-reproducible",
    // ── ANDROID ─────────────────────────────────────────────────────────────
    // ANDROID-001 (emulator boot timeout) requires an actual AVD that fails to
    // boot within the timeout window — not reproducible by breaking config the
    // way ANDROID-000 is, and CI runners here don't have the Android SDK/an AVD
    // available to drive a real (or realistically stalled) boot.
    "ANDROID-001": "not-example-reproducible",
    // ANDROID-005 (no upload key) and ANDROID-006 (unusable upload key) are
    // raised after the Android tools are validated, so they need a real SDK
    // with adb on the runner. Covered by test/native/androidSigning.test.ts in
    // catalyst-core.
    "ANDROID-005": "not-example-reproducible",
    "ANDROID-006": "not-example-reproducible",
    // ANDROID-007..009 come from setupEmulator:android's toolchain setup
    // (JDK, SDK downloads/licences, cmdline-tools checksum). Which of them
    // fires depends on what the runner already has installed (GitHub's
    // ubuntu image ships a JDK and an SDK), so no config mistake reproduces
    // them deterministically. ANDROID-010 (bad public/icon.png) is raised
    // while assets are copied, after the SDK is validated. All four are
    // covered by test/native/androidToolchain.test.ts and appIcon.test.ts.
    "ANDROID-007": "not-example-reproducible",
    "ANDROID-008": "not-example-reproducible",
    "ANDROID-009": "not-example-reproducible",
    "ANDROID-010": "not-example-reproducible",
    // ── IOS ─────────────────────────────────────────────────────────────────
    // IOS-001 (no Simulator/DeviceHub app installed) requires the actual
    // absence of Xcode's Simulator.app/DeviceHub.app on the host — not
    // reproducible by breaking config the way IOS-000 is, and CI runners here
    // are Linux (no Xcode at all) so this can never fire in this environment
    // either way.
    "IOS-001": "not-example-reproducible",
    // IOS-002..004 (no full Xcode, Xcode licence/first launch pending, no
    // simulator runtime) and IOS-005/006 (bad or transparent public/icon.png,
    // checked during the Xcode build) need macOS with Xcode; the runners here
    // are Linux. Covered by test/native/iosToolchain.test.ts and
    // appIcon.test.ts in catalyst-core.
    "IOS-002": "not-example-reproducible",
    "IOS-003": "not-example-reproducible",
    "IOS-004": "not-example-reproducible",
    "IOS-005": "not-example-reproducible",
    "IOS-006": "not-example-reproducible",
}

export default scenarios
