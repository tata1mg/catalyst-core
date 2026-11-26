# drape

AI photo generation for clothing lines. Universal app — web (SSR) + iOS/Android via webview — built on [catalyst-core](https://catalyst.1mg.com).

## Stack

- React + Redux Toolkit
- `@tata1mg/router` for routing (SSR-safe)
- Tailwind v4, SCSS modules where scoped styles are needed
- Tokens in `src/static/css/resources/_variables.scss` (mirrors `docs/DESIGN-TOKENS.md`)
- Pencil for design comps (`design/drape.pen`)

## Getting started

Dev server:

```bash
npm run start
```

Production build (flip `NODE_ENV` to `"production"` in `config/config.json` first):

```bash
npm run build
npm run serve
```

Mobile builds:

```bash
npm run buildApp:ios
npm run buildApp:android
```

Lint:

```bash
npm run lint
```

## Project layout

- `src/js/containers/` — feature reducers + screens (Welcome, UploadAttire, etc.)
- `src/js/routes/index.js` — route registry
- `src/js/store/index.js` — Redux store + reducer registration
- `src/js/components/` — shared UI (BottomSheet, PhotoSourceSheet, RadioListSheet, …)
- `docs/` — spec, design language, tokens, heuristics, per-feature idea docs
- `design/drape.pen` — Pencil design file (single source of truth for comps)

## Conventions

See `CLAUDE.md` and `docs/REPO-CONVENTIONS.md`. Highlights:

- All internal navigation uses `@tata1mg/router` `Link` / `useNavigate` — never raw `<a href>` (breaks SSR hydration).
- Every visual value traces to a token in `docs/DESIGN-TOKENS.md`. No orphan hex / px literals.
- Locked decisions in `docs/` are hard constraints — don't renegotiate without reopening the decision.
- Use catalyst-core's platform-agnostic methods (camera, library, share, …) instead of hand-rolling web↔native splits.

## Docs

- `docs/BRIEF-AND-DIRECTION.md` — goals, audience, constraints
- `docs/DESIGN-LANGUAGE.md` — typography, color, layout philosophy
- `docs/DESIGN-TOKENS.md` — token table
- `docs/DESIGN-HEURISTICS.md` — taste settings
- `docs/MOTION-DIRECTION.md` — motion sub-spec
- `docs/DESIGN-TAXONOMY.md` — artifact index + sync states
- `docs/REPO-CONVENTIONS.md` — routing, state, styling, SSR, analytics
- Per-feature: `docs/WELCOME-IDEAS.md`, `UPLOAD-ATTIRE-IDEAS.md`, `SHOOT-TYPE-IDEAS.md`, `GENERATING-IDEAS.md`, `VARIANTS-GALLERY-IDEAS.md`, `FINAL-RESULTS-IDEAS.md`
