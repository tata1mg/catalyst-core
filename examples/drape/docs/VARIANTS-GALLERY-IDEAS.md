# Variants Gallery: ideas and decisions

## Route chrome
- **Route:** /variants/:jobId
- **Layout:** Default (status bar + content + tab bar)
- **Header variant:** Simplified (back + title)
- **Footer variant:** Tab Bar

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | Grid density | 2-column grid, 3 rows (6 cells) — radius-md image cards filling the viewport | locked | variant |
| 2 | Selection model | Single-select for upscale (one variant becomes the "high-res" candidate); selected card shows 2px terracotta stroke + small terracotta check badge | locked | direction |
| 3 | Header pattern | Back · Fraunces 22 "Choose preview" + tiny Inter 12 "Step 3 of 3" subtitle stacked left, lucide `ellipsis` overflow menu right | locked | variant |
| 4 | Helper copy | One Inter 12 line beneath the header explaining the upscale interaction ("Tap a preview to upscale into high-res shots.") | locked | variant |
| 5 | Footer info | Status row: "1 selected · 4 high-res images" left, "Regenerate" inline link right (with refresh-cw icon) | locked | variant |

**Direction chosen — 2026-05-01:** *Editorial Boutique India*. Grid is read as a contact sheet — equal-weight images with no captions, the user picks a "winner".

## Design variations

### Variation A — "Contact Sheet 2×3"
Header row (back · stacked title block · ellipsis menu). One-line helper sits below the title. Body is a 2-column × 3-row image grid (6 cells), each cell radius-md `radius-md`, gap 10, image fill. Selected cell carries a 2px terracotta stroke and a small terracotta check badge top-right. Footer block: status info row + full-width "Generate high-res →" pill. Tab bar anchors the bottom.

### Variation B — "[name]"
<!-- Same depth. Different spatial concept. -->
<!-- Pending exploration if/when revisited. -->

## Locked spec (drawn frame)

- **Frame:** `I7E7ve` (`05 Variants Gallery`)
- **Header L:** Back icon · stacked Fraunces 22/500 "Choose preview" + Inter 12/500 `#7A736B` "Step 3 of 3"
- **Header R:** lucide `ellipsis` `#1A1A1A`
- **Helper copy:** Inter 12/400 `#7A736B`, line-height 1.4, full width
- **Grid:** 3 row frames each 2 columns wide, gap 10 row, gap 10 column. Each cell is an image-fill frame, radius `radius-md`.
- **Selection:** 2px stroke `#8B3A2F`, top-right check badge (small accent circle with white tick)
- **Status row:** Inter 12/400 `#7A736B` left + "Regenerate" inline icon-text affordance right (lucide `refresh-cw`)
- **Primary CTA:** full-width pill, radius 27, height 54, fill `#1A1A1A`, label "Generate high-res" + lucide `arrow-right`

## Open questions

- Does selection persist across regenerate? (Likely no — fresh batch resets selection.)
- Multi-select: do we ever want to upscale 2+ in one go, or is single-select the lock?
- Overflow menu items — what lives behind the ellipsis (Save batch, Share preview sheet, Report)?

## Grid / layout system (if applicable)
<!-- Breakpoints, cell sizing, responsive rules -->

## API response shape
<!-- Likely: GET /jobs/:id/variants → list of generated images with metadata { id, url, prompt, score? }. Confirm when API lands. -->

## Parser implementation
<!-- /code-agent will populate. -->

## Next steps
- Existing draft frame: `I7E7ve` (`05 Variants Gallery`).
