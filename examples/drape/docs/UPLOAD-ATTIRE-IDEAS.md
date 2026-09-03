# Upload Attire: ideas and decisions

## Route chrome
- **Route:** /upload
- **Layout:** Default (status bar + header + body + continue area + tab bar)
- **Header variant:** Simplified (back + title)
- **Footer variant:** Continue CTA + Tab Bar

## Decisions

| # | Question | Decision | Status | Type |
|---|----------|----------|--------|------|
| 1 | Upload affordance | Tall cream tile with central upload icon + helper copy ("Tap to add photos / JPG or PNG, up to 5") | locked | direction |
| 2 | Selected-photo strip | 4-column thumbnail grid below the upload tile; final cell is an "add more" tile with `+` icon | locked | variant |
| 3 | Attire metadata input | Two stacked field rows ("Type of attire", "Fabric") with chevron-right disclosure → modal/sheet picker | locked | variant |
| 4 | Step indicator | Right-aligned "1 of 3" pill in header (Inter 12/500 caption, cream pill background, warm gray text) | locked | variant |

**Direction chosen — 2026-05-01:** *Editorial Boutique India*. Upload flow is treated like a contact sheet — the cream tile is a placeholder that fills with the actual garment photographs, becoming the protagonist of the screen.

## Design variations

### Variation A — "Contact Sheet"
Header strip (back · "New Shoot" · step indicator). Body opens with a Fraunces 22 section title "Upload your attire" above a tall (160px) cream-filled upload tile with a centered circular icon-bg, primary-text helper ("Tap to add photos") and secondary helper ("JPG or PNG, up to 5"). A 4-column thumbnail row sits beneath, three filled with garment photos, the fourth a hairline-bordered `+` tile. Below, a second section "Attire details" lists two field rows (Type of attire / Fabric) with chevron disclosure. Continue pill anchors above the tab bar.

### Variation B — "[name]"
<!-- Same depth. Different spatial concept. -->
<!-- Pending exploration if/when revisited. -->

## Locked spec (drawn frame)

- **Frame:** `yTtlh` (`02 Upload Attire`)
- **Header:** Back icon (lucide `arrow-left`) · Fraunces 17/500 title "New Shoot" · cream pill "1 of 3" (Inter 12/500, `#7A736B`)
- **Section titles:** Fraunces 22, weight 500, `#1A1A1A`
- **Upload tile:** height 160, cornerRadius 16, fill `#F5F1EC`, stroke `#E8E2DA` × 1.5
  - Inner icon background: 48×48, radius 24, fill `#FFFFFF`, lucide `upload` icon
  - Helper primary: Inter 14/500 `#1A1A1A`
  - Helper secondary: Inter 12/400 `#7A736B`
- **Thumbnails:** 4 columns, height 78, radius 12, gap 10. Empty cell uses 1.2px stroke `#E8E2DA`, plus icon `#7A736B`.
- **Field row:** height 56, radius 14, fill `#FFFFFF`, stroke `#E8E2DA` × 1, padding `[0, 18]`. Label (Inter 12 `#7A736B`) + value (Inter 14/500 `#1A1A1A`) stacked left, chevron right `#7A736B`.
- **Continue area / Tab bar:** see route chrome above; CTA pill width = full container, height ~56, radius 28, fill `#1A1A1A`.

## Open questions

- Multi-photo capture vs single (the 4-thumb grid implies up to 5 — confirm against backend constraints).
- Field picker UX: bottom sheet vs full-screen modal — *see Design rationale 2026-05-01 below.*

## Design rationale — 2026-05-01 (upload integration)

### Active settings
- DESIGN_VARIANCE: distinctive (7-8), MOTION_INTENSITY: micro-only (3-4), TYPE_CONTRAST: dramatic (8-9), COLOR_ECONOMY: restrained (2-3), GRID_DENSITY: comfortable (4-5), PERSONALITY: warm

### Reference frame
- `yTtlh` (Upload Attire — A: Contact Sheet) — locked parent context for both pickers
- New patterns introduced: bottom sheet, inline expand. No prior project precedent — both align with the editorial register (Fraunces titles, generous radii, single terracotta accent).

### Question 1 — Photo source picker (after tapping upload tile or `+` tile)

#### Variant A: Bottom sheet — editorial list rows  *(rendered in Pencil: frame `N8sfdW`)*

A standard iOS-style bottom sheet (390×404, rounded top 28, 60% black scrim behind). Contents top-to-bottom:
- 36×4 cream handle bar (centered)
- Fraunces 22/500 "Add photos" title
- 3 source rows, each: 44×44 cream icon-tile (`Camera`, `Image`, `Folder` lucide) + stacked Fraunces 16/500 name + Inter 12/400 helper. Rows: "Take a photo / Use the camera now", "Choose from library / Pick up to 5 photos", "Browse files / From iCloud Drive or Files".
- Cream pill "Cancel" footer (Inter 14/500)

**Critique**
- ✅ Hierarchy: each row's name dominates; helper provides context. Three options is the right cardinality for iOS source pickers.
- ✅ Typography: Fraunces title + Fraunces row names + Inter helper hits dramatic TYPE_CONTRAST.
- ✅ Anti-patterns: no AI fingerprints. One terracotta-free sheet — accent is reserved for selection state in the parent screen, not for source picking.
- ✅ Taste: warm personality, restrained color, micro-motion only.
- ⚠️ Editorial cost: the row layout is iOS-idiomatic but visually quiet — doesn't lean into the "photography is the protagonist" heuristic. The user's *next* step is choosing a photo, but this sheet doesn't preview anything photographic.

#### Variant B: Bottom sheet — visual cards  *(rendered in Pencil: frame `PHGrF`; deprecated for v1, kept as v2 reference)*

Same 60% black scrim + bottom sheet (390×404, rounded top 28). Contents:
- 36×4 cream handle bar (centered)
- Stacked title block: Fraunces 22/500 "Add photos" + Inter 13/400 secondary "Pick a source"
- A 3-up horizontal card row, each card 1fr × 140 tall, radius 18, fill cream:
  - Camera card → 28px lucide `camera` icon + Fraunces 16/500 "Camera"
  - Library card → 28px lucide `image` icon + Fraunces 16/500 "Library"
  - Files card → 28px lucide `folder` icon + Fraunces 16/500 "Files"
- Cream pill "Cancel" footer

**Critique**
- ✅ Visual register: the card grid leans into "photography is the protagonist" — each card visually anticipates the photo it'll yield.
- ✅ Distinctiveness: most projects use list rows for source pickers; this is more distinctive (matches DESIGN_VARIANCE distinctive).
- ⚠️ Information density: 3 cards in a row at 390 width = ~106px each. Tight for both icon + label. Card height of 140 is generous but creates a sheet that's nearly the same height as A while showing less explicit information (no helper text).
- ⚠️ Taste alignment: GRID_DENSITY comfortable. Cards push toward sparse — fine, but borderline.
- ⚠️ Affordance: cards may not signal "tap me" as clearly as list rows do (lists have known iOS affordance + chevron). Consider a subtle stroke or pressed state.

#### Trade-offs A vs B

- **A** is iOS-conventional, easy to scan, gives the most context per option (helper line). Best when source choice is purely functional.
- **B** is more distinctive and on-brand, prioritizes visual register over information density. Best when the brand wants every screen to feel curated.
- **Recommended:** **A for v1** — it's the lower-risk default, matches platform expectations, and the helper line resolves the ambiguity of "what does Library mean here?". Keep B in the back pocket if user testing shows the source picker feels too "system-y" relative to the rest of the app.

### Question 2 — Field row picker (Type of attire / Fabric)

#### Variant A: Bottom sheet — radio list  *(rendered in Pencil: frames `kmdnD` (Type of attire) and `Q8pzF` (Fabric))*

Bottom sheet (390×564, rounded top 28, 60% black scrim). Contents:
- 36×4 cream handle bar
- Fraunces 22/500 title (e.g. "Type of attire")
- Vertical list of 6 options: Saree, Lehenga, Kurta, Anarkali, Sherwani, Dupatta. Each row:
  - Padding `[14, 0]`, full width
  - Fraunces 17 label left
  - Lucide `check` icon (terracotta `#8B3A2F`) on the right when selected
  - Selected row uses Fraunces 17/**500** (vs 17/400 unselected) for additional weight cue
- Cream pill "Cancel" footer

**Critique**
- ✅ Hierarchy: title dominates, option list reads like a magazine ToC entry. Fits the editorial register.
- ✅ Typography: Fraunces 17 for option names — first time the system uses Fraunces at this size for non-title content. It's slightly outside the established type scale (which has 16 for card names but skips 17). Consider promoting Fraunces 17 to the type scale or reverting to Fraunces 16.
- ✅ Selection state: terracotta check + weight bump = structural + redundant cue (color-blind safe).
- ✅ Anti-patterns: no AI fingerprints. List of 6 options is appropriate cardinality.
- ⚠️ Long lists: if the catalog grows beyond ~8 options, the sheet will need scroll. Add a sticky title + scrollable list pattern when that happens.

#### Variant B: Inline chip expand  *(documented in prose; Pencil rendering hit a layout quirk)*

No scrim, no overlay. The tapped field row expands inline, replacing the chevron-right with chevron-up and revealing a chip cluster directly below. Layout:
- Field row stays in place (height 56, radius 14, white surface) — but acquires a 1.5px terracotta stroke to indicate "expanded" state, and the chevron rotates to up
- A chip row appears 12px below the field row, padded to the same horizontal extent:
  - Pill chips, each: padding `[8, 14]`, radius 18, fill white, hairline subtle border
  - Selected chip: 1.5px terracotta border (matches the parent field's stroke)
  - First few options visible inline: "Saree" (selected), "Lehenga", "Kurta"
  - Final chip: "+ N more" (cream-fill pill with secondary text) → opens the full bottom sheet (Variant A) for less-common options

The Fabric field below stays collapsed.

**Critique**
- ✅ Distinctiveness: most apps use sheets for everything. Inline expand keeps the user oriented on the upload screen — they don't lose context. Aligns with DESIGN_VARIANCE distinctive.
- ✅ Editorial register: chips read like editorial tags ("Saree · Silk · Studio"), reinforcing the magazine ToC feel.
- ⚠️ Cardinality limit: only ~3–4 chips fit in a row at 390 width. The "+ N more" escape hatch handles overflow but adds a second-tap path. If the typical user picks one of the top 3 options, this is great. If they often pick "Anarkali" or below, it becomes a friction point.
- ⚠️ Two patterns coexist: inline expand for top options + bottom sheet for the long tail. More complex than a single sheet pattern. Engineering cost is non-trivial.
- ⚠️ Push behavior: when the field expands, the Fabric field below should push down (not get covered). On a 390×844 canvas this means scrolling the body — adds motion that competes with the "micro-only" MOTION_INTENSITY heuristic.

#### Trade-offs A vs B

- **A** is conventional, scales to any catalog size, has zero context loss (full sheet shows all options). Best when the picker needs to surface many options.
- **B** is more distinctive, keeps the user on the upload screen, leans into the editorial chip vocabulary. Best when the catalog is small (3-4 common options + a long tail).
- **Recommended:** **A for v1, B as a v2 enhancement.** A's predictability beats B's novelty for first-time users, and A handles future catalog growth without re-architecting. Revisit B once usage data shows whether users pick from the top 3 options most of the time.

### Combined recommendation

For v1: **Photo source A + Field picker A** (both bottom sheets). Consistent pattern across both pickers, lowest implementation cost, predictable for users new to the app. The bottom-sheet treatment in `N8sfdW` becomes the design template — Type-of-Attire (`kmdnD`) and Fabric (`Q8pzF`) pickers reuse the same chrome (handle bar, Fraunces title, list rows, cream Cancel pill) with content swapped in.

For v2 if usage data supports it: consider B for one of the two questions to add distinctiveness — most likely the field picker (Variant B inline expand) since it resolves a real friction point (choosing between two short fields without leaving the screen).

### Pencil rendering note (2026-05-02)

The Type-of-Attire and Fabric picker frames (`kmdnD`, `Q8pzF`) are built atop copies of the Photo Source A row template, not freshly-inserted nodes. This is a workaround for a Pencil rendering quirk where children inserted via `batch_design` into a cloned sheet sometimes do not paint, even though they are present in the data. Updates to copied descendants do paint. The visual outcome matches the radio-list spec: Fraunces 17 label left, terracotta `check` icon right (selected), weight bump from 400 → 500 on the selected row. Code-side, this template equivalence means a single `<BottomSheet><RadioList />` component can render both pickers — the design comp and the code can converge cleanly.

## Grid / layout system (if applicable)
<!-- Breakpoints, cell sizing, responsive rules -->

## API response shape
<!-- Greenfield — backend contract not defined yet. -->
<!-- Likely: POST multipart upload → { uploadId, previewUrl, derivedAttributes? }. Confirm when API lands. -->

## Parser implementation
<!-- /code-agent will populate when the upload flow is wired. -->

## Next steps
- Existing draft frame: `yTtlh` (`02 Upload Attire`).
