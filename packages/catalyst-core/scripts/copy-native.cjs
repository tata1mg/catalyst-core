#!/usr/bin/env node

/**
 * Copies src/native to dist/native verbatim, ahead of the Babel pass.
 *
 * Replaces `cp -r ./src/native ./dist/native`, which stopped `npm install` dead
 * on Windows: no cmd.exe has a cp. `dereference` matches what that cp did, so
 * dist contains no symlinks.
 *
 * Usage: node scripts/copy-native.cjs
 */

const fs = require("fs")
const path = require("path")

const packageRoot = path.resolve(__dirname, "..")

fs.cpSync(path.join(packageRoot, "src", "native"), path.join(packageRoot, "dist", "native"), {
    recursive: true,
    dereference: true,
})
