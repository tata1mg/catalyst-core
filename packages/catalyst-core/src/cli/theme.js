"use strict"

const os = require("os")
const path = require("path")
const pc = require("ansis")

/**
 * The one visual language shared by every Catalyst command.
 *
 * Rules, so anything added later still looks like it belongs:
 *   - One accent (cyan) for identity and links. Green, red and yellow carry
 *     state only, never decoration.
 *   - Single-width glyphs, never emoji. Emoji render double-width in some
 *     terminals, which breaks every column that follows them.
 *   - Dim is structure: rules, labels and paths recede so the one thing that
 *     matters on a line is the bright one.
 *   - Every line starts at the same gutter, so output reads as a column.
 *
 * Authored as CommonJS because src/native/ ships as CJS (see
 * src/native/package.json) while src/scripts/ is ESM -- CJS is the only form
 * both halves can consume.
 */

// Colour codes sit in front of text, so anything that matches against output
// must strip them first. Defined once here rather than per-module.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

const GUTTER = "  "

const glyph = {
    pending: "○",
    running: "◐",
    done: "✓",
    fail: "✗",
    warn: "▲",
    info: "•",
    arrow: "›",
    branch: "├",
    last: "└",
    pipe: "│",
    rule: "─",
}

// Frames for the running indicator. Braille spinners look busier than they
// read; these four are calm and legible at any width.
const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"]

const t = {
    accent: pc.cyan,
    dim: pc.gray,
    ok: pc.green,
    bad: pc.red,
    warn: pc.yellow,
    bold: pc.bold,
}

/**
 * True when we may draw in place: a real terminal, not a pipe, not CI.
 * Vite's gate, so the web and native commands agree on what "interactive"
 * means. ansis independently handles NO_COLOR/FORCE_COLOR/TERM=dumb.
 */
function isInteractive(stream = process.stdout) {
    return Boolean(stream.isTTY && !process.env.CI)
}

/**
 * True when the user asked for more detail: `--verbose`/`--debug` on this
 * process, or CATALYST_OUTPUT_MODE forwarded by a parent that saw them. The
 * default view keeps only what someone acts on; the rest is here.
 */
function isVerbose(argv = process.argv, env = process.env) {
    if (argv.includes("--verbose") || argv.includes("--debug")) return true
    return env.CATALYST_OUTPUT_MODE === "verbose" || env.CATALYST_OUTPUT_MODE === "debug"
}

let cachedVersion
/** catalyst-core's own version: ../../package.json from both src/cli and dist/cli. */
function version() {
    if (cachedVersion === undefined) {
        try {
            cachedVersion = require("../../package.json").version || null
        } catch (error) {
            cachedVersion = null
        }
    }
    return cachedVersion
}

/** The titled rule every command opens with: `catalyst build v1.0.1 › production`. */
function header(title, subtitle) {
    const v = version()
    const line =
        `${t.bold(t.accent(title))}` +
        `${v ? t.dim(` v${v}`) : ""}` +
        `${subtitle ? t.dim(`  ${glyph.arrow}  ${subtitle}`) : ""}`
    return `\n${GUTTER}${line}\n${GUTTER}${t.dim(glyph.rule.repeat(46))}\n`
}

/** A dim-key / bright-value row, values column-aligned. */
function row(key, value, width = 9) {
    return `${GUTTER}${t.dim(key.padEnd(width))}${value}`
}

function duration(ms) {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

/**
 * A path as a person would type it: relative to the app when inside it,
 * `~/...` when under home, absolute otherwise. Absolute paths into DerivedData
 * or node_modules pushed the useful tail off the edge of the terminal.
 */
function displayPath(file, root = process.cwd()) {
    if (!file) return file
    const relative = path.relative(root, file)
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative
    const home = os.homedir()
    return file.startsWith(home) ? `~${file.slice(home.length)}` : file
}

function bytes(n) {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
}

// Below this a timing is noise: "0ms" next to a step says nothing a reader
// can use, and a column of them hides the one step that was actually slow.
const MIN_SHOWN_MS = 100

/** A completed step: `✓ Label  1.2s` */
function step(label, ms, state = "done") {
    const mark =
        state === "fail" ? t.bad(glyph.fail) : state === "warn" ? t.warn(glyph.warn) : t.ok(glyph.done)
    return `${GUTTER}${mark} ${label}${ms == null || ms < MIN_SHOWN_MS ? "" : `  ${t.dim(duration(ms))}`}`
}

module.exports = {
    ANSI,
    GUTTER,
    glyph,
    SPINNER_FRAMES,
    t,
    isInteractive,
    isVerbose,
    version,
    header,
    row,
    duration,
    bytes,
    displayPath,
    step,
}
