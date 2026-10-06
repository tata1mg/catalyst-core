# Design heuristics

Taste settings derived from the locked direction. `/design-agent` reads these to keep variant generation within the project's voice.

**Direction:** Editorial Boutique India (see `DESIGN-LANGUAGE.md` for the full read).
**Date locked:** 2026-05-01
**Source:** Reverse-engineered from `design/drape.pen` — the design was built before the docs.

## Settings

- **DESIGN_VARIANCE: distinctive (7-8)** — the design has a strong, specific point of view (editorial Indian fashion). Variants should feel different from each other, not be permutations of the same template. Avoid SaaS-default templates.
- **MOTION_INTENSITY: micro-only (3-4)** — see `docs/MOTION-DIRECTION.md` for the full motion sub-spec (durations × easings × triggers). The "micro-only" floor is iOS native (push transitions, modal sheets, segmented slides, tap rebounds, lazy image fade-ins) — these are sanctioned. Off-limits within micro-only: parallax, scroll-triggered reveals on body content, multi-element spring choreography, hover zooms on mobile.
- **TYPE_CONTRAST: dramatic (8-9)** — the type scale spans 56pt → 10pt with serif/sans pairing reinforcing the gap. Lean on size and family contrast for hierarchy; resist mid-scale Fraunces sizes that blur display from section.
- **COLOR_ECONOMY: restrained (2-3)** — one terracotta accent (`#8B3A2F`) carries every point of intent. Everything else is a warm-neutral ramp. Adding a second hue dilutes the editorial register.
- **GRID_DENSITY: comfortable (4-5)** — generous outer padding (20), section gaps (24), card paddings (10–14). Not sparse (which would feel gallery-like) and not dense (which would feel like a SaaS dashboard).
- **PERSONALITY: warm** — cream canvas, terracotta accent, soft generous radii, serif identity type. Never cool, technical, or playful-cute.

## Rules of thumb

- **Photography is the protagonist.** UI chrome stays quiet so generated images can dominate. No gradients, frames, drop shadows, or color overlays on imagery.
- **Selection is structural, not decorative.** 2px accent stroke + small accent check badge. No fill swap or scale.
- **Cards over lists** for option groups (shoot type, variants).
- **Single-column flow** with sectioned vertical rhythm — section headers in Fraunces, bodies in Inter, 24px between sections.
- **Primary CTA = full-width pill, ink fill, white label.** This is the only button that takes the full column width.

## Reaffirmations

<!-- One line per challenge cycle: "[YYYY-MM-DD] Reaffirmed after challenge: [rationale]". -->
