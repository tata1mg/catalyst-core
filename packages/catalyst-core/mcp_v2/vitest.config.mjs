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
        include: ["test/**/*.test.cjs"],
        // This package is CommonJS and vitest's describe/it/expect exports
        // can't be require()'d from a .cjs file, only import'd — globals
        // injects them instead, same pattern as the other CJS packages here.
        globals: true,
    },
})
