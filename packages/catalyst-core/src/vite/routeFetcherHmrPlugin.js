import fs from "node:fs"
import { createHash } from "node:crypto"
import { parseAst, transformWithEsbuild } from "vite"

// Dev-only HMR for page data fetchers.
//
// Fast Refresh swaps a page's component but not statics like clientFetcher.
// For every module that defines a fetcher, this plugin appends a footer that
// announces each hot update to split() and RouterDataProvider, together with
// whether the update changed what each fetcher does.
//
// To decide "changed", hash only the code a fetcher can reach: the top-level
// declarations and statements it uses, followed into local imports. Edits to
// the fetcher, or to constants and helpers it uses, change the hash; edits to
// JSX, styles or helpers only the component uses don't. Modules the walk can't
// follow name by name are hashed whole; a fetcher it can't analyse at all gets
// the fingerprint "unknown", which the footer treats as changed on every update.

const FETCHERS = ["clientFetcher", "serverFetcher"]
const MENTIONS_FETCHER = /\b(client|server)Fetcher\b/
const SCRIPT = /\.(m?[jt]sx?|cjs)$/
const UNKNOWN = "unknown"

const sha = (text) => createHash("sha1").update(text).digest("hex").slice(0, 16)

const isFetcherMember = (node) =>
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "Identifier" &&
    FETCHERS.includes(node.property.name)

// The identifiers an AST subtree uses, and the specifiers of its `import()`
// calls (null when not a string literal). Property names and object keys
// aren't variables, so they're skipped. Over-collecting only adds to the hash.
function references(node, found = { names: new Set(), imports: [] }) {
    if (Array.isArray(node)) {
        node.forEach((child) => references(child, found))
    } else if (node && typeof node.type === "string") {
        // `Page.serverFetcher` refers to that fetcher, not to the whole component.
        if (isFetcherMember(node)) {
            found.names.add(`${node.object.name}.${node.property.name}`)
            return found
        }
        if (node.type === "Identifier") found.names.add(node.name)
        if (node.type === "ImportExpression") {
            found.imports.push(node.source.type === "Literal" ? node.source.value : null)
        }
        for (const [key, child] of Object.entries(node)) {
            if ((key === "property" || key === "key") && !node.computed) continue
            if (child && typeof child === "object") references(child, found)
        }
    }
    return found
}

// Bindings an initialiser may change while it runs: passed to a call (or the
// object a method is called on), assigned to, or aliased (`const alias = config`,
// whose later writes change `config`). Function bodies don't run at
// declaration time, so they're skipped; that keeps `memo(() => <Page/>)` from
// tying the component to everything its JSX uses.
function touchedNames(node, found = new Set()) {
    const root = (n) => {
        while (n?.type === "MemberExpression") n = n.object
        if (n?.type === "Identifier") found.add(n.name)
    }
    if (Array.isArray(node)) {
        node.forEach((child) => touchedNames(child, found))
    } else if (node && typeof node.type === "string" && !node.type.includes("Function")) {
        if (node.type === "CallExpression" || node.type === "NewExpression") {
            node.arguments.forEach(root)
            if (node.callee.type === "MemberExpression") root(node.callee.object)
            // `(() => { config.base = … })()` runs now, so its body counts.
            if (node.callee.type.includes("Function")) touchedNames(node.callee.body, found)
        }
        if (node.type === "AssignmentExpression") root(node.left)
        if (node.type === "UpdateExpression") root(node.argument)
        for (const child of Object.values(node))
            if (child && typeof child === "object") touchedNames(child, found)
    }
    return found
}

// The binding an initialiser is just another name for: `config`, `config.api`,
// `a ?? b`, `cond ? a : b`.
function aliasedNames(node, found = new Set()) {
    while (node?.type === "MemberExpression") node = node.object
    if (node?.type === "Identifier") found.add(node.name)
    if (node?.type === "LogicalExpression") [node.left, node.right].forEach((n) => aliasedNames(n, found))
    if (node?.type === "ConditionalExpression")
        [node.consequent, node.alternate].forEach((n) => aliasedNames(n, found))
    return found
}

/**
 * Indexes a module's top level: what each name is declared as, plus every
 * top-level statement that mentions it (`api.base = …`, `configure(api)`, TS
 * namespace setup); where each import comes from; and where fetchers are set.
 */
async function analyseModule(file, source) {
    const loader = file.endsWith(".tsx") ? "tsx" : file.endsWith(".ts") ? "ts" : "jsx"
    const { code } = await transformWithEsbuild(source, file, { loader, jsx: "automatic" })
    const mod = {
        code,
        declarations: new Map(),
        imports: new Map(),
        sources: [],
        sideEffects: [],
        fetchers: {},
        dynamicImports: [],
    }
    const declare = (name, node) => mod.declarations.set(name, [...(mod.declarations.get(name) || []), node])
    const body = parseAst(code).body
    mod.dynamicImports = references(body).imports
    for (let node of body) {
        if (node.source) mod.sources.push(node.source.value)
        if (node.type === "ImportDeclaration") {
            if (!node.specifiers.length) mod.sideEffects.push(node.source.value)
            for (const s of node.specifiers) {
                const name = s.imported
                    ? (s.imported.name ?? s.imported.value)
                    : s.type === "ImportDefaultSpecifier"
                      ? "default"
                      : "*"
                mod.imports.set(s.local.name, { source: node.source.value, name })
            }
            continue
        }
        // `export { a } from …` and `export *` declare nothing here; the walk follows them as exports.
        if (
            node.type === "ExportAllDeclaration" ||
            (node.type === "ExportNamedDeclaration" && !node.declaration)
        ) {
            continue
        }
        if (node.type === "ExportDefaultDeclaration") declare("default", node)
        if (node.declaration) node = node.declaration
        if (node.type === "VariableDeclaration") {
            for (const d of node.declarations) {
                references(d.id).names.forEach((name) => declare(name, d))
                // `const x = Object.assign(config, …)` or `= setup(config)` can change
                // `config`, so the declaration also counts toward the bindings it passes on or writes.
                touchedNames(d.init).forEach((name) => declare(name, d))
                aliasedNames(d.init).forEach((name) => declare(name, d))
            }
        } else if (node.id) {
            declare(node.id.name, node)
        } else {
            // Any other top-level statement (`api.base = …`, `if (…) value = 2`,
            // loops, `configure(api)`, TS namespace setup) is part of every name it mentions.
            const { left, right } = node.expression || {}
            const fetcher = left?.type === "MemberExpression" && FETCHERS.includes(left.property.name)
            if (fetcher) mod.fetchers[left.property.name] = right
            // A fetcher definition belongs only to the object it's set on, so a
            // fetcher that sets `window.x` doesn't tie itself to everything.
            const names = fetcher
                ? [left.object.name, `${left.object.name}.${left.property.name}`]
                : references(node).names
            names.forEach((name) => declare(name, node))
        }
    }
    return mod
}

// A local file an import resolves to (query stripped), or null for packages and virtual modules.
async function resolveLocal(resolve, source, importer) {
    const id = (await resolve(source, importer))?.id
    const file = id?.split("?")[0]
    const local = file && !file.startsWith("\0") && !file.includes("/node_modules/") && fs.existsSync(file)
    return local ? { file, script: SCRIPT.test(id) } : null
}

/**
 * Hashes everything a fetcher can reach, starting at its expression. Names
 * resolve to their declarations, imports to the exporting module's
 * declaration; a module re-export, namespace import or `import()` is hashed
 * whole, as are local side-effect scripts of every module it enters. Local
 * data files it imports (JSON, `?raw`) count by content, packages by specifier.
 * Returns UNKNOWN when it meets a computed `import()`.
 */
async function hashFetcher(page, root, load, resolve, dependencies) {
    const parts = []
    const queue = []
    const seen = new Set()
    const entered = new Set()
    let unknown = false
    const visit = async (file, node) => {
        const mod = await load(file)
        parts.push(mod.code.slice(node.start, node.end))
        if (!entered.has(file)) {
            entered.add(file)
            for (const source of mod.sideEffects) await follow(file, source, "*", { scriptsOnly: true })
        }
        const { names, imports } = references(node)
        names.forEach((name) => queue.push({ file, name }))
        for (const source of imports) await follow(file, source, "*")
    }
    const follow = async (importer, source, name, { scriptsOnly = false } = {}) => {
        if (source === null) return (unknown = true)
        const target = await resolveLocal(resolve, source, importer)
        if (!target) return parts.push(`${source}:${name}`)
        // Side-effect stylesheets don't change data; side-effect scripts might.
        if (!target.script && scriptsOnly) return
        dependencies.add(target.file)
        if (!target.script) return parts.push(fs.readFileSync(target.file, "utf8"))
        queue.push({ file: target.file, name, exported: true })
    }
    await visit(page, root)
    while (queue.length) {
        const { file, name, exported } = queue.shift()
        const key = `${file}#${name}`
        if (seen.has(key)) continue
        seen.add(key)
        const mod = await load(file)
        if (name.includes(".") && !mod.declarations.has(name)) {
            // A fetcher member of something defined elsewhere: follow the object itself.
            queue.push({ file, name: name.split(".")[0], exported })
            continue
        }
        const imported = mod.imports.get(name)
        const declared = mod.declarations.get(name)
        // An imported binding can also be touched here (`api.flag = true`): follow both.
        for (const node of declared || []) await visit(file, node)
        if (imported) await follow(file, imported.source, imported.name)
        if (!declared && !imported && exported) {
            // A re-export, `export *` or namespace: take the whole module, with
            // everything it imports, statically or with import().
            parts.push(mod.code)
            for (const source of [...mod.sources, ...mod.dynamicImports]) await follow(file, source, "*")
        }
    }
    return unknown ? UNKNOWN : sha(parts.join("\n"))
}

/**
 * Fingerprints each fetcher of a page module: "none" when it isn't defined,
 * and UNKNOWN when it's defined in a way this can't follow (a class static,
 * Object.assign) or analysis fails.
 *
 * @param {string} file absolute path of the page module
 * @param {string} source its source text
 * @param {(spec: string, importer: string) => Promise<{id: string} | null>} resolve
 */
export async function fetcherFingerprints(file, source, resolve) {
    const modules = new Map()
    const load = (target) => {
        if (!modules.has(target)) {
            modules.set(
                target,
                analyseModule(target, target === file ? source : fs.readFileSync(target, "utf8"))
            )
        }
        return modules.get(target)
    }
    const fingerprints = {}
    // Other local files the fetchers reach; editing one changes a fingerprint.
    const dependencies = new Set()
    try {
        const page = await load(file)
        for (const name of FETCHERS) {
            const root = page.fetchers[name]
            if (root) fingerprints[name] = await hashFetcher(file, root, load, resolve, dependencies)
            // Mentioned but not set as `X.name = …` at the top level (a class static,
            // Object.assign, a computed key, inside an `if`): it can't be followed.
            else fingerprints[name] = new RegExp(`\\b${name}\\b`).test(page.code) ? UNKNOWN : "none"
        }
        dependencies.delete(file)
        return { fingerprints, dependencies }
    } catch (error) {
        for (const name of FETCHERS) fingerprints[name] = UNKNOWN
        return { fingerprints, dependencies, error }
    }
}

const hmrFooter = (fingerprints) => `
if (import.meta.hot) {
    const fingerprints = ${JSON.stringify(fingerprints)}
    import.meta.hot.data.catalystFingerprints = fingerprints
    // Shared with split(): old module namespace -> its replacement, and the splits to update.
    const hmr = (window.__CATALYST_HMR__ = window.__CATALYST_HMR__ || { replaced: new WeakMap(), splits: new Set() })
    const isComponent = (c) => typeof c === "function" || (typeof c === "object" && c !== null && "$$typeof" in c)
    const changed = (name, next) => next[name] === "${UNKNOWN}" || next[name] !== fingerprints[name]
    import(/* @vite-ignore */ import.meta.url).then((prev) => {
        import.meta.hot.accept((next) => {
            if (!next) return
            // Not a page component: let the update reach the modules that import this one.
            if (!isComponent(prev.default) || !isComponent(next.default)) return import.meta.hot.invalidate()
            const nextFingerprints = import.meta.hot.data.catalystFingerprints
            hmr.replaced.set(prev, next)
            const detail = {
                prev,
                next,
                splits: [],
                fetcherChanged: changed("clientFetcher", nextFingerprints),
                serverFetcherChanged: changed("serverFetcher", nextFingerprints),
                reload: false,
            }
            // split() swaps in the new module first; then RouterDataProvider decides what to refetch.
            hmr.splits.forEach((onUpdate) => onUpdate(detail))
            window.dispatchEvent(new CustomEvent("catalyst:route-module-updated", { detail }))
            // RouterDataProvider asks for this when the page on screen shows data from an edited serverFetcher.
            if (detail.reload) window.location.reload()
        })
    })
}
`

export function routeFetcherHmrPlugin() {
    // Files that got the footer stay instrumented, so removing a fetcher and
    // adding it back still announces both updates.
    const instrumented = new Set()
    const transformed = new Set()
    // Page file -> local files its fetchers reach.
    const fetcherDependencies = new Map()
    let server
    return {
        name: "vite-plugin-catalyst-route-fetcher-hmr",
        apply: "serve",
        enforce: "post",
        configureServer(devServer) {
            server = devServer
        },
        // When a file a fetcher reaches changes, Vite would only soft-invalidate the
        // page (reusing its transform), leaving the page's fingerprints stale.
        // Invalidate it fully so transform() recomputes them, and include it in the update.
        handleHotUpdate({ file, modules, server: devServer }) {
            const pages = []
            for (const [page, dependencies] of fetcherDependencies) {
                if (!dependencies.has(file)) continue
                for (const mod of devServer.moduleGraph.getModulesByFile(page) || []) {
                    devServer.moduleGraph.invalidateModule(mod)
                    pages.push(mod)
                }
            }
            return pages.length ? [...new Set([...modules, ...pages])] : undefined
        },
        async transform(code, id, options) {
            if (options?.ssr || id.startsWith("\0") || id.includes("node_modules")) return null
            const file = id.split("?")[0]
            if (!SCRIPT.test(file)) return null
            const loadedBefore = transformed.has(file)
            transformed.add(file)
            if (!instrumented.has(file) && !MENTIONS_FETCHER.test(code)) return null
            const { fingerprints, dependencies, error } = await fetcherFingerprints(
                file,
                fs.readFileSync(file, "utf8"),
                (spec, importer) => this.resolve(spec, importer)
            )
            if (!instrumented.has(file)) {
                if (FETCHERS.every((name) => fingerprints[name] === "none")) return null
                instrumented.add(file)
                // The browser already runs a version without the footer, so nothing
                // would hand this update to split(). Reload once instead.
                if (loadedBefore) setTimeout(() => server?.ws.send({ type: "full-reload" }))
            }
            fetcherDependencies.set(file, dependencies)
            if (error)
                this.warn(`Couldn't analyse fetchers in ${file}, so every edit refetches: ${error.message}`)
            return { code: code + hmrFooter(fingerprints), map: null }
        },
    }
}
