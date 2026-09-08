import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

/**
 * Single source of truth for the app's baseline files.
 *
 * A scenario's break() mutates a file; its restore() must put it back exactly.
 * Rather than each scenario carrying its own hand-typed copy of the baseline
 * (which drifts — a stale inline copy clobbered package.json once), every
 * baseline is read from the committed file on disk when this module loads,
 * BEFORE any break() runs. restore() then writes that captured content back.
 *
 * Import order matters: this must be imported (transitively, via
 * scenarios/index.js) before any scenario executes.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, "..")

// A bare `vitest run test/scenarios.test.ts` skips the pretest ensure-config
// hook; make sure config/config.json exists before any baseline read/snapshot.
const cfgPath = path.join(appDir, "config", "config.json")
if (!fs.existsSync(cfgPath)) {
    fs.copyFileSync(path.join(appDir, "config", "config.template.json"), cfgPath)
}

function read(relPath) {
    return fs.readFileSync(path.join(appDir, relPath), "utf8")
}

export const BASELINE_FILES = {
    // config/config.json is gitignored; config.template.json is the committed
    // source of truth (scripts/ensure-config.js copies it into place).
    "config/config.json": read("config/config.template.json"),
    "package.json": read("package.json"),
    "server/index.js": read("server/index.js"),
    "server/server.js": read("server/server.js"),
    "server/document.js": read("server/document.js"),
    "src/js/store/index.js": read("src/js/store/index.js"),
    "src/js/routes/index.js": read("src/js/routes/index.js"),
    "src/js/routes/utils.js": read("src/js/routes/utils.js"),
    "src/js/containers/App/index.jsx": read("src/js/containers/App/index.jsx"),
    "src/js/containers/App/Home.jsx": read("src/js/containers/App/Home.jsx"),
}

// Parsed forms, for scenarios that build a variant object then re-serialize.
export const BASELINE_CONFIG = JSON.parse(BASELINE_FILES["config/config.json"])
export const BASELINE_PKG = JSON.parse(BASELINE_FILES["package.json"])

export function writeBaselineFile(appDirArg, relPath) {
    const content = BASELINE_FILES[relPath]
    if (content === undefined) throw new Error(`No baseline captured for ${relPath}`)
    const full = path.join(appDirArg, relPath)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, "utf8")
}

// Config-mutating scenarios restore config/config.json to the committed
// template bytes exactly (ensure-config.js does a plain copyFileSync, so the
// live file is byte-identical to the template — re-serializing the parsed
// object via JSON.stringify would drift array formatting / trailing newline).
export function restoreBaselineConfig(appDirArg) {
    fs.writeFileSync(
        path.join(appDirArg, "config", "config.json"),
        BASELINE_FILES["config/config.json"],
        "utf8"
    )
}
