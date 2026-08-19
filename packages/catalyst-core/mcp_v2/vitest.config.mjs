import { defineConfig } from "vitest/config"

// Framework-level (Tier 1) unit tests for catalyst-mcp's own internals.
// mcp_v2 lives inside packages/catalyst-core/mcp_v2/ (it ships bundled
// inside the catalyst-core package, see ../mcp_v2/scripts/copyErrorsIndex.cjs
// and errors.js's own packaged-path handling) and is NOT matched by the
// packages/* workspace glob, so it's invisible to `npm run test:unit` unless
// explicitly wired in — see the root package.json's test:unit script.
export default defineConfig({
    test: {
        environment: "node",
        include: ["test/**/*.test.ts"],
        // tools/errors.js itself is CommonJS, loaded via require() from the
        // .ts test file below. .ts, not .cts: this Vite/Rollup version's SSR
        // transform doesn't strip TS syntax from .cts files at all (fails to
        // parse even a single type annotation — a real tooling gap,
        // confirmed empirically, not a config mistake). vitest's own
        // describe/it/expect exports can't be require()'d, only import'd —
        // globals injects them instead.
        globals: true,
    },
})
