"use strict"

const fs = require("fs")
const path = require("path")

/**
 * File operations on a generated Android project.
 *
 * These were find, mv, rsync and rm -rf, which do not exist on Windows. They are
 * plain Node now, on every platform, so there is one behaviour to reason about.
 */

// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - every root below is the generated project inside this package, and names come from readdirSync.
const join = (...parts) => path.join(...parts)

/**
 * Every path under a directory, children before their parent, so that renaming
 * or removing one entry never invalidates an entry still to come.
 */
function walkTree(root) {
    const found = []
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const fullPath = join(root, entry.name)
        if (entry.isDirectory()) found.push(...walkTree(fullPath))
        found.push({ path: fullPath, name: entry.name, isDirectory: entry.isDirectory() })
    }
    return found
}

function findFiles(root, matches) {
    return walkTree(root)
        .filter((entry) => !entry.isDirectory && matches(entry.name))
        .map((entry) => entry.path)
}

/**
 * A build tree is often still being scanned when it is removed. On Windows that
 * means an antivirus or the Gradle daemon holding a file open, so it gets retries.
 */
function removeTree(target) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
}

function renameWithRetry(from, to) {
    for (let attempt = 1; ; attempt++) {
        try {
            fs.renameSync(from, to)
            return
        } catch (error) {
            if (attempt === 8 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error
            // eslint-disable-next-line no-undef -- the native lint env predates these globals
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
        }
    }
}

/** Depth first, so a directory left empty by removing its children goes as well. */
function removeEmptyDirectories(root) {
    for (const entry of walkTree(root)) {
        if (entry.isDirectory && fs.readdirSync(entry.path).length === 0) {
            fs.rmdirSync(entry.path)
        }
    }
}

/**
 * Copy an Android project without its build outputs. The build that follows
 * starts with a clean anyway, and they hold the deepest paths in the tree, the
 * ones that run into the Windows path length limit.
 */
function copyProjectWithoutOutputs(source, destination) {
    // The real path: given a link, cpSync would recreate the link rather than copy
    // the project, and the renames that follow would rewrite the original.
    const root = fs.realpathSync(source)
    const outputs = new Set([".gradle", "build", join("app", "build")].map((dir) => join(root, dir)))
    fs.cpSync(root, destination, {
        recursive: true,
        verbatimSymlinks: true,
        preserveTimestamps: true,
        filter: (entry) => !outputs.has(path.normalize(entry)),
    })
}

module.exports = {
    walkTree,
    findFiles,
    removeTree,
    renameWithRetry,
    removeEmptyDirectories,
    copyProjectWithoutOutputs,
}
