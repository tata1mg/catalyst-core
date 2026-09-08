#!/usr/bin/env node

/**
 * Removes TypeScript source files that the native copy step put into dist/.
 *
 * The native half of the prepare chain is a raw copy followed by a Babel pass:
 *
 *   cp -r ./src/native ./dist/native
 *   babel src/native --out-dir dist/native --extensions '.js,.jsx,.ts,.tsx' ...
 *
 * The copy is what carries the non-source files the native toolchain needs
 * (Gradle projects, Xcode projects, plists, and the {"type":"commonjs"}
 * package.json that makes dist/native a CommonJS island), so it cannot be
 * dropped. But it copies *everything*, including .ts/.tsx sources. Babel then
 * compiles those sources to their .js siblings — it does not remove the
 * .ts/.tsx originals the copy left behind, so dist would ship both the
 * compiled output and its raw TypeScript source.
 *
 * Shipping the raw .ts alongside the emitted .js is wrong twice over: the
 * package publishes uncompiled source that no consumer's runtime can load, and
 * a resolver that prefers .ts (or a bundler configured to) would pick the
 * uncompiled file over the compiled one.
 *
 * So this runs after Babel and deletes the .ts/.tsx files the copy left. It
 * deliberately does NOT touch .d.ts declaration files: those are type-only,
 * carry no runtime code, and are the one kind of TypeScript file that is
 * correct to ship.
 *
 * Usage: node scripts/strip-ts-sources.mjs <dir> [<dir> ...]
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

/** Extensions to remove. .d.ts / .d.mts are excluded — see the header. */
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx"])

/**
 * True for declaration files, which are type-only and ship as-is.
 *
 * @param {string} fileName basename of the file being considered
 * @returns {boolean} whether the file is a TypeScript declaration file
 */
function isDeclarationFile(fileName) {
    return fileName.endsWith(".d.ts") || fileName.endsWith(".d.mts")
}

/**
 * Walks a directory and deletes every compilable TypeScript source under it.
 *
 * @param {string} dir absolute path of the directory to scan
 * @returns {number} count of files removed
 */
function stripDirectory(dir) {
    let removed = 0

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
            removed += stripDirectory(entryPath)
            continue
        }

        if (!entry.isFile()) continue
        if (isDeclarationFile(entry.name)) continue
        if (!TYPESCRIPT_EXTENSIONS.has(path.extname(entry.name))) continue

        fs.rmSync(entryPath, { force: true })
        removed += 1
    }

    return removed
}

const targets = process.argv.slice(2)
if (targets.length === 0) {
    console.error("Usage: node scripts/strip-ts-sources.mjs <dir> [<dir> ...]")
    process.exit(1)
}

let total = 0
for (const target of targets) {
    const resolved = path.resolve(target)
    if (!resolved.split(path.sep).includes("dist")) {
        console.error(`strip-ts-sources: refusing to strip outside a dist tree: ${resolved}`)
        process.exit(1)
    }
    if (!fs.existsSync(resolved)) {
        console.error(`strip-ts-sources: target does not exist: ${resolved}`)
        process.exit(1)
    }
    total += stripDirectory(resolved)
}

console.log(`strip-ts-sources: removed ${total} TypeScript source file(s)`)
