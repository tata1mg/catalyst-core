#!/usr/bin/env node

/**
 * rm -rf that retries on transient "Directory not empty" / ENOTEMPTY failures.
 *
 * fs.rm's own retry logic only covers EBUSY/EPERM/ENOENT, not ENOTEMPTY — so it
 * doesn't help when something else (an IDE's file watcher, an editor's Gradle/
 * Java language server auto-indexing a native project under dist/, antivirus,
 * Spotlight, etc.) is concurrently creating files inside the directory being
 * removed. That race is common on packages/catalyst-core/dist, which contains
 * a full Android project that IDEs like to auto-import the moment it appears.
 *
 * Usage: node scripts/safe-rimraf.js <path> [<path> ...]
 */

const fs = require("fs")
const path = require("path")

const MAX_ATTEMPTS = 8
const BASE_DELAY_MS = 150

function sleep(ms) {
    const buf = new SharedArrayBuffer(4)
    Atomics.wait(new Int32Array(buf), 0, 0, ms)
}

function rimraf(targetPath) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - targetPath comes from this local CLI script's own argv, invoked directly by a developer or by the build's own package.json "prepare" script with a hardcoded path, never from a request.
    const resolved = path.resolve(targetPath)
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            fs.rmSync(resolved, { recursive: true, force: true })
            return
        } catch (err) {
            const transient = err.code === "ENOTEMPTY" || err.code === "EBUSY" || err.code === "EPERM"
            if (!transient || attempt === MAX_ATTEMPTS) throw err
            sleep(BASE_DELAY_MS * attempt)
        }
    }
}

const targets = process.argv.slice(2)
if (targets.length === 0) {
    console.error("Usage: node scripts/safe-rimraf.js <path> [<path> ...]")
    process.exit(1)
}

for (const target of targets) {
    rimraf(target)
}
