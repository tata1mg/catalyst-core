// Shared logic for the catalyst-cloudflare adapter: reads the app's opt-in config (the
// `catalystCloudflare` key in package.json) and generates the two files that used to be
// hand-copied from the README, worker/index.js and wrangler.jsonc, from templates that
// live in this directory.
//
// This copy lives directly inside the app (useai/cloudflare-adapter), not as an
// installed npm package — it isn't published, and installing it via a `file:` link to
// the sibling repo turned out to be a recurring source of staleness: npm silently
// symlinks local `file:` deps by default (breaking module resolution for the adapter's
// own dependencies, since node_modules lookups then start from the sibling repo's real
// path instead of this app's), and even with `--install-links` forcing a real copy,
// nothing re-syncs it after an edit — every fix required manually detecting and
// re-copying a stale node_modules/@sauravvarma/catalyst-cloudflare. Editing it in place
// here means the app always builds against exactly what's on disk.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export const ADAPTER = "catalyst-cloudflare (in-repo)"
// Import specifiers below are relative paths, not a package name: WORKER_ENTRY's imports
// resolve from worker/index.js (one level down from the app root), the wrangler `alias`
// map's from the app root (where wrangler.jsonc lives) — hence the different prefixes.
const WORKER_ENTRY_BASE = "../cloudflare-adapter"
const ALIAS_BASE = "./cloudflare-adapter"

// The 2 scripts needed in the app's package.json (no separate install step — the
// adapter is already in the repo).
export const SCRIPTS = {
    "build:worker": "node cloudflare-adapter/prebuild.mjs",
    "dev:worker": "npm run build && npm run build:worker && wrangler dev",
    "deploy:worker": "npm run build && npm run build:worker && wrangler deploy",
}

// Turn an npm package name into a valid Workers service name (lowercase, dashes, no scope).
export function slugify(name) {
    return (
        String(name || "")
            .replace(/^@[^/]+\//, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "catalyst-app"
    )
}

// Resolve the adapter config from the app's package.json. The only genuinely per-app
// value is the worker `name`; everything else has a safe default.
export function loadConfig(root) {
    const pkgPath = join(root, "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    const cc = pkg.catalystCloudflare || {}

    // The app's config/config.json is read (not written) for two Vite-build-time-baked
    // values that the SSR bundle can no longer be told apart from at the wrangler layer:
    //   - PUBLIC_STATIC_ASSET_PATH/URL: Vite's DefinePlugin equivalent inlines these as
    //     literal strings into build/server/index.js during `catalyst build`, using
    //     whatever config.json held at that time — a wrangler `define`/`vars` override
    //     arrives too late to change them. Mirroring the same values forward (rather than
    //     guessing a different one) keeps the asset staging step (prebuild.mjs) honest
    //     about what URLs the already-built bundle actually requests.
    //   - NODE_SERVER_HOSTNAME/PORT: the self-fetch host alias (see CATALYST_SELF_HOST_ALIAS
    //     below).
    let appConfig = {}
    try {
        appConfig = JSON.parse(readFileSync(join(root, "config", "config.json"), "utf-8"))
    } catch {
        /* no config.json — fall back to defaults below */
    }

    return {
        name: cc.name || slugify(pkg.name),
        // Routes that must always hit the Worker (SSR/API). Hashed assets under /assets/
        // are served by Workers Assets first; unmatched paths fall through to the Worker.
        routes: Array.isArray(cc.routes) && cc.routes.length ? cc.routes : ["/"],
        // Shallow-merged into the generated wrangler.jsonc so custom bindings (KV, D1,
        // vars, ...) are reachable without hand-editing a generated file.
        wrangler: cc.wrangler && typeof cc.wrangler === "object" ? cc.wrangler : {},
        publicStaticAssetPath: appConfig.PUBLIC_STATIC_ASSET_PATH || "",
        publicStaticAssetUrl: appConfig.PUBLIC_STATIC_ASSET_URL || "",
        // NODE_SERVER_HOSTNAME/PORT are real (non-baked) process.env reads in the SSR
        // bundle — unlike PUBLIC_STATIC_ASSET_*, Vite's getClientEnvVariables() never
        // defines these two, so any app code that builds its own self-fetch URL from them
        // (e.g. `fetch(\`http://\${NODE_SERVER_HOSTNAME}:\${NODE_SERVER_PORT}/api/x\`)`,
        // same as the Node/container target does) needs them set as real Worker vars, or
        // it constructs "http://undefined:undefined/..." and throws.
        nodeServerHostname: appConfig.NODE_SERVER_HOSTNAME || "",
        nodeServerPort: appConfig.NODE_SERVER_PORT != null ? String(appConfig.NODE_SERVER_PORT) : "",
        // Same literal host:port a serverFetcher's self-call would target on the Node/
        // container server — the C2 reroute in runtime.js needs to recognize this as
        // "self" too, not just the Worker's real inbound host.
        selfHostAlias:
            appConfig.NODE_SERVER_HOSTNAME && appConfig.NODE_SERVER_PORT
                ? `${appConfig.NODE_SERVER_HOSTNAME}:${appConfig.NODE_SERVER_PORT}`
                : "",
        pkg,
        pkgPath,
    }
}

// The Worker entry, written into the app's own worker/ dir so its relative imports
// resolve against the app's build output (../build/server/index.js) and source
// (../server/server.js, ../server/index.js).
//
// catalyst-core (Vite target) no longer ships a per-app compiled expressServer.js —
// the framework's own dist/server/expressServer.js self-executes (calls app.listen()
// itself and never exports the app), so there's nothing importable to hand to
// createWorker(). Instead this reassembles the small production slice of that file
// directly: body parsing (stubbed), cookies, the app's own addMiddlewares, and the
// SSR catch-all backed by the app's built build/server/index.js. Static asset serving,
// compression, and OpenTelemetry are intentionally left out — Workers Assets, the edge,
// and OTEL_ENABLE=false (respectively) cover those on this runtime.
export const WORKER_ENTRY = `// AUTO-GENERATED by ${ADAPTER} — do not edit.
// Regenerated on every \`npm run build:worker\`; change settings via the
// "catalystCloudflare" key in package.json instead.
import express from "express"
import cookieParser from "cookie-parser"
import bodyParser from "body-parser"
import { createWorker } from "${WORKER_ENTRY_BASE}/worker/runtime"
// Registers globalThis.__CATALYST_FS_ASSETS__ as an import-time side effect (see
// prebuild.mjs) — MUST stay above the build/server/index.js import below: that
// module's manifestCache.js reads .vite/manifest.json + asset-categories.json via
// \`fs\` as its own synchronous top-level side effect, and the fs shim only has
// bundle-embedded file contents to serve once this has already registered them.
// Static \`import\` declarations run in source order relative to each other (even
// though all of them precede any non-import code in the file), so this ordering is
// enough without resorting to a dynamic import() of a local, non-package path
// (which wrangler doesn't reliably bundle).
import fsAssets from "./fs-assets.generated.js"
import render from "../build/server/index.js"
import { addMiddlewares } from "../server/server.js"
// catalyst-core's Node target mounts this via a dynamic require.resolve("catalyst-ai/route")
// against node_modules at server-startup time (see expressServer.js's mountAIRouter) so it's
// a graceful no-op when catalyst-ai isn't installed. Wrangler bundles this Worker ahead of
// time, so a runtime require against node_modules isn't an option here — this import has to
// be static instead, which only works because this app actually depends on catalyst-ai
// (package.json). If catalyst-ai is ever removed from this app, this line needs removing
// too, or the Worker bundle fails to build.
import aiRouter from "catalyst-ai/route"

const app = express()
// Cloudflare's automatic response compression (applied whenever the client sends
// Accept-Encoding and the response has no Content-Encoding of its own) buffers the
// ENTIRE body before compressing it — silently defeating PPR's whole point (an
// instant shell, dynamic content streamed in later). Every real browser sends
// Accept-Encoding by default, so without this every response — not just PPR's —
// would get buffered end-to-end. Declaring our own (identity/no-op) Content-Encoding
// signals it's already "encoded" and opts out of that re-compression.
app.use((req, res, next) => {
    res.setHeader("Content-Encoding", "identity")
    next()
})
app.use(bodyParser.json())
app.use(bodyParser.raw({ type: "application/*" }))
app.use(cookieParser())
if (typeof addMiddlewares === "function") addMiddlewares(app)

// Mirrors expressServer.js's mountAIRouter, minus the dynamic require.resolve (this
// import is already static, above). AI_CONFIG must arrive as a Worker secret
// (\`wrangler secret put AI_CONFIG\` / .dev.vars for local dev) — nodejs_compat mirrors
// secrets and vars into process.env the same way, so this read is identical to the
// Node target's. Never put API keys in this app's catalystCloudflare.wrangler.vars
// passthrough or config/config.json's baked wrangler.jsonc output — those land in
// plaintext in the generated (gitignored, but still) wrangler.jsonc and get printed to
// the terminal on every \`wrangler dev\` start.
try {
    const aiConfig = JSON.parse(process.env.AI_CONFIG || "{}")
    if (aiConfig && typeof aiConfig === "object" && !Array.isArray(aiConfig) && aiConfig.enabled !== false) {
        app.use(aiConfig.basePath || "/ai", aiRouter)
    }
} catch (e) {
    console.warn("[catalyst-cloudflare/ai] Invalid AI_CONFIG JSON, ignoring:", e.message)
}

app.use("*", async (req, res) => {
    try {
        if (typeof render === "function") {
            await render(req, res)
        } else {
            console.error("Renderer not found or invalid")
            res.status(500).send("Error loading renderer")
        }
    } catch (err) {
        console.error("SSR Error:", err)
        if (!res.headersSent) res.status(500).send("Internal Server Error")
    }
})

export default createWorker(app, { fsAssets })
`

// Runtime env the Catalyst server reads via process.env. NODE_ENV/BUILD_OUTPUT_PATH/
// src_path only matter for code the *worker* bundles directly (this entry, the app's
// server/server.js) — the pre-built build/server/index.js already had its own
// process.env reads inlined by Vite at `catalyst build` time and no longer reads
// them at runtime at all.
const ENV = {
    NODE_ENV: "production",
    IS_DEV_COMMAND: "false",
    src_path: "/",
    BUILD_OUTPUT_PATH: "build",
}

const shim = (file) => `${ALIAS_BASE}/worker/${file}`

const OTEL = [
    "api",
    "auto-instrumentations-node",
    "exporter-metrics-otlp-grpc",
    "exporter-metrics-otlp-http",
    "exporter-trace-otlp-grpc",
    "exporter-trace-otlp-http",
    "resources",
    "sdk-metrics",
    "sdk-node",
    "sdk-trace-node",
    "semantic-conventions",
]

// Deep-ish merge: top-level keys from `extra` win, but plain-object blocks (assets, vars,
// alias, define, ...) merge one level so a passthrough can add a single var/binding
// without discarding the generated block.
function mergeWrangler(base, extra) {
    const out = { ...base }
    for (const [k, v] of Object.entries(extra)) {
        const isObj = (x) => x && typeof x === "object" && !Array.isArray(x)
        out[k] = isObj(v) && isObj(out[k]) ? { ...out[k], ...v } : v
    }
    return out
}

export function buildWranglerConfig({
    name,
    routes,
    wrangler,
    publicStaticAssetPath = "",
    publicStaticAssetUrl = "",
    nodeServerHostname = "",
    nodeServerPort = "",
    selfHostAlias = "",
}) {
    const runtimeEnv = {
        ...ENV,
        PUBLIC_STATIC_ASSET_PATH: publicStaticAssetPath,
        PUBLIC_STATIC_ASSET_URL: publicStaticAssetUrl,
        // Real (non-baked) runtime reads in app code (e.g. api.js's self-fetch base URL) —
        // see loadConfig's comment.
        NODE_SERVER_HOSTNAME: nodeServerHostname,
        NODE_SERVER_PORT: nodeServerPort,
        // Read by runtime.js at cold start to seed SELF_HOSTS (see there) — empty is
        // fine, it's just skipped.
        CATALYST_SELF_HOST_ALIAS: selfHostAlias,
    }

    const define = { __dirname: '"/"', __filename: '"/worker/index.js"' }
    for (const [k, v] of Object.entries(runtimeEnv)) define[`process.env.${k}`] = JSON.stringify(v)

    const alias = {
        // Adapter shims. Catalyst's Vite build fully bundles the app's own source and
        // catalyst-core's framework code into build/server/index.js — the only bare
        // specifiers it leaves unresolved (by design, so Node/edge can each supply their
        // own build) are React's streaming SSR entry points and a handful of Node
        // built-ins/deps that don't run on workerd.
        "react-dom/server": shim("react-dom-server-shim.js"),
        "react-dom/static": shim("react-dom-static-shim.js"),
        fs: shim("fs-shim.js"),
        "body-parser": shim("body-parser-stub.js"),
        compression: shim("middleware-factory-stub.js"),
        "express-static-gzip": shim("middleware-factory-stub.js"),
        tty: shim("tty-stub.js"),
        "node:tty": shim("tty-stub.js"),
    }
    for (const m of OTEL) alias[`@opentelemetry/${m}`] = shim("empty-stub.js")

    const base = {
        name,
        main: "worker/index.js",
        compatibility_date: "2025-09-01",
        compatibility_flags: ["nodejs_compat"],
        // Self service binding: lets server-side same-origin fetches dispatch to this
        // Worker's own routes in-process (see worker/runtime.js).
        services: [{ binding: "SELF", service: name }],
        assets: {
            directory: "./dist/public",
            not_found_handling: "none",
            run_worker_first: routes,
        },
        alias,
        define,
        vars: { ...runtimeEnv },
    }
    return mergeWrangler(base, wrangler)
}

// Write the two generated files into the app root. Returns the resolved config.
export function generate(root) {
    const cfg = loadConfig(root)
    const workerDir = join(root, "worker")
    mkdirSync(workerDir, { recursive: true })
    writeFileSync(join(workerDir, "index.js"), WORKER_ENTRY)
    writeFileSync(
        join(root, "wrangler.jsonc"),
        `// AUTO-GENERATED by ${ADAPTER} — do not edit.\n` +
            `// Change settings via the "catalystCloudflare" key in package.json, then rebuild.\n` +
            JSON.stringify(buildWranglerConfig(cfg), null, 4) +
            "\n",
    )
    return cfg
}
