import { defineConfig } from "vitest/config"

// Framework-level (Tier 1) unit tests for catalyst-core's own internals —
// see test/errors/*.test.ts. Application-level (Tier 2) integration tests
// live in examples/catalyst-core-test and run via scripts/test-catalyst-core.sh,
// not through vitest (see issue #412).
export default defineConfig({
    test: {
        environment: "node",
        include: ["test/**/*.test.ts"],
        // Registry/index.js are ESM and side-effect-free at import time — no
        // DOM, no server, no global setup needed for Tier 1. Vitest
        // transpiles .ts test files via esbuild at run time — no separate
        // build step needed to execute them (tsconfig.test.json is only for
        // editor/CI type-checking, see its own header comment).
    },
})
