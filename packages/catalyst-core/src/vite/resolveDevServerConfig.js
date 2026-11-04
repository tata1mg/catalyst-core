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
    return `/${String(base)
        .trim()
        .replace(/^\/+|\/+$/g, "")}`
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
 * `server.allowedHosts` plus the comma-separated hosts in
 * CATALYST_DEV_ALLOWED_HOSTS. `catalyst buildApp:ios` sets it to the Mac's
 * `<name>.local` when a physical iPhone loads the dev server by that name:
 * Vite answers 403 to any Host header that is not localhost or an IP.
 */
export function withExtraAllowedHosts(allowedHosts, extra) {
    const hosts = String(extra || "")
        .split(",")
        .map((host) => host.trim())
        .filter(Boolean)
    if (allowedHosts === true || hosts.length === 0) return allowedHosts
    const base = Array.isArray(allowedHosts) ? allowedHosts : []
    return [...base, ...hosts.filter((host) => !base.includes(host))]
}

/**
 * Vite `server` block from `buildConfig.devServer`. Passthrough keys are spread
 * first so the framework-owned `hmr` and `fs` always win.
 */
export function buildDevServer(devServer = {}, { frameworkPaths, isProduction = false } = {}) {
    // `base` is pulled out to keep it out of serverOverrides -- it is applied
    // at the config root, not under `server` -- so it is unused by design.
    // eslint-disable-next-line no-unused-vars
    const { base, hmr, fs, ...serverOverrides } = devServer
    // CATALYST_NO_HMR lets a one-shot consumer of this config (the offline
    // manifest step, which spins up a throwaway server purely to load a
    // module) opt out. isProduction is captured at module load, so it cannot
    // be flipped by setting NODE_ENV just before createServer().
    const hmrDisabled = isProduction || process.env.CATALYST_NO_HMR === "true"
    const allowedHosts = withExtraAllowedHosts(
        serverOverrides.allowedHosts,
        process.env.CATALYST_DEV_ALLOWED_HOSTS
    )
    return {
        ...serverOverrides,
        ...(allowedHosts === undefined ? {} : { allowedHosts }),
        hmr: hmrDisabled ? false : (hmr ?? true),
        fs: { allow: resolveDevFsAllow(fs, frameworkPaths) },
    }
}
