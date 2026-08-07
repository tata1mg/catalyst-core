#!/usr/bin/env node
/**
 * Docs link/asset validation: scans every content file for markdown links and
 * images, and reports references that don't resolve:
 *  - relative .md/.mdx links must resolve to a known content file
 *  - absolute /content/... links must match a manifest URL
 *  - relative image paths must exist next to the content file
 *  - absolute /img/... paths must exist in docs/static/img
 * Reports findings; exits 0 (report-only) unless --strict is passed.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, "..")
const CONTENT_ROOT = path.resolve(APP_ROOT, "../../docs/content")
const STATIC_IMG_ROOT = path.resolve(APP_ROOT, "../../docs/static/img")
const manifest = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "src/js/generated/docsManifest.json"), "utf8"))

const knownUrls = new Set(manifest.map((page) => page.url))
const knownSources = new Set(manifest.map((page) => page.sourcePath))

const walk = (dir, files = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full, files)
        else if (/\.mdx?$/.test(entry.name)) files.push(full)
    }
    return files
}

const problems = []
const LINK_PATTERN = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

for (const filePath of walk(CONTENT_ROOT)) {
    const relPath = path.relative(CONTENT_ROOT, filePath).split(path.sep).join("/")
    const body = fs.readFileSync(filePath, "utf8").replace(/```[\s\S]*?```/g, "")

    for (const match of body.matchAll(LINK_PATTERN)) {
        const rawTarget = match[1]
        const isImage = match[0].startsWith("!")
        const target = decodeURIComponent(rawTarget.split("#")[0])
        if (!target || /^[a-z]+:/i.test(target) || target.startsWith("mailto")) continue

        if (isImage || /\.(png|jpe?g|gif|svg|webp)$/i.test(target)) {
            const resolved = target.startsWith("/img/")
                ? path.join(STATIC_IMG_ROOT, target.slice("/img/".length))
                : path.resolve(path.dirname(filePath), target)
            if (!fs.existsSync(resolved)) {
                problems.push({ file: relPath, target: rawTarget, kind: "missing image" })
            }
            continue
        }

        if (/\.mdx?$/.test(target)) {
            // Two Docusaurus forms: relative file link, or absolute source
            // path under /content/ (e.g. /content/11-API Reference/x.md).
            const resolved = target.startsWith("/content/")
                ? target.slice("/content/".length)
                : path
                      .relative(CONTENT_ROOT, path.resolve(path.dirname(filePath), target))
                      .split(path.sep)
                      .join("/")
            if (!knownSources.has(resolved)) {
                problems.push({ file: relPath, target: rawTarget, kind: "broken doc link" })
            }
            continue
        }

        if (target.startsWith("/content/")) {
            if (!knownUrls.has(target.replace(/\/$/, ""))) {
                problems.push({ file: relPath, target: rawTarget, kind: "unknown /content URL" })
            }
        }
    }
}

if (problems.length) {
    console.log(`Found ${problems.length} broken documentation reference(s):`)
    for (const problem of problems) {
        console.log(`  [${problem.kind}] ${problem.file} -> ${problem.target}`)
    }
} else {
    console.log("All documentation links and assets resolve ✓")
}

if (process.argv.includes("--strict") && problems.length) {
    process.exit(1)
}
