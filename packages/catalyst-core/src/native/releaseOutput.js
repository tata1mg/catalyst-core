import fs from "fs"
import path from "path"
import { nativeError } from "./utils.js"

// What both platforms share about a release's output folder,
// build-output/<platform>/<version>-<build>/: the file-name-safe names and
// the guard against writing over an earlier release.

/** The version a release reports when package.json has none: what both shells ship then. */
const DEFAULT_VERSION_NAME = "1.0.0"

/** A file-name-safe version of a name for the release artifacts. */
function artifactBaseName(name) {
    const safe = String(name || "")
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
    return safe || "app"
}

/**
 * The folder name for one release: `<version>-<build>`.
 *
 * @param {{ versionName?: string, buildNumber: number | string }} version - resolveNativeConfig().version
 */
function releaseFolderName(version) {
    return `${artifactBaseName(version?.versionName || DEFAULT_VERSION_NAME)}-${version?.buildNumber}`
}

/**
 * Fail before building when the release folder already holds a store
 * artifact (NATIVE-011): two releases in the same minute get the same build
 * number, and the second would overwrite the first.
 *
 * @param {string} dir - the release folder
 * @param {string[]} extensions - the artifact types, e.g. [".aab"] or [".ipa"]
 */
function assertReleaseFolderFree(dir, extensions) {
    let entries = []
    try {
        entries = fs.readdirSync(dir)
    } catch (error) {
        return
    }
    const existing = entries.find((name) => extensions.some((ext) => name.toLowerCase().endsWith(ext)))
    if (existing) throw nativeError("NATIVE-011", path.join(dir, existing))
}

export { DEFAULT_VERSION_NAME, artifactBaseName, releaseFolderName, assertReleaseFolderFree }
