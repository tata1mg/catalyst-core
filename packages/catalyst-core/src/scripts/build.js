import path from "path"
import { spawn } from "child_process"
import { arrayToObject, loaderImportArg } from "./scriptUtils.js"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { readFileSync, readdirSync, existsSync, rmSync } from "fs"
import { gzipSync } from "zlib"
import { createRequire } from "module"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// src/cli is CommonJS so src/native (also CJS) can share it; pull it in here
// rather than duplicating the visual language for the web commands.
const requireCjs = createRequire(import.meta.url)
const { header, step, glyph, t, GUTTER, duration, bytes } = requireCjs("../cli/theme.js")
const { diagnostic } = requireCjs("../cli/diagnostic.js")
const { loadAppConfig } = requireCjs("../cli/appConfig.js")
const { bundleWarnings } = requireCjs("../cli/buildWarnings.js")
const { extractBuildErrors, outputTail } = requireCjs("../cli/buildErrors.js")
const { hintFor } = requireCjs("../cli/hints.js")
const loaderPath = path.resolve(__dirname, "../../dist/vite/node-loader.mjs")

// A missing or malformed config used to throw a raw ENOENT/SyntaxError stack at
// module load, before any output at all. Note the "utf-8" was being passed as
// JSON.parse's reviver argument, not as the read encoding.
const configJSON = loadAppConfig(process.env.PWD || process.cwd())

// Resolve vite's actual JS entry point rather than spawning the "vite" command name,
// which on Windows only resolves via the npm-installed .cmd shim (i.e. requires a shell).
// Invoking process.execPath + this path directly works cross-platform with no shell.
const require = createRequire(import.meta.url)
const viteBinPath = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js")

/**
 * A child's exit code, or 1 when there is not a usable one.
 *
 * Spawn failures carry a string `code` like "ENOENT", and process.exit throws
 * ERR_INVALID_ARG_TYPE on anything that is not an integer -- which would
 * replace the friendly error with an internal stack trace.
 */
const MAX_CAPTURED_BYTES = 1024 * 1024

function exitCodeFrom(error) {
    return Number.isInteger(error?.code) ? error.code : 1
}

/**
 * Run one build step, capturing its output.
 *
 * Output is piped rather than inherited. With inherit the bundler wrote
 * straight to the terminal at column 0 -- so two parallel bundles interleaved,
 * the same error printed once per bundle, and the parent held nothing but an
 * exit code. Holding the text is what makes it possible to find the real
 * compiler error, dedupe it, and show it in the house style.
 *
 * @param {string[]} args
 * @param {import('child_process').SpawnOptions} options
 * @param {string} label - names this step, e.g. "client"
 */
function runBuildStep(args, options, label = "Build step") {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            ...options,
            stdio: ["inherit", "pipe", "pipe"],
        })

        // Only the tail is ever shown, so a pathological build cannot grow
        // this without bound.
        let output = ""
        const keep = (chunk) => {
            output += chunk.toString()
            if (output.length > MAX_CAPTURED_BYTES) output = output.slice(-MAX_CAPTURED_BYTES)
        }
        child.stdout.on("data", keep)
        child.stderr.on("data", keep)

        child.on("close", (code) => {
            if (code === 0) {
                resolve({ label, output })
            } else {
                reject(
                    Object.assign(new Error(`${label} failed with exit code ${code}`), {
                        code,
                        label,
                        output,
                    })
                )
            }
        })
        child.on("error", reject)
    })
}

/**
 * Report bundle failures once each, not once per bundle.
 *
 * One broken import fails both bundles, so the naive loop printed the same
 * error twice with two identical hints. Errors are keyed on their cause, and
 * the bundles they broke become a dim suffix rather than a second block.
 */
function shortenPaths(text, cwd) {
    return String(text).split(`${cwd}/`).join("")
}

function reportBundleFailures(failures, cwd) {
    const byCause = new Map()
    let unrecognised = null

    for (const failure of failures) {
        const found = extractBuildErrors(failure.output, { toolchain: "vite" })
        if (found.length === 0) {
            unrecognised = unrecognised || failure
            continue
        }
        for (const error of found) {
            const key = `${error.file || ""}:${error.line || ""}:${error.message}`
            const existing = byCause.get(key)
            if (existing) existing.bundles.push(failure.label)
            else byCause.set(key, { ...error, bundles: [failure.label] })
        }
    }

    if (byCause.size === 0) {
        // Nothing recognised: fence the bundler's own words rather than
        // inventing a summary that says less than they do.
        const tail = outputTail(unrecognised?.output || "", 8)
        return (
            diagnostic({
                message: `The ${unrecognised?.label || "production"} bundle failed`,
                scope: "production build",
                cwd,
            }) +
            (tail
                ? tail
                      .split("\n")
                      .map((line) => `${GUTTER}${t.dim(glyph.pipe)} ${t.dim(line)}`)
                      .join("\n") + "\n\n"
                : "")
        )
    }

    const causes = [...byCause.values()]
    const out = [""]
    out.push(`${GUTTER}${t.bad(t.bold(causes.length === 1 ? "error" : `${causes.length} errors`))}`)

    for (const cause of causes) {
        // Vite prints absolute paths; show them relative to the app so the
        // interesting part is not buried behind /Users/you/work/....
        out.push(`${GUTTER}${t.bold(shortenPaths(cause.message, cwd))}`)

        if (cause.file) {
            const resolved = path.resolve(cwd, cause.file.replace(/^(\.\.\/)+/, ""))
            const shown = path.relative(cwd, resolved) || cause.file
            const at =
                cause.line != null ? `:${cause.line}${cause.column != null ? `:${cause.column}` : ""}` : ""
            const scope = cause.bundles.length > 1 ? `  ${t.dim(`· ${cause.bundles.join(", ")}`)}` : ""
            out.push(`${GUTTER}${t.dim("at")} ${t.accent(shown)}${t.dim(at)}${scope}`)
        }

        const known = hintFor(cause.message)
        if (known) {
            out.push("")
            out.push(`${GUTTER}${t.accent("hint")}  ${known.hint}`)
        }
        out.push("")
    }

    return out.join("\n")
}

/**
 * List what was actually produced, largest first, with gzip where we have it.
 *
 * Reads the directory rather than parsing the bundler's output: the files on
 * disk are the truth, and this keeps working if the bundler changes format.
 */
function printAssetTable(outputPath, label) {
    const entries = []

    const walk = (dir, prefix) => {
        let items
        try {
            items = readdirSync(dir, { withFileTypes: true })
        } catch (error) {
            return
        }
        for (const item of items) {
            // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - names come from readdirSync of our own build output.
            const full = path.join(dir, item.name)
            const rel = prefix ? `${prefix}/${item.name}` : item.name
            if (item.isDirectory()) {
                walk(full, rel)
            } else if (/\.(js|css|mjs|cjs)$/.test(item.name)) {
                try {
                    const raw = readFileSync(full)
                    entries.push({ name: rel, size: raw.length, gzip: gzipSync(raw).length })
                } catch (error) {
                    // A file we cannot read is not worth failing a build over.
                }
            }
        }
    }

    walk(outputPath, "")
    if (entries.length === 0) return

    entries.sort((a, b) => b.size - a.size)
    const shown = entries.slice(0, 12)
    const width = Math.max(...shown.map((e) => e.name.length))

    console.log(`\n${GUTTER}${t.dim("Output")}  ${t.dim(`${label}/`)}`)
    for (const [index, entry] of shown.entries()) {
        const isLast = index === shown.length - 1 && entries.length === shown.length
        console.log(
            `${GUTTER}${t.dim(isLast ? glyph.last : glyph.branch)} ${entry.name.padEnd(width + 2)}` +
                `${bytes(entry.size).padStart(9)}` +
                `${t.dim(`  ${bytes(entry.gzip).padStart(8)} gzip`)}`
        )
    }
    if (entries.length > shown.length) {
        console.log(`${GUTTER}${t.dim(glyph.last)} ${t.dim(`and ${entries.length - shown.length} more`)}`)
    }
}

/**
 * @description - builds the application for production
 */
async function build() {
    const startedAt = Date.now()
    const commandLineArguments = process.argv.slice(2)
    const argumentsObject = arrayToObject(commandLineArguments)
    const dirname = path.resolve(__dirname, "../../")

    // Read package.json
    const packageJson = JSON.parse(readFileSync(path.join(process.env.PWD, "package.json"), "utf-8"))
    const { name } = packageJson

    process.stdout.write(header("catalyst build", "production"))

    const buildOutputPath = path.join(process.env.PWD, configJSON.BUILD_OUTPUT_PATH || "build")
    if (existsSync(buildOutputPath)) {
        const cleaning = Date.now()
        rmSync(buildOutputPath, { recursive: true, force: true })
        console.log(step("Cleaned previous output", Date.now() - cleaning))
    }

    const baseEnv = {
        ...process.env,
        // The children are piped now, so their stdout is not a TTY and the
        // bundler would drop colour. Forward our own terminal's answer, so a
        // redirect to a file still comes out plain.
        ...(process.stdout.isTTY && !process.env.NO_COLOR ? { FORCE_COLOR: "1" } : {}),
        src_path: process.env.PWD,
        NODE_ENV: "production",
        VITE_BUILD_MODE: "true",
        APPLICATION: name || "catalyst_app",
        NODE_OPTIONS: `--import ${loaderImportArg(loaderPath)}`,
        ...argumentsObject,
        filterKeys: JSON.stringify([
            "src_path",
            "NODE_ENV",
            "VITE_BUILD_MODE",
            "APPLICATION",
            ...Object.keys(argumentsObject),
        ]),
    }

    const serverBuildArgs = [viteBinPath, "build", "--config", "./dist/vite/vite.config.server.js", "--ssr"]
    const clientBuildArgs = [viteBinPath, "build", "--config", "./dist/vite/vite.config.client.js"]
    const spawnBase = { cwd: dirname }

    // No announce line here: a static "◐ Building..." row would just sit there
    // until the ✓ result prints below it.
    const bundlesStarted = Date.now()

    // Both bundles build in parallel and their output is captured, so failures
    // are reported once, attributed to the bundle that produced them.
    // allSettled rather than all: if both bundles are broken, Promise.all would
    // report only whichever rejected first and hide the other.
    const results = await Promise.allSettled([
        runBuildStep(
            serverBuildArgs,
            { ...spawnBase, env: { ...baseEnv, CATALYST_VITE_CACHE_ID: "ssr" } },
            "server"
        ),
        runBuildStep(
            clientBuildArgs,
            { ...spawnBase, env: { ...baseEnv, CATALYST_VITE_CACHE_ID: "client" } },
            "client"
        ),
    ])

    const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason)

    if (failures.length > 0) {
        console.log(step("Build failed", Date.now() - bundlesStarted, "fail"))
        process.stderr.write(reportBundleFailures(failures, process.env.PWD))
        process.exit(exitCodeFrom(failures[0]))
    }

    // Warnings that survived the config filters were captured and then thrown
    // away on a green build, so a real one (a circular dependency, an oversized
    // chunk) vanished silently. Surface them under the step that produced them.
    const warnings = results
        .filter((result) => result.status === "fulfilled")
        .flatMap((result) => bundleWarnings(result.value.output, result.value.label))

    if (warnings.length > 0) {
        console.log("")
        console.log(`${GUTTER}${t.dim("Notices")}`)
        for (const warning of warnings) {
            console.log(`${GUTTER}${t.warn(glyph.warn)} ${t.dim(warning)}`)
        }
    }

    console.log(step("Built client and server bundles", Date.now() - bundlesStarted))

    const manifestStarted = Date.now()
    try {
        await runBuildStep(
            ["./dist/scripts/generateOfflineManifest.js"],
            { ...spawnBase, env: baseEnv },
            "Generating the offline manifest"
        )
    } catch (error) {
        // Without this the manifest step fell through to the top-level handler,
        // which prints a raw stack trace.
        process.stderr.write(
            diagnostic({
                message: `Generating the offline manifest failed: ${error.message}`,
                scope: "offline manifest",
            })
        )
        process.exit(exitCodeFrom(error))
    }
    console.log(step("Generated offline manifest", Date.now() - manifestStarted))

    printAssetTable(buildOutputPath, configJSON.BUILD_OUTPUT_PATH || "build")

    console.log(`\n${GUTTER}${t.ok(glyph.done)} ${t.bold(`Built in ${duration(Date.now() - startedAt)}`)}`)
    console.log(
        `${GUTTER}  ${t.dim("Run ")}${t.accent("catalyst serve")}${t.dim(" to start the production server")}\n`
    )
}

build().catch((err) => {
    console.error(err)
    process.exit(1)
})
