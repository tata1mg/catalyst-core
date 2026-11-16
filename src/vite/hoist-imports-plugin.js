import path from "path"

/**
 * Rollup hoisted each entry's transitive static imports into the entry itself,
 * so the browser requested the whole static import tree at once. Rolldown does
 * not (`output.hoistTransitiveImports` is "not implemented yet", see
 * rolldown#10820). Catalyst sets `build.modulePreload: false` and writes its own
 * HTML, so without hoisting every level of the import tree costs one more
 * network round trip before the page can hydrate.
 *
 * For every entry and dynamic-entry chunk, this appends `import"./x.js";` for
 * each chunk in its static import closure that it does not import directly.
 * Those chunks load anyway; the browser now just asks for them up front. A
 * chunk whose closure contains itself (a chunk cycle) is left alone, so module
 * evaluation order cannot change.
 *
 * It runs in generateBundle, after file names are hashed. A change to this
 * plugin therefore changes file contents without changing their names: ship
 * any such change together with something that rehashes the output, or cached
 * copies will fail the page's `integrity` checks.
 *
 * Remove once Rolldown implements hoistTransitiveImports.
 */
export function hoistImportsPlugin() {
    return {
        name: "catalyst:hoist-transitive-imports",
        enforce: "post",
        apply: "build",
        generateBundle(_options, bundle) {
            const chunks = Object.values(bundle).filter((output) => output.type === "chunk")
            const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))

            for (const chunk of chunks) {
                if (!chunk.isEntry && !chunk.isDynamicEntry) continue

                const closure = new Set()
                const stack = [...chunk.imports]
                while (stack.length) {
                    const fileName = stack.pop()
                    if (closure.has(fileName)) continue
                    closure.add(fileName)
                    stack.push(...(byFileName.get(fileName)?.imports || []))
                }
                if (closure.has(chunk.fileName)) continue

                const direct = new Set(chunk.imports)
                const missing = [...closure].filter((fileName) => !direct.has(fileName))
                if (!missing.length) continue

                const dir = path.posix.dirname(chunk.fileName)
                const statements = missing
                    .map((fileName) => {
                        const relative = path.posix.relative(dir, fileName)
                        return `import"${relative.startsWith(".") ? relative : `./${relative}`}";`
                    })
                    .join("")

                // A leading newline keeps the imports out of a trailing line comment.
                const mapComment = chunk.code.lastIndexOf("\n//# sourceMappingURL=")
                const end = mapComment === -1 ? chunk.code.length : mapComment
                chunk.code = `${chunk.code.slice(0, end)}\n${statements}${chunk.code.slice(end)}`
            }
        },
    }
}
