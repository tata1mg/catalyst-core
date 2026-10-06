# Design language

## Direction
**Editorial Boutique India** — drape borrows the typographic vocabulary of fashion print magazines (serif display headlines, generous whitespace, warm cream paper) and applies it to a utility wizard. The serif treatment elevates what could feel like a generic SaaS upload flow into a tool that respects the artistry of the garment.

**Signature tension:** editorial gravity (Fraunces display, breathing room, restrained palette) running alongside utility chrome (status bar, progress ring, multi-step header, tab bar). The chrome is honest about what the app does; the typography signals what it's *for*.

**Adjacent traditions:** Vogue India / Verve cover typography; The Row, Khaite, Aman e-commerce restraint.

## Typography
Two-family system, intentionally contrasting:

- **Display: Fraunces** — modern transitional serif. Carries every screen-level title, brand mark, and numeric callouts. Weight 500 at large sizes, regular at body-of-display sizes. Negative letter-spacing on the largest sizes (-1 at 56pt).
- **Body / UI: Inter** — geometric sans. All body copy, button labels, helper text, meta. Weights 400/500/600. Mild positive letter-spacing on small uppercase-feeling labels (`0.3 – 1`).

Scale philosophy: **dramatic, not modular**. The brand wordmark sits at 56pt and the smallest label at 10pt — a ~5.6× range — and the serif/sans pairing reinforces the contrast at every step. Don't introduce mid-scale Fraunces sizes that blur the line between "display" and "section title".

Pairing rule: serif speaks identity (titles, hero copy, big numerics), sans speaks function (controls, descriptions, progress text). Never mix on the same line.

## Color strategy
Warm-neutral palette with **a single accent**.

- One terracotta accent (`#8B3A2F`) carries every point of intent: selected state on cards, primary progress arc, current-step rail, focused outline.
- Everything else is a warm neutral ramp: cream board, white screen, near-black ink, warm gray secondary, light beige border.
- No cool tones, no second accent, no semantic green/blue/yellow status colors. When status needs to be communicated (success, in-progress), it's done with the terracotta + iconography, not by adding a hue.

This is restraint by intent, not by accident. Adding any second hue dilutes the editorial register.

## Layout principles
- **Mobile-first iPhone canvas** (390×844, 48px device corner). Every comp is drawn at this size; web/tablet are responsive expansions of this column, not separate compositions.
- **Single-column flow** with sectioned vertical rhythm. Section headers are Fraunces 18–22; section bodies are Inter; gaps between sections are 24, gaps within a section are 12–14.
- **Outer page padding: 20** on body content; status/tab chrome carry their own.
- **Generous corner radii everywhere.** Nothing is rectilinear: thumbnails 10–12, fields 14, cards 16, chips/scrim badges 18–20, segmented control 20–24, primary CTA pill 26–28, the device itself 48. Sharp corners don't appear in the system.
- **Cards over lists.** When showing options or images, the default is a bordered or photo-filled card with internal padding (10–14), not a list row. Borders are 1–1.5px in `#E8E2DA`; selection is a 2px accent stroke.

## Interaction philosophy
- **Micro-motion only.** The only animated surface is the progress ring on the Generating screen (sweep angle on a stroked ellipse). Buttons, cards, tabs, and transitions should feel instant and quiet — no spring-loaded card hops, no parallax, no shimmer skeletons.
- **Selection is structural, not decorative.** Selected = 2px accent stroke + small accent check badge in the corner. No fill swap, no scale, no color flood. The image inside the card is the protagonist; the selection mark is a quiet endorsement.
- **Primary actions are full-width pills** (height 52–56, radius 26–28, ink fill `#1A1A1A`, white label). Secondary actions are text links in `#1A1A1A` or in a soft cream pill (`#F5F1EC`).
- **Photography is the show.** UI chrome is deliberately quiet so generated images can dominate the eye. Don't add gradients, frames, drop shadows, or color overlays to imagery — let it sit on the cream canvas and breathe.

## Spatial layering (no shadows)
The system never uses drop shadows for elevation — they break the editorial register. Spatial separation between layers is communicated three ways:
1. **Stroke + fill contrast** (default) — a 1px hairline border in `--color-border-subtle` plus a surface fill different from the background.
2. **Backdrop frosted glass** for floating chrome that overlays scrolling content (the tab bar pill is the canonical case). `background-color: rgba(255, 255, 255, 0.86); backdrop-filter: blur(20px) saturate(1.4)` — the slight saturation bump preserves the warmth of the warm-neutral palette behind the blur.
3. **Cream sub-surface** when one rounded card sits on the surface — `--color-canvas` (cream) under, white card on top.
