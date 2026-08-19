const pc = require("ansis")

// src/native is a CJS-only subtree (see src/native/package.json) and cannot
// synchronously require() the ESM errors/index.js module under Node 20, so
// output-mode formatting for buildAppAndroid.js/buildAppIos.js is
// hand-rolled here rather than shared with errors/index.js's box/formatVerbose/
// formatDebug — those two files are the only callers, and both native build
// failure sites need the same minimal shape.

function resolveOutputMode() {
    if (process.argv.includes("--debug")) return "debug"
    if (process.argv.includes("--verbose")) return "verbose"
    return "default"
}

function box(bodyLines) {
    const width = 70
    const top = pc.red(`┌${"─".repeat(width)}`)
    const bottom = pc.red(`└${"─".repeat(width)}`)
    const body = bodyLines.map((line) => (line === "" ? pc.red("│") : `${pc.red("│")} ${line}`))
    return [top, ...body, bottom].join("\n")
}

/**
 * Format a native build failure for terminal output. `code`/`category`
 * identify the generic upstream-toolchain wrapper (ANDROID-000/IOS-000 —
 * see errors/ANDROID/ANDROID-000.md and errors/IOS/IOS-000.md); the
 * upstream message is always shown verbatim, never reinterpreted.
 */
function formatBuildError({ code, category, upstreamName, error }) {
    // Xcode/Gradle tooling (via execSync and friends) can reject with a plain
    // string, null, or undefined instead of an Error instance — normalize
    // before touching .message/.stack so a non-Error failure still prints
    // something useful instead of throwing or rendering "undefined".
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack || "(no stack available)" : "(no stack available)"
    const mode = resolveOutputMode()
    if (mode === "default") {
        return `[${code}] Build failed (upstream: ${upstreamName})\n→ ${message}`
    }
    const lines = [
        `❌ Build failed (upstream: ${upstreamName})`,
        `Code: ${code}`,
        `Category: ${category}`,
        `Time: ${new Date().toISOString()}`,
        "",
        `Problem: ${message}`,
    ]
    if (mode === "debug") {
        lines.push("", "Environment:", `  node: ${process.version}`, `  platform: ${process.platform}`)
        lines.push("", "Stack trace:", ...stack.split("\n").map((l) => `  ${l}`))
    }
    return box(lines)
}

module.exports = { resolveOutputMode, formatBuildError }
