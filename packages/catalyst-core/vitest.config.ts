import { configDefaults, defineConfig } from "vitest/config"

// Two projects sharing this one config, kept in `projects` rather than a
// separate vitest.workspace.ts so there's a single vitest.config.ts to
// find. Each project is otherwise independent -- unique `name`, own
// `environment`, own `include` glob, no shared setup between them.
//
// "node" project: framework-level (Tier 1) unit tests for catalyst-core's
// own internals -- see test/errors/*.test.ts. Registry/index.js are ESM
// and side-effect-free at import time -- no DOM, no server, no global
// setup needed. Application-level (Tier 2) integration tests live in
// examples/catalyst-core-test and run via scripts/test-catalyst-core.sh,
// not through vitest (see issue #412).
//
// "web-router" project: React component/hook tests for src/web-router
// (issue #346/#340 coverage work). Needs jsdom (a real DOM environment)
// and @testing-library/react -- neither existed in this package before,
// since every prior test here was plain-JS/Node logic. Kept as its own
// project rather than switching the whole config to jsdom: jsdom has
// real per-test overhead the plain error-system tests don't need, and
// this keeps the two testing concerns (framework internals vs. React UI)
// separately configured.
//
// `*.server.test.{js,jsx}` under src/web-router is the exception: a
// handful of code paths there branch on `typeof window === "undefined"`
// (fetchRouteData picks serverFetcher over clientFetcher on the server).
// jsdom always defines `window`, so those branches can only be exercised
// in the "node" environment -- those files are routed to the "node"
// project and excluded from "web-router" so RTL's jsdom-only setupFiles
// never load for them. Issue #347.
export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "node",
                    environment: "node",
                    include: [
                        "test/**/*.test.ts",
                        "src/web-router/**/*.server.test.{js,jsx}",
                    ],
                },
            },
            {
                test: {
                    name: "web-router",
                    environment: "jsdom",
                    include: ["src/web-router/**/*.test.{js,jsx}"],
                    exclude: [...configDefaults.exclude, "src/web-router/**/*.server.test.{js,jsx}"],
                    setupFiles: ["./src/web-router/vitest.setup.js"],
                },
            },
        ],
    },
})
