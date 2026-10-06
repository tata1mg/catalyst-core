# Generating: ideas and decisions

## Route chrome
- **Route:** /generating/:jobId
- **Layout:** Custom (status bar + top bar + centered loader + bottom area)
- **Header variant:** Top bar (job context / cancel)
- **Footer variant:** Status / progress copy

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | Progress representation | Large hairline progress ring (200×200, hollow) with terracotta sweep + Fraunces percentage in the well | locked | direction |
| 2 | Step communication | Stacked pill list below the ring (Analyzing attire · Selecting models · Rendering scenes…) — completed steps cream-filled with terracotta check, current step white-filled with terracotta hairline border + spinner ellipse | locked | variant |
| 3 | Abort UX | Lightweight `× Cancel` text affordance pinned to the top-left (no header bar, no back chevron) | locked | variant |
| 4 | Background activity hint | Caption at bottom: "You can leave this screen — we'll notify you" with 4 placeholder thumbnail slots above it | locked | variant |

**Direction chosen — 2026-05-01:** *Editorial Boutique India*. Progress treated as a moment of craft, not a system task — the ring is generously sized, the percentage is set in display serif, and the step list reads like a recipe rather than a log.

## Design variations

### Variation A — "Atelier Progress"
A 62px status bar caps the screen. Top bar offers only `× Cancel` flush-left. The body centers a 200×200 progress ring (hairline cream backing ring + terracotta arc), with Fraunces 42 percentage and a small uppercase-feeling caption "complete" in its center. Below the ring: Fraunces 26 title "Crafting your shoot" and an Inter 13 secondary line ("Generating 6 low-res previews…"). Below that, a vertical stack of 3 step pills marks pipeline state. Bottom area shows 4 cream skeleton thumbnails and the leave-screen reassurance copy.

### Variation B — "[name]"
<!-- Same depth. Different spatial concept. -->
<!-- Pending exploration if/when revisited. -->

## Locked spec (drawn frame)

- **Frame:** `u0kSD9` (`04 Generating`)
- **Top bar:** `× Cancel` only — Inter on `#1A1A1A`. No back chevron, no title.
- **Progress ring:** 200×200, two stacked ellipses with `innerRadius: 0.94` (hairline)
  - Backing ring: fill `#E8E2DA`, full circle
  - Arc: fill `#8B3A2F`, `startAngle: 90`, `sweepAngle: -360 × progress`
  - Center stack: Fraunces 42 percentage `#1A1A1A`; Inter 11 caption `#7A736B`, letter-spacing 1, content "complete"
- **Title block (below ring):** Fraunces 26 `#1A1A1A` "Crafting your shoot" + Inter 13 `#7A736B` "Generating N low-res previews…"
- **Step pill (completed):** radius 14, fill `#F5F1EC`, padding `[10, 16]`, gap 12. Status icon: 22×22 radius 11 fill `#8B3A2F` with white check. Label: Inter 13/500 `#1A1A1A`.
- **Step pill (current):** radius 14, fill `#FFFFFF`, stroke `#8B3A2F` × 1. Status icon: 22×22 stroked ellipse, sweep -260 in `#8B3A2F` (this is the only animated element).
- **Skeleton row:** 4 cream tiles, each fill `#EDE6DD`, radius 8.
- **Reassurance caption:** Inter, `#7A736B`, centered.

## API hooks

- Poll or subscribe to a job-state endpoint (`GET /jobs/:id` or websocket).
- Expected status enum: `pending`, `running`, `done`, `failed`.
- Each running job exposes a `progress: 0–1` and an ordered `steps: [{ name, status }]` array.
- Cancel = `DELETE /jobs/:id`.

## Open questions

- What's the typical wall-clock for a 6-variant generation? (Drives whether the step pills need sub-second updates or if 1–2s polling is fine.)
- Does the leave-and-be-notified path require push notifications, or is it always fast enough to wait?

## Grid / layout system (if applicable)
<!-- Breakpoints, cell sizing, responsive rules -->

## API response shape
<!-- Likely: GET /jobs/:id (poll) or websocket → { status: "pending" | "running" | "done" | "failed", progress?: number, etaSeconds?: number }. Confirm when API lands. -->

## Parser implementation
<!-- /code-agent will populate — likely a status/progress derivation rule from the response. -->

## Next steps
- Existing draft frame: `u0kSD9` (`04 Generating`).
