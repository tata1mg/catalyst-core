"use strict"

// Copies the monorepo-root errors/index.json into this package's dist/ so
// mcp_v2/tools/errors.js#explain_error can find it once catalyst-core is
// installed as a real npm dependency — the repo-root errors/ directory is a
// sibling of packages/catalyst-core, not inside it, so it never ends up in
// a published tarball on its own.
//
// Run as part of the "prepare"/"prepublishOnly" scripts. Non-fatal if the
// source file doesn't exist (e.g. running outside this monorepo, or before
// generateDocs.js has ever run) — explain_error degrades to reporting every
// code as non-catalyst-owned rather than failing the whole build.

const fs = require("fs")
const path = require("path")

const SOURCE_PATH = path.join(__dirname, "..", "..", "..", "..", "errors", "index.json")
const DEST_PATH = path.join(__dirname, "..", "..", "dist", "errors-index.json")

function copyErrorsIndex() {
    if (!fs.existsSync(SOURCE_PATH)) {
        console.log(`[copyErrorsIndex] ${SOURCE_PATH} not found, skipping (run generateDocs.js first for explain_error to work)`)
        return
    }
    fs.mkdirSync(path.dirname(DEST_PATH), { recursive: true })
    fs.copyFileSync(SOURCE_PATH, DEST_PATH)
    console.log(`[copyErrorsIndex] copied ${SOURCE_PATH} -> ${DEST_PATH}`)
}

if (require.main === module) {
    copyErrorsIndex()
}

module.exports = { copyErrorsIndex }
