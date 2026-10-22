import { readFileSync, writeFileSync } from "fs"
import path from "path"
import { createRequire } from "module"
import {
    validateConfigFile,
    validatePackageJson,
    validateModuleAlias,
} from "../server/utils/validator.js"
import { formatError, createError, ERROR_CODES } from "../errors/index.js"
import { resolveOutputMode, getDebugEnvInfo } from "./scriptUtils.js"

const requireCjs = createRequire(import.meta.url)
const { registryFailure } = requireCjs("../cli/diagnostic.js")
const { GUTTER, glyph, t } = requireCjs("../cli/theme.js")

/**
 * A registry error as the CLI shows it: the diagnostic block by default, the
 * registry's box under --verbose and --debug.
 * @param {import("../errors/index.js").CatalystError} err
 * @param {string} mode - "default" | "verbose" | "debug"
 * @param {{scope?: string}} [options]
 */
export function renderRegistryError(err, mode, { scope } = {}) {
    if (mode === "default") return registryFailure(err, { scope })
    return formatError(err, mode, mode === "debug" ? getDebugEnvInfo() : undefined)
}

// Static preflight — the file-based checks a developer's misconfiguration
// would trip. Runs in the parent CLI process (start.js / serve.js / build.js)
// BEFORE the server is spawned, so a bad config.json / package.json fails
// fast with a coded, doc-linked error instead of a raw ENOENT or SyntaxError
// deep in the boot sequence.
//
// The in-server hook validators (middleware / getRoutes / configureStore /
// preInitServer / reducer / customDocument) are NOT run here — those need the
// app's modules loaded, so they stay at their call sites in expressServer.js
// and handler.jsx, where they log-and-continue.
//
// Behaviour: collect EVERY failure, print them all, then throw so the caller
// exits non-zero. The caller is expected to catch and `process.exit(1)` —
// see runStaticPreflightOrExit below.

function readJson(filePath) {
    try {
        return { value: JSON.parse(readFileSync(filePath, "utf8")), error: null }
    } catch (e) {
        return { value: null, error: e }
    }
}

/**
 * Run the static preflight checks against an app directory.
 * @param {string} [appDir] - the consumer app root. Defaults to the current
 *   working directory. `process.env.PWD` is preferred when set (it survives a
 *   `cd` in the invoking shell script), but it is not exported by every shell
 *   / CI runner, so `process.cwd()` is the fallback — never `undefined`, which
 *   would make the `path.join` calls below throw.
 * @returns {import("../errors/index.js").CatalystError[]} all failures (empty = passed)
 */
export function runStaticPreflight(appDir = process.env.PWD || process.cwd()) {
    const failures = []

    // config/config.json
    const cfgPath = path.join(appDir, "config", "config.json")
    const cfg = readJson(cfgPath)
    if (cfg.error) {
        // A file that exists but does not parse is not "missing": the default
        // message and its "create the file" advice would send people the
        // wrong way.
        const unparsable = cfg.error.code !== "ENOENT"
        failures.push(
            createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING, {
                details: unparsable
                    ? `config/config.json could not be parsed: ${cfg.error.message}`
                    : `config/config.json not found at ${cfgPath}`,
                ...(unparsable && {
                    message: "config/config.json is not valid JSON",
                    suggestedAction: "Fix the JSON syntax in config/config.json at the position shown.",
                }),
            })
        )
    } else {
        const err = validateConfigFile(cfg.value)
        if (err) failures.push(err)
    }

    // package.json (+ its moduleAliases)
    const pkgPath = path.join(appDir, "package.json")
    const pkg = readJson(pkgPath)
    if (pkg.error) {
        failures.push(
            createError(
                pkg.error.code === "ENOENT"
                    ? ERROR_CODES.PREFLIGHT_PACKAGE_JSON_MISSING
                    : ERROR_CODES.PREFLIGHT_PACKAGE_JSON_INVALID,
                {
                    details:
                        pkg.error.code === "ENOENT"
                            ? `package.json not found at ${pkgPath} — run this command from the project root`
                            : `package.json could not be parsed: ${pkg.error.message}`,
                }
            )
        )
    } else {
        const pkgErr = validatePackageJson(pkg.value)
        if (pkgErr) failures.push(pkgErr)

        const aliases = pkg.value._moduleAliases ?? pkg.value.moduleAliases
        const aliasErr = validateModuleAlias(aliases)
        if (aliasErr) failures.push(aliasErr)
    }

    return failures
}

/**
 * Run static preflight and, if anything failed, print every error in the
 * caller's output mode and exit the process non-zero. Call this at the top
 * of a CLI entry script (start / serve / build).
 * @param {string} [appDir]
 */
export function runStaticPreflightOrExit(appDir = process.env.PWD || process.cwd()) {
    const mode = resolveOutputMode(process.argv)
    const failures = runStaticPreflight(appDir)
    if (failures.length === 0) return

    for (const err of failures) {
        console.error(renderRegistryError(err, mode, { scope: "preflight" }))
    }
    // One block speaks for itself; a count only helps when there are several.
    if (failures.length > 1) {
        console.error(`${GUTTER}${t.dim(`${failures.length} problems found. Fix them and re-run.`)}\n`)
    }
    process.exit(1)
}

// Records the config values a build was made with, so `serve` can refuse a
// build that no longer matches config/config.json (issue #251).
const BUILD_INFO_FILE = ".catalyst-build.json"

/**
 * Config values Vite inlines into the bundles at build time (see
 * getClientEnvVariables in vite.config.js). KEY=value CLI arguments win over
 * config.json, and objects are stored as JSON, as in loadEnvironmentVariables.
 * @param {Record<string, unknown>} config - parsed config/config.json
 * @param {Record<string, string>} [args] - KEY=value CLI arguments
 */
export function getInlinedConfig(config, args = {}) {
    const values = { ...config, ...args }
    let clientVars = values.CLIENT_ENV_VARIABLES ?? []
    if (typeof clientVars === "string") clientVars = JSON.parse(clientVars)
    const keys = ["PUBLIC_STATIC_ASSET_URL", "PUBLIC_STATIC_ASSET_PATH", ...clientVars]
    return Object.fromEntries(
        keys.map((key) => [key, typeof values[key] === "object" ? JSON.stringify(values[key]) : values[key]])
    )
}

function buildInfoPath(appDir, config, args) {
    return path.join(appDir, args.BUILD_OUTPUT_PATH || config.BUILD_OUTPUT_PATH || "build", BUILD_INFO_FILE)
}

/**
 * @param {string} appDir
 * @param {Record<string, unknown>} config
 * @param {Record<string, string>} [args]
 */
export function writeBuildInfo(appDir, config, args = {}) {
    writeFileSync(
        buildInfoPath(appDir, config, args),
        JSON.stringify(getInlinedConfig(config, args), null, 4)
    )
}

/**
 * Compare the values a build was made with against the current config.
 * Anything that stops the comparison (a missing or unreadable build info
 * file, e.g. from an older catalyst-core, an unparseable CLIENT_ENV_VARIABLES)
 * only warns, so the build still serves.
 * @param {string} [appDir]
 * @param {Record<string, string>} [args]
 * @returns {import("../errors/index.js").CatalystError | null}
 */
export function checkBuildMatchesConfig(appDir = process.env.PWD || process.cwd(), args = {}) {
    const skip = (reason) => {
        console.warn(`${GUTTER}${t.warn(glyph.warn)} ${t.dim(`Skipping the build/config check: ${reason}`)}`)
        return null
    }

    // runStaticPreflightOrExit has already checked config.json.
    const config = JSON.parse(readFileSync(path.join(appDir, "config", "config.json"), "utf8"))
    const infoPath = buildInfoPath(appDir, config, args)
    const info = readJson(infoPath)
    if (info.error || !info.value || typeof info.value !== "object" || Array.isArray(info.value)) {
        return skip(`${infoPath} is missing or invalid. Rebuild to enable it.`)
    }

    let current
    try {
        current = getInlinedConfig(config, args)
    } catch (e) {
        return skip(`could not read CLIENT_ENV_VARIABLES: ${e.message}`)
    }

    const keys = new Set([...Object.keys(info.value), ...Object.keys(current)])
    const changed = [...keys].filter((key) => info.value[key] !== current[key])
    if (changed.length === 0) return null

    const show = (value) => (value === undefined ? "unset" : JSON.stringify(value))
    const lines = changed.map(
        (key) => `${key}: built with ${show(info.value[key])}, now ${show(current[key])}`
    )
    return createError(ERROR_CODES.PREFLIGHT_BUILD_STALE, {
        details: `These values were inlined into the build and differ from config/config.json:\n  ${lines.join("\n  ")}`,
    })
}
