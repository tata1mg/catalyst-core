# Welcome: ideas and decisions

## Route chrome
- **Route:** /
- **Layout:** Custom (full-bleed hero, no header/footer)
- **Header variant:** None
- **Footer variant:** None

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | Primary layout | Hero photograph above the fold, brand + copy + CTAs anchored to the bottom half | locked | direction |
| 2 | Hero treatment | Full-bleed editorial fashion photograph (no overlay text) | locked | variant |
| 3 | CTA pattern | Single primary pill (`Get Started`) + plain text "Sign in" link | locked | variant |

**Direction chosen — 2026-05-01:** *Editorial Boutique India* — see `DESIGN-LANGUAGE.md` and `DESIGN-HEURISTICS.md`. Signature tension: serif brand wordmark (Fraunces 56) sits on warm cream beneath an editorial saree photograph, treating the app like a magazine cover rather than a SaaS landing.

## Design variations

### Variation A — "Magazine Cover"
Full-bleed model photograph occupies the top ~50% of the viewport. Below it: large Fraunces brand wordmark (`Drape`), short editorial tagline in warm gray, supporting body line, then a generous spacer that pushes the primary pill CTA + sign-in link to the bottom. The hierarchy reads top-to-bottom like flipping past a cover image to a masthead — image first, identity second, action last.

### Variation B — "[name]"
<!-- Same depth. Different spatial concept, not just a rearrangement of A. -->
<!-- Pending exploration if/when revisited. -->

## Locked spec (drawn frame)

- **Frame:** `Hymuu` (`01 Welcome`) in `design/drape.pen`
- **Hero:** 420px tall, full-bleed image fill
- **Brand:** Fraunces 56, weight 500, letter-spacing -1, `#1A1A1A`
- **Tagline:** Inter 15, regular, `#7A736B`, centered
- **Description:** Inter 13, regular, line-height 1.5, `#7A736B`, centered
- **Primary CTA:** Full-width pill, height 56, radius 28, fill `#1A1A1A`, label "Get Started" (Inter 15/600 white, letter-spacing 0.3)
- **Sign in:** Inter 13/500, `#1A1A1A`, no underline
- **Body padding:** `[36, 28, 32, 28]` (top, right, bottom, left)

## Grid / layout system (if applicable)
<!-- Breakpoints, cell sizing, responsive rules -->

## API response shape
<!-- No API for this screen — static welcome content. -->

## Parser implementation
<!-- N/A — no parsing required for this route. -->

## Hero asset history
- 2026-05-02 — regenerated via `/design-agent` to fix iOS Dynamic Island clipping the model's head. Replacement source `design/images/generated-1777692873239.png` placed at `public/welcome/hero.png`. New composition keeps the model in the lower two-thirds with ~80–100px of warm plaster headroom — Dynamic Island now lands on the backdrop. Asset is portrait (912×1168) where the original was landscape (1408×768); `.hero` is `object-fit: cover` and object-position default `center`, so the visible center band keeps plaster above and saree below.

## Next steps
- Existing draft frame: `Hymuu` (`01 Welcome`) in `design/drape.pen`. Rename per taxonomy on next edit.
