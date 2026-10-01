import { readFileSync } from "fs"
import path from "path"
import {
    validateConfigFile,
    validatePackageJson,
    validateModuleAlias,
} from "../server/utils/validator.js"
import { formatError, createError, ERROR_CODES } from "../errors/index.js"
import { resolveOutputMode } from "./scriptUtils.js"

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
        failures.push(
            createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING, {
                details:
                    cfg.error.code === "ENOENT"
                        ? `config/config.json not found at ${cfgPath}`
                        : `config/config.json could not be parsed: ${cfg.error.message}`,
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
        console.error(formatError(err, mode))
    }
    console.error(
        `\nPreflight failed with ${failures.length} error${failures.length === 1 ? "" : "s"}. ` +
            `Fix the above and re-run.`
    )
    process.exit(1)
}
