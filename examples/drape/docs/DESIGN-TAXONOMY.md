# Design taxonomy

## Lifecycle labels

| Label | Meaning |
|-------|---------|
| Draft | Exploring — not a commitment |
| Variant | Comparing options |
| Final | Approved for implementation |
| Deprecated | Replaced by a newer final |

## Sync states

| State | Meaning |
|-------|---------|
| Synced | Design and code match |
| Out of sync | One changed without the other |
| Not started | Design exists, code doesn't yet |

## Frame naming convention

All frames in Pencil .pen files follow this naming scheme. The bracket prefix is the taxonomy lifecycle label — it is the **single source of truth** for what stage a frame is in.

### Format

```
[label] Artifact Name — Letter: Short Description
```

- **`[label]`** — One of: `[draft]`, `[variant]`, `[final]`, `[deprecated]`
- **Artifact Name** — Stable concept identity (never changes across lifecycle)
- **Letter** — `A`, `B`, `C` etc. (only when comparing variants)
- **Short Description** — The spatial/layout concept (not generic like "option 1")

### Sub-component nesting

Append `> Region > Element` for sub-components:

```
[final] Hero Section — A: Side-by-side > Headline
[variant] Pricing Page — B: Master-detail > Sidebar > Tab Bar
```

### Proposal groups

When exploring variants, wrap them in a proposal group frame:

```
[proposal] Hero Section Widget — 2026-04-14
  [variant] Hero Section — A: Side-by-side
  [variant] Hero Section — B: Centered Hero
  [variant] Hero Section — C: Compact Card
```

### Lifecycle transitions

The bracket label changes when the lifecycle changes. The name stays stable.

**Exploration → Approval:**
```
[proposal] Hero Section Widget — 2026-04-14
  [final] Hero Section — A: Side-by-side
  [deprecated] Hero Section — B: Centered Hero
  [deprecated] Hero Section — C: Compact Card
```

**Iteration on approved design:**
```
[final] Hero Section — A: Side-by-side
[draft] Hero Section — A: Side-by-side v2
```

### Label text nodes

Follow `label/` prefix with the same naming:
```
label/ [variant] Hero Section — A: Side-by-side
```

### Rules

1. **Label always leads** — scannable in layer panels, instant lifecycle context
2. **Label changes, name doesn't** — rename only the bracket prefix on promotion/deprecation
3. **Every `[variant]` or `[final]` frame gets a row in the artifact index below**
4. **No unnamed frames** — delete default/empty frames created by `open_document`
5. **Proposal groups are date-stamped** — so you know when the exploration happened

## Artifact index

| Artifact | ID/Frame | Label | Sync state | Notes |
|----------|----------|-------|------------|-------|
| Welcome — A: Magazine Cover | Hymuu | Final | Synced | Implemented at `src/js/containers/Welcome/` (route `/`). Smoke-tested end-to-end 2026-05-01. Hero asset regenerated 2026-05-02 with Dynamic Island headroom (see `WELCOME-IDEAS.md` › Hero asset history). |
| Upload Attire — A: Contact Sheet | yTtlh | Final | Out of sync | Implemented at `src/js/containers/UploadAttire/` (route `/upload-attire`). Smoke-tested 2026-05-01. **Code added per-thumbnail X-remove badge and at-cap "All set" state with Check icon (2026-05-02) — Pencil frame `yTtlh` does not yet show these affordances; rerun `/design-agent` to update the comp.** |
| Shoot Type — A: Location Plate Grid | WuXtu | Final | Synced | Implemented at `src/js/containers/ShootType/` (route `/shoot-type`). Smoke-tested 2026-05-01. |
| Shoot Type — B: Editorial Carousel | gJ1Gr | Deprecated | n/a | Resolved 2026-05-01 in favour of A. Kept in Pencil under `[proposal] ... (resolved → A)` for future reference. |
| Shoot Type — C: Type-as-Visual List | FH9JR | Deprecated | n/a | Resolved 2026-05-01 in favour of A. Kept in Pencil under `[proposal] ... (resolved → A)` for future reference. |
| Generating — A: Atelier Progress | u0kSD9 | Final | Synced | Implemented at `src/js/containers/Generating/` (route `/generating`); auto-advances to `/variants-gallery` on completion. Smoke-tested 2026-05-01. |
| Variants Gallery — A: Contact Sheet 2×3 | I7E7ve | Final | Synced | Implemented at `src/js/containers/VariantsGallery/` (route `/variants-gallery`). Smoke-tested 2026-05-01. |
| Final Results — A: Magazine Spread | jVFCi | Final | Synced | Implemented at `src/js/containers/FinalResults/` (route `/final-results`). Smoke-tested 2026-05-01. |
| Upload Integration — Photo Source A: Bottom sheet list | N8sfdW | Final | Synced | Wired 2026-05-02 at `UploadAttire.js` (opens via upload-tile / `+` thumbnail tap). Canonical bottom-sheet template lives at `src/js/components/BottomSheet/`; photo source rows at `src/js/components/PhotoSourceSheet/`. Native picker bridge still TODO at the dispatch site. |
| Upload Integration — Field Picker A: Type of attire | kmdnD | Final | Synced | Wired 2026-05-02 at `UploadAttire.js` (radio sheet via `RadioListSheet`). Saree/Lehenga/Kurta/Anarkali/Sherwani/Dupatta. Selection dispatches `setAttireType` in the Upload Attire reducer. |
| Upload Integration — Field Picker A: Fabric | Q8pzF | Final | Synced | Wired 2026-05-02 at `UploadAttire.js` via the same `RadioListSheet` template. Silk/Cotton/Linen/Chiffon/Georgette/Velvet. Selection dispatches `setFabric`. |
| Upload Integration — Photo Source B: Visual cards | PHGrF | Deprecated | n/a | Resolved 2026-05-02 in favour of A. Pencil frame exists (rendered 3-up card grid) for v2 reference. |
| Upload Integration — Field Picker B: Inline chip expand | (in prose) | Deprecated | n/a | Resolved 2026-05-02 in favour of A. No Pencil frame — empty placeholder was removed 2026-05-02 since it never rendered cleanly; spec lives in prose in `docs/UPLOAD-ATTIRE-IDEAS.md` for v2 reference. |

## Rules

### When you change code
1. Update the design comp if the change is material (layout, structure, content).
2. Update sync state in the artifact index above.
3. If you skip the design update, mark as "Out of sync".

### When you change design
1. Frame name must follow the naming convention above.
2. Add or update the artifact index row with the frame ID.
3. Note whether code needs updating.
4. Update sync state accordingly.
