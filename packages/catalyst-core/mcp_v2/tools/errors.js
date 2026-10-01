"use strict"

const fs = require("fs")
const path = require("path")

let _index = null
let _loadError = null

// Prefer the copy published inside the package itself (dist/errors-index.json,
// see the "prepare" script) — the repo-root errors/ directory is a sibling of
// packages/catalyst-core, not inside it, so it never ends up in a published
// tarball. Fall back to the repo-root path for local dev inside this
// monorepo, where dist/errors-index.json may not have been generated yet.
const PACKAGED_INDEX_PATH = path.join(__dirname, "..", "..", "dist", "errors-index.json")
const MONOREPO_INDEX_PATH = path.join(__dirname, "..", "..", "..", "..", "errors", "index.json")

function init() {
    for (const candidate of [PACKAGED_INDEX_PATH, MONOREPO_INDEX_PATH]) {
        try {
            _index = JSON.parse(fs.readFileSync(candidate, "utf-8"))
            _loadError = null
            return
        } catch (e) {
            _loadError = e
        }
    }
    _index = {}
}

function handle_explain_error({ code } = {}) {
    if (!code) {
        return { error: "code is required, e.g. 'PREFLIGHT-001'" }
    }

    if (_loadError) {
        return {
            code,
            error: `Could not load errors/index.json (run generateDocs.js): ${_loadError.message}`,
        }
    }

    const entry = Object.prototype.hasOwnProperty.call(_index, code) ? _index[code] : null

    if (!entry) {
        return {
            code,
            is_catalyst_owned: false,
            note: `"${code}" is not a catalyst-owned error code. It likely came from an upstream tool (Vite, Rollup, Xcode, Gradle, etc). Catalyst does not reinterpret foreign error codes — check the upstream tool's own documentation for this code.`,
        }
    }

    return {
        code,
        is_catalyst_owned: true,
        category: entry.category,
        message: entry.message,
        details: entry.details,
        suggestedAction: entry.suggestedAction,
        docUrl: entry.docUrl,
    }
}

module.exports = { init, handle_explain_error }
