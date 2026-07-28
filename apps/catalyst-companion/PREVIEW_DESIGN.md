# Catalyst Companion — "Try Your App" Preview Flow

Design for letting a developer scan a QR code from their running Catalyst app
and load it inside Catalyst Companion with full native bridge access —
Catalyst's answer to Expo Go, built on primitives Catalyst already ships.

## Core mechanism

Companion is a **superset Catalyst binary**: every supported plugin compiled
in, all corresponding permissions declared, `google-services` applied,
notifications + Google Sign-In wired — everything the build pipeline can
already produce for a normal Catalyst app, produced once for Companion
itself. A scan doesn't unlock a capability; it *selects and parameterizes*
among capabilities that are already physically present in the binary. This
is the same shape as Expo Go's fixed-SDK model, reached from the other
direction.

The scanned app's config is written to a runtime-readable overlay location
(not baked into the APK/IPA), and Companion restarts / reconstructs its
WebView to pick it up — the same pattern many game engines use for
config-driven client behavior.

```
CATALYST APP TODAY (unchanged, for reference)
──────────────────────────────────────────────
MainActivity
   → creates customWebView
   → addJavascriptInterface(NativeBridge)
   → addJavascriptInterface(PluginBridge)
   → reads webview_config.properties (assets/, baked at build time)
   → loads currentUrl
        ↓
   client/index.js → WebBridge.init()
        ↓
   window.NativeBridge / window.PluginBridge callable from JS
```

The bridge is a property of *the WebView MainActivity constructs*, not of
the URL it happens to load. Nothing about `PreviewActivity` today is a
different kind of WebView — it is a second, deliberately stripped instance
that skips `addJavascriptInterface` entirely. Routing the scanned URL
through the real `customWebView` construction path, instead of a separate
preview surface, is what gives the scanned app the bridge for free.

## End-to-end flow

```
 DEV MACHINE                              COMPANION APP
 ───────────                              ─────────────
 npm run start
   --experiment companion-app <debug|release>
        │
        ├─ debug:   dev server on LAN_IP:port
        │           QR encodes {LOCAL_IP, port, useHttps: false,
        │                       manifest: [...declared plugins]}
        │
        └─ release: app already deployed
                    QR encodes {url: "https://…",
                                manifest: [...declared plugins]}
        │
        ▼
   [ QR code printed to terminal ]

                                           user taps "Try Your App"
                                                    │
                                                    ▼
                                           camera opens (existing
                                           useVideoStream QR path)
                                                    │
                                              scan hits QR
                                                    │
                                                    ▼
                                   ┌─────────────────────────────────┐
                                   │ DECODED CONFIG SCREEN            │
                                   │  • target origin / LOCAL_IP:port │
                                   │  • declared plugins requested    │
                                   │  • ⚠ missing-in-Companion plugins│
                                   │    (compiled-set vs manifest     │
                                   │     diff, computed here)         │
                                   │  • Catalyst-core version, with   │
                                   │    drift warning if applicable   │
                                   └─────────────────────────────────┘
                                                    │
                                            [Open Preview]
                                                    │
                                                    ▼
                                   ┌─────────────────────────────────┐
                                   │ CONFIRM DIALOG                   │
                                   │  "This will load <origin> with   │
                                   │   full app access. For testing   │
                                   │   only — not affiliated with     │
                                   │   Catalyst."                     │
                                   │            [Cancel]  [Continue]  │
                                   └─────────────────────────────────┘
                                                    │ Continue
                                                    ▼
                                   write overlay config → filesDir
                                   (Android: self-restart process)
                                   (iOS: reconstruct WKWebView,
                                    shared WKProcessPool /
                                    WKWebsiteDataStore retained)
                                                    │
                                                    ▼
                                   MainActivity boots exactly like a
                                   real Catalyst app:
                                     customWebView created
                                     → NativeBridge attached
                                     → PluginBridge attached
                                     → overlay config read
                                     → scanned app's URL loaded
                                                    │
                                                    ▼
                                   ┌─────────────────────────────────┐
                                   │ scanned app running, full bridge │
                                   │ ── persistent native banner ──── │
                                   │   "Catalyst Companion · Preview" │
                                   │  (drawn above WebView; page      │
                                   │   cannot hide/restyle it)        │
                                   └─────────────────────────────────┘
                                                    │
                                shake device  OR  tap banner
                                                    │
                                                    ▼
                                   ┌─────────────────────────────────┐
                                   │ BOTTOM SHEET                     │
                                   │  "Exit preview and return to     │
                                   │   Companion?"                    │
                                   │            [Cancel]  [Exit]      │
                                   └─────────────────────────────────┘
                                                    │ Exit
                                                    ▼
                                   delete overlay config → restart
                                   (Android) / reconstruct WKWebView
                                   with original Companion config
                                   (iOS) → back to Landing/TryApp
```

## Phasing

The boundary is **the store review, not implementation effort.** Anything
touching native code, `Info.plist`, `AndroidManifest.xml`, or Gradle forces
a second store submission if deferred — so it goes in Phase 1 regardless of
how small it is. Phase 2 is strictly what's expressible against the Phase 1
binary with no rebuild.

### Phase 1 — ships in the submitted binary

| Item | Notes |
|---|---|
| Superset plugin compilation | Scoped deliberately (see Critical Decisions) — not reflexively "every plugin," to limit 2.5.2 / privacy-manifest exposure |
| Config overlay reader (Android) | Merge `filesDir` overlay over `assets/webview_config.properties` at `MainActivity` startup |
| Config overlay reader (iOS) | **New code** — `ConfigConstants.swift` is compiled-in only today; needs a runtime-readable fallback (plist/JSON in `Documents/`) checked before compiled defaults |
| Cleartext / network-security-config (Android) | Required for LAN `http://LOCAL_IP:port` debug QR |
| ATS exception + `NSLocalNetworkUsageDescription` (iOS) | Same, iOS side |
| `catalyst-companion://` URL scheme + intent-filter (Android) | Cold deep link — external tap can launch straight into a preview, not just in-app QR scan |
| URL scheme registration (iOS) | Same |
| Native preview banner | Layered above WebView, safe-area/notch aware; page cannot hide it |
| Native bottom sheet (exit/clear) | Wired to shake gesture **on both platforms** — only iOS has shake handling today, Android needs it added |
| Self-restart primitive (Android) | Verify a clean full-process restart exists or add one — `WebView.setDataDirectorySuffix` is process-once, a half-restart will corrupt storage isolation |
| Re-runnable bridge-attach + WKWebView-construct path (iOS) | iOS never restarts the process, so this path is exercised repeatedly across scans in one lifetime — needs an explicit test, not an assumption |
| Emitted build-time constants | Compiled plugin ID list + Catalyst-core version, baked in so Phase 2 has something to diff against |
| Decoded-config screen + confirm dialog (native chrome) | Gates a native action (restart / bridge attach), so the dialog itself ships now even though its content can evolve in Phase 2 |

### Phase 2 — ships anytime after, no rebuild required

| Item | Notes |
|---|---|
| QR manifest schema evolution | New config keys consumed by code already shipped in Phase 1 |
| Version-drift comparison logic + UI | Reads the constant Phase 1 emitted; Phase 1 only emits, Phase 2 compares and renders |
| Capability-diff toast copy/UX polish | Set-diff logic can ship in Phase 1; presentation polish is Phase 2 |
| Companion's own web screens | Landing / TryApp / Showcase iteration — pure web, ships independent of any store review |
| Config-only WebView property additions | User-agent, custom headers, etc. — new payload keys read by code already in the binary |

## UI / layout changes ("feels native")

Same native-vs-web split as phasing above.

**Native chrome (Phase 1, because it's native code):**
- Preview banner: thin strip near the status bar/notch, always drawn above
  the WebView as a sibling view (Android: layout addition in
  `MainActivity`; iOS: `UIView` pinned above `WKWebView`, respecting safe
  area). Not part of the page — cannot be hidden or restyled by loaded
  content.
- Bottom sheet for exit/clear, triggered by shake (both platforms) or tap
  on the banner.
- Decoded-config screen and confirm dialog render as native surfaces, not
  web pages — they gate a native action and must be trustworthy
  independent of any web content.

**Web chrome (Phase 2, iterate freely):**
- Existing `.app-screen` / `app-screen-bar` / `shell-only` / `web-only` /
  `data-shell` conventions already used by `TryApp.js` extend naturally —
  no new shell system needed.
- `/app` stays the top-level companion-home route with its own chrome,
  separate from the docs navbar, per the existing route table
  (`src/js/routes/index.js`).

## Critical decisions

1. **Plugin superset scope.** Compile in *every* plugin (maximizes
   coverage, maximizes 2.5.2 / privacy-manifest review risk) vs. a
   defensible named subset with real purpose strings (lower risk, but
   adding a plugin later means another Phase-1-style rebuild). Must be
   decided before submission — unwindable only by another review cycle.

2. **App Store review risk (Guideline 2.5.2).** Apple has repeatedly
   delayed/rejected Expo Go itself under "apps may not download or execute
   code that changes app behavior." Companion's scan → load-remote-JS →
   attach-bridge flow is the same shape. Mitigations already in the design
   (persistent banner, explicit confirm dialog, Companion not being
   *solely* a code-execution shell) reduce but do not eliminate this risk.
   Submission notes should address it explicitly rather than hope it's not
   flagged.

3. **Trust gate model.** Settled as confirm-once-per-scan + persistent
   banner, not an allowlist or account/project system. Revisit only if a
   store rejects on these grounds — do not build allowlist/account infra
   speculatively.

4. **Android self-restart correctness.** Must be a full, clean process
   restart. `WebView.setDataDirectorySuffix` / `ProcessGlobalConfig` are
   documented as process-once; a partial restart risks silently breaking
   storage isolation between the trusted and preview contexts.

5. **iOS repeated bridge-attach lifecycle.** Since iOS cannot
   self-relaunch, the construct → attach-bridge → load → teardown cycle
   must be proven safe to run many times within a single process lifetime
   (memory, WKProcessPool/WKWebsiteDataStore reuse, listener cleanup) —
   this is new ground, not something today's single-shot
   `PreviewViewController` had to handle.

6. **Version-drift signal granularity.** Plugin-presence diffing (compiled
   vs. declared) is already sufficient for "missing plugin" warnings, but
   does not catch API-shape drift within a plugin both sides have. Needs a
   `catalystCoreVersion`/`apiVersion` field added to plugin manifests (or
   confirmation one already exists elsewhere) before Phase 2's drift UI is
   meaningful.
