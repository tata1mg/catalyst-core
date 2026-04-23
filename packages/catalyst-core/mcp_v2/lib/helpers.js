"use strict"
const fs = require("fs")
const path = require("path")
const supportedCatalystPackages = ["catalyst-core", "catalyst-core-internal"]

/**
 * Parse a semver-like version string into comparable parts.
 * Handles: "0.0.3-canary.3", "0.1.0-canary.4", "^0.1.0-canary.4"
 * Returns { major, minor, patch, pre, preNum } or null if unparseable.
 */
function parseVersion(v) {
    if (!v) return null
    const clean = v.replace(/^[\^~]/, "")
    const m = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-(\w+)\.(\d+))?/)
    if (!m) return null
    return {
        major: +m[1],
        minor: +m[2],
        patch: +m[3],
        pre: m[4] || null,
        preNum: m[5] ? +m[5] : 0,
        raw: clean,
    }
}

/**
 * Returns true if version a is older than version b.
 * Only works for matching pre-release labels (e.g. both "canary").
 */
function versionOlderThan(a, b) {
    const pa = parseVersion(a)
    const pb = parseVersion(b)
    if (!pa || !pb) return false
    if (pa.major !== pb.major) return pa.major < pb.major
    if (pa.minor !== pb.minor) return pa.minor < pb.minor
    if (pa.patch !== pb.patch) return pa.patch < pb.patch
    if (pa.pre && pb.pre && pa.pre === pb.pre) return pa.preNum < pb.preNum
    return false
}

/**
 * Walk up the directory tree looking for a package.json that depends on Catalyst.
 * Returns { dir, pkg, catalystPackageName, catalystVersion, installedVersion, versionMeta } or null.
 */
function findCatalystRoot() {
    // Walk up from __dirname first (mcp always lives inside the project at .catalyst/mcp/),
    // then fall back to cwd. This ensures the right root is found regardless of what
    // cwd the editor/IDE sets when spawning the MCP process.
    const startDirs = [path.resolve(__dirname, "..", ".."), process.cwd()]

    for (const start of startDirs) {
        let dir = start
        while (dir !== path.parse(dir).root) {
            const pkgPath = path.join(dir, "package.json")
            if (fs.existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
                    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
                    const catalystPackageName = supportedCatalystPackages.find(
                        (packageName) => deps[packageName]
                    )
                    if (catalystPackageName) {
                        const nmPath = path.join(dir, "node_modules", catalystPackageName)
                        const installed = fs.existsSync(nmPath)
                        // Read the actual installed version from node_modules
                        let installedVersion = null
                        if (installed) {
                            try {
                                const nmPkg = JSON.parse(
                                    fs.readFileSync(path.join(nmPath, "package.json"), "utf8")
                                )
                                installedVersion = nmPkg.version || null
                            } catch {
                                /* ignore */
                            }
                        }
                        const declaredRef = deps[catalystPackageName]
                        const isGithubRef = declaredRef.startsWith("github:") || declaredRef.includes("#")
                        return {
                            dir,
                            pkg,
                            catalystPackageName,
                            catalystVersion: declaredRef, // what package.json says (may be github ref)
                            installedVersion, // what's actually in node_modules e.g. "0.0.3-canary.3"
                            notInstalled: !installed,
                            versionMeta: {
                                declaredRef,
                                isGithubRef,
                                installedVersion,
                                parsed: parseVersion(installedVersion),
                            },
                        }
                    }
                } catch {
                    // Malformed package.json — skip, keep walking up
                }
            }
            dir = path.dirname(dir)
        }
    }
    return null
}

/**
 * File-system helpers scoped to a project root.
 */
function makeProjectHelpers(root) {
    function fileExists(rel) {
        return fs.existsSync(path.join(root, rel))
    }

    function readJson(rel) {
        try {
            return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"))
        } catch {
            return null
        }
    }

    function readText(rel) {
        try {
            return fs.readFileSync(path.join(root, rel), "utf8")
        } catch {
            return null
        }
    }

    /**
     * Walk src/**\/*.{js,jsx,ts,tsx} and return relative paths that match pattern.
     */
    function grepSrc(pattern) {
        const re = new RegExp(pattern)
        const matches = []
        function walk(dir) {
            let entries
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true })
            } catch {
                return
            }
            for (const e of entries) {
                if (e.name === "node_modules" || e.name === ".git") continue
                const full = path.join(dir, e.name)
                if (e.isDirectory()) {
                    walk(full)
                } else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) {
                    try {
                        if (re.test(fs.readFileSync(full, "utf8"))) {
                            matches.push(path.relative(root, full))
                        }
                    } catch {
                        // Ignore unreadable files during source scan.
                    }
                }
            }
        }
        walk(path.join(root, "src"))
        return matches
    }

    return { fileExists, readJson, readText, grepSrc }
}

module.exports = {
    findCatalystRoot,
    makeProjectHelpers,
    versionOlderThan,
    parseVersion,
    supportedCatalystPackages,
}
