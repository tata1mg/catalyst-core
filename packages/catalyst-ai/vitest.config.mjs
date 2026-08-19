import { defineConfig } from "vitest/config"

// Framework-level (Tier 1) unit tests for catalyst-ai's own internals — see
// test/route.test.cjs. route.js exports the Express router as its primary
// export (unchanged, for expressServer.js's require("catalyst-ai/route"))
// with testable pure-logic internals attached as router._internal.
export default defineConfig({
    test: {
        environment: "node",
        include: ["test/**/*.test.cjs"],
        // route.js is CommonJS (see its own header comment on why), and
        // vitest's describe/it/expect exports can't be require()'d from a
        // .cjs file — only import'd. globals injects them instead, matching
        // the same setup used in create-catalyst-app's vitest.config.mjs.
        globals: true,
    },
})
