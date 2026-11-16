"use strict"

const { ANSI } = require("./theme.js")

/**
 * Warnings worth showing from a bundle that otherwise succeeded.
 *
 * The vite configs already drop the advisories nobody can act on; anything
 * still here is a real signal (circular dependency, oversized chunk) that was
 * previously captured and discarded.
 */
// Rolldown (Vite 8) prints warnings as "[CODE] message". PLUGIN_TIMINGS is a
// report on how long plugins took, not a warning about the bundle.
const ROLLDOWN_WARNING = /^\[([A-Z][A-Z0-9_]*)\]\s/

function bundleWarnings(output, label) {
    if (!output) return []
    const seen = new Set()
    const found = []
    for (const raw of String(output).split("\n")) {
        const line = raw.replace(ANSI, "").trim()
        if (!line) continue
        const rolldownCode = ROLLDOWN_WARNING.exec(line)?.[1]
        if (rolldownCode === "PLUGIN_TIMINGS") continue
        if (!rolldownCode && !/^(warning|\(!\))/i.test(line) && !/^\[plugin/.test(line)) continue
        const message = line.replace(/^\(!\)\s*/, "").replace(/^warning:?\s*/i, "")
        if (!message || seen.has(message)) continue
        seen.add(message)
        found.push(`${label} ${message}`)
    }
    return found
}

module.exports = { bundleWarnings }
