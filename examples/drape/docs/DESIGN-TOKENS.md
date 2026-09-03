# Design tokens

All values below are extracted from `design/drape.pen`. They are the source of truth — code in `src/static/css/resources/_variables.scss` should mirror these. No raw hex/px in component code.

## Color

| Token | Light | Dark | CSS variable |
|-------|-------|------|--------------|
| canvas | `#F5F1EC` | <!-- TBD --> | `--color-canvas` |
| surface | `#FFFFFF` | <!-- TBD --> | `--color-surface` |
| surface-soft | `#EDE6DD` | <!-- TBD --> | `--color-surface-soft` |
| text-primary | `#1A1A1A` | <!-- TBD --> | `--color-text-primary` |
| text-secondary | `#7A736B` | <!-- TBD --> | `--color-text-secondary` |
| text-on-dark | `#FFFFFF` | <!-- TBD --> | `--color-text-on-dark` |
| accent | `#8B3A2F` | <!-- TBD --> | `--color-accent` |
| border-subtle | `#E8E2DA` | <!-- TBD --> | `--color-border-subtle` |
| scrim | `rgba(26, 26, 26, 0.8)` | <!-- TBD --> | `--color-scrim` |

Dark mode is undecided — the design is currently a single-mode warm system. If/when dark mode lands, the canvas → surface inversion strategy needs an explicit decision (warm dark? cool dark?), not a mechanical hue flip.

## Typography

| Token | Value | CSS variable |
|-------|-------|--------------|
| font-display | `"Fraunces", serif` | `--font-display` |
| font-body | `"Inter", system-ui, sans-serif` | `--font-body` |

### Type scale

| Token | Family | Size / px | Weight | Letter-spacing | Use |
|-------|--------|-----------|--------|----------------|-----|
| display-xl | Fraunces | 56 | 500 | -1 | Brand wordmark only |
| display-lg | Fraunces | 42 | 400 | 0 | Big numerics (progress %) |
| display-md | Fraunces | 26–28 | 400–500 | 0 | Screen-level title |
| display-sm | Fraunces | 22 | 400–500 | 0 | Section title |
| display-xs | Fraunces | 17–20 | 400–500 | 0 | Subsection / nav title |
| body-lg | Inter | 15 | 600 | 0.3 | Primary CTA label, hero descriptor |
| body | Inter | 13–14 | 400–500 | 0 | Body copy, list items, button labels |
| caption | Inter | 11–12 | 400–500 | 0–0.5 | Meta, helper text, step indicators |
| micro | Inter | 10 | 400 | 1 | Smallest labels |

Default `lineHeight` for body/caption: `1.4–1.5`. Display sizes use the font's intrinsic line-height.

## Spacing

A 2-based ramp, used for both `gap` and `padding`. Most rhythm runs on the 4-step (`4, 8, 12, 16, 20, 24…`); the half-steps (`6, 10, 14, 18`) exist for tight arrangements (icon clusters, compact controls).

| Token | Value | CSS variable |
|-------|-------|--------------|
| space-2 | 2 | `--space-2` |
| space-4 | 4 | `--space-4` |
| space-6 | 6 | `--space-6` |
| space-8 | 8 | `--space-8` |
| space-10 | 10 | `--space-10` |
| space-12 | 12 | `--space-12` |
| space-14 | 14 | `--space-14` |
| space-16 | 16 | `--space-16` |
| space-18 | 18 | `--space-18` |
| space-20 | 20 | `--space-20` |
| space-24 | 24 | `--space-24` |
| space-28 | 28 | `--space-28` |
| space-32 | 32 | `--space-32` |
| space-36 | 36 | `--space-36` |
| space-40 | 40 | `--space-40` |
| space-60 | 60 | `--space-60` |

Common idioms:
- **Body padding:** `20` (horizontal), variable vertical depending on chrome.
- **Section gap:** `24` between sections, `12–14` within a section.
- **Status bar height:** `62`. **Tab bar padding:** `[12, 21, 21, 21]` (top, right, bottom, left).

## Radius

| Token | Value | Use | CSS variable |
|-------|-------|-----|--------------|
| radius-xs | 10–12 | Image thumbnails | `--radius-xs` |
| radius-sm | 14–16 | Form fields, content cards | `--radius-sm` |
| radius-md | 18–20 | Chips, scrim badges, hero cards | `--radius-md` |
| radius-lg | 24 | Segmented control container | `--radius-lg` |
| radius-pill | 26–28 | Primary CTA buttons | `--radius-pill` |
| radius-xxl | 36 | Stepper / oversized controls | `--radius-xxl` |
| radius-device | 48 | Device frame corner | `--radius-device` |

No `radius: 0`. The system is consistently rounded.

## Stroke

| Token | Value | Use |
|-------|-------|-----|
| stroke-hairline | 1 | Default field/card border |
| stroke-thin | 1.2 | Tertiary border (e.g., "add more" tile) |
| stroke-soft | 1.5 | Upload area border |
| stroke-emphasis | 2 | Selected card / current-step ring |

## Shadows

None defined. The system relies on stroke + fill contrast for elevation, not drop shadows. **Don't introduce shadows without re-opening this decision** — they would break the editorial register.

## Motion

The motion system is documented in full in `docs/MOTION-DIRECTION.md` (durations × easings × triggers). Below is the token table that the code-agent uses; per-route specs live in the motion-direction doc.

### Duration tokens

| Token | Value | Use | CSS variable |
|-------|-------|-----|--------------|
| motion-instant | 0ms | Reduced-motion fallback | `--motion-instant` |
| motion-tap | 100ms | Press-down (button/card scale) | `--motion-tap` |
| motion-quick | 200ms | Tap release, color/border state changes | `--motion-quick` |
| motion-state | 280ms | Selection state, segment slide, sheet dismiss | `--motion-state` |
| motion-transition | 320ms | Route transition, sheet present | `--motion-transition` |
| motion-soft | 500ms | Long photographic transitions | `--motion-soft` |
| motion-progress-rotation | 1400ms | Continuous spinner rotation | `--motion-progress-rotation` |
| motion-shimmer | 2400ms | Skeleton-placeholder shimmer loop | `--motion-shimmer` |
| motion-reveal-develop | 800ms | Image reveal (Print Develop variant) | `--motion-reveal-develop` |

### Easing tokens

| Token | Value | Use | CSS variable |
|-------|-------|-----|--------------|
| ease-standard | `cubic-bezier(0.4, 0, 0.2, 1)` | Default for state changes | `--ease-standard` |
| ease-decelerate | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances (route in, sheet present, image fade-in) — soft landing | `--ease-decelerate` |
| ease-accelerate | `cubic-bezier(0.4, 0, 1, 1)` | Exits (route out, sheet dismiss) | `--ease-accelerate` |

### Per-trigger tokens (composed)

| Token | Value | Use |
|-------|-------|-----|
| transition-tap | `transform var(--motion-tap) var(--ease-standard)` | Button / card press feedback |
| transition-state | `var(--motion-quick) var(--ease-standard)` | Color / border / opacity changes |
| transition-route-in | `var(--motion-transition) var(--ease-decelerate)` | Route entry |
| transition-route-out | `var(--motion-quick) var(--ease-accelerate)` | Route exit |
| transition-sheet-in | `var(--motion-transition) var(--ease-decelerate)` | Bottom sheet present |
| transition-sheet-out | `var(--motion-state) var(--ease-accelerate)` | Bottom sheet dismiss |
| transition-image-fade | `opacity var(--motion-soft) var(--ease-decelerate)` | Image lazy fade-in |

## Grid

drape is mobile-first; the canvas is a single 390-wide column with 20px page padding. There's no multi-column grid in the mobile design. If web/tablet introduce one, this section gets a formula — not a snapshot.

The runtime layout has no fixed device-size container — pages flex to fill `100dvh` on every platform (iOS WebView, Android WebView, mobile Safari/Chrome, desktop). 390 / 844 are *design canvas* references for Pencil only, not CSS tokens.

| Token | Value | Meaning |
|-------|-------|---------|
| page-padding | 20 | Horizontal page padding |
