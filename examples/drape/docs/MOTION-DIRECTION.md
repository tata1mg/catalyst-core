# Motion direction

**Locked:** 2026-05-02 (via `/design-explore`)
**Heuristic:** MOTION_INTENSITY: micro-only (3-4). This doc is the binding interpretation.

## Tradition + signature tension

drape borrows its motion vocabulary from three places:
1. **iOS UIKit native transitions** — push/pop, modal sheets, segmented control slides, tap rebounds. The polish floor users already recognize as "feels like iOS, not a webpage".
2. **Editorial e-commerce** (The Row, Khaite, Aman, Bottega Veneta) — lazy image fade-ins, restrained hover, photography that "settles" into place rather than appearing instantly.
3. **Modern fashion-magazine apps** (Vogue, Verve, AD India) — image-led reveals (image first, copy follows), masthead crossfades, page-turn-as-route-change.

**Signature tension:** the system is calm at rest but has *one* moment of expression per interaction. No element animates without a reason. No two elements animate at once unless they're a coordinated pair (image + scrim, sheet + scrim).

## Universal rules

1. **`prefers-reduced-motion: reduce` is mandatory.** All animations collapse to `var(--motion-instant)`. State changes are immediate. Spinners are replaced with a static dot or progress text. Test before shipping.
2. **One bold move per interaction.** If a tap fires both a route transition and a card scale-down, the route transition wins; the scale gets skipped. Stack-trace it: route transitions > sheet present > selection state > tap feedback.
3. **Animate transform and opacity only.** Never animate width/height/top/left — they thrash layout. Use `transform: translate/scale` and `opacity`.
4. **Easings carry meaning.**
   - `--ease-decelerate` (ease-out-quart) for entrances — soft landing, "settling in"
   - `--ease-accelerate` for exits — "leaving briskly"
   - `--ease-standard` for everything in between
5. **Photography is the protagonist** still applies in motion. Images get the `--motion-soft` (500ms) fade-in; UI chrome gets `--motion-quick` (200ms). Images take their time.

## Trigger × motion specs

### 1. Route transitions (between screens)

**What animates:** outgoing route fades + slides up 8px; incoming route fades in + slides up from 8px below.
**Specs:**
- Out: `opacity 1→0` + `translateY(0 → -8px)`, `var(--motion-quick)` `var(--ease-accelerate)`
- In: `opacity 0→1` + `translateY(8px → 0)`, `var(--motion-transition)` `var(--ease-decelerate)`
- Stagger: incoming begins ~100ms after outgoing starts (overlap, not back-to-back)

**Implementation:**
- Preferred: View Transitions API (`document.startViewTransition`) — supported in Chromium 111+, Safari 18+. iOS 18+ WebView supports it.
- Fallback: wrap each route's container in a CSS class that animates on mount/unmount via `<TransitionGroup>` from `react-transition-group` or hand-rolled with `useEffect`.
- The route enter/exit doesn't apply to the floating tab bar — the tab bar persists across routes (pinned, no transition).

**Apply to:** all 6 routes. Special case: **Welcome → anywhere is a forward push** (all routes are "forward" from Welcome). **Anywhere → Welcome is a backward pop** (route slides DOWN 8px on entry instead of up). Use the router state's history direction to pick.

### 2. Tap feedback (buttons, cards, interactive surfaces)

**What animates:** scale.
**Specs:**
- Press: `transform: scale(0.97)`, `var(--motion-tap)` (100ms) `var(--ease-standard)`
- Release: `transform: scale(1)`, `var(--motion-quick)` (200ms) `var(--ease-decelerate)` — slight overshoot via the decelerate curve gives an iOS-native feel without a true spring

**Apply to:**
- `<PrimaryCta>` — the full-width pill. Scale 0.97 on press.
- `ShootTypeCard` (Shoot Type's 4 cards). Scale 0.98 on press (smaller scale because the card is bigger; reads more like a "select" than a "press").
- Variants Gallery cells (the 6 photo tiles). Scale 0.98.
- Final Results sibling thumbs. Scale 0.97.
- Tab Bar individual tabs. No scale — they have an active-state fill change instead (see #3).
- Stepper +/− buttons. Scale 0.92 (smaller surface, more pronounced feedback).
- Cancel button (Generating). Scale 0.92.

**Skip:** form fields, chevron rows in Upload Attire (they open a sheet — the sheet is the feedback).

### 3. Selection / active-state transitions

**What animates:** color, border, fill, position.
**Specs:** `var(--transition-state)` (= `200ms ease-standard`) on the changed property. Never animate `width`/`height`.

**Apply to:**
- **ShootType card border:** stroke `1px subtle → 2px terracotta` on selection. Animate `border-color` + `border-width` together via the transition. (Note: animating border-width can shift content 1px — use `outline` instead and animate `outline-color`/`outline-width`.)
- **ShootType check badge:** scale-in from 0 to 1 on appear (`var(--motion-state)` `var(--ease-decelerate)`), scale-out 1 to 0 on disappear (`var(--motion-quick)` `var(--ease-accelerate)`).
- **Segmented control (Female/Male/Both):** the active dark pill SLIDES between segments instead of jump-cutting. Use `transform: translateX` on a single shared `.segmentActive` indicator overlay; the labels stay still and inverse their text color. `var(--motion-state)` `var(--ease-standard)`.
- **TabBar active tab:** active fill (ink) appears via opacity 0→1 on the *new* active tab, opacity 1→0 on the *previously* active tab. `var(--motion-state)` `var(--ease-standard)`. (Don't slide the active background — the tabs aren't equal-width pills, they're divided columns.)
- **VariantsGallery cell selected outline:** `outline-color` transitions from transparent to terracotta. `var(--motion-state)`.
- **Final Results sibling-thumb selected outline:** same pattern, ink color.

### 4. Stepper number change (How many variants?)

**What animates:** the numeric value.
**Specs:**
- Old number: `translateY(0 → -16px)` + `opacity 1→0`, `var(--motion-quick)` `var(--ease-accelerate)`
- New number: `translateY(16px → 0)` + `opacity 0→1`, `var(--motion-quick)` `var(--ease-decelerate)`
- Direction reverses on decrement (old slides DOWN, new slides UP from above). Driven by which button was pressed.

**Implementation:** keyed React component. On change, mount the new value; the CSS `@keyframes` runs once. Old value is unmounted after its animation ends.

### 5. Image lazy reveal

**What animates:** depends on variant — see below. The original spec called for a uniform opacity fade; that was revised after a debug session uncovered an iOS WebView constraint (see Framework note at the end of this section).

**Trigger:** image bitmap is decoded into the GPU cache (`img.decode()` resolves). Pre-load happens off-DOM via `new Image()` so the rendered `<img>` mounts from cache and never paints a half-decoded bitmap.

**Skeleton placeholder:** while the image is loading, the cell shows a slow horizontal cream-90% gradient sweep — `--motion-shimmer` (2400ms) linear infinite. Same skeleton across every variant.

**Variants** (selected via FadeImage's `variant` prop):

- **`snap`** — image appears at full opacity once decoded. No motion. Default; safe baseline. Reserved for cases where motion would be inappropriate.
- **`develop`** — image mounts with `filter: contrast(0.6) saturate(0.4) brightness(1.15)` and resolves to `filter: none` over `--motion-reveal-develop` (800ms) `var(--ease-decelerate)`; the shimmer overlay fades out concurrently. Reads as a darkroom print emerging from the chemical bath — gradient-driven, soft, non-invasive, identical regardless of cell size. Used on every photographic surface in the app today: Welcome hero, UploadAttire strip, ShootType cards, VariantsGallery cells, FinalResults featured + sibling thumbs. Earlier explorations (Aperture Bloom, Drape Pull) were ruled out — Aperture for hard clip-path edges, Drape because no amount of fold-detail / mask-feathering / multi-layer choreography sold "fabric flowing" over "rectangle sliding." Develop won by being inherently gradient-based: there's no edge to harden.

**Stagger** (within a grid): each cell's reveal starts `index * 60ms` after the previous. Caps at 4 (so a 6-cell grid's 5th and 6th cells start at the same time as the 4th).

**Skip on:** images that come from the user's own upload (those should appear instantly when the user picks them — the reveal is for *initial* photographic loads, not user-driven inserts).

#### Framework note — iOS WebView vs route View Transitions API

The original 500ms opacity fade flickered visibly on iOS WebView during route navigation. Root cause: **VTA captures a frozen snapshot of the new page's DOM at one instant; if the live DOM continues animating opacity past that instant, there is a visible jump when VTA hands off the snapshot back to the live DOM at the end of the cross-fade.** iOS surfaces this jump because its compositor is more conservative about layer reuse than Chromium's.

The fix is structural: **FadeImage defers the reveal animation until after `viewTransition.finished` resolves.** The live DOM stays at its loading-skeleton state during the entire VTA cross-fade, so no animation runs against a frozen snapshot. After VTA hands off, the live DOM is uncovered and free to animate without fighting anything.

Implementation: `useViewTransitionNavigate` (in `src/js/hooks/`) tracks the most recently started VTA via a module-level ref. FadeImage's reveal effect awaits `vta.finished` before triggering `setReady(true)`. On initial page load (no VTA), the ref is null and reveal fires immediately.

This makes all three variants — including `develop` (which animates `filter` + `opacity`) — safe under VTA. Do not animate visible properties on the FadeImage wrap or its overlays during VTA without going through this deferred-reveal mechanism.

### 6. Bottom sheet present / dismiss (Photo Source picker, Field Picker)

**What animates:** sheet position + scrim opacity, as a coordinated pair.
**Specs:**
- **Present:**
  - Scrim: `opacity 0 → 0.6`, `var(--motion-state)` `var(--ease-decelerate)`
  - Sheet: `transform: translateY(100% → 0)`, `var(--motion-transition)` `var(--ease-decelerate)`
  - Sheet starts AT THE SAME TIME as scrim (no stagger — they're a pair)
- **Dismiss:**
  - Sheet: `transform: translateY(0 → 100%)`, `var(--motion-state)` `var(--ease-accelerate)`
  - Scrim: `opacity 0.6 → 0`, `var(--motion-state)` `var(--ease-accelerate)`
  - 30ms after the sheet starts (sheet leaves first, scrim follows)

**Trigger:** tapping the upload tile / `+` tile / a field row → present. Tapping scrim, Cancel, or completing a selection → dismiss.

**Drag-to-dismiss:** when implementing, allow swipe-down on the sheet. Below 30% drag → snap back; above → continue dismiss. iOS-native feel.

### 7. Generating screen — progress + step transitions

**Already partly implemented:**
- Progress ring sweep: `stroke-dashoffset` transitions on update, `var(--motion-quick)` `var(--ease-standard)`. ✅
- Spinner rotation on current step: `var(--motion-progress-rotation)` linear infinite. ✅

**Add:**
- Step pill state transitions: when a step transitions from "current" → "complete", animate fill, border, and icon swap.
  - Fill: `var(--color-surface) → var(--color-canvas)`, `var(--motion-state)` `var(--ease-standard)`
  - Border: opacity 1 → 0 (the terracotta border on current state fades out as the pill loses focus)
  - Icon: spinner exits via `opacity 1→0 + scale 1→0.8` (`var(--motion-quick)` `var(--ease-accelerate)`); check icon enters via `opacity 0→1 + scale 0.8→1` (`var(--motion-state)` `var(--ease-decelerate)`).

### 8. Tab bar floating chrome — no entry animation, but active-state subtleties

The tab bar is always pinned. It does NOT animate in or out across routes (per "stack-trace it" rule — route transition wins). The only motion within the tab bar is:
- Tab `active` fill change (covered in #3 above)
- Tap feedback on individual tabs is a tiny opacity dip (1.0 → 0.6 → 1.0, total 200ms) — gentler than other tap targets because the tab bar reads as "system chrome", not "primary action".

### 9. Welcome screen — hero entrance

**What animates:** the hero image and the content panel reveal, on first mount.
**Specs:**
- Hero image: standard image lazy fade-in (#5 above), 500ms.
- Content panel below hero: `opacity 0 → 1` + `translateY(12px → 0)`, `var(--motion-state)` `var(--ease-decelerate)`, **delayed 200ms** so the image lands first, then the content settles.
- Brand wordmark "Drape" gets an extra 80ms delay relative to the rest of the content panel (image → content → identity reveal sequence).

This is the only screen with a "compound entrance". Other screens use the standard route transition (#1) only.

## What NOT to add

The following are explicitly off-limits within the current MOTION_INTENSITY:
- Scroll-triggered reveals on body content (e.g., "fade in as you scroll" on Variants Gallery cells). Cells fade-in once, on initial load.
- Parallax (hero scrolling at different speed than content). Breaks editorial calmness.
- Spring physics on multiple coordinated elements (e.g., card fly-in animations). The progress ring sweep is the only "physics-y" motion.
- Decorative blobs / shapes that animate. There are none in the design system; don't add them via motion.
- Hover-triggered photographic zoom on mobile (no hover on touch). Web-only and only on desktop preview if at all — currently skipping.

## Implementation handoff

**For `/code-agent`:**
1. Update `src/static/css/resources/_variables.scss` to mirror the new motion tokens from `DESIGN-TOKENS.md` (including the composed `transition-*` tokens).
2. Implement `prefers-reduced-motion` overrides FIRST (one media query at the bottom of `_variables.scss` zeroing all durations). Without this, motion is non-shippable.
3. Apply per-trigger specs above route by route. Suggested implementation order:
   - **First pass:** tap feedback (#2) + state transitions (#3) — cheapest, highest perceived polish gain.
   - **Second pass:** image lazy fade-in (#5) — touches multiple containers but low risk.
   - **Third pass:** route transitions (#1) — needs View Transitions API or transition-group integration.
   - **Fourth pass:** stepper (#4) + Welcome compound entrance (#9) + Generating step pills (#7) — per-component polish.
   - **Fifth pass (when sheets land):** sheet present/dismiss (#6) — gates on the upload-integration code.
4. After each pass, run `/visual-qa` and verify the motion doesn't hurt anything else (no horizontal overflow from translateY, no layout thrash, reduced-motion still works).

The motion direction is locked. `/design-agent` shouldn't propose new motion patterns without first running this through `/design-explore` Mode 5 (challenge).
