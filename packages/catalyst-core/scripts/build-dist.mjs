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
 * Two compile paths, chosen by input extension
 * --------------------------------------------
 * dist ships raw .jsx today: package.json points main/exports at dist/index.jsx,
 * and vite (dev + build) and dist/vite/node-loader.mjs transform JSX at runtime.
 * Running Babel over the whole ESM tree would reprint every file from its AST,
 * which rewrites formatting (quotes stay, but semicolons are added, indentation
 * is re-emitted at 2 spaces, blank lines collapse, object literals expand and
 * comments move) even with zero transform plugins and `retainLines`. That is a
 * change to shipped bytes for files that need no compilation at all.
 *
 * So the two paths are:
 *
 *   - .js / .jsx / .mjs  -> byte-for-byte copy. Nothing to strip; the bytes
 *     that ship are the bytes in src/.
 *   - .ts / .tsx         -> @babel/core with preset-typescript ONLY. This
 *     erases types and nothing else: no preset-env (module syntax and modern
 *     syntax survive untouched) and no preset-react (JSX stays literal JSX in
 *     the emitted .jsx, for the same runtime transform that handles today's
 *     hand-written .jsx). Reprinting is unavoidable here — an AST rewrite is
 *     the whole point — and applies only to files that were converted.
 *
 * .d.ts / .d.mts are declaration files, not compilable source: they route to
 * the asset copier so src/globals.d.ts ships verbatim instead of being erased
 * to an empty globals.d.js.
 *
 * Usage: node scripts/build-dist.mjs [--src <dir>] [--out <dir>]
 */

import { transformAsync } from "@babel/core"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Directories under src/ that this script must not touch, relative to src/. */
const SKIPPED_DIRS = new Set(["native"])

/**
 * Extensions treated as compilable source. Everything else is copied verbatim.
 */
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"])

/**
 * Extensions that need a real Babel pass. Everything else in
 * SOURCE_EXTENSIONS is copied byte for byte — see the header comment.
 */
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx"])

/**
 * Output extension for a compiled source file, when it differs from the input.
 * .js/.jsx/.mjs keep their extension; TypeScript sources shed theirs so that
 * dist keeps shipping the .js/.jsx pair the package exports already point at.
 */
const OUTPUT_EXTENSION = new Map([
    [".ts", ".js"],
    [".tsx", ".jsx"],
])

/**
 * True for declaration files (.d.ts, .d.mts), which are not compilable source.
 * They carry types only, so Babel would erase them to an empty file under a
 * .js name; they must be copied verbatim instead.
 *
 * @param {string} fileName basename of the file being built
 * @returns {boolean} whether the file is a TypeScript declaration file
 */
function isDeclarationFile(fileName) {
    return fileName.endsWith(".d.ts") || fileName.endsWith(".d.mts")
}

/**
 * Turns one source file into its dist output.
 *
 * .js/.jsx/.mjs are copied byte for byte. .ts/.tsx go through Babel with
 * preset-typescript alone, which strips types and leaves everything else —
 * module syntax, modern syntax and JSX — exactly as written.
 *
 * @param {string} inputPath absolute path of the file being built
 * @param {string} outputPath absolute path to write to
 */
async function compileSource(inputPath, outputPath) {
    const extension = path.extname(inputPath)

    if (!TYPESCRIPT_EXTENSIONS.has(extension)) {
        await fs.promises.copyFile(inputPath, outputPath)
        return
    }

    // isTSX is only meaningful with allExtensions, which tells the preset to
    // stop inferring the dialect from the filename. .ts keeps the default
    // (filename-driven) behaviour, which is already correct for it.
    const presetOptions = extension === ".tsx" ? { isTSX: true, allExtensions: true } : {}

    const source = await fs.promises.readFile(inputPath, "utf8")
    const result = await transformAsync(source, {
        filename: inputPath,
        babelrc: false,
        configFile: false,
        // preset-typescript only: no preset-env (module and modern syntax stay
        // as authored) and no preset-react (JSX stays literal in the .jsx).
        presets: [["@babel/preset-typescript", presetOptions]],
        sourceMaps: false,
    })

    if (!result || typeof result.code !== "string") {
        throw new Error(`build-dist: babel produced no output for ${inputPath}`)
    }

    await fs.promises.writeFile(outputPath, `${result.code}\n`, "utf8")
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
 * @param {Map<string, string>} claimedOutputs output path -> source path that wrote it
 */
async function buildDirectory(srcDir, outDir, relativeDir, stats, claimedOutputs) {
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true })
    await fs.promises.mkdir(outDir, { recursive: true })

    for (const entry of entries) {
        const relativePath = path.join(relativeDir, entry.name)
        const inputPath = path.join(srcDir, entry.name)

        if (entry.isDirectory()) {
            if (relativeDir === "" && SKIPPED_DIRS.has(entry.name)) continue
            await buildDirectory(inputPath, path.join(outDir, entry.name), relativePath, stats, claimedOutputs)
            continue
        }

        // Declaration files carry no runtime code: they ship verbatim rather
        // than being erased to an empty .js by the TypeScript path.
        // Symlinks and other non-regular entries go through copyAsset, which
        // dereferences them exactly as `cp -r` did.
        const extension = path.extname(entry.name)
        const isSource = entry.isFile() && SOURCE_EXTENSIONS.has(extension) && !isDeclarationFile(entry.name)
        const outputPath = isSource
            ? path.join(outDir, path.basename(outputPathFor(entry.name)))
            : path.join(outDir, entry.name)

        // Two sources mapping onto one output (foo.tsx emitting foo.jsx next to
        // a hand-written foo.jsx) would silently drop one of them.
        const previousClaim = claimedOutputs.get(outputPath)
        if (previousClaim) {
            throw new Error(
                `build-dist: output collision at ${outputPath}\n` +
                    `  claimed by: ${previousClaim}\n` +
                    `  also from:  ${inputPath}`
            )
        }
        claimedOutputs.set(outputPath, inputPath)

        if (isSource) {
            await compileSource(inputPath, outputPath)
            stats.compiled += 1
        } else {
            await copyAsset(inputPath, outputPath)
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
    await buildDirectory(srcDir, outDir, "", stats, new Map())

    console.log(
        `build-dist: ${stats.compiled} source file(s), ${stats.copied} asset(s) -> ${path.relative(PACKAGE_ROOT, outDir) || outDir}`
    )
}

main().catch((err) => {
    console.error("build-dist: build failed")
    console.error(err)
    process.exit(1)
})
