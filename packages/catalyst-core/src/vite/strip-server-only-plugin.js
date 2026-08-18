import fs from "node:fs"

const SERVER_ONLY_SUFFIX = ".server.js"
const STUB_PREFIX = "\0catalyst-server-only-stub:"

/**
 * The API layer (catalyst-core/api) keeps its own handler code out of the
 * client bundle by construction — nothing client-side imports server/api/**.
 * A loader living in shared route config has no equivalent guard: nothing
 * stops one from importing a DB client or a secret directly. This plugin adds
 * that guard for the one escape hatch RFC 0001 documents for a loader that
 * needs real server-only code instead of going through the isomorphic `api.*`
 * client: colocate it in a `*.server.js` file. On the client build only
 * (this plugin is registered in vite.config.client.js, never
 * vite.config.server.js), any import ending `.server.js` resolves to a stub
 * that re-exports the real module's own export names, each throwing a clear
 * error if actually called — so a build-time typo or an accidental client-side
 * call fails loudly with a useful message instead of silently shipping
 * secrets to the browser or failing with a cryptic "not a function".
 *
 * `export * from` re-exports inside a `.server.js` file aren't resolved
 * (would need following the re-exported module's own exports too) — a known,
 * narrow limitation; named/default exports declared directly in the file are
 * fully supported.
 */
export function stripServerOnlyPlugin() {
    return {
        name: "catalyst-strip-server-only",
        enforce: "pre",

        async resolveId(source, importer, options) {
            if (!source.endsWith(SERVER_ONLY_SUFFIX)) return null

            const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
            if (!resolved) return null

            return `${STUB_PREFIX}${resolved.id}`
        },

        load(id) {
            if (!id.startsWith(STUB_PREFIX)) return null

            const realPath = id.slice(STUB_PREFIX.length)
            return buildStubSource(this, realPath)
        },
    }
}

const buildStubSource = (pluginContext, realPath) => {
    let source
    try {
        source = fs.readFileSync(realPath, "utf-8")
    } catch {
        return "export default undefined"
    }

    let ast
    try {
        ast = pluginContext.parse(source)
    } catch {
        return "export default undefined"
    }

    const { names, hasDefault } = extractExportedNames(ast)
    const thrower = (label) =>
        `function () { throw new Error(${JSON.stringify(
            `[catalyst-core] "${label}" from "${realPath}" is server-only (stripped from the client ` +
                `bundle by strip-server-only-plugin) and cannot run in the browser.`
        )}) }`

    const lines = names.map((name) => `export const ${name} = ${thrower(name)}`)
    if (hasDefault) lines.push(`export default ${thrower("default export")}`)

    return lines.length > 0 ? lines.join("\n") : "export default undefined"
}

/**
 * Statically collects every top-level export name from a parsed module —
 * `export const/function/class x`, `export { x, y as z }` — using Rollup's
 * own acorn-based parser (this.parse), the same AST-analysis tool
 * inject-cache-key-plugin.js already uses in this same directory.
 */
const extractExportedNames = (ast) => {
    const names = new Set()
    let hasDefault = false

    for (const node of ast.body) {
        if (node.type === "ExportDefaultDeclaration") {
            hasDefault = true
            continue
        }

        if (node.type !== "ExportNamedDeclaration") continue

        if (node.declaration) {
            const decl = node.declaration
            if (decl.type === "VariableDeclaration") {
                decl.declarations.forEach((d) => {
                    if (d.id.type === "Identifier") names.add(d.id.name)
                })
            } else if (decl.id) {
                names.add(decl.id.name)
            }
        }

        ;(node.specifiers || []).forEach((spec) => names.add(spec.exported.name))
    }

    return { names: [...names], hasDefault }
}
