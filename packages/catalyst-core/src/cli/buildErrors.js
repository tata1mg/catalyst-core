"use strict"

const { ANSI } = require("./theme.js")

/**
 * Pull the real errors out of a native build's output.
 *
 * A failed gradle or xcodebuild run ends with "Command failed with exit code 1",
 * which tells you nothing -- the Kotlin or Swift error that actually caused it
 * is somewhere in the middle of hundreds of lines. Without this you have to
 * open Android Studio or Xcode to find out what broke.
 *
 * Deliberately pattern-matching rather than parsing: both tools change their
 * output between releases, and a parser that breaks silently is worse than a
 * matcher that occasionally misses a line. Everything is still on screen and in
 * the tail we print, so a miss costs nothing.
 */

// e/ and error: are Kotlin; the file:line:col form covers javac, swiftc and
// clang. `> Task :app:x FAILED` and `FAILURE:` are gradle's own markers.
const ERROR_PATTERNS = [
    // Kotlin: e: file:///path/Foo.kt:12:5 Unresolved reference: bar
    /^e:\s+(?:file:\/\/)?(?<file>[^\s:]+):(?<line>\d+):(?<column>\d+)\s+(?<message>.+)$/,
    // Swift / clang / javac: /path/Foo.swift:12:5: error: cannot find 'bar'
    /^(?<file>[^\s:][^:]*):(?<line>\d+):(?<column>\d+):\s*(?:fatal\s+)?error:\s*(?<message>.+)$/i,
    // javac without a column
    /^(?<file>[^\s:][^:]*):(?<line>\d+):\s*error:\s*(?<message>.+)$/i,
    // Gradle/AGP: "> Task :app:compileDebugKotlin FAILED" then a bare message
    /^\s*(?:>\s*)?(?:error|FAILURE):\s*(?<message>.+)$/i,
    // Xcode linker and codesign failures carry no file
    /^(?<message>(?:ld|clang|codesign|xcodebuild): error:.+)$/i,
]

// Lines that look like errors but are summary noise, not the cause.
const NOISE = [
    /^FAILURE: Build failed with an exception/i,
    /^\*\s*(What went wrong|Try|Exception is|Get more help)/i,
    /^Execution failed for task/i,
    /error: Compilation failed; see the compiler error output/i,
    /^\s*>\s*Compilation error\. See log for more details/i,
    /^The following build commands failed:/i,
    /^\(\d+ failures?\)$/i,
]

// Vite/rollup errors. Kept separate from the native patterns: a Vite build
// can never emit Kotlin or Xcode markers, and one flat list would become a
// junk drawer where every toolchain's noise matches every other's.
const VITE_ERROR_PATTERNS = [
    // [plugin:name] Could not load /path (imported by other/path): ENOENT...
    /\[(?:vite|plugin)[^\]]*\]\s*(?<message>Could not (?:load|resolve)[^:]*)(?::.*)?$/i,
    // Failed to resolve import "x" from "y"
    /^(?<message>Failed to resolve (?:import|entry)[^.]*)\.?$/i,
    // file.js:12:3: error: message   (esbuild transform failures)
    /^(?<file>[^\s:][^:]*):(?<line>\d+):(?<column>\d+):\s*ERROR:\s*(?<message>.+)$/i,
    // Bare "error during build:" is a header, not a message -- see NOISE.
]

// "imported by <file>" tells us which of the user's files to point at, which
// is far more useful than the missing path they typed.
const IMPORTED_BY = /\(imported by ([^)]+)\)/

const MAX_ERRORS = 5

/**
 * @param {string} output - everything the build printed
 * @returns {Array<{file?: string, line?: number, column?: number, message: string}>}
 */
function extractBuildErrors(output, { toolchain = "native" } = {}) {
    if (!output) return []

    const patterns = toolchain === "vite" ? VITE_ERROR_PATTERNS : ERROR_PATTERNS

    const found = []
    const seen = new Set()

    for (const raw of String(output).split("\n")) {
        const line = raw.replace(ANSI, "").trimEnd()
        if (!line.trim()) continue
        if (NOISE.some((pattern) => pattern.test(line.trim()))) continue

        for (const pattern of patterns) {
            const match = pattern.exec(line.trim())
            if (!match) continue

            const { file, line: lineNo, column, message } = match.groups
            const importedBy = IMPORTED_BY.exec(line)
            const key = `${file || ""}:${lineNo || ""}:${message}`
            if (seen.has(key)) break
            seen.add(key)

            found.push({
                file: file || (importedBy ? importedBy[1].trim() : undefined),
                line: lineNo ? Number(lineNo) : undefined,
                column: column ? Number(column) : undefined,
                // The "(imported by x)" clause becomes the `file` above, so
                // repeating it in the message is noise.
                message: message.replace(IMPORTED_BY, "").replace(/\s+/g, " ").trim(),
            })
            break
        }

        if (found.length >= MAX_ERRORS) break
    }

    return found
}

/**
 * The tail of a build's output, for when no error could be recognised.
 * Better to show the last thing the tool said than to say nothing.
 */
// Advice every gradle failure prints regardless of cause. It crowds out the
// real message, which is worse than useless here: the tail exists precisely
// because nothing was recognised, so every line it spends must be evidence.
const TAIL_NOISE = [
    /^>?\s*Run with --(stacktrace|info|debug|scan)/i,
    /^>?\s*Get more help at/i,
    /^Deprecated Gradle features were used/i,
    /^You can use '--warning-mode all'/i,
    /^For more on this, please refer to/i,
    /^BUILD FAILED in /i,
    /^\*\s*(Try|Get more help)/i,
]

function outputTail(output, lines = 12) {
    if (!output) return ""
    return String(output)
        .replace(ANSI, "")
        .split("\n")
        .filter((line) => line.trim() && !TAIL_NOISE.some((pattern) => pattern.test(line.trim())))
        .slice(-lines)
        .join("\n")
}

module.exports = { extractBuildErrors, outputTail, MAX_ERRORS }
