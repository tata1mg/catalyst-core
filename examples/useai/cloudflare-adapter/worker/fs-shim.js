// Thin wrapper over node:fs. The Catalyst SSR renderer synchronously reads a few build
// artifacts by absolute build-host path at request time (loadable-stats.json for the
// loadable ChunkExtractor, and first-fold CSS for inlining). Those paths don't exist on the
// Workers runtime, so we serve their contents from a bundle-embedded map keyed by basename
// (registered via runtime.registerFsAssets / createWorker({ fsAssets })). Everything else
// delegates to the real node:fs.
//
// wrangler `alias` maps the bare `fs` specifier (used by the compiled Catalyst code) to this
// file; the `node:fs` import below is NOT aliased, so it resolves to the real module.
import * as realFs from "node:fs"

const assets = () => globalThis.__CATALYST_FS_ASSETS__ || {}
const lookup = (p) => {
    const key = String(p).split(/[\\/]/).pop()
    const map = assets()
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined
}

export function readFileSync(p, options) {
    const hit = lookup(p)
    if (hit === undefined) return realFs.readFileSync(p, options)
    const encoding = typeof options === "string" ? options : options && options.encoding
    return encoding ? hit : Buffer.from(hit)
}

export function existsSync(p) {
    if (lookup(p) !== undefined) return true
    return realFs.existsSync(p)
}

export * from "node:fs"
export default { ...realFs, readFileSync, existsSync }
