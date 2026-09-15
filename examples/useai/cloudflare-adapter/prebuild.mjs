// catalyst-cloudflare prebuild — run from the Catalyst app root AFTER `catalyst build`
// (wired as the `build:worker` script by `catalyst-cloudflare init`). Prepares everything
// wrangler needs to bundle the Worker:
//   1. generates worker/index.js + wrangler.jsonc from the in-package templates, using
//      the app's `catalystCloudflare` config (name/routes/wrangler passthrough);
//   2. copies server/data -> build/data (Vite doesn't copy non-JS server assets);
//   3. stages build/client -> dist/public/client (+ public/ at root) for Workers Assets,
//      preserving the exact "client/assets/..." URL shape the SSR bundle already baked
//      in at `catalyst build` time, and normalizes any baked asset origin to same-origin;
//   4. generates worker/fs-assets.generated.js (the map the fs-shim serves at request time:
//      build/.vite/manifest.json + asset-categories.json + every CSS file, all read
//      synchronously off disk by the renderer at request time in the Node/container target).
import {
    readFileSync,
    writeFileSync,
    readdirSync,
    rmSync,
    mkdirSync,
    cpSync,
    existsSync,
    statSync,
} from "node:fs"
import { join } from "node:path"
import { generate } from "./lib/adapter.mjs"

const ADAPTER = "@sauravvarma/catalyst-cloudflare"
const ROOT = process.cwd()
const BUILD_DIR = join(ROOT, "build")
const BUILD_CLIENT = join(BUILD_DIR, "client")
const BUILD_VITE_META = join(BUILD_DIR, ".vite")

if (!existsSync(BUILD_CLIENT)) {
    console.error("catalyst-cloudflare prebuild: build/client not found - run `catalyst build` first.")
    process.exit(1)
}

// 1. generate worker/index.js + wrangler.jsonc from the app's catalystCloudflare config.
// (also reads config/config.json for the asset origin/self-host values used below.)
const cfg = generate(ROOT)

// Vite's `define` bakes PUBLIC_STATIC_ASSET_URL + PUBLIC_STATIC_ASSET_PATH into
// build/server/index.js as a literal string prefix (e.g. "http://host:port/assets/") at
// `catalyst build` time (see vite.config.js's getClientEnvVariables()), so the Worker's
// own `define`/`vars` have no process.env token left to override at wrangler-bundle time.
// On Workers, Workers Assets serves `dist/public` at the site root with no such prefix
// (prebuild stages build/client straight to dist/public/client, not dist/public<path>/
// client), so BOTH pieces need stripping from the built output — not just the origin.
// Both empty for apps whose config.json already uses "" for each (same origin, no path
// prefix) - a no-op in that case.
const assetOrigin = (cfg.publicStaticAssetUrl || "").trim()
const assetPath = (cfg.publicStaticAssetPath || "").trim()
// Vite's define() bakes PUBLIC_STATIC_ASSET_PATH in as a JSON-quoted literal, e.g. the
// source ends up containing the literal 10 characters `"/assets/"` (quotes included)
// wherever process.env.PUBLIC_STATIC_ASSET_PATH was referenced. Matching that quoted
// form - not a bare substring search - matters because the Vite manifest's own "file"
// entries look like "client/assets/main-<hash>.js": Vite's default chunk output
// directory is also named "assets", so an unquoted search for "/assets/" also matches
// inside "client/assets/..." and corrupts it (turns it into "clientmain-<hash>.js").
// The quoted form only matches the actual PUBLIC_STATIC_ASSET_PATH literal.
const quotedAssetPath = assetPath ? JSON.stringify(assetPath) : ""
const stripOrigin = (s) => {
    if (assetOrigin) s = s.split(assetOrigin).join("")
    if (quotedAssetPath) s = s.split(quotedAssetPath).join('""')
    return s
}

// Recursively strip the origin from matching text files in a directory (in place).
const stripDir = (dir, re, skip = () => false) => {
    if ((!assetOrigin && !assetPath) || !existsSync(dir)) return
    for (const f of readdirSync(dir)) {
        const full = join(dir, f)
        if (skip(full)) continue
        if (statSync(full).isDirectory()) stripDir(full, re, skip)
        else if (re.test(f)) {
            const before = readFileSync(full, "utf-8")
            const after = stripOrigin(before)
            if (after !== before) writeFileSync(full, after)
        }
    }
}

// Recursively collect files matching `re` under `dir` (full paths).
const findFiles = (dir, re, out = []) => {
    if (!existsSync(dir)) return out
    for (const f of readdirSync(dir)) {
        const full = join(dir, f)
        if (statSync(full).isDirectory()) findFiles(full, re, out)
        else if (re.test(f)) out.push(full)
    }
    return out
}

// Server bundle: strip the baked publicAssetPath from the compiled JS/JSON the worker
// bundles/reads (build/server/index.js, build/.vite/*.json). Skip build/client (staged and
// stripped separately below) and build/data (app JSON content - must not be rewritten).
const BUILD_DATA_DIR = join(BUILD_DIR, "data")
stripDir(BUILD_DIR, /\.(js|json)$/, (p) => p === BUILD_CLIENT || p === BUILD_DATA_DIR)

// 2. server/data -> build/data
if (existsSync(join(ROOT, "server", "data"))) {
    cpSync(join(ROOT, "server", "data"), BUILD_DATA_DIR, { recursive: true })
}

// 3. stage assets, rewriting the baked asset origin in text assets. build/client is copied
// to dist/public/client (not flattened) because the manifest's "file" entries (and the
// publicAssetPath already baked into build/server/index.js) are of the form
// "client/assets/<name>-<hash>.js" - Workers Assets must serve that exact path.
const DIST_PUBLIC = join(ROOT, "dist", "public")
rmSync(DIST_PUBLIC, { recursive: true, force: true })
mkdirSync(join(DIST_PUBLIC, "client"), { recursive: true })
cpSync(BUILD_CLIENT, join(DIST_PUBLIC, "client"), { recursive: true })
stripDir(join(DIST_PUBLIC, "client"), /\.(js|json|css|html|map)$/)
// App static files served at the site root: the app's `public/` tree (favicon, images,
// etc.), which Catalyst serves in the Node target via express.static middleware. On Workers
// there is no fs for express.static to read, so stage public/ into dist/public and let
// Workers Assets serve it at the same URL paths (e.g. /blog-thumbs/x.svg).
if (existsSync(join(ROOT, "public"))) {
    cpSync(join(ROOT, "public"), DIST_PUBLIC, { recursive: true })
}
// Build-generated SW/offline/manifest (if the app's build emits them at build/client root)
// win over any same-named file staged from public/.
for (const f of ["catalyst-sw.js", "offline.html", "catalyst-offline-manifest.json"]) {
    const src = join(BUILD_CLIENT, f)
    if (existsSync(src)) writeFileSync(join(DIST_PUBLIC, f), stripOrigin(readFileSync(src, "utf-8")))
}

// 4. generate fs-assets map (manifest.json + asset-categories.json + every *.css under
// build/client/assets, keyed by basename - extract.js/manifestCache.js only ever look files
// up by basename regardless of the (build-host-absolute, Workers-meaningless) path they were
// asked for), origin-stripped.
const map = {}
for (const full of [
    join(BUILD_VITE_META, "manifest.json"),
    join(BUILD_VITE_META, "asset-categories.json"),
]) {
    if (existsSync(full)) map[full.split(/[\\/]/).pop()] = stripOrigin(readFileSync(full, "utf-8"))
}
for (const full of findFiles(BUILD_CLIENT, /\.css$/)) {
    map[full.split(/[\\/]/).pop()] = stripOrigin(readFileSync(full, "utf-8"))
}
// Registering the map is a module-evaluation-time SIDE EFFECT (not just a default
// export) so plain import order in worker/index.js is enough to guarantee it happens
// before build/server/index.js is evaluated (whose manifestCache.js reads
// .vite/manifest.json via the fs shim as its own top-level side effect). Static
// `import` declarations execute in source order relative to each other (even though
// all of them run before any non-import code in the file), so a dynamic import()
// gymnastic to enforce this ordering isn't needed - and dynamic import() of a local,
// non-package relative path isn't reliably bundleable by wrangler anyway.
mkdirSync(join(ROOT, "worker"), { recursive: true })
writeFileSync(
    join(ROOT, "worker", "fs-assets.generated.js"),
    `// AUTO-GENERATED by ${ADAPTER} prebuild - do not edit.\n` +
        `const map = ${JSON.stringify(map)}\n` +
        `globalThis.__CATALYST_FS_ASSETS__ = map\n` +
        `export default map\n`,
)

const assetCount = findFiles(join(DIST_PUBLIC, "client"), /.*/).length
console.log(
    `catalyst-cloudflare prebuild: worker "${cfg.name}", staged ${assetCount} client assets, embedded ${Object.keys(map).length} fs files` +
        (assetOrigin ? `, stripped asset origin ${assetOrigin}` : "") +
        (assetPath ? `, stripped asset path ${assetPath}` : "") +
        (cfg.selfHostAlias ? `, self-host alias ${cfg.selfHostAlias}` : ""),
)
