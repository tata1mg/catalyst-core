"use strict"

const fs = require("fs")
const path = require("path")

let _index = null
let _loadError = null

// packages/catalyst-core/mcp_v2/tools -> repo root /errors/index.json
const ERRORS_INDEX_PATH = path.join(__dirname, "..", "..", "..", "..", "errors", "index.json")

function init() {
    try {
        _index = JSON.parse(fs.readFileSync(ERRORS_INDEX_PATH, "utf-8"))
    } catch (e) {
        _loadError = e
        _index = {}
    }
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

    const entry = _index[code]

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
