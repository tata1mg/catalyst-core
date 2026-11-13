import fs from "fs"
import path from "path"

// Per-project, per-machine CLI state in .catalyst/local.json. It only ever
// holds conveniences (the last emulator/phone pick, one-time migrations,
// the dev server this CLI started), so every read and write is best effort
// and never fails a build.
//
// Shape:
// {
//   "android": { "target": "emulator", "avd": "Pixel_8_API_36" }
//            | { "target": "device", "serial": "R58M123ABC" },
//   "ios":     { "target": "simulator", "udid": "<sim udid>", "name": "iPhone 17" }
//            | { "target": "device", "udid": "<device udid>", "name": "Jane's iPhone" },
//   "migrations": { "lanAddresses": "2026-10-29T10:00:00.000Z" },
//   "devServer": { "host": "localhost" | "<mac>.local" | "<lan ip>", "port": 3005, "pid": 4242 }
// }
//
// The folder carries its own .gitignore (`*`), so it stays out of git even
// in an app whose .gitignore predates the `.catalyst/` entry.

const DIR_NAME = ".catalyst"
const FILE_NAME = "local.json"

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

/** @param {string} [cwd] */
function localStatePath(cwd = process.cwd()) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - cwd is the local app directory; the names are fixed.
    return path.join(cwd, DIR_NAME, FILE_NAME)
}

/**
 * Create .catalyst/ (owner only) with its own `*` .gitignore, and return its
 * path. An existing .gitignore is left as it is.
 *
 * @param {string} [cwd]
 * @returns {string}
 */
function ensureLocalStateDir(cwd = process.cwd()) {
    const dir = path.dirname(localStatePath(cwd))
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    try {
        // "wx": create it only when it is not there, in one step.
        fs.writeFileSync(path.join(dir, ".gitignore"), "*\n", { flag: "wx" })
    } catch (error) {
        if (error.code !== "EEXIST") throw error
    }
    return dir
}

/**
 * The whole state object, or {} when the file is missing or unreadable.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @returns {Record<string, any>}
 */
function readLocalState({ cwd = process.cwd() } = {}) {
    try {
        const parsed = JSON.parse(fs.readFileSync(localStatePath(cwd), "utf8"))
        return isPlainObject(parsed) ? parsed : {}
    } catch (error) {
        return {}
    }
}

/**
 * Merge `patch` into the state, one level deep (each top-level key is
 * replaced as a whole). Returns false instead of throwing when it cannot
 * write.
 *
 * @param {Record<string, any>} patch
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @returns {boolean}
 */
function writeLocalState(patch, { cwd = process.cwd() } = {}) {
    try {
        const file = path.join(ensureLocalStateDir(cwd), FILE_NAME)
        const next = { ...readLocalState({ cwd }), ...patch }
        fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n")
        return true
    } catch (error) {
        return false
    }
}

/**
 * The last target picked for a platform, or null.
 *
 * @param {"android"|"ios"} platform
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @returns {{ target: string, [key: string]: any } | null}
 */
function getLastTarget(platform, { cwd = process.cwd() } = {}) {
    const entry = readLocalState({ cwd })[platform]
    return isPlainObject(entry) && typeof entry.target === "string" ? entry : null
}

/**
 * Remember the target picked for a platform.
 *
 * @param {"android"|"ios"} platform
 * @param {{ target: string, [key: string]: any }} target
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @returns {boolean}
 */
function saveLastTarget(platform, target, { cwd = process.cwd() } = {}) {
    if (!isPlainObject(target) || typeof target.target !== "string") return false
    return writeLocalState({ [platform]: target }, { cwd })
}

export { localStatePath, ensureLocalStateDir, readLocalState, writeLocalState, getLastTarget, saveLastTarget }
