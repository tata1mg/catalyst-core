#!/usr/bin/env node

/**
 * Build script for @catalyst/ai-sdk
 * Generates both CommonJS (.js) and ESM (.mjs) formats with source maps
 */

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
const DIST = path.join(ROOT, "dist")

// Prefer the monorepo/root Babel if available (works for local examples where dist/ is not committed)
const ROOT_BABEL_CLI = path.join(ROOT, "..", "..", "node_modules", "@babel", "cli", "bin", "babel.js")
const BABEL_CMD = fs.existsSync(ROOT_BABEL_CLI) ? `node "${ROOT_BABEL_CLI}"` : "babel"

// Clean dist folder
if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true, force: true })
}
execSync(`${BABEL_CMD} src --out-dir ./dist --out-file-extension .js --source-maps`, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, BABEL_MODULE_FORMAT: "cjs" },
})

// Build ESM (for import statements)
execSync(`${BABEL_CMD} src --out-dir ./dist --out-file-extension .mjs --source-maps`, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, BABEL_MODULE_FORMAT: "esm" },
})
