# oxlint + oxfmt migration benchmark

Machine: Apple M3 Pro (11 cores), Node v22.14.0, npm 10.9.2, macOS (Darwin 25.5.0)
Method: 3 sequential wall-clock runs per command (`node Date.now()` around the command), no daemon/cache cleared between runs.
Date: 2026-08-07

## Baseline (before migration)

Tools: eslint 8.57.1 (legacy `.eslintrc`, @babel/eslint-parser), prettier 3.8.3

| Command                  | Scope                  | Run 1   | Run 2   | Run 3   |
| ------------------------ | ---------------------- | ------- | ------- | ------- |
| `npx eslint .`           | packages/catalyst-core | 3358 ms | 2494 ms | 2546 ms |
| `npx prettier . --check` | repo root              | 2647 ms | 2482 ms | 2477 ms |

Diagnostics baseline (for parity comparison after migration):

- `eslint .` in packages/catalyst-core: **1 error** — `no-unused-vars` ('exec') at `src/native/androidSetup.js:3`
- `prettier . --check`: **146 files unformatted** (drift — prettier only ever ran on staged files via lint-staged), plus **1 hard parse error**: `examples/useai/src/js/pages/Delta/Delta.js:155` — raw `->` inside JSX text (pre-existing, also breaks prettier today)

Dependency footprint (repo root):

- `node_modules`: 189 MB, ~498 top-level packages
- lint/format-related devDeps: eslint, @babel/eslint-parser, eslint-plugin-babel, eslint-plugin-react, eslint-plugin-react-hooks, eslint-plugin-react-compiler, eslint-plugin-risxss, eslint-plugin-security, prettier (9 packages + transitive)

## After migration (oxlint + oxfmt)

Tools: oxlint 1.77.0 (`.oxlintrc.json`, jsPlugins: eslint-plugin-security, eslint-plugin-risxss, eslint-plugin-react-compiler), oxfmt 0.62.0

| Command                                     | Scope                  | Run 1   | Run 2   | Run 3   | vs baseline (median)             |
| ------------------------------------------- | ---------------------- | ------- | ------- | ------- | -------------------------------- |
| `npx oxlint`                                | packages/catalyst-core | 2483 ms | 2096 ms | 2023 ms | **1.2x faster** (2546 → 2096 ms) |
| `npx oxlint` without jsPlugins (diagnostic) | packages/catalyst-core | 236 ms  | 215 ms  | 215 ms  | **11.8x faster** (2546 → 215 ms) |
| `npx oxfmt --check`                         | repo root              | 684 ms  | 485 ms  | 476 ms  | **5.1x faster** (2482 → 485 ms)  |

The oxlint gap is entirely the JS-plugins compatibility layer (Node.js startup + plugin
execution for security/risxss/react-compiler). Native rules alone run in ~215 ms.

### Parity verification

- **Lint**: on the old ESLint scope (`.js` files), oxlint reports **exactly the baseline error set**
  (1 error: unused 'exec' in `src/native/androidSetup.js`). 9 additional findings, all in
  `.jsx`/`.mjs` files that legacy `eslint .` never linted (v8 default only covered `.js`):
  2 risxss XSS flags in `src/server/renderer/document/Head.jsx`, 2 exhaustive-deps in
  `RouterDataProvider.jsx`, 1 react-compiler in `MetaTag.jsx`, 4 unused imports/vars.
- **Format (file lists)**: prettier would reformat 149 files, oxfmt 148 — oxfmt's list is a strict
  subset of prettier's. Sole divergence: `packages/catalyst-core/src/web-router/types/context.d.ts`
  (prettier wants a change, oxfmt is satisfied).
- **Format (content)**: formatted two full copies of the repo (minus node_modules/.git) with
  prettier 3.8.3 (original configs) and oxfmt 0.62.0 (new configs) — resulting trees are
  **byte-identical** across all file types (js, jsx, scss, css, md, json, yml, html).

### Dependency footprint

- `node_modules`: 189 MB / ~498 packages → **186 MB / ~400 packages**
- Removed from package.jsons: eslint, @babel/eslint-parser, eslint-plugin-babel,
  eslint-plugin-react, eslint-plugin-react-hooks, prettier (×3 packages)
- Kept (loaded via oxlint jsPlugins): eslint-plugin-security, eslint-plugin-risxss,
  eslint-plugin-react-compiler
- Note: eslint 8.57.1 still lands on disk as an auto-installed peer dependency of
  eslint-plugin-react-compiler; it is no longer in any package.json.

### Intentional behavior deltas (documented, not accidental)

1. `react/prop-types` dropped — not implemented natively in oxlint; was warn-only, low value on React 19.
2. `risxss/catch-potential-xss-react` runs without its `trustedLibraries: ["@commonUtils"]` option —
   the plugin declares no options schema (pre-ESLint-v9), and oxlint validates strictly. Inert here:
   `@commonUtils` is unused in catalyst-core.
3. `no-unused-vars` pinned to `caughtErrors: "none"` (ESLint v8 default) — oxlint's v9 default would
   add ~25 unused-catch-param errors.
4. `no-unused-expressions` off — oxlint's correctness category enables it; not part of
   eslint:recommended baseline.
5. `.lintstagedrc.cjs` path normalization fixed: lint-staged passes absolute paths but the allowlist
   matched relative prefixes with startsWith — **the ESLint pre-commit step never actually ran**
   (only Prettier did). The oxlint step now genuinely fires; commits touching allowlisted files with
   pre-existing errors (e.g. `src/native/androidSetup.js`) will be blocked until fixed.

### Recommended follow-ups

- Enable `react/rules-of-hooks` (off for parity): first run flagged real conditional hook calls in
  `src/native/bridge/hooks/` (useCamera, useDataProtection, useGoogleSignIn, useIntent).
- Consider eslint-plugin-react-hooks v6 via jsPlugins to replace eslint-plugin-react-compiler
  (bundles the compiler rule; drops the eslint peer dep from disk).
- Triage the 2 risxss XSS flags in `Head.jsx` (inline CSS via dangerouslySetInnerHTML).
- Fix `examples/useai/src/js/pages/Delta/Delta.js:155` — raw `->` in JSX text; both prettier and
  oxfmt fail to parse it (pre-existing).
- Add a CI lint + `oxfmt --check` job — both now sub-second to ~2s; there is currently no CI gate.
- Pin oxfmt exact version in package.json to avoid cross-version reformat churn (currently `^0.62.0`).
- Phase 2: migrate create-catalyst-app templates (6 variants still ship eslint ^8.26.0).
