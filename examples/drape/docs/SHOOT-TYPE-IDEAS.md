# Shoot Type: ideas and decisions

## Route chrome
- **Route:** /shoot-type
- **Layout:** Default (status bar + content + button area + tab bar)
- **Header variant:** Simplified (back + title)
- **Footer variant:** Generate CTA + Tab Bar

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | Shoot-type presentation | 2×2 grid of photo cards (Studio · Outdoor · Urban · Palace), each with a representative image, name, and one-line descriptor | locked | direction |
| 2 | Selection model | Single-select; selected card shows 2px terracotta stroke + small terracotta check badge in top-right | locked | variant |
| 3 | Model preferences | 3-segment pill control (Female / Male / Both) — selected segment is ink-filled with white text, unselected segments are flat on cream container | locked | variant |
| 4 | Variant count | Stepper control (— · big numeric · +) inside a bordered card with helper caption "Low-res preview, ~30 sec" | locked | variant |

**Direction chosen — 2026-05-01:** *Editorial Boutique India*. The four shoot types are presented like editorial location plates — small photographic thumbnails do most of the communication; copy is reserved for a single descriptor.

## Design variations

### Variation A — "Location Plate Grid"
Header strip (back · "New Shoot" · step "2 of 3"). Body title "Choose shoot type" (Fraunces 22) sits above a 2×2 grid of cards. Each card: white surface, radius 16, padding 10, stroke 1px `#E8E2DA` (or 2px `#8B3A2F` selected), interior is image thumb + bold name + descriptor. Below the grid: two stacked smaller sections — "Model preferences" (Fraunces 18) with the segmented pill, then "How many variants?" (Fraunces 18) with the stepper card and a caption helper. Generate Preview pill anchors above the tab bar.

### Variation B — "Editorial Carousel"
A single full-bleed featured card (220 tall, radius 20) shows the currently-selected shoot type with an overlay scrim chip naming it. Below the hero, a 4-up chip row (image-only thumbnails, 78 tall, radius 14) acts as a horizontally-readable selector — the studio chip carries a 2px terracotta selection stroke that mirrors the hero. The pattern trades parallel comparison for image gravitas: photography dominates the viewport, and switching shoot type becomes a tap-to-promote interaction rather than a visual A/B/C/D scan.

### Variation C — "Type-as-Visual List"
Vertical stack of 4 full-width rows, each row leads with the shoot-type name set in Fraunces 32 + a one-line Inter 12 descriptor; a small 52×52 image plate sits at the right of each row. The selected row (Studio) shifts to a cream fill (`#F5F1EC`) and the plate gains a 2px terracotta stroke. The pattern reads like a magazine table of contents — typography is the protagonist, photography becomes supporting evidence. This is the most distinctive of the three and the most committed interpretation of *Editorial Boutique India*.

## Design rationale — 2026-05-01

### Active settings
- DESIGN_VARIANCE: distinctive (7-8), MOTION_INTENSITY: micro-only (3-4), TYPE_CONTRAST: dramatic (8-9), COLOR_ECONOMY: restrained (2-3), GRID_DENSITY: comfortable (4-5), PERSONALITY: warm

### Reference frame
- `WuXtu` (Shoot Type — A: Location Plate Grid) — the locked Variation A. Reused chrome (status bar, header, model-prefs section, stepper, continue area, tab bar) via Pencil Copy operations to keep variants visually consistent with A.

### Variants generated
- **B: Editorial Carousel** — featured-hero + chip row. Photography-first.
- **C: Type-as-Visual List** — type-led row stack. Typography-first.

### Variant B critique

**Anti-pattern scan:** PASS. No AI fingerprints. Not "three equal cards", not centered-everything, not auto-play carousel.

**What's working**
- Hero card as protagonist aligns with the "photography is the show" rule.
- The scrim chip does double duty: identifies the selection AND adds editorial weight.
- Chip row preserves selectability without competing with the hero.

**Priority issues**
- ⚠️ **Selection appears twice** — the scrim chip names "Studio · Clean backdrop, soft light" while the studio chip below also shows the terracotta stroke. Redundant. *Fix:* drop the studio descriptor from the scrim chip and just show the name, or remove the stroke from the active chip and rely solely on the scrim chip identification.
- ⚠️ **No at-a-glance comparison** — user has to tap each chip to see its image promoted. Trade-off, not a defect, but worth surfacing.

**Taste alignment:** All settings respected. TYPE_CONTRAST sits within range but doesn't push the dramatic ceiling — the hero image, not type, is the dominant visual.

**Subjective feel:** Calm. Editorial. Image-led. Strongest variant if the brand wants photography to remain the through-line across all wizard steps.

### Variant C critique

**Anti-pattern scan:** PASS. No AI fingerprints. Distinct row pattern, not card grid; not centered, not auto-play.

**What's working**
- The most distinctive of the three — commits hardest to typography-as-identity.
- Single-glance comparison of all four shoot types (advantage A has but B doesn't).
- Reads like a magazine ToC entry — fully on-brand for *Editorial Boutique India*.

**Priority issues**
- ⚠️ **Photography demoted** — image plate is 52×52, much smaller than A's 64×64 thumb or B's full-width hero. Mildly contradicts the "photography is the show" heuristic.
- ⚠️ **Type compromise** — Fraunces had to drop from 36 → 32 to make the stepper fit on a 390×844 canvas. The dramatic register holds (Fr32 vs Inter12 is still 2.7×), but a true Fr36 type-led layout would push some other content off-screen. *Fix candidates:* tighten model-prefs/stepper section gaps, or accept Fr32 as the cap for this canvas.
- ⚠️ **Selection cue depends on cream fill differential** — `#F5F1EC` vs `#FFFFFF` is subtle in normal viewing conditions; the 2px terracotta plate stroke does the heavy lifting. This is fine but worth knowing if you ever consider a darker selection fill.

**Taste alignment:** Pushes TYPE_CONTRAST hardest of the three (within range). GRID_DENSITY runs comfortable but tight — required compression to fit.

**Subjective feel:** Editorial, magazine-ToC, type-led. Strongest if the brand wants the editorial register to be the through-line.

### Resolution — 2026-05-01
**Locked: Variation A (Location Plate Grid).** B and C marked `[deprecated]` in the Pencil proposal group; kept for reference. Implementation proceeds against frame `WuXtu`.

### Trade-offs

- **A vs B:** A gives parallel at-a-glance comparison; B gives image-as-protagonist. A is faster to scan; B is more aspirational.
- **A vs C:** A treats each shoot type as an option; C treats each as a chapter heading. C is more distinctive but demotes photography.
- **B vs C:** Same single-protagonist problem solved two ways — B picks photography, C picks typography. Mutually exclusive register choices.
- **Recommended within the locked direction:** **B** if image-first is the through-line; **C** if editorial-typography is the through-line; **A** is the safe default and remains locked. Pick one of B/C only if you want to pivot the wizard's signature move from "card grid" to either "image carousel" or "type list" — whichever you pick should propagate to the other wizard steps for visual consistency.

## Locked spec (drawn frame)

- **Frame:** `WuXtu` (`03 Shoot Type`)
- **Section title (large):** Fraunces 22, weight 400, `#1A1A1A`
- **Section title (small):** Fraunces 18, weight 400, `#1A1A1A`
- **Card grid:** 2 columns, gap 12 between rows and columns, each card radius 16, fill `#FFFFFF`, padding 10
  - **Default stroke:** 1px `#E8E2DA`
  - **Selected stroke:** 2px `#8B3A2F`
- **Segmented pill:** container radius 24, fill `#F5F1EC`, padding 4, height 44, gap 4. Selected segment: radius 20, fill `#1A1A1A`, label white. Unselected: no fill, label `#1A1A1A`.
- **Stepper card:** radius 16, fill `#FFFFFF`, stroke `#E8E2DA` × 1, height 56, padding `[0, 8]`
  - Minus button: 40×40, radius 20, fill `#F5F1EC`
  - Numeric: Fraunces 28/500 `#1A1A1A`
  - Plus button: 40×40, radius 20, fill `#1A1A1A`
- **Helper caption:** Inter 11/400 `#7A736B`
- **Primary CTA:** full-width pill `Generate Preview →` (lucide `arrow-right`)

## Open questions

- Are shoot types a fixed catalog (Studio/Outdoor/Urban/Palace) or extensible from API?
- "Both" segment for model preference — does it generate ½/½, or one of each variant?

## Grid / layout system (if applicable)
<!-- Breakpoints, cell sizing, responsive rules -->

## API response shape
<!-- Likely: GET /shoot-types → list of preset types with thumbnail + label + descriptors. Confirm when API lands. -->

## Parser implementation
<!-- /code-agent will populate. -->

## Next steps
- Existing draft frame: `WuXtu` (`03 Shoot Type`).
