#!/usr/bin/env node

/**
 * Verifies that a real consumer of the published tarball sees real types.
 *
 * This is a black-box check, not a self-test: it runs `npm pack`, installs the
 * resulting tarball into a throwaway project, and type-checks a probe file
 * against it. Everything it asserts is therefore a property of what actually
 * ships, not of the source tree — a declaration that fails to make it into the
 * tarball, or an exports entry pointing at a file that is not there, fails here.
 *
 * Four things are asserted, in the module-resolution modes consumers use
 * ("bundler" and "node16"), plus a narrower fifth pass for legacy "node10":
 *
 *   1. POSITIVE — a probe importing the public API from "catalyst-core",
 *      "catalyst-core/hooks" and "catalyst-core/WebBridge" type-checks clean.
 *
 *   2. NEGATIVE — deliberately wrong usage (`split(42)`, and reading a property
 *      the hook result does not have) FAILS to compile. Without this, the
 *      positive check proves nothing: if the types resolved to `any`, or did not
 *      resolve at all, the probe would still pass. This is what distinguishes
 *      "types are present" from "types are real".
 *
 *   3. GLOBALS ISOLATION — the ambient declarations in src/globals.d.ts
 *      (`__CATALYST_IS_BOT__`, `window.webkit`, the `@catalyst/template/*`
 *      wildcard module) must NOT be visible to the consumer. They are needed to
 *      compile this package, but leaking them would inject globals into every
 *      consuming app and can hard-conflict with an app's own Window typing.
 *      Asserted as a compile FAILURE, same as the negative test.
 *
 *   4. UNTYPED SUBPATHS — "catalyst-core/logger", "/sentry" and "/otel" ship no
 *      declarations by design. Under node16 an untyped subpath is an error,
 *      which is the honest signal; this script records the behaviour per mode
 *      rather than asserting one outcome, so a future accidental `types`
 *      condition on them shows up as a reported change.
 *
 *   5. NODE10 — a final pass under classic CommonJS resolution (`module:
 *      commonjs`, no `moduleResolution`), which the team's own TS templates
 *      default to. node10 ignores the "exports" map entirely, so subpath types
 *      reach it only through the "typesVersions" block in package.json. This
 *      pass asserts the root import and "catalyst-core/hooks" resolve with real
 *      types; delete typesVersions and the /hooks case fails with TS2307.
 *
 * Usage: node scripts/check-consumer-types.mjs [--keep]
 *   --keep  leave the temp project on disk and print its path
 *
 * Exits 0 if every assertion holds in every mode, 1 otherwise.
 *
 * NOTE: this script is tooling, not part of the package — /scripts is
 * npmignored, so it never ships to consumers.
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Scratch root for the temp consumer project. Prefers the session scratchpad so
 * runs stay inside the workspace instead of scattering into the system temp dir.
 */
const SCRATCH_ROOT = process.env.CLAUDE_SCRATCHPAD || process.env.TMPDIR || os.tmpdir()

const KEEP = process.argv.includes("--keep")

/** ANSI helpers, disabled when not a TTY or when NO_COLOR is set. */
const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const green = (s) => (useColor ? `[32m${s}[0m` : s)
const red = (s) => (useColor ? `[31m${s}[0m` : s)
const dim = (s) => (useColor ? `[2m${s}[0m` : s)

const results = []

/**
 * Records one assertion outcome and prints it as it happens.
 *
 * @param {string} name human-readable assertion label
 * @param {boolean} ok whether the assertion held
 * @param {string} [detail] extra context, shown indented under a failure
 */
function assert(name, ok, detail = "") {
    results.push({ name, ok, detail })
    console.log(`  ${ok ? green("PASS") : red("FAIL")}  ${name}`)
    if (!ok && detail) {
        console.log(dim(`        ${detail.split("\n").join("\n        ")}`))
    }
}

/**
 * Runs a command, returning its outcome instead of throwing.
 *
 * Used for the tsc invocations, where a non-zero exit is frequently the
 * expected result (the negative and globals-isolation cases).
 *
 * @param {string} command executable to run
 * @param {string[]} args arguments
 * @param {string} cwd working directory
 * @returns {{ ok: boolean, output: string }} success flag and combined output
 */
function run(command, args, cwd) {
    try {
        const output = execFileSync(command, args, {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        })
        return { ok: true, output }
    } catch (error) {
        const output = `${error.stdout || ""}${error.stderr || ""}`.trim()
        return { ok: false, output }
    }
}

/**
 * Same as run(), but a failure is fatal — for setup steps (pack, install)
 * where continuing would make every later assertion meaningless.
 *
 * @param {string} command executable to run
 * @param {string[]} args arguments
 * @param {string} cwd working directory
 * @param {string} label what the step was, for the error message
 * @returns {string} the command's stdout
 */
function runOrDie(command, args, cwd, label) {
    const { ok, output } = run(command, args, cwd)
    if (!ok) {
        console.error(red(`\ncheck-consumer-types: ${label} failed\n`))
        console.error(output)
        process.exit(1)
    }
    return output
}

/**
 * The probe file. Imports the documented public API across all three typed
 * entry points and uses each value in a way that only compiles if its type is
 * real.
 */
const PROBE_VALID = `
import {
    RouterDataProvider,
    useCurrentRouteData,
    split,
    hydrationReady,
    Head,
    Body,
    MetaTag,
    useRouterData,
} from "catalyst-core"
import { useCamera } from "catalyst-core/hooks"
import WebBridge from "catalyst-core/WebBridge"

// Every import must be a value, not an implicit any from a failed resolution.
const _provider: unknown = RouterDataProvider
const _head: unknown = Head
const _body: unknown = Body
const _meta: unknown = MetaTag
const _bridge: unknown = WebBridge

// split() returns a component carrying route statics — exercise the real shape.
const Lazy = split(() => import("./widget.js"), { ssr: false })
const _cacheKey: string | undefined = Lazy.__cacheKey
const _load: Promise<any> = Lazy.load()

// hydrationReady() is a promise of an array.
const _ready: Promise<any[]> = hydrationReady()

// Hook results have named, structured fields.
function useProbe() {
    const routeData = useCurrentRouteData()
    const isFetching: boolean = routeData.isFetching
    const allData = useRouterData()
    const camera = useCamera()
    const loading: boolean = camera.isLoading
    const takePhoto: () => void = camera.takePhoto
    return { isFetching, allData, loading, takePhoto }
}

export { useProbe, Lazy, _provider, _head, _body, _meta, _bridge, _cacheKey, _load, _ready }
`

/**
 * Negative cases. Each must FAIL to compile; if any compiles, the types are not
 * doing real work. Kept in separate files so one case cannot mask another.
 */
const NEGATIVE_CASES = {
    "split-wrong-arg": {
        description: "split(42) rejected — argument types are enforced",
        code: "TS2345",
        source: `
import { split } from "catalyst-core"
export const Bad = split(42)
`,
    },
    "hook-bogus-property": {
        description: "unknown property on useCamera() result rejected",
        code: "TS2339",
        source: `
import { useCamera } from "catalyst-core/hooks"
export function bad() {
    const camera = useCamera()
    return camera.thisPropertyDoesNotExist
}
`,
    },
}

/**
 * Globals-isolation cases. Each must FAIL to compile: these ambient
 * declarations belong to this package's own compilation and must not reach a
 * consumer's global scope.
 *
 * Each probe imports the package FIRST. That is what makes the case meaningful:
 * without an import, catalyst-core's declarations never enter the compilation at
 * all, so the global would be absent for the trivial reason that nothing pulled
 * the package in. Importing first proves the stronger property — even with the
 * package's types fully loaded, the ambient globals stay out of consumer scope.
 */
const GLOBALS_CASES = {
    "ambient-var": {
        description: "__CATALYST_IS_BOT__ not visible to consumer",
        source: `import "catalyst-core"\nexport const leaked = typeof __CATALYST_IS_BOT__\n`,
    },
    "window-augmentation": {
        description: "Window.webkit augmentation not leaked to consumer",
        source: `import "catalyst-core/hooks"\nexport const leaked = window.webkit\n`,
    },
    "wildcard-module": {
        description: '"@catalyst/template/*" wildcard module not leaked',
        source: `import WebBridge from "catalyst-core/WebBridge"\nimport x from "@catalyst/template/anything"\nexport const leaked = [WebBridge, x]\n`,
    },
}

/**
 * Builds the tsconfig for one resolution mode.
 *
 * "node10" is the legacy classic-node resolution: it is selected by setting
 * `module: commonjs` and leaving `moduleResolution` unset, which is exactly what
 * a plain `tsc --init`-style CommonJS project gets. It is tested because the
 * team's own TypeScript templates default to it. node10 ignores the "exports"
 * map entirely, so subpath types reach it only via "typesVersions".
 *
 * @param {"bundler"|"node16"|"node10"} mode resolution mode to test
 * @param {string[]} files the probe files this pass should compile
 * @returns {string} tsconfig JSON
 */
function tsconfigFor(mode, files) {
    const moduleFor = { node16: "node16", node10: "commonjs", bundler: "esnext" }
    const compilerOptions = {
        target: "es2022",
        lib: ["es2022", "dom", "dom.iterable"],
        jsx: "react-jsx",
        module: moduleFor[mode],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
        types: [],
    }

    // node10 is expressed by the ABSENCE of moduleResolution, not by a value.
    if (mode !== "node10") {
        compilerOptions.moduleResolution = mode
    }

    return JSON.stringify({ compilerOptions, files }, null, 4)
}

/**
 * Runs the whole assertion suite against one resolution mode.
 *
 * @param {string} projectDir the temp consumer project
 * @param {"bundler"|"node16"} mode moduleResolution to test
 */
function checkMode(projectDir, mode) {
    console.log(`\n${dim("─".repeat(60))}\nmoduleResolution: ${mode}\n`)

    const tsc = path.join(projectDir, "node_modules", ".bin", "tsc")

    // 1. POSITIVE
    fs.writeFileSync(path.join(projectDir, "probe.ts"), PROBE_VALID)
    fs.writeFileSync(path.join(projectDir, "widget.ts"), "export default function W() { return null }\n")
    fs.writeFileSync(path.join(projectDir, "tsconfig.json"), tsconfigFor(mode, ["probe.ts", "widget.ts"]))

    const positive = run(tsc, ["-p", "tsconfig.json"], projectDir)
    assert(`[${mode}] public API type-checks clean`, positive.ok, positive.output)

    // 2. NEGATIVE — each must fail to compile with its SPECIFIC error code.
    //    Asserting the code, not merely "some error", is what makes the case
    //    load-bearing: a typo in the probe or a failed module resolution also
    //    produces a non-zero exit, and would otherwise be scored as a pass.
    for (const [name, { description, source, code }] of Object.entries(NEGATIVE_CASES)) {
        const file = `neg-${name}.ts`
        fs.writeFileSync(path.join(projectDir, file), source)
        fs.writeFileSync(path.join(projectDir, "tsconfig.json"), tsconfigFor(mode, [file]))
        const result = run(tsc, ["-p", "tsconfig.json"], projectDir)
        assert(
            `[${mode}] ${description} (${code})`,
            !result.ok && result.output.includes(code),
            result.ok
                ? "expected a compile error, but it compiled clean — types may be `any`"
                : `expected ${code}, got:\n${result.output}`
        )
    }

    // 3. GLOBALS ISOLATION — each must fail to compile.
    for (const [name, { description, source }] of Object.entries(GLOBALS_CASES)) {
        const file = `glob-${name}.ts`
        fs.writeFileSync(path.join(projectDir, file), source)
        fs.writeFileSync(path.join(projectDir, "tsconfig.json"), tsconfigFor(mode, [file]))
        const result = run(tsc, ["-p", "tsconfig.json"], projectDir)
        assert(
            `[${mode}] ${description}`,
            !result.ok,
            result.ok ? "expected a compile error — an ambient global leaked into the consumer" : ""
        )
    }

    // 4. @types/react IS REQUIRED — asserted so the dependency stays a
    //    deliberate, documented fact rather than an accident.
    //
    //    The emitted declarations name React types directly (React.JSX.Element on
    //    Head/Body, React.Context on RouterDataProvider, React.Dispatch across the
    //    bridge hooks) and the react package ships no types of its own. With
    //    skipLibCheck:true — the common default, and what most consumers run — a
    //    missing @types/react is silently absorbed and the probe still compiles.
    //    Under skipLibCheck:false it surfaces as TS7016. This runs the strict pass
    //    with the React types renamed away, and asserts it DOES fail: if it ever
    //    stops failing, the public surface no longer needs @types/react and the
    //    peerDependenciesMeta entry can go.
    const typesReactDir = path.join(projectDir, "node_modules", "@types", "react")
    const typesReactHidden = `${typesReactDir}.hidden`
    if (fs.existsSync(typesReactDir)) {
        fs.renameSync(typesReactDir, typesReactHidden)
        fs.writeFileSync(path.join(projectDir, "tsconfig.json"), tsconfigFor(mode, ["probe.ts", "widget.ts"]))
        const strict = JSON.parse(fs.readFileSync(path.join(projectDir, "tsconfig.json"), "utf8"))
        strict.compilerOptions.skipLibCheck = false
        fs.writeFileSync(path.join(projectDir, "tsconfig.json"), JSON.stringify(strict, null, 4))

        const withoutTypes = run(tsc, ["-p", "tsconfig.json"], projectDir)
        fs.renameSync(typesReactHidden, typesReactDir)

        assert(
            `[${mode}] @types/react is genuinely required (TS7016 without it)`,
            !withoutTypes.ok && withoutTypes.output.includes("TS7016"),
            withoutTypes.ok
                ? "expected TS7016 — declarations no longer need @types/react; drop the peerDependenciesMeta entry"
                : withoutTypes.output.split("\n").slice(0, 3).join("\n")
        )
    }

    // 5. UNTYPED SUBPATHS — reported, not asserted. See the header.
    const untypedFile = "untyped-subpaths.ts"
    fs.writeFileSync(
        path.join(projectDir, untypedFile),
        `import "catalyst-core/logger"\nimport "catalyst-core/otel"\n`
    )
    fs.writeFileSync(path.join(projectDir, "tsconfig.json"), tsconfigFor(mode, [untypedFile]))
    const untyped = run(tsc, ["-p", "tsconfig.json"], projectDir)
    console.log(
        dim(
            `  NOTE  [${mode}] untyped subpaths (logger/otel): ${
                untyped.ok ? "resolve as implicit any" : "error, as expected for an untyped subpath"
            }`
        )
    )
}

/**
 * Runs the node10 (classic CommonJS) pass.
 *
 * Narrower than checkMode() on purpose. node10 ignores "exports", so the only
 * reason a subpath resolves at all is the "typesVersions" map in package.json —
 * that map is precisely what this pass exists to hold in place. It asserts the
 * root import and "catalyst-core/hooks" both type-check with REAL types (the
 * deliberate-error cases prove "real" rather than "any"), which is what a
 * consumer on the team's default TS template actually depends on.
 *
 * @param {string} projectDir the temp consumer project
 */
function checkNode10(projectDir) {
    const mode = "node10"
    console.log(`\n${dim("─".repeat(60))}\nmoduleResolution: ${mode} (module: commonjs, no moduleResolution set)\n`)

    const tsc = path.join(projectDir, "node_modules", ".bin", "tsc")

    // 1. POSITIVE — root and /hooks must resolve with real types.
    const probe = `
import { split, hydrationReady } from "catalyst-core"
import { useCamera } from "catalyst-core/hooks"

const Lazy = split(() => import("./widget"), { ssr: false })
const _cacheKey: string | undefined = Lazy.__cacheKey
const _ready: Promise<any[]> = hydrationReady()

export function useProbe() {
    const camera = useCamera()
    const loading: boolean = camera.isLoading
    const takePhoto: () => void = camera.takePhoto
    return { loading, takePhoto }
}

export { Lazy, _cacheKey, _ready }
`
    fs.writeFileSync(path.join(projectDir, "probe-node10.ts"), probe)
    fs.writeFileSync(path.join(projectDir, "widget.ts"), "export default function W() { return null }\n")
    fs.writeFileSync(
        path.join(projectDir, "tsconfig.json"),
        tsconfigFor(mode, ["probe-node10.ts", "widget.ts"])
    )

    const positive = run(tsc, ["-p", "tsconfig.json"], projectDir)
    assert(`[${mode}] root + /hooks type-check clean (typesVersions)`, positive.ok, positive.output)

    // 2. NEGATIVE — the same specific-code cases, proving the node10 types are
    //    genuinely real and not silently `any`. Cheap: one tsc run each.
    for (const [name, { description, source, code }] of Object.entries(NEGATIVE_CASES)) {
        const file = `neg10-${name}.ts`
        fs.writeFileSync(path.join(projectDir, file), source)
        fs.writeFileSync(path.join(projectDir, "tsconfig.json"), tsconfigFor(mode, [file]))
        const result = run(tsc, ["-p", "tsconfig.json"], projectDir)
        assert(
            `[${mode}] ${description} (${code})`,
            !result.ok && result.output.includes(code),
            result.ok
                ? "expected a compile error, but it compiled clean — node10 types may be `any`"
                : `expected ${code}, got:\n${result.output}`
        )
    }
}

function main() {
    console.log("check-consumer-types: packing and installing catalyst-core\n")

    const workDir = fs.mkdtempSync(path.join(SCRATCH_ROOT, "consumer-types-"))
    const projectDir = path.join(workDir, "consumer")
    fs.mkdirSync(projectDir)

    // Pack the real package — this is what consumers get.
    const packOutput = runOrDie(
        "npm",
        ["pack", "--pack-destination", workDir, "--silent"],
        PACKAGE_ROOT,
        "npm pack"
    )
    const tarball = packOutput.trim().split("\n").filter(Boolean).pop()
    const tarballPath = path.join(workDir, path.basename(tarball))
    const sizeMb = (fs.statSync(tarballPath).size / 1024 / 1024).toFixed(2)
    console.log(`  packed ${path.basename(tarballPath)} (${sizeMb} MB)`)

    fs.writeFileSync(
        path.join(projectDir, "package.json"),
        JSON.stringify({ name: "consumer-probe", version: "1.0.0", type: "module", private: true }, null, 4)
    )

    // A consumer installs the tarball plus the React types its own app needs.
    runOrDie(
        "npm",
        [
            "install",
            "--no-audit",
            "--no-fund",
            "--silent",
            tarballPath,
            "@types/react@^19",
            "@types/react-dom@^19",
            "typescript@^5.9.3",
        ],
        projectDir,
        "npm install"
    )
    console.log("  installed tarball + @types/react + typescript")

    for (const mode of ["bundler", "node16"]) {
        checkMode(projectDir, mode)
    }
    checkNode10(projectDir)

    const failed = results.filter((r) => !r.ok)
    console.log(`\n${dim("─".repeat(60))}`)
    if (failed.length === 0) {
        console.log(green(`\ncheck-consumer-types: all ${results.length} assertions passed\n`))
    } else {
        console.log(red(`\ncheck-consumer-types: ${failed.length}/${results.length} assertions FAILED\n`))
        for (const f of failed) console.log(red(`  - ${f.name}`))
        console.log()
    }

    if (KEEP) {
        console.log(dim(`  temp project kept at: ${projectDir}\n`))
    } else {
        fs.rmSync(workDir, { recursive: true, force: true })
    }

    process.exit(failed.length === 0 ? 0 : 1)
}

main()
