# Error Catalog Example (`examples/error-catalog`)

Standalone example application documenting and demonstrating the 25 in-scope framework error codes across `halt`, `warn`, `no-call-site`, and `AI` tiers.

---

## Error Catalog Ledger (25 Codes)

| Code | Dev Mistake | Command | What the Dev Sees | Tier |
|---|---|---|---|---|
| `PREFLIGHT-001` | Deleted `config/config.json` | `catalyst start` | `PREFLIGHT-001` error message & doc URL in stderr; process exits with code 1 | `halt` |
| `PREFLIGHT-002` | `config/config.json` contains a JSON string instead of an object | `catalyst start` | `PREFLIGHT-002` error message & doc URL in stderr; process exits with code 1 | `halt` |
| `PREFLIGHT-003` | Removed required key `NODE_SERVER_HOSTNAME` from `config/config.json` | `catalyst start` | `PREFLIGHT-003` error message & doc URL in stderr; process exits with code 1 | `halt` |
| `PREFLIGHT-004` | Deleted `package.json` | `catalyst start` | `PREFLIGHT-004` error message & doc URL in stderr; process exits with code 1 | `halt` |
| `PREFLIGHT-005` | `package.json` contains invalid JSON syntax | `catalyst start` | `PREFLIGHT-005` error message & doc URL in stderr; process exits with code 1 | `halt` |
| `PREFLIGHT-006` | Removed `_moduleAliases` from `package.json` | `catalyst start` | `PREFLIGHT-006` error message & doc URL in stderr; process exits with code 1 | `halt` |
| `PREFLIGHT-007` | `_moduleAliases` in `package.json` is a string instead of an object | `catalyst start` | `PREFLIGHT-007` error message & doc URL in stderr; process exits with code 1 | `halt` |
| `PREFLIGHT-008` | `_moduleAliases` contains a key with restricted word `"catalyst"` | `catalyst start` | `PREFLIGHT-008` error message & doc URL in stderr; process exits with code 1 | `halt` |
| `PREFLIGHT-009` | `_moduleAliases` is missing required `@containers` entry | `catalyst start` | `PREFLIGHT-009` error message & doc URL in stderr; process exits with code 1 | `halt` |
| `PREFLIGHT-010` | `preServerInit` missing from `server/index.js` | N/A | Validator exists, no live call site — see PR #450 ledger | `no-call-site` |
| `PREFLIGHT-011` | `server/index.js` exports `preServerInit: 123` (not a function) | `catalyst start` | `PREFLIGHT-011` error message & doc URL logged; server startup continues | `warn` |
| `PREFLIGHT-012` | `addMiddlewares` missing from `server/server.js` | N/A | Validator exists, no live call site — see PR #450 ledger | `no-call-site` |
| `PREFLIGHT-013` | `server/server.js` exports `addMiddlewares: 123` (not a function) | `catalyst start` | `PREFLIGHT-013` error message & doc URL logged; server startup continues | `warn` |
| `PREFLIGHT-014` | `reducer` missing from `src/js/containers/App/reducer` | N/A | Validator exists, no live call site — see PR #450 ledger | `no-call-site` |
| `PREFLIGHT-015` | `reducer` export is not a function | N/A | Validator exists, no live call site — see PR #450 ledger | `no-call-site` |
| `PREFLIGHT-016` | `configureStore` missing from `src/js/store/index.js` | N/A | Validator exists, no live call site — see PR #450 ledger | `no-call-site` |
| `PREFLIGHT-017` | `src/js/store/index.js` default export is `123` (not a function) | `catalyst start` | `PREFLIGHT-017` error message & doc URL logged on request; server stays up | `warn` |
| `PREFLIGHT-018` | `getRoutes` missing from `src/js/routes/utils.js` | N/A | Validator exists, no live call site — see PR #450 ledger | `no-call-site` |
| `PREFLIGHT-019` | `src/js/routes/utils.js` exports `getRoutes: []` (not a function) | `catalyst start` | `PREFLIGHT-019` error message & doc URL logged on request; server stays up | `warn` |
| `PREFLIGHT-020` | `document` component missing from `server/document.js` | N/A | Validator exists, no live call site — see PR #450 ledger | `no-call-site` |
| `PREFLIGHT-021` | `server/document.js` default export is `123` (not a component) | `catalyst start` | `PREFLIGHT-021` error message & doc URL logged on request; falls back to default document | `warn` |
| `AI-000` | Upstream AI provider returns error or fails connection | `POST /ai/openai/generate` | HTTP 500 JSON response `{ error, code: "AI-000", docUrl: "..." }` | `AI` |
| `AI-001` | AI routes called while `AI_CONFIG.enabled` is `false` | `GET /ai/providers` | HTTP 403 JSON response `{ error, code: "AI-001", docUrl: "..." }` | `AI` |
| `AI-002` | Provider `openai` requested but has no `apiKey` configured | `POST /ai/openai/generate` | HTTP 404 JSON response `{ error, code: "AI-002", docUrl: "..." }` | `AI` |
| `AI-003` | Request body sent with empty `messages` array (`{ messages: [] }`) | `POST /ai/openai/generate` | HTTP 400 JSON response `{ error, code: "AI-003", docUrl: "..." }` | `AI` |

---

## Running the App & Tests

```bash
# 1. Sync catalyst-core and catalyst-ai local packages into node_modules
npm run sync-core
npm run sync-packages

# 2. Run the interactive scenario demo
npm run demo

# 3. Run individual scenario in demo
npm run demo -- --only PREFLIGHT-003

# 4. Run Vitest suite
npm test
```
