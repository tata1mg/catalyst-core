import fs from "fs"
import path from "path"
import crypto from "crypto"
import MagicString from "magic-string"

/**
 * Stable chunk names: a chunk's file name changes only when its own code changes.
 *
 * Why: Rollup puts a hash of each chunk's final bytes in its file name, and those bytes include the file names
 * of the chunks it imports. A shared chunk that many chunks import (a "hub", in practice `app`) also holds an
 * `import("./X-<hash>.js")` for every lazily loaded route and widget. So changing any lazy chunk renames the
 * hub, and renaming the hub renames every chunk that imports it. On 1mg's mweb, a release that changes one page
 * renames ~1,200 of ~1,350 JS files, and returning visitors download ~330 KB (brotli) of JS they already had.
 *
 * What: inside hub chunks only (found with Rollup's own parser):
 *     import("./X-<hash>.js")                          ->  __ccI("src/pages/X/index")
 *     preload(fn, __VITE_PRELOAD__[, import.meta.url]) ->  __ccP("src/pages/X/index", preload, fn, 0|1)
 * The ids are module paths relative to the app root, so they are the same across builds and machines. The
 * id -> file name / CSS table is carried by the entry chunk (`main`), which nothing imports and which already
 * changes on every release. A hub's bytes, and so its file name, now change only when the hub's own code changes.
 * Other chunks are not touched. A change inside a hub still renames the chunks that import it statically;
 * avoiding that would need import maps (Safari 16.4+).
 *
 * Runtime behaviour is unchanged:
 * - The same file is imported, resolved against the hub's own URL as the relative specifier was.
 * - The same CSS is loaded through Vite's own preload helper (same nonce, crossorigin and error event).
 * - The table is published on `globalThis.__ccCM` as a promise, so a hub that runs before `main` waits for it.
 *
 * Cache safety:
 * - `main`'s hash covers every target's file name: the table is written in renderChunk with Rollup's hash
 *   placeholders.
 * - The CSS lists are filled in generateBundle (after hashing), like Vite's own `__vite__mapDeps`. They are
 *   covered transitively: a chunk's hash includes its CSS file names, and a target's hash its imports' hashes.
 *
 * Fallback: every import() in a hub that names another chunk must be the single import inside a Vite preload
 * call. Otherwise that hub is left exactly as Vite emits it, and the build warns with the reason. Left as they
 * are, because they name no chunk of the build: imports with a computed or non-relative specifier, and preload
 * calls around no import at all (Rollup inlines a dynamic import of a module that is in the hub itself).
 */

const NAME = "stable-chunk-names"
const CSS_MARKER = '"__CATALYST_CHUNK_CSS_DEPS__"'
const EMPTY_MARKER = '"__CATALYST_CHUNK_EMPTY__"'
const ENTRY_CSS = "@@catalyst-css:"
// A chunk is a hub when at least this many chunks import it statically.
const DEFAULT_MIN_IMPORTERS = 20

const PRELOAD_MARKER = "__VITE_PRELOAD__"
// Start of the line `main` gets in renderChunk. The line is ours alone, so it has no source mappings.
const TABLE_PREFIX = "!function(g,t){var w=g.__ccCM;"

// Appended to each rewritten hub (function declarations are hoisted). They sit after every Vite preload marker
// in the chunk, so Vite's generateBundle never pairs these non-literal import() calls with a marker.
//   __ccT: the table `main` publishes on globalThis.__ccCM (created here as a pending promise if `main`
//            has not run yet, e.g. an eager split() import while the hub module is still evaluating)
//   __ccI: import("./<file>") for a stable id, resolved against the hub's own URL like the original specifier
//   __ccP: Vite's preload helper call, with the CSS deps Vite would have passed for that import
//   __ccQ: short form of __ccP for the common `preload(() => import("./X"), ...)` shape
// Table entries are "file" or ["file", ...css indexes for the primary hub]; other hubs keep theirs in t.c.
const helperFor = (hubKey, primary) => `
function __ccT(){var g=globalThis,w=g.__ccCM;if(!w){var r,q=new Promise(function(x){r=x});q.r=r;w=g.__ccCM=q}return w}
function __ccI(i){return __ccT().then(function(t){var e=t.j[i];return t.e[i]?{}:import(new URL("./"+(typeof e=="string"?e:e[0])+".js",import.meta.url).href)})}
function __ccP(i,p,f,n){return __ccT().then(function(t){var e=t.j[i],d=${
    primary ? `typeof e=="string"?[]:e.slice(1)` : `(t.c[${JSON.stringify(hubKey)}]||{})[i]||[]`
};return p(f,d.map(function(k){return t.p+t.s[k]+t.x}),n?import.meta.url:void 0)})}
function __ccQ(i,p,n){return __ccP(i,p,function(){return __ccI(i)},n)}
`

const countMarkers = (code) => code.split(PRELOAD_MARKER).length - 1

const isMarker = (node) =>
    (node?.type === "Identifier" && node.name === PRELOAD_MARKER) ||
    (node?.type === "ConditionalExpression" && isMarker(node.consequent))

const isPreloadCall = (node) =>
    node.type === "CallExpression" && node.arguments.length >= 2 && isMarker(node.arguments[1])

const isImportMetaUrl = (node) =>
    node?.type === "MemberExpression" &&
    node.object.type === "MetaProperty" &&
    node.object.meta.name === "import" &&
    node.property.name === "url"

// One pass over the AST: every import() and every Vite preload call `preload(fn, __VITE_PRELOAD__[, url])`.
// An import() belongs to the innermost preload call whose callback `fn` contains it.
const collectDynamicImports = (ast) => {
    const imports = [] // { node, owner }
    const preloads = [] // { call, fn, imports }
    const visit = (node, owner) => {
        if (!node || typeof node.type !== "string") return
        if (node.type === "ImportExpression") {
            imports.push({ node, owner })
            owner?.imports.push(node)
        }
        const preload = isPreloadCall(node) ? { call: node, fn: node.arguments[0], imports: [] } : null
        if (preload) preloads.push(preload)
        for (const key in node) {
            const value = node[key]
            for (const child of Array.isArray(value) ? value : [value])
                visit(child, preload && child === preload.fn ? preload : owner)
        }
    }
    visit(ast, null)
    return { imports, preloads }
}

// Stable, readable id of a module: its path relative to the app root, without the extension
// (e.g. "src/js/pages/Home/index"). Readable ids compress well next to the split() keys Catalyst already
// writes at each call site; a hash is used only for ids that aren't plain paths (virtual modules).
const stableId = (moduleId, root) => {
    const rel = path.relative(root, moduleId).split(path.sep).join("/")
    if (/[\0?#"\\]/.test(rel)) return hashedId(moduleId, root)
    return rel.replace(/\.(m?js|jsx|ts|tsx)$/, "")
}

// Module that names a chunk: its facade module, or (for a shared chunk reached through one of its exports,
// e.g. `import("./x.js").then(m => m.j)`) its first module in sorted order. A module belongs to one chunk only.
const chunkModule = (info) =>
    info?.facadeModuleId || (info?.moduleIds?.length ? [...info.moduleIds].sort()[0] : null)

// Id of a module that no other module in the build can share: a hash of its full path, extension included.
const hashedId = (moduleId, root) =>
    "#" +
    crypto
        .createHash("sha256")
        .update(path.relative(root, moduleId).split(path.sep).join("/"))
        .digest("hex")
        .slice(0, 12)

/**
 * Stable ids for a set of chunks. The readable id drops the extension, so two chunks can end up
 * with the same one (`foo.js` / `foo.ts`), and an id can name an Object.prototype property (`constructor`),
 * which would break a plain-object lookup at runtime. Such ids are replaced by `hashedId`. Returns null if the
 * ids are still not unique (the build then leaves every hub unchanged).
 */
const uniqueIds = (files, chunks, root) => {
    const readable = new Map()
    const owners = new Map()
    for (const file of files) {
        const moduleId = chunkModule(chunks[file])
        if (!moduleId) continue
        const id = stableId(moduleId, root)
        readable.set(file, { id, moduleId })
        owners.set(id, (owners.get(id) || 0) + 1)
    }
    const ids = new Map()
    for (const [file, { id, moduleId }] of readable)
        ids.set(file, owners.get(id) > 1 || id in Object.prototype ? hashedId(moduleId, root) : id)
    const values = [...ids.values()]
    return new Set(values).size === values.length && !values.some((id) => id in Object.prototype) ? ids : null
}

const realPath = (p) => {
    try {
        return fs.realpathSync(p)
    } catch {
        return path.resolve(p)
    }
}

const baseName = (fileName) => fileName.slice(fileName.lastIndexOf("/") + 1)

export const isStableChunkNamesEnabled = (value) => value === true || value === "true"

/**
 * Added to the client build when STABLE_CHUNK_NAMES_ENABLE is true (see vite.config.client.js).
 * @param {object} [options]
 * @param {number} [options.minImporters] - static importers needed for a chunk to count as a hub
 * @param {string} [options.root] - path stable ids are relative to (defaults to the app root)
 */
export function stableChunkNamesPlugin({ minImporters = DEFAULT_MIN_IMPORTERS, root } = {}) {
    // Rollup's module ids are real paths, so the root must be too: a root reached through a symlink (a CI
    // workspace, macOS /tmp) would otherwise put "../../private/..." into every id, and the ids would change
    // with the checkout path.
    const appRoot = realPath(root || process.env.src_path || process.cwd())
    // per output: placeholder file name -> { imports, importedCss } recorded at renderChunk time
    let records = new Map()
    let plan = null // { hubs: Set<fileName>, table: Map<sid, targetFileName>, rewritten: Set<fileName> }

    const buildPlan = (chunks) => {
        const importers = new Map()
        for (const chunk of Object.values(chunks)) {
            for (const imported of chunk.imports) importers.set(imported, (importers.get(imported) || 0) + 1)
        }
        const hubFiles = Object.values(chunks)
            .filter((c) => !c.isEntry && (importers.get(c.fileName) || 0) >= minImporters && chunkModule(c))
            .map((c) => c.fileName)
        const targets = [...new Set(hubFiles.flatMap((file) => chunks[file].dynamicImports))]
        const sidByTarget = uniqueIds(targets, chunks, appRoot)
        // A stable key per hub: Vite leaves the calling chunk's own CSS out of a dynamic import's deps,
        // so the CSS lists are kept per hub.
        const hubKey = uniqueIds(hubFiles, chunks, appRoot)
        if (!sidByTarget || !hubKey) return { error: "chunk ids are not unique", hubs: new Set() }

        const hubs = new Set(hubFiles)
        const table = new Map()
        const dynamicByHub = new Map()
        for (const file of hubFiles) {
            const own = chunks[file].dynamicImports.filter((target) => sidByTarget.has(target))
            dynamicByHub.set(file, own)
            for (const target of own) table.set(sidByTarget.get(target), target)
        }
        // The hub with the most lazy imports (in practice `app`) keeps its CSS lists inside the file table.
        const primary = [...hubs].sort(
            (a, b) =>
                dynamicByHub.get(b).length - dynamicByHub.get(a).length ||
                (hubKey.get(a) < hubKey.get(b) ? -1 : 1)
        )[0]
        return {
            hubs,
            primary,
            table,
            hubKey,
            sidByTarget,
            dynamicByHub,
            byBaseName: new Map(Object.keys(chunks).map((f) => [baseName(f), f])),
        }
    }

    /**
     * Rewrites each Vite preload call in a hub and the import() inside it:
     *     preload(() => import("./X"), __VITE_PRELOAD__[, import.meta.url])  ->  __ccQ(id, preload, n)
     *     preload(fn, __VITE_PRELOAD__[, import.meta.url])                    ->  __ccP(id, preload, fn, n)
     *     (and the import("./X") inside fn                                    ->  __ccI(id))
     * where n is 1 when Vite passed import.meta.url. Every import() is checked before anything is changed.
     * Returns null when there is nothing to do, `{ failed, reason, offset }` when the hub must stay as Vite
     * emitted it, or the MagicString with the rewrite.
     */
    const rewriteHub = (code, parse, byBaseName, hk, primary) => {
        const fail = (reason, node) => ({ failed: true, reason, offset: node?.start })
        let ast
        try {
            ast = parse(code)
        } catch (error) {
            return fail(`parse error: ${error.message}`)
        }
        const { imports, preloads } = collectDynamicImports(ast)

        for (const { node, owner } of imports) {
            const spec = node.source.type === "Literal" ? node.source.value : null
            if (typeof spec !== "string" || !/^\.\.?\//.test(spec)) {
                // names no chunk of this build: left as it is
                if (owner) return fail("preload call around an import that names no chunk", node)
                continue
            }
            if (!spec.startsWith("./") || node.options)
                return fail('relative dynamic import that is not a plain "./" path', node)
            if (!owner) return fail("dynamic import outside a Vite preload call", node)
        }
        const calls = []
        // Preload calls around no import(): Rollup inlined a dynamic import of a module in the same chunk as
        // `Promise.resolve().then(() => ns)`. They name no chunk; Vite turns their marker into `void 0`.
        let inlined = 0
        for (const { call, fn, imports: own } of preloads) {
            if (own.length === 0) {
                if (countMarkers(code.slice(call.start, call.end)) !== 1)
                    return fail("preload call with no import and more than one marker", call)
                inlined++
                continue
            }
            if (own.length !== 1) return fail(`preload callback with ${own.length} dynamic imports`, call)
            const [, , url, ...rest] = call.arguments
            if (rest.length || (url && !isImportMetaUrl(url)))
                return fail("preload call with an unexpected 3rd argument", call)
            const [inner] = own
            const sid = plan.sidByTarget.get(byBaseName.get(inner.source.value.slice(2)))
            if (!sid) return fail(`no chunk for ${inner.source.value}`, inner)
            const short = fn.type === "ArrowFunctionExpression" && !fn.params.length && fn.body === inner
            calls.push({ call, fn, inner, sid, short, n: url ? 1 : 0 })
        }
        if (!calls.length) return null

        const s = new MagicString(code)
        for (const { call, fn, inner, sid, short, n } of calls) {
            const id = JSON.stringify(sid)
            const callee = code.slice(call.callee.start, call.callee.end)
            if (short) {
                s.overwrite(call.start, call.end, `__ccQ(${id},${callee},${n})`)
            } else {
                s.overwrite(call.start, fn.start, `__ccP(${id},${callee},`)
                s.overwrite(fn.end, call.end, `,${n})`)
                s.overwrite(inner.start, inner.end, `__ccI(${id})`)
            }
        }
        const out = s.toString()
        if (countMarkers(out) !== inlined) return fail("a Vite preload marker outside a preload call")
        if (/\bimport\(\s*["']\.\.?\//.test(out)) return fail("a relative import() left after the rewrite")
        s.append(helperFor(hk, primary))
        return s
    }

    return {
        name: NAME,
        apply: "build",
        enforce: "post",

        renderStart() {
            records = new Map()
            plan = null
        },

        renderChunk: {
            order: "post",
            handler(code, chunk, outputOptions, meta) {
                if (outputOptions.format !== "es") return null
                records.set(chunk.fileName, {
                    imports: [...chunk.imports],
                    importedCss: [...(chunk.viteMetadata?.importedCss || [])],
                })
                if (!plan) {
                    plan = { ...buildPlan(meta.chunks), rewritten: new Set() }
                    if (plan.error) this.warn(`[${NAME}] left every hub unchanged: ${plan.error}`)
                }

                if (plan.hubs.has(chunk.fileName)) {
                    const s = rewriteHub(
                        code,
                        (c) => this.parse(c),
                        plan.byBaseName,
                        plan.hubKey.get(chunk.fileName),
                        chunk.fileName === plan.primary
                    )
                    if (!s) return null
                    if (s.failed) {
                        const at = s.offset === undefined ? "" : ` (offset ${s.offset})`
                        this.warn(`[${NAME}] left ${chunk.fileName} unchanged: ${s.reason}${at}`)
                        return null
                    }
                    plan.rewritten.add(chunk.fileName)
                    return { code: s.toString(), map: s.generateMap({ hires: "boundary" }) }
                }

                if (chunk.isEntry && chunk.name === "main" && plan.hubs.size) {
                    // File names are written as placeholders, so main's hash covers every target.
                    // Each entry carries a marker that generateBundle replaces with the primary hub's CSS indexes.
                    const entries = [...plan.table.entries()]
                        .sort()
                        .map(
                            ([sid, target]) =>
                                `${JSON.stringify(sid)}:[${JSON.stringify(
                                    baseName(target).replace(/\.js$/, "")
                                )},${JSON.stringify(ENTRY_CSS + sid)}]`
                        )
                    const s = new MagicString(code)
                    s.prepend(
                        `${TABLE_PREFIX}w&&w.r?w.r(t):g.__ccCM=Promise.resolve(t)}(globalThis,{j:{${entries.join(
                            ","
                        )}},c:${CSS_MARKER},e:${EMPTY_MARKER}});\n`
                    )
                    return { code: s.toString(), map: s.generateMap({ hires: "boundary" }) }
                }
                return null
            },
        },

        generateBundle: {
            order: "post",
            handler(outputOptions, bundle) {
                if (!plan) return
                const main = Object.values(bundle).find(
                    (c) => c.type === "chunk" && c.isEntry && c.name === "main"
                )
                // The markers are filled in on the table line only. That line was prepended in renderChunk, so it
                // has no source mappings; with no line added or removed, main.map stays valid for every other line.
                const start = main ? main.code.indexOf(TABLE_PREFIX) : -1
                const end = start < 0 ? -1 : main.code.indexOf("\n", start)
                const line = end < 0 ? "" : main.code.slice(start, end)
                if (!line.includes(CSS_MARKER) || !line.includes(EMPTY_MARKER)) {
                    if (plan.rewritten.size) this.error(`[${NAME}] main chunk lost the chunk table`)
                    return
                }
                if (start > 0 && main.code[start - 1] !== "\n")
                    this.error(`[${NAME}] the chunk table is no longer on its own line in main`)
                // records are keyed by preliminary (placeholder) names; map them to final names
                const finalName = new Map()
                for (const item of Object.values(bundle)) {
                    if (item.type === "chunk") finalName.set(item.preliminaryFileName, item.fileName)
                }
                // Same dependency walk as Vite's __vite__mapDeps: the target, its static imports (recursively)
                // and their CSS, stopping at the calling hub. Pure-CSS chunks Vite removed are still in records.
                const cssOf = (target, owner) => {
                    const seen = new Set([owner])
                    const css = new Set()
                    const walk = (file) => {
                        if (seen.has(file)) return
                        seen.add(file)
                        const rec = records.get(file)
                        if (!rec) return
                        rec.importedCss.forEach((c) => css.add(c))
                        rec.imports.forEach(walk)
                    }
                    walk(target)
                    return [...css].sort()
                }
                // Compact form: one de-duplicated list of CSS files (common prefix/suffix stripped) and, per hub
                // and target, indexes into it. __ccP rebuilds exactly the paths Vite would have passed.
                const perHubLists = []
                const allCss = new Set()
                for (const hub of plan.rewritten) {
                    for (const target of plan.dynamicByHub.get(hub)) {
                        const css = cssOf(target, hub)
                        css.forEach((c) => allCss.add(c))
                        if (css.length)
                            perHubLists.push([plan.hubKey.get(hub), plan.sidByTarget.get(target), css])
                    }
                }
                const cssList = [...allCss].sort()
                const P = "client/assets/css/"
                const X = ".css"
                const compact = cssList.every(
                    (c) => c.startsWith(P) && c.endsWith(X) && c.length > P.length + X.length
                )
                const index = new Map(cssList.map((c, i) => [c, i]))
                const primaryKey = plan.rewritten.has(plan.primary) ? plan.hubKey.get(plan.primary) : null
                const primaryCss = new Map()
                const cssTable = Object.create(null)
                for (const hub of plan.rewritten)
                    if (hub !== plan.primary) cssTable[plan.hubKey.get(hub)] = Object.create(null)
                for (const [hk, sid, css] of perHubLists) {
                    const idx = css.map((c) => index.get(c))
                    if (hk === primaryKey) primaryCss.set(sid, idx)
                    else cssTable[hk][sid] = idx
                }
                const strip = (c) => (compact ? c.slice(P.length, c.length - X.length) : c)
                const cssData = `${JSON.stringify(cssTable)},s:${JSON.stringify(
                    cssList.map(strip)
                )},p:${JSON.stringify(compact ? P : "")},x:${JSON.stringify(compact ? X : "")}`
                // Vite drops chunks that only carried CSS and turns their import() into Promise.resolve({}).
                const empty = Object.create(null)
                for (const [sid, target] of plan.table) if (!finalName.has(target)) empty[sid] = 1
                const entryRe = new RegExp(`\\[("[^"]*"),("${ENTRY_CSS}(?:[^"\\\\]|\\\\.)*")\\]`, "g")
                const filled = line
                    .replace(entryRe, (m, file, marker) => {
                        const idx = primaryCss.get(JSON.parse(marker).slice(ENTRY_CSS.length))
                        return idx ? `[${[file, ...idx].join(",")}]` : file
                    })
                    .replace(CSS_MARKER, () => cssData)
                    .replace(EMPTY_MARKER, () => JSON.stringify(empty))
                if (filled.includes("\n")) this.error(`[${NAME}] the chunk table must stay on one line`)
                main.code = main.code.slice(0, start) + filled + main.code.slice(end)
                this.info?.(
                    `[${NAME}] hubs rewritten: ${
                        [...plan.rewritten].map((f) => baseName(finalName.get(f) || f)).join(", ") || "none"
                    }; table entries: ${plan.table.size}`
                )
            },
        },
    }
}
