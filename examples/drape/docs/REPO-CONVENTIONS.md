# Repo conventions

Architectural patterns, philosophy, and institutional knowledge for this project. These are repo-wide — not feature-specific. Read this before making structural decisions.

## Data flow — API to component

### Parser philosophy
<!-- Greenfield — no parser layer wired yet. -->
<!-- Default convention as features are built: API responses pass through a per-feature `parser.js` that reshapes them for component consumption. The frontend shapes data for its own needs rather than mirroring the API. -->
<!-- /code-agent will populate this section as the first feature lands. -->

### State management
- **Library:** `@reduxjs/toolkit` 1.9.x with `react-redux` 8.x.
- **Store:** `src/js/store/index.js` builds the store with `combineReducers`, currently registering `shellReducer` from `src/js/containers/App/reducer.js`. Add new feature reducers there.
- **Async:** thunk middleware is configured with `extraArgument: { api }` where `api` is the fetch wrapper from `api.js`. Use `createAsyncThunk` and pull `api` off `extraArgument` rather than importing the fetcher directly inside thunks.
- **Slice convention:** colocate slices under `src/js/containers/<Feature>/reducer.js` and export `<feature>Reducer` from each.

## Routing

### Navigation model
- **Router:** `@tata1mg/router` (catalyst-core wrapper around React Router).
- **Client/server bridge:** `RouterDataProvider` + `RouterProvider` wrap the tree; `clientRouter` is hydrated from `window.__ROUTER_INITIAL_DATA__`.
- **Convention:** all in-app navigation must go through the router's `Link` (or `useNavigate`) — never use raw `<a href>` for internal routes, since that breaks SSR hydration.

### Route registration
- Routes live in `src/js/routes/index.js` as a flat array of `{ path, component, end? }` objects.
- `src/js/routes/utils.js` (`preparedRoutes`) wraps each route's component into `element` and injects the `App` shell + `RouterDataProvider`.
- **To add a route:** import the container at the top of `routes/index.js` and append to the `routes` array.

## Code splitting & SSR

- **Framework:** catalyst-core handles SSR + hydration. The client bootstraps in `client/index.js` via `loadableReady(...)` → `hydrateRoot`.
- **Lazy loading:** `@loadable/component` is installed but not yet used. Default convention: wrap route-level containers in `loadable(() => import(...))` once routes multiply.
- **`loadableReady` is required** before `hydrateRoot` — it ensures all chunks are present so server and client trees match. Don't skip it.
- **`serverSideFunction`:** containers can export a static `serverSideFunction` (see `containers/App/index.js`) which catalyst awaits during SSR. Use it for data prefetch on the server.

## Analytics
<!-- No analytics library wired yet. Decide between API-driven (ga_data on responses) or hardcoded events when first feature ships. -->

## Asset handling
- **Webpack bundle assets** (built JS/CSS chunks) are served at `/assets/` per `config/config.json` (`PUBLIC_STATIC_ASSET_PATH`, `PUBLIC_STATIC_ASSET_URL`). This namespace is owned by catalyst-core — don't put user-supplied files here.
- **User-supplied static files** (images, fonts, downloads): drop them under `public/` and reference via `/static/<path>`. The `/static` Express mount is registered in `server/server.js`. Example: `public/shoot-types/studio.png` → `<img src="/static/shoot-types/studio.png" />`. Don't try to serve from `/assets/` — requests will fall through to the SSR catch-all and return HTML instead of the file.
- **Design-side images:** `design/images/` holds AI-generated mockup images consumed by the .pen file — these are not shipped to production. When promoting a mock image to a real asset, copy it into `public/` (don't symlink — webpack and the catalyst dev server resolve through links and cache the wrong target).

## Styling architecture
- **Tailwind v4** via `@tailwindcss/postcss` (PostCSS plugin, not the legacy CLI). Tailwind classes are the default styling layer.
- **SCSS modules** for component-scoped styles — see `src/js/containers/Home/Home.scss` imported as `import css from "./Home.scss"`. Use this pattern when Tailwind isn't enough.
- **Global base styles:** `src/static/css/base/index.scss` is imported once via `client/styles.js`. It pulls in `tailwindcss` and any future global rules.
- **Design tokens:** `src/static/css/resources/_variables.scss` is empty today. As tokens are defined in `docs/DESIGN-TOKENS.md`, mirror them here as SCSS/CSS custom properties — every visual value in code must trace back to this file.
- **Aliases:** webpack module aliases are declared in `package.json` (`@containers`, `@css`, `@routes`, `@store`, `@api`, `@server`, `@config`). Use them — don't write `../../..` paths.

## Layout root

Every route container's outermost element is `<div className="screen">` — a global class defined in `src/static/css/base/styles.scss` that establishes a `min-height: 100dvh` flex column with a surface background. Inside that, the page builds its own header / body / footer flow.

There is **no** shared scroll wrapper, no `100dvh` overflow container, and no transformed ancestor of any sticky/fixed element. Document scroll handles overflow on every target (mobile Safari, mobile Chrome, iOS WebView, Android WebView, desktop). This keeps:

- `position: sticky` on the AppHeader behaving consistently across platforms (no transformed ancestor breaking the scroll port).
- `position: fixed` on the floating TabBar pinned to the viewport (not to a transformed inner container — which would cause iOS WebView to flash the `backdrop-filter` during route transitions).

If you find yourself reaching for `overflow-y: auto` on an inner wrapper, ask first — it almost certainly breaks one of the above.

## Framework notes
<!-- Repo-specific catalyst-core / @tata1mg/router gotchas. -->
<!-- /code-agent populates this as it discovers framework issues during implementation. -->

### catalyst-core iOS template ships with `aps-environment` entitlement on by default

**Symptom:** When opening `node_modules/catalyst-core/dist/native/iosnativeWebView/iosnativeWebView.xcodeproj` in Xcode and selecting a personal Apple ID team, signing fails with: *"Personal development teams ... do not support the Push Notifications capability."*

**What's already wired correctly:** `WEBVIEW_CONFIG.notifications.enabled` correctly gates the Firebase/notification deps in `Package.swift`. The catalyst script generates Package.swift conditionally on first run.

**Most common actual cause:** the template's `iosnativeWebView.entitlements` file hardcodes `aps-environment: development` regardless of `notifications.enabled`. Personal teams can't sign that capability.

**Recovery procedure:**
1. Edit `node_modules/catalyst-core/dist/native/iosnativeWebView/iosnativeWebView/iosnativeWebView.entitlements` and remove the `aps-environment` `<key>` and its `<string>` value. Keep `keychain-access-groups` — it's harmless.
2. In Xcode, after team selection, the Push Notifications row in *Signing & Capabilities* should disappear and signing succeeds.
3. **The fix is wiped by `npm install`** — same volatility caveat as iOS signing. Long-term, file an upstream issue with catalyst-core or use an `.xcconfig` override that points to a project-local entitlements file. Short-term, redo the edit after every `npm install`.

### `npm run buildApp:ios` auto-targets a wirelessly-paired iPhone

**Symptom:** `npm run buildApp:ios` reports *"Found device candidate: <iPhone name> - <UDID>"* and tries to build for that device, even though the iPhone isn't physically connected. Build fails on a personal Apple ID team because of the entitlements gotcha above.

**Cause:** Xcode's wireless device pairing keeps a previously-USB-paired iPhone visible to `xcodebuild` over Wi-Fi for as long as both are on the same network. The catalyst script's auto-detection picks the physical device over the simulator.

**Recovery procedure (any one):**
1. Easiest, no Xcode UI needed: unplug the iPhone *and* turn off its Wi-Fi (or take your laptop off Wi-Fi briefly), then re-run `buildApp:ios`. The script falls through to the simulator workflow.
2. Persistent: in Xcode → Window → Devices and Simulators → right-click the iPhone → **Unpair Device**. Survives until you re-pair.
3. Force a target: set `WEBVIEW_CONFIG.ios.simulatorName` in `config/config.json` and pass a UDID via the catalyst script's flags if it supports them; check `node_modules/catalyst-core/dist/scripts/build-ios.js` for current flags.

**Test workflow alternative:** if you only changed web code, you don't need a native rebuild at all. The iOS WebView app loads from the dev/serve server URL (`config/config.json` → `WEBVIEW_CONFIG.LOCAL_IP:port`); relaunching the installed app on the simulator is enough to pick up new web bundles. See the next note.

### Reload the simulator app without rebuilding the native target

**Pattern:** native rebuild via `buildApp:ios` is slow (~30s minimum). When iterating on React/CSS, just relaunch the already-installed app instead.

**Command:**
```sh
xcrun simctl terminate booted com.drape.app && xcrun simctl launch booted com.drape.app
```

**Why it works:** the catalyst-core iOS native app is a thin WKWebView shell pointing at the dev server URL embedded at build time. Terminate + relaunch makes the WebView reload that URL — same behavior as a hard reload in a browser, so any updated web bundle (`npm run start` HMR or a fresh `npm run build`) is picked up. The bundle ID `com.drape.app` is set in `config/config.json` → `WEBVIEW_CONFIG.ios.appBundleId`.

**Caveat:** this does not pick up changes to `WEBVIEW_CONFIG.LOCAL_IP` (e.g., when you change Wi-Fi networks) — that value is baked into the native bundle. Then a real `buildApp:ios` is required.

### Capturing iOS-specific issues for frame-by-frame analysis

iOS WebView rendering bugs (compositor flicker, animation desync, paint-vs-decode races) often fire faster than the eye can parse — especially during 320ms route transitions where the smoking-gun frame is one of ~10 paint frames in the cross-fade window.

**Workflow:**
1. **Record:** Simulator → File → Record Video. Saves a `.mov` to your Desktop.
2. **Extract frames:**
   ```sh
   ffmpeg -i "<recording>.mov" -vf "fps=60" /tmp/<slug>/d_%03d.png
   ```
   60fps is high enough to catch single-frame artifacts; 30fps misses them.
3. **Inspect:** open frames in any image viewer, or use `ls -la` on the directory — file sizes track visual change, so a sudden file-size jump or drop usually marks a transition boundary worth examining.

This was the workflow that finally surfaced the VTA snapshot/live-DOM desync bug behind the FadeImage flicker (commit `baf8e6b`); both the mechanism and the fix would have been impossible to identify from real-time observation.

### catalyst-core's WebView app loader masquerades as your React app

**Symptom:** when launching the iOS app on a fresh boot, you see a blue spinner with `10%` → `35%` → `41%` percentages, *not* your Welcome screen. Easy to misread as a React-side initialization issue.

**Cause:** that's catalyst-core's native WebView-bootstrapping animation, shown while the WKWebView is initializing and fetching the SSR HTML from the dev server. It clears once the WebView is ready and the page has rendered. Your React app hasn't run yet during that phase.

**Recovery:** wait for the spinner to clear before debugging. If it never clears: check that the dev/serve server is reachable from the simulator at `WEBVIEW_CONFIG.LOCAL_IP:port` (`curl -sI http://192.168.1.97:3005/` from your Mac is a quick sanity check; the simulator inherits the Mac's network).

### Three-tier smoke ladder for universal-app changes

The catalyst app ships to web AND iOS/Android WebView. Bugs surface at different layers; testing all three is wasteful, but skipping a layer lets bugs through. The ladder:

| Tier | Tool | Catches |
|------|------|---------|
| 1 | Playwright **Chromium** (`mcp__expect__open` default) | logic, state machines, dispatcher wiring, layout on a Blink engine, most regressions |
| 2 | Playwright **WebKit** (`mcp__expect__open({ url, browser: "webkit" })`) | iOS-Safari engine specifics — backdrop-filter, `position: fixed` + transforms, `@property`-animated CSS custom props, env() insets, decoder timing |
| 3 | iOS Simulator (`xcrun simctl ... com.drape.app`) | catalyst native bridge surface (camera, file picker, share, push), VTA snapshot/live-DOM races, WKWebView compositor quirks, the cases playwright-webkit can't reach because they need the `window.webkit.messageHandlers.NativeBridge` runtime |

**Default workflow during `/code-agent`:**
1. Smoke at tier 1 — fix everything that fails there.
2. Run a tier 2 pass at the same breakpoint as tier 1. Specifically check anything touching: animations, layout with stickies / fixed / blur, viewport units, color-with-alpha. WebKit will surface CSS quirks Chromium tolerates.
3. Reload the simulator app (`xcrun simctl terminate booted com.drape.app && xcrun simctl launch booted com.drape.app`) for a final pass on anything that goes through `useCamera` / `useFilePicker` / `useNotification` / any native bridge path. Tiers 1–2 cannot validate native bridge behavior because `window.WebBridge.isNative` is `false` in pure browsers.

The ladder is cumulative — tier 3 doesn't replace tiers 1–2. Most bugs caught at tier 1; tier 2 catches the second wave; tier 3 is the bridge-and-WebView-specific safety net.

### iOS-simulator self-verification loop (the playwright-on-iOS workflow)

The web iteration loop (`/code-agent` → playwright MCP → screenshot → read → adjust) doesn't have a direct equivalent for iOS, but a workable subset of it does — enough to catch rendering bugs without spinning up Appium or WebDriverAgent. The key insight: **Mobile Safari in the simulator runs the same WebKit engine as the catalyst app's WKWebView**, and Mobile Safari has full Safari Web Inspector access from the host Mac. So most rendering issues can be reproduced and inspected there with first-class tooling.

**The current toolkit (no extra deps):**

| Need | Command | Notes |
|------|---------|-------|
| Screenshot | `xcrun simctl io booted screenshot <path>` | PNG. Read it with the Read tool — same loop as playwright. |
| Record video | `xcrun simctl io booted recordVideo <path>` | Followed by ffmpeg extraction at 60fps; see "Capturing iOS-specific issues" above. |
| Reload current page (catalyst app) | `xcrun simctl terminate booted com.drape.app && xcrun simctl launch booted com.drape.app` | See "Reload the simulator app" above. |
| Open arbitrary URL in Mobile Safari | `xcrun simctl openurl booted http://192.168.1.97:3005/upload-attire` | Same WebKit engine; gives you Safari Web Inspector. |
| Install app | `xcrun simctl install booted <path>.app` | Rarely needed during web iteration. |
| Clipboard in/out | `xcrun simctl pbcopy booted` / `pbpaste booted` | Useful for shuttling logs. |
| Status bar override | `xcrun simctl status_bar booted override --time "9:41" --batteryLevel 100` | Cleaner screenshots for design QA. |
| Light/dark mode | `xcrun simctl ui booted appearance dark` | When dark-mode lands. |

**Recommended workflow inside `/code-agent`:**

1. **For pure rendering verification** (animation, layout, spacing): prefer Mobile Safari over the catalyst native shell. Open the URL with `simctl openurl`, screenshot, read. The catalyst native WebView doesn't expose Safari Web Inspector by default (`isInspectable` is opt-in), so you lose DOM/console access — Mobile Safari gives it for free.
2. **For VTA / route-transition / native-shell-specific bugs**: use the catalyst app via `terminate + launch`. Screenshot for static state; recordVideo + ffmpeg for transition states.
3. **For DOM / state inspection**: attach Safari Web Inspector manually from the host Mac (Safari → Develop → Simulator → \<page\>). No programmatic equivalent without setting up the Web Inspector remote protocol bridge — see vault notes for research targets.

**Limitations vs playwright web loop (what's not yet automated):**

- **Programmatic taps / scrolls / text input.** No native simctl command. Workarounds: AppleScript driving Simulator.app, `cliclick` against the simulator window, or full WebDriverAgent. None is great.
- **JS evaluation in the WebView.** Requires Safari Web Inspector's remote protocol (unofficial CDP-like API). Worth investigating — would unlock most of the playwright loop.
- **Network request inspection.** Visible in Safari Web Inspector manually; no programmatic stream.
- **Console log streaming.** Same — manual via Web Inspector.

**Future improvements worth the investment** (when iteration speed becomes the bottleneck): a thin wrapper script library at `scripts/ios-*` for the common commands above, then a Safari Web Inspector remote bridge for JS/DOM access. WebDriverAgent / Appium is the heavy artillery if full automation is needed; defer until clearly justified.

### iOS layout / animation gotchas

A surfaceable list of the iOS-WebView-specific issues hit during this project's flicker / chrome / route-transition work. Order roughly matches blast radius — top items have caused the most debugging time.

#### 1. View Transitions API: snapshot / live-DOM desync

**Symptom:** an animation visibly "jumps" at the end of a route transition. Image flickers; element appears at one position during cross-fade, then snaps to a different one.

**Cause:** `document.startViewTransition` captures a *frozen snapshot* of the new DOM at one instant near the start of the transition. The pseudo-element animation cross-fades that snapshot. If the live DOM continues animating any visible property (`opacity`, `transform`, `filter`, `clip-path`, `mask-image`) during the 320ms cross-fade, the live DOM is at a different state than the snapshot when VTA hands off — visible discontinuity.

**Recovery:** defer in-DOM animations until `viewTransition.finished` resolves. The pattern is in `src/js/hooks/useViewTransitionNavigate.js` (`getCurrentViewTransition()` exposes the current VTA via a module ref) and `src/js/components/FadeImage/FadeImage.js` (awaits `vta.finished` before flipping `setReady(true)`). MOTION-DIRECTION.md §5 has the long-form rationale.

**Test:** when adding a new animation that runs near route transitions, check on iOS WebView specifically — Chromium tolerates the desync, iOS surfaces it.

#### 2. `env(safe-area-inset-top)` double-counts when two ancestors apply it

**Symptom:** content sits ~2× further from the notch than expected on iPhone X+ devices.

**Cause:** if both a "status bar spacer" element and a sticky `AppHeader` apply `padding-top: env(safe-area-inset-top, 0)`, the inset is added twice. Each phone's safe-area-inset-top is ~50–60px on devices with a notch / Dynamic Island.

**Recovery:** exactly one element in the document tree should claim the safe-area inset. We chose the sticky `AppHeader` (because when stickied at top: 0 on scroll, it must clear the system status bar itself). The fake desktop-preview StatusBar is `display: none` on mobile.

**Detection trick:** search for `safe-area-inset-top` across the codebase; expect one hit per visual zone.

#### 3. Transformed ancestors break `position: fixed` AND `backdrop-filter`

**Symptom:** a floating tab bar with `backdrop-filter: blur(...)` flashes opaque/garbled for one frame on every route transition. Worse: the "fixed"-positioned tab bar moves with its transformed ancestor instead of staying viewport-pinned.

**Cause:** when an element has a non-`none` `transform` (or `filter`, `perspective`, `will-change`), it becomes the containing block for any descendant `position: fixed` element — they're "fixed" relative to the transformed ancestor, not the viewport. Separately, `backdrop-filter` requires a stable GPU composite layer; transformed ancestors invalidate that layer on every transform tick, forcing a rebuild that flashes visibly on iOS WebView.

**Recovery:** **never wrap a fixed/sticky element or a `backdrop-filter` element in a transformed ancestor.** This is why drape's `DeviceFrame` was removed — its `routeFallbackIn` animation used `transform: translateY` and that transform reliably broke both the floating TabBar's `position: fixed` and its frosted `backdrop-filter`. Today document scroll is the only scroll port; nothing wraps the route in a transform.

#### 4. iOS WebView paints `<img>` before bitmap rasterization is complete

**Symptom:** an image animated with `opacity: 0 → 1` from `onLoad` flashes at full visibility for 1 frame, then drops to 0, then fades up. (You see the bitmap briefly before the fade starts.)

**Cause:** `<img>` `onLoad` fires when bytes have been parsed enough for layout, but the bitmap isn't yet rasterized into a GPU texture. iOS WebView's compositor sometimes paints the partially-decoded bitmap on its own composite layer for one frame before the parent's opacity:0 is composited. The reverse — start opacity:0 then animate to 1 from `onLoad` — runs the transition against a not-yet-painted bitmap, producing a different flicker.

**Recovery:** gate the reveal on `img.decode()` resolving (which guarantees the bitmap is in the GPU cache), and pre-load the image off-DOM via `new Image()` so the `<img>` only mounts *after* the cache is hot. Pattern in FadeImage.js. Combined with the VTA fix in #1, this is how the whole image-flicker arc landed.

#### 5. `prefers-reduced-motion` is a separate code path that's easy to miss

**Symptom:** ships fine, then a user with reduced motion enabled sees ugly half-broken transitions or a frozen spinner.

**Cause:** the global `@media (prefers-reduced-motion: reduce)` rule in `_variables.scss` zeros out durations, but each new animation needs to handle the `iteration-count: 1, duration: 0.01ms` case correctly — usually means "snap to the end state via `forwards` fill," not "play once at 0.01ms and reset."

**Test path on simulator:** Settings → Accessibility → Motion → Reduce Motion → On. Re-test all reveals/transitions in this mode before shipping. (Easy to forget — the simulator's default is off.)

#### 6. `@property`-animated CSS custom properties require iOS 16.4+

**Symptom:** an animation that interpolates a CSS custom property via `@property` declaration (e.g., a radial-gradient mask whose radius animates) doesn't animate at all on iOS < 16.4. The property snaps from start to end.

**Cause:** `@property` (CSS Houdini Properties and Values API) shipped in Safari 16.4. iOS 16+ devices on older iOS versions fall back to non-animated custom property changes.

**Recovery:** target iOS 17+ as the floor (current `Shared.xcconfig` already does this), or supply a fallback animation path. The retired Aperture Bloom variant in FadeImage relied on `@property` — kept it because the iOS-version constraint matched the project floor.

#### 7. CSS opacity interpolation is paint-bound (slow, drops frames) on iOS without GPU promotion

**Symptom:** opacity transitions on `<img>` elements appear jittery / drop frames on iOS WebView, especially during scroll or alongside other animations.

**Cause:** iOS WebView keeps `<img>` elements on the main render layer rather than promoting them to a GPU composite layer. Opacity transitions there are paint-bound on every frame, not composite-bound.

**Recovery:** wrap the animated element in a `<div>` with `will-change: opacity` (or apply the transition to the wrapper, not the `<img>` directly). The wrapper gets promoted to a GPU layer; transitions run on the compositor thread. Multiple variants of this pattern exist in FadeImage's history; the current shipping form moved on to filter-based reveals (Print Develop) which avoid the issue entirely.

#### 8. `prefers-reduced-motion` and forwards-fill keyframe animations need careful coexistence

**Symptom:** under reduced motion, an animation that should snap to end state instead reverts to its initial state.

**Cause:** the global rule sets `animation-duration: 0.01ms; animation-iteration-count: 1` — the animation plays once, instantly. Without `animation-fill-mode: forwards`, the element returns to its pre-animation state.

**Recovery:** any keyframe animation that represents a *one-way state change* (e.g., reveal, dismiss) should use `forwards` fill. Patterns in FadeImage.scss.

### Consuming `useFilePicker` / `useCamera` data: dedupe with a ref, keep deps stable

**Symptom:** picking N files via `useFilePicker()` (catalyst-core/hooks) ends up dispatching MORE than N — sometimes exactly the photo cap, sometimes a multiple of N. The bug only appears on iOS; the same code on web (where the `<input type="file">` fallback path runs) fires exactly once. Picking 1 photo lands you at 5; picking 2 lands you at 5; picking 3 lands at 5. Always converges on the cap.

**Root cause (NOT a catalyst bug — verified against `FilePickerHandler.swift`):** iOS fires `ON_FILE_PICKED` exactly once per user selection. The duplication is in the consumer pattern, not the bridge.

What goes wrong: a naive effect that watches `filePicker.data`, slices files by a derived count (`remainingSlots = LIMIT - photos.length`), and includes that derived count in its dep array — re-runs after every dispatch. The slice shrinks each iteration, and the math converges on the cap:

```
run 1: data=[A,B], remainingSlots=5 → slice [A,B] → photos=[A,B]
run 2: data=[A,B], remainingSlots=3 → slice [A,B] → photos=[A,B,A,B]
run 3: data=[A,B], remainingSlots=1 → slice [A]   → photos=[A,B,A,B,A]
run 4: data=[A,B], remainingSlots=0 → slice [],  done at exactly 5
```

The reason `filePicker.clear()` doesn't end the loop on its first call: under React 18 + `useSyncExternalStore` (react-redux 8.x), each `dispatch` triggers a re-subscribe before `clear()`'s scheduled `setData(null)` commits — so the effect re-runs with the same `data` ref and the new `remainingSlots`. Web doesn't show this because the web `<input>` path skips the catalyst data effect entirely; results are dispatched directly from the `change` handler.

**Recovery:** two-part fix.

1. **Dedupe the data ref** — process each `data` reference exactly once:

```js
const processedRef = useRef(null)

useEffect(() => {
    if (!filePicker.data) return
    if (processedRef.current === filePicker.data) return
    processedRef.current = filePicker.data

    for (const f of filePicker.data.files ?? []) {
        if (f?.fileSrc) dispatch(addPhoto({ id: safeId(), url: f.fileSrc }))
    }
    filePicker.clear()
}, [filePicker.data, filePicker.clear, dispatch])
```

2. **Keep dep arrays stable** — never put derived counts (`remainingSlots`, `photos.length`, etc.) in the deps of an effect that consumes catalyst data. Let the picker enforce caps at the source via `pickFile({ maxFiles, multiple })` so the data array arrives correctly sized; the effect just dispatches what it received.

**Detection trick:** the convergence-on-cap pattern is the fingerprint. If picking varying counts always lands you at the same final count (whatever your in-effect slice/clamp uses), it's this bug. Attach Safari Web Inspector (Develop → Simulator → upload-attire) and watch `📁 File picked:` log lines — exactly one fires per selection from the iOS side, so multiple Redux dispatches for one log line means the duplication is on the React side.

### `crypto.randomUUID()` is undefined on LAN-IP HTTP dev hosts

**Symptom:** code that calls `crypto.randomUUID()` silently throws (or returns undefined depending on engine), leaving you with an unreachable code path. The dispatch / fetch / whatever runs *after* the call never fires. Errors don't surface in the console — the throw is swallowed by the surrounding event handler.

**Cause:** `crypto.randomUUID()` is gated on a *secure context*. The browser counts these as secure: `https://*`, `http://localhost`, `http://127.0.0.1`. It does **not** count `http://192.168.x.x` or any other LAN-IP origin. Because catalyst's iOS WebView loads the app from `http://<LAN-IP>:3005` (per `WEBVIEW_CONFIG.LOCAL_IP`), the simulator app and any browser pointed at the LAN-IP dev URL both fail this check.

**Recovery:** never call `crypto.randomUUID()` directly for app-internal IDs. Use a guarded helper:

```js
const safeId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
```

Photo / option / row IDs that never leave the client don't need cryptographic uniqueness — collision odds with the millisecond+random suffix are vanishingly small for any human-driven flow.

**Detection trick:** if a click handler "does nothing" on the LAN-IP dev URL but works on `localhost`, suspect this. Check the handler for `crypto.randomUUID` / `crypto.subtle` / `Notification.requestPermission` / any other secure-context-only API.

### catalyst-core SSR sends `text/html` without `charset=utf-8`
**Symptom:** Hydration mismatch on any page that renders non-ASCII characters (em dash `—`, ellipsis `…`, middle dot `·`, curly quotes). The console shows lines like `Server: "%s" Client: "%s"` with the server text mojibake'd (`…` → `â€¦`). Once one mismatch fires, React unmounts the entire root and re-renders client-side, which is the wrong recovery cost for a single-byte encoding bug.

**What's already wired correctly:** SSR output is genuinely UTF-8 bytes; the JSX strings are fine. The only thing missing is the charset declaration on the receiving side.

**Most common actual cause:** the response Content-Type comes through as `text/html` (no charset) and the browser falls back to Latin-1 decoding.

**Recovery procedure:**
1. Ensure `server/document.js` includes `<meta charSet="utf-8" />` as the first child of `<Head>`. catalyst-core's `<Head>` is a passthrough — children land directly in `<head>`. This makes the browser parse the document as UTF-8 even without a Content-Type charset.
2. If you still see mismatches after that, they're a real SSR/client divergence (e.g. `Date.now()` in render, conditional based on `window`) — not encoding. Fix the divergence at the source rather than working around the charset.

## Environment
- **Dev server:** `npm run start` (catalyst start). Webpack dev server on `localhost:3006`, node server on `localhost:3005`.
- **Build:** `npm run build` after flipping `NODE_ENV` to `"production"` in `config/config.json`. Serve with `npm run serve`.
- **Mobile:** `npm run buildApp:ios` / `buildApp:android`; emulator setup via `setupEmulator:*`. Mobile config block lives at `config.json → WEBVIEW_CONFIG`.
- **Env vars:** `CLIENT_ENV_VARIABLES` in `config.json` whitelists what gets exposed to the client bundle (currently `API_URL`).
- **`API_URL`** is empty by default — set it before any thunk that hits a real backend will work.

## Mock-driven development
<!-- No mocks yet. When API responses arrive, save them under `docs/mocks/<endpoint>.json`, PII-scrubbed, and seed reducer initialState from them in dev so the UI has real shapes from day one. -->
