#!/usr/bin/env node

/**
 * Builds the ESM half of dist/ (everything in src/ except src/native/).
 *
 * This replaces the `cp -r ./src ./dist` step of the old prepare chain with an
 * explicit two-track build:
 *
 *   - SOURCE files (see SOURCE_EXTENSIONS) go through `compileSource()`.
 *   - every other file is copied verbatim, byte for byte.
 *
 * src/native/ is skipped entirely — it is a CommonJS island that the prepare
 * chain still hands to `babel --config-file ./babel.native.config.cjs` in a
 * separate pass, and it owns its own package.json ({"type":"commonjs"}) which
 * must land in dist/native/.
 *
 * Why compileSource() is currently a byte-for-byte copy
 * ----------------------------------------------------
 * dist ships raw .jsx today: package.json points main/exports at dist/index.jsx,
 * and vite (dev + build) and dist/vite/node-loader.mjs transform JSX at runtime.
 * Running Babel over the ESM tree would reprint every file from its AST, which
 * rewrites formatting (quotes stay, but semicolons are added, indentation is
 * re-emitted at 2 spaces, blank lines collapse, object literals expand and
 * comments move) even with zero transform plugins and `retainLines`. That is a
 * change to shipped bytes, which this migration step is explicitly not allowed
 * to make.
 *
 * So today the "compile" is the identity function. Its purpose is structural:
 * it puts the extension routing, the output-extension map and the single
 * choke point for a Babel call in place, so that turning on .ts/.tsx later is a
 * small diff — add the extensions to SOURCE_EXTENSIONS, add the .ts -> .js /
 * .tsx -> .jsx entries to OUTPUT_EXTENSION, and replace the body of
 * compileSource() with a babel.transformAsync() call.
 *
 * Usage: node scripts/build-dist.mjs [--src <dir>] [--out <dir>]
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Directories under src/ that this script must not touch, relative to src/. */
const SKIPPED_DIRS = new Set(["native"])

/**
 * Extensions treated as compilable source. Everything else is copied verbatim.
 * Adding "ts" and "tsx" here is what switches TypeScript on.
 */
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs"])

/**
 * Output extension for a compiled source file, when it differs from the input.
 * Currently empty because .js/.jsx/.mjs keep their extension. TypeScript will
 * add { ".ts": ".js", ".tsx": ".jsx", ".mts": ".mjs" }.
 */
const OUTPUT_EXTENSION = new Map()

/**
 * Turns one source file into its dist output.
 *
 * Identity transform for now — see the header comment. Kept async so that
 * swapping in babel.transformAsync() later does not change any call sites.
 *
 * @param {string} inputPath absolute path of the file being built
 * @param {string} outputPath absolute path to write to
 */
async function compileSource(inputPath, outputPath) {
    await fs.promises.copyFile(inputPath, outputPath)
}

/**
 * Copies a non-source file verbatim.
 *
 * `dereference: true` matches the `cp -r` this step replaces: BSD/macOS `cp -r`
 * follows symlinks and writes real files, so dist contains no symlinks.
 *
 * @param {string} inputPath absolute path of the file being copied
 * @param {string} outputPath absolute path to write to
 */
async function copyAsset(inputPath, outputPath) {
    await fs.promises.cp(inputPath, outputPath, { dereference: true, force: true })
}

/**
 * Maps a source path to its path under the output directory, applying
 * OUTPUT_EXTENSION when the compiled extension differs from the source one.
 *
 * @param {string} relativePath path relative to the source directory
 * @returns {string} the matching path relative to the output directory
 */
function outputPathFor(relativePath) {
    const extension = path.extname(relativePath)
    const mapped = OUTPUT_EXTENSION.get(extension)
    if (!mapped) return relativePath
    return relativePath.slice(0, -extension.length) + mapped
}

/**
 * Walks srcDir depth-first and builds every entry into outDir.
 *
 * @param {string} srcDir absolute path of the directory to read
 * @param {string} outDir absolute path of the directory to write
 * @param {string} relativeDir path of srcDir relative to the build root
 * @param {{ compiled: number, copied: number }} stats mutated tally for the summary line
 */
async function buildDirectory(srcDir, outDir, relativeDir, stats) {
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true })
    await fs.promises.mkdir(outDir, { recursive: true })

    for (const entry of entries) {
        const relativePath = path.join(relativeDir, entry.name)
        const inputPath = path.join(srcDir, entry.name)

        if (entry.isDirectory()) {
            if (relativeDir === "" && SKIPPED_DIRS.has(entry.name)) continue
            await buildDirectory(inputPath, path.join(outDir, entry.name), relativePath, stats)
            continue
        }

        // Symlinks and other non-regular entries go through copyAsset, which
        // dereferences them exactly as `cp -r` did.
        const extension = path.extname(entry.name)
        if (entry.isFile() && SOURCE_EXTENSIONS.has(extension)) {
            const outputPath = path.join(outDir, path.basename(outputPathFor(entry.name)))
            await compileSource(inputPath, outputPath)
            stats.compiled += 1
        } else {
            await copyAsset(inputPath, path.join(outDir, entry.name))
            stats.copied += 1
        }
    }
}

/**
 * Reads --src / --out off argv, falling back to ./src and ./dist.
 *
 * @param {string[]} argv arguments after the script name
 * @returns {{ srcDir: string, outDir: string }} absolute, resolved directories
 */
function parseArgs(argv) {
    let srcDir = path.join(PACKAGE_ROOT, "src")
    let outDir = path.join(PACKAGE_ROOT, "dist")

    for (let i = 0; i < argv.length; i += 1) {
        const value = argv[i + 1]
        if (argv[i] === "--src" && value) {
            srcDir = path.resolve(value)
            i += 1
        } else if (argv[i] === "--out" && value) {
            outDir = path.resolve(value)
            i += 1
        }
    }

    return { srcDir, outDir }
}

async function main() {
    const { srcDir, outDir } = parseArgs(process.argv.slice(2))

    if (!fs.existsSync(srcDir)) {
        console.error(`build-dist: source directory not found: ${srcDir}`)
        process.exit(1)
    }

    const stats = { compiled: 0, copied: 0 }
    await buildDirectory(srcDir, outDir, "", stats)

    console.log(
        `build-dist: ${stats.compiled} source file(s), ${stats.copied} asset(s) -> ${path.relative(PACKAGE_ROOT, outDir) || outDir}`
    )
}

main().catch((err) => {
    console.error("build-dist: build failed")
    console.error(err)
    process.exit(1)
})
