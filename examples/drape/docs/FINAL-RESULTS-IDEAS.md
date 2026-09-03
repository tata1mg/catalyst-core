# Final Results: ideas and decisions

## Route chrome
- **Route:** /results/:jobId
- **Layout:** Default (status bar + content + tab bar)
- **Header variant:** Simplified (back + title + share/download)
- **Footer variant:** Tab Bar

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | Result presentation | Single hero image (radius-md, 360px tall) with a scrim badge overlay summarising the shoot ("Studio · Red silk saree · 4K"); a 4-thumb strip below for sibling variants from the batch | locked | direction |
| 2 | Share / export | Two header icons (lucide `share`, lucide `bookmark`); below the image, a primary "Download all" pill paired with a small refresh-cw icon button to regenerate | locked | variant |
| 3 | Header pattern | Back chevron · stacked Fraunces 17/500 title "Your Shoot" + Inter caption "N high-res images" · share + bookmark icons | locked | variant |
| 4 | Featured-image overlay | Bottom-left scrim chip: rgba ink scrim with sparkles icon + Inter 11/500 white descriptor | locked | variant |

**Direction chosen — 2026-05-01:** *Editorial Boutique India*. The final-results screen behaves like a magazine spread: one big image is the page, supporting variants shrink into a contact strip beneath, and the export action sits like a colophon.

## Design variations

### Variation A — "Magazine Spread"
Status bar caps the screen. Header row (back · stacked title/subtitle · share + bookmark). Body opens with a tall 360px hero image card, radius 20, with a bottom-left scrim chip describing the shoot. Below the hero: a 4-column thumbnail strip (height 74, radius 12, gap 10) — currently-selected sibling carries a 2px ink stroke. Below the strip, a primary "Download all" pill (52 tall) plus a small 52×52 cream-fill icon button for regenerate.

### Variation B — "[name]"
<!-- Same depth. Different spatial concept. -->
<!-- Pending exploration if/when revisited. -->

## Locked spec (drawn frame)

- **Frame:** `jVFCi` (`06 Final Results`)
- **Header L:** Back icon · stacked Fraunces 17/500 "Your Shoot" + Inter caption `#7A736B` "N high-res images"
- **Header R:** lucide `share` (20) · lucide `bookmark` (20), gap 18
- **Featured image:** height 360, radius 20, image fill, padding 14, justifyContent end
  - **Scrim badge:** radius 18, fill `#1A1A1ACC`, padding `[6, 12]`, gap 8 — lucide `sparkles` (13) + Inter 11/500 white descriptor
- **Sibling thumbs:** 4 columns, height 74, radius 12, gap 10. Currently-selected: 2px stroke `#1A1A1A`. Others: no stroke.
- **Actions row:** "Download all" full-width pill (height 52, radius 26, fill `#1A1A1A`, label Inter 14/600 white + lucide `download`) and a 52×52 secondary icon button (radius 26, fill `#F5F1EC`, lucide `refresh-cw` `#1A1A1A`).

## Open questions

- Bookmark behaviour — single asset or whole shoot batch?
- Share affordance — native share sheet or in-app share preview?
- Regenerate target — re-run the same prompt, or open the variants gallery to pick a different starting preview?

## Grid / layout system (if applicable)
<!-- Breakpoints, cell sizing, responsive rules -->

## API response shape
<!-- Likely: GET /jobs/:id/result → final asset(s) with download URLs and metadata. Confirm when API lands. -->

## Parser implementation
<!-- /code-agent will populate. -->

## Next steps
- Existing draft frame: `jVFCi` (`06 Final Results`).
