import { defineConfig } from "vitest/config"

// Framework-level (Tier 1) unit tests for create-catalyst-app's own
// internals — see test/*.test.ts. errors.cjs is a standalone CJS mirror of
// catalyst-core's error registry shape (it can't depend on catalyst-core —
// CCA packs/extracts itself before catalyst-core is ever installed), so its
// parity test lives here rather than in catalyst-core's test suite.
export default defineConfig({
    test: {
        environment: "node",
        include: ["test/**/*.test.ts"],
        // errors.cjs itself is CommonJS (see its own file header), loaded
        // via require() from the .ts test file below — TypeScript allows
        // require() in a .ts file (it's still just a global Node function),
        // it just doesn't get CJS *emit* semantics the way .cts would.
        // .cts was tried first and rejected: this Vite/Rollup version's SSR
        // transform doesn't strip TS syntax from .cts files at all (fails
        // to parse even a single `const x: number` type annotation) — a
        // real tooling gap, not a config mistake. vitest's own describe/it/
        // expect exports can't be require()'d, only import'd — globals
        // injects them instead.
        globals: true,
    },
})
