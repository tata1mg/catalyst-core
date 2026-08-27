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
    // tracedServerDataFetcher can't reject. It DOES appear — mislabeled — on
    // the document-throw cascade (see RUNTIME-WEB-001 scenario note), but a
    // scenario asserting that mislabel would enshrine the bug as contract.
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
}

export default scenarios
