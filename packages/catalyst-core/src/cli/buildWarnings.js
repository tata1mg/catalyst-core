"use strict"

const { ANSI } = require("./theme.js")

/**
 * Warnings worth showing from a bundle that otherwise succeeded.
 *
 * The vite configs already drop the advisories nobody can act on; anything
 * still here is a real signal (circular dependency, oversized chunk) that was
 * previously captured and discarded.
 */
function bundleWarnings(output, label) {
    if (!output) return []
    const seen = new Set()
    const found = []
    for (const raw of String(output).split("\n")) {
        const line = raw.replace(ANSI, "").trim()
        if (!line) continue
        if (!/^(warning|\(!\))/i.test(line) && !/^\[plugin/.test(line)) continue
        const message = line.replace(/^\(!\)\s*/, "").replace(/^warning:?\s*/i, "")
        if (!message || seen.has(message)) continue
        seen.add(message)
        found.push(`${label} ${message}`)
    }
    return found
}

module.exports = { bundleWarnings }
