# Error Catalog Example (`examples/error-catalog`)

A standalone Catalyst app whose scenarios reproduce a **real developer
mistake** for every one of the framework's 72 error codes, then assert the dev
sees the right coded error (message + doc URL).

- **`npm run test:error`** — runs all 72, one block per code: the mistake, what
  the dev sees, and PASS / FAIL / SKIP. This is the command to run.
- **`npm run demo`** — interactive walk of the server-reachable scenarios only
  (the `cli` / `http` tiers); other kinds are contract assertions, see
  `test:error`.
- **`npm test`** — the Vitest contract suite (`test/*.test.ts`).

## Coverage

72 / 72 codes accounted for: **61 reproduced by a scenario**, **11 in the
LEDGER** as `not-example-reproducible` — each with a specific reason below, not
a hand-wave.

### Tiers

| Tier | Meaning |
|---|---|
| `cli (halts)` | `catalyst start` prints the coded error and exits 1 |
| `cli (warns)` | server boots; coded error logged, startup continues |
| `no-call-site` | validator exists, no live framework call site (PR #450 ledger) |
| `http` | server boots; a request surfaces the coded error (body or stderr) |
| `build` | `catalyst build` fails with the coded error, exit ≠ 0 |
| `cca-cli` | `create-catalyst-app` CLI exits with the coded error |
| `client (jsdom)` | a hook / `WebBridge` call raises the coded error under jsdom |
| `mapping` | native side emits an error string; JS maps it to the coded error |
| `build-native` | `catalyst buildApp:*` fails early (bad config), coded error, exit ≠ 0 |

### Known framework findings (surfaced while building this)

1. **`create-catalyst-app` CCA-003 is dead code** — `validateOptions()` checks
   `cmd.lang` (throws CCA-003) but no `--lang` / `-l` Commander option is ever
   registered, so the check is unreachable. → CCA-003 is LEDGER.
2. **`App.serverSideFunction` is an implicit contract** — the SSR handler calls
   it unconditionally; a hand-rolled app that omits it throws a `TypeError` on
   every request. All `create-catalyst-app` templates define it; this example
   now does too. (No preflight validator guards it.)
3. **SSR error mis-attribution** — a `document.js` render failure logs
   `RUNTIME-WEB-001` (correct) but also mis-logs `RUNTIME-WEB-002` (FETCHER) and
   `RUNTIME-WEB-003` (SSF) on the 404-retry path, though no fetcher or
   `serverSideFunction` failed. → `RUNTIME-WEB-002` is LEDGER (its only
   appearance is this mislabel).
4. **`terminalProgress.js` import casing** — `buildAndroid/index.js`,
   `buildIos/index.js`, `androidSetup.js` and `setupEmulatorIos.js` imported
   `TerminalProgress.js` but the file is `terminalProgress.js`. macOS
   (case-insensitive FS) masks it; on Linux / Docker / CI `require()` fails with
   `MODULE_NOT_FOUND` and `catalyst buildApp:android` / `buildApp:ios` /
   `setupEmulator` crash on load. Fixed in `fix(native): correct
   terminalProgress.js import casing` — the ANDROID-000 / IOS-000 scenarios here
   are what surfaced it (first CI exercise of `buildApp:*` on Linux).

## The 72-code ledger

| Code | Dev mistake | Tier | What the dev sees | Coverage |
|---|---|---|---|---|
| `AI-000` | valid request, provider returns a non-2xx upstream -> 500, code AI-000 | http | AI provider request failed | scenario |
| `AI-001` | GET /ai/providers with AI_CONFIG.enabled false -> 403 | http | AI is disabled | scenario |
| `AI-002` | POST /ai/openai/generate, provider has no apiKey -> 404 | http | AI provider not configured | scenario |
| `AI-003` | POST /ai/openai/generate body {messages:[]} -> 400 | http | Invalid AI request body | scenario |
| `AI-004` | useNativeAI mounted in a plain web app — no window.NativeBridge | client (jsdom) | Native AI bridge unavailable | scenario |
| `AI-005` | — | — | Native AI stream not ready | **LEDGER: not-example-reproducible** |
| `AI-006` | — | — | Native AI request failed | **LEDGER: not-example-reproducible** |
| `AI-007` | — | — | Native AI reported an error | **LEDGER: not-example-reproducible** |
| `AI-008` | — | — | Web AI worker unavailable | **LEDGER: not-example-reproducible** |
| `AI-009` | — | — | Web AI worker crashed | **LEDGER: not-example-reproducible** |
| `ANDROID-000` | Android build failed in upstream toolchain step | build-native | Android build failed in an upstream toolchain step | scenario |
| `BUNDLE-000` | Syntax error in a source file during production build | build | Build failed in an upstream bundler step | scenario |
| `CCA-000` | — | — | An upstream command failed | **LEDGER: not-example-reproducible** |
| `CCA-001` | Invalid project name provided to create-catalyst-app | cca-cli | Invalid project name | scenario |
| `CCA-002` | Target directory already exists when running create-catalyst-app | cca-cli | Target directory already exists | scenario |
| `CCA-003` | — | — | Invalid language option | **LEDGER: not-example-reproducible** |
| `CCA-004` | Invalid --state-management option passed to create-catalyst-app | cca-cli | Invalid state management option | scenario |
| `CCA-005` | Invalid value passed to --yes flag in create-catalyst-app | cca-cli | Invalid --yes option | scenario |
| `CCA-006` | — | — | Failed to pack create-catalyst-app | **LEDGER: not-example-reproducible** |
| `CCA-007` | — | — | Failed to extract template files | **LEDGER: not-example-reproducible** |
| `CCA-008` | — | — | MCP server setup failed | **LEDGER: not-example-reproducible** |
| `CCA-009` | .gitignore file already exists warning in create-catalyst-app | cca-cli | .gitignore already exists | scenario |
| `IOS-000` | iOS build failed in upstream toolchain step | build-native | iOS build failed in an upstream toolchain step | scenario |
| `PREFLIGHT-001` | config/config.json deleted | cli (halts) | config not found in config folder | scenario |
| `PREFLIGHT-002` | config/config.json is a JSON string | cli (halts) | config export is not an object | scenario |
| `PREFLIGHT-003` | Removed a required key from config/config.json | cli (halts) | required key missing inside config.json | scenario |
| `PREFLIGHT-004` | package.json deleted / wrong dir | cli (halts) | package.json not found in the project | scenario |
| `PREFLIGHT-005` | package.json malformed | cli (halts) | package.json should be defined in project root directory | scenario |
| `PREFLIGHT-006` | _moduleAliases removed from package.json | cli (halts) | moduleAliases not found in package.json | scenario |
| `PREFLIGHT-007` | _moduleAliases is a string in package.json | cli (halts) | moduleAliases named object should be exported from package.json | scenario |
| `PREFLIGHT-008` | a _moduleAliases key contains 'catalyst' | cli (halts) | catalyst keyword is restricted for defining aliases | scenario |
| `PREFLIGHT-009` | _moduleAliases missing @containers | cli (halts) | required module alias not defined inside package.json | scenario |
| `PREFLIGHT-010` | preServerInit missing from server/index.js | no-call-site | preServerInit named function should be defined in server/index.js | scenario |
| `PREFLIGHT-011` | server/index.js exports preServerInit: 123 | cli (warns) | preServerInit should be a function present in server/index.js | scenario |
| `PREFLIGHT-012` | addMiddlewares missing from server/server.js | no-call-site | addMiddlewares named function not found in server/server.js | scenario |
| `PREFLIGHT-013` | middleware export not a function | cli (warns) | addMiddlewares should be a function present in server/server.js | scenario |
| `PREFLIGHT-014` | reducer missing from src/js/containers/App/reducer | no-call-site | reducer not found in src/js/containers/App/reducer | scenario |
| `PREFLIGHT-015` | reducer export not a function | no-call-site | reducer should be present in src/js/containers/App/reducer | scenario |
| `PREFLIGHT-016` | configureStore missing from src/js/store/index.js | no-call-site | configureStore not found in file src/js/store/index.js | scenario |
| `PREFLIGHT-017` | store default export not a function | cli (warns) | configureStore should be a function exported from src/js/store/index.js | scenario |
| `PREFLIGHT-018` | getRoutes missing from src/js/routes/utils.js | no-call-site | getRoutes not found in file src/js/routes/utils.js | scenario |
| `PREFLIGHT-019` | getRoutes not a function | cli (warns) | getRoutes should be a function exported from src/js/routers/index.js | scenario |
| `PREFLIGHT-020` | document missing from server/document.js | no-call-site | document not found in file server/document.js | scenario |
| `PREFLIGHT-021` | server/document.js default export not a function | cli (warns) | document should be a react component exported from server/document.js | scenario |
| `PROCESS-001` | preServerInit hook throws during server startup | cli (warns) | preServerInit threw an error during server startup | scenario |
| `PROCESS-002` | User-defined hook onRouteMatch throws when invoked | cli (warns) | A user-defined hook threw an error | scenario |
| `RUNTIME-NATIVE-001` | Native string 'permission denied' maps to RUNTIME-NATIVE-001 | mapping | Permission denied | scenario |
| `RUNTIME-NATIVE-002` | Native code RUNTIME-NATIVE-002 (Permission required) error mapping | mapping | Permission required | scenario |
| `RUNTIME-NATIVE-003` | Native string 'network unavailable' maps to RUNTIME-NATIVE-003 | mapping | No internet connection | scenario |
| `RUNTIME-NATIVE-004` | Native code RUNTIME-NATIVE-004 (Download failed) error mapping | mapping | Download failed | scenario |
| `RUNTIME-NATIVE-005` | Native string 'file not found' maps to RUNTIME-NATIVE-005 | mapping | File not found | scenario |
| `RUNTIME-NATIVE-006` | Native code RUNTIME-NATIVE-006 (File too large) error mapping | mapping | File too large | scenario |
| `RUNTIME-NATIVE-007` | Native string 'storage full' maps to RUNTIME-NATIVE-007 | mapping | Storage full | scenario |
| `RUNTIME-NATIVE-008` | Native code RUNTIME-NATIVE-008 (File corrupted) error mapping | mapping | File corrupted | scenario |
| `RUNTIME-NATIVE-009` | Native string 'operation cancelled' maps to RUNTIME-NATIVE-009 | mapping | Operation cancelled | scenario |
| `RUNTIME-NATIVE-010` | Native code RUNTIME-NATIVE-010 (No file selected) error mapping | mapping | No file selected | scenario |
| `RUNTIME-NATIVE-011` | Native code RUNTIME-NATIVE-011 (Invalid file type) error mapping | mapping | Invalid file type | scenario |
| `RUNTIME-NATIVE-012` | Native code RUNTIME-NATIVE-012 (Invalid parameters) error mapping | mapping | Invalid parameters | scenario |
| `RUNTIME-NATIVE-013` | Native bridge feature unavailable when hook invoked | client (jsdom) | Native feature unavailable | scenario |
| `RUNTIME-NATIVE-014` | Native feature not supported on current platform | client (jsdom) | Feature not supported | scenario |
| `RUNTIME-NATIVE-015` | Native unrecognized error string maps to RUNTIME-NATIVE-015 (Internal error) | mapping | An unexpected error occurred | scenario |
| `RUNTIME-NATIVE-016` | Native string 'camera unavailable' maps to RUNTIME-NATIVE-016 | mapping | Camera unavailable | scenario |
| `RUNTIME-NATIVE-017` | Native string 'camera in use' maps to RUNTIME-NATIVE-017 | mapping | Camera in use | scenario |
| `RUNTIME-NATIVE-018` | WebBridge.callback() invoked with unregistered interface name | client (jsdom) | Invalid callback interface | scenario |
| `RUNTIME-NATIVE-019` | WebBridge callback received before handler registered | client (jsdom) | No handler registered for this bridge interface | scenario |
| `RUNTIME-NATIVE-020` | Registered WebBridge callback handler throws during execution | client (jsdom) | A registered bridge callback handler threw | scenario |
| `RUNTIME-NATIVE-021` | WebBridge.register() called with invalid parameters | client (jsdom) | Invalid bridge callback registration | scenario |
| `RUNTIME-NATIVE-022` | WebBridge.init() called outside a browser environment | client (jsdom) | WebBridge could not be initialized | scenario |
| `RUNTIME-WEB-001` | SSR render fails (document.js throws) — onError fires RUNTIME-WEB-001 | http | Rendering failed on the server | scenario |
| `RUNTIME-WEB-002` | — | — | serverFetcher failed | **LEDGER: not-example-reproducible** |
| `RUNTIME-WEB-003` | App.serverSideFunction throws | http | App.serverSideFunction failed | scenario |
| `RUNTIME-WEB-004` | server/document.js default export throws during document render | http | Failed to handle document request | scenario |

## Running

```bash
# One-time: sync the local catalyst-core / catalyst-ai into node_modules
# (npm run test:error also does this itself before running).
npm run sync-core
npm run sync-packages

# All 72, human-readable
npm run test:error

# One code
npm run test:error -- --only PREFLIGHT-003

# One category
npm run test:error -- --filter CCA

# Interactive walk of the server-reachable scenarios
npm run demo

# Vitest contract suite
npm test
```
