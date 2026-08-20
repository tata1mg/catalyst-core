import { defineConfig } from "vitest/config"

// Framework-level (Tier 1) unit tests for catalyst-ai's own internals — see
// test/route.test.ts. route.js exports the Express router as its primary
// export (unchanged, for expressServer.js's require("catalyst-ai/route"))
// with testable pure-logic internals attached as router._internal.
export default defineConfig({
    test: {
        environment: "node",
        include: ["test/**/*.test.ts"],
        // route.js itself is CommonJS (see its own header comment), loaded
        // via require() from the .ts test file below. .ts, not .cts: this
        // Vite/Rollup version's SSR transform doesn't strip TS syntax from
        // .cts files at all (fails to parse even a single type annotation —
        // a real tooling gap, confirmed empirically, not a config mistake).
        // vitest's own describe/it/expect exports can't be require()'d,
        // only import'd — globals injects them instead.
        globals: true,
    },
})
