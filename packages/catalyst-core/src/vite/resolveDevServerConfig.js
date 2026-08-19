// Pure resolvers for the Vite dev-server config derived from an app's
// `buildConfig.devServer`. Side-effect free so the base precedence and the fs
// allowlist merge can be unit-tested without spinning up Vite.

/**
 * Vite `base` for the dev server. `buildConfig.devServer.base` is the single
 * source of truth (default "/"). Normalized to a leading slash and no trailing
 * slash so it doubles as a URL prefix for the SSR renderer.
 */
export function resolveDevBase(devServer = {}) {
    const base = devServer?.base
    if (!base || base === "/") return "/"
    return `/${String(base).trim().replace(/^\/+|\/+$/g, "")}`
}

/**
 * A resolved base as a URL prefix. Root ("/") becomes "" so
 * `${prefix}/client/index.js` stays single-slashed.
 */
export function toMountPathPrefix(base) {
    return !base || base === "/" ? "" : String(base).replace(/\/+$/, "")
}

/**
 * fs.allow for the dev server. Framework paths are always present; apps may
 * extend the list via `devServer.fs.allow` but cannot replace it or relax other
 * fs guards (e.g. `strict`), so buildConfig can't widen filesystem exposure.
 */
export function resolveDevFsAllow(devFs, frameworkPaths) {
    const extra = Array.isArray(devFs?.allow) ? devFs.allow : []
    return [...frameworkPaths, ...extra]
}

/**
 * Vite `server` block from `buildConfig.devServer`. Passthrough keys are spread
 * first so the framework-owned `hmr` and `fs` always win.
 */
export function buildDevServer(devServer = {}, { frameworkPaths, isProduction = false } = {}) {
    // eslint-disable-next-line no-unused-vars -- base is destructured only to omit it from serverOverrides
    const { base, hmr, fs, ...serverOverrides } = devServer
    return {
        ...serverOverrides,
        hmr: isProduction ? false : (hmr ?? true),
        fs: { allow: resolveDevFsAllow(fs, frameworkPaths) },
    }
}
