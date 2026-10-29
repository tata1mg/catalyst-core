"use strict"
const fs = require("fs")
const path = require("path")

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

const VITE_RUNTIME_VERSION = "0.3.0-beta.1"

function catalystGeneration(version) {
    const parsed = parseVersion(version)
    if (!parsed) return "unknown"
    return versionOlderThan(version, VITE_RUNTIME_VERSION) ? "legacy" : "current"
}

/**
 * Walk up the directory tree looking for a package.json that depends on Catalyst,
 * or the catalyst-core package source itself when developing this repo.
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
            // A package.json inside a node_modules segment is an installed copy, not
            // the catalyst-core source repo itself — for the standard install layout
            // (<app>/node_modules/catalyst-core/mcp_v2/mcp.js), walking up from
            // __dirname hits catalyst-core's own installed package.json (name:
            // "catalyst-core") before it ever reaches the consumer app's root. Only
            // the isSourcePackage branch below should match on pkg.name, and only for
            // a real (non-node_modules) source checkout — otherwise keep climbing so
            // the walk finds the consumer's package.json instead, which matches via
            // the deps["catalyst-core"] branch further down.
            const isInstalledCopy = dir.split(path.sep).includes("node_modules")
            if (fs.existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
                    if (pkg.name === "catalyst-core" && !isInstalledCopy) {
                        const sourceVersion = pkg.version || null
                        return {
                            dir,
                            pkg,
                            catalystPackageName: "catalyst-core",
                            catalystVersion: sourceVersion,
                            version: sourceVersion,
                            installedVersion: sourceVersion,
                            notInstalled: false,
                            isSourcePackage: true,
                            versionMeta: {
                                declaredRef: sourceVersion,
                                isGithubRef: false,
                                installedVersion: sourceVersion,
                                parsed: parseVersion(sourceVersion),
                            },
                        }
                    }

                    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
                    const declaredRef = deps["catalyst-core"]
                    if (declaredRef) {
                        // A fixed `<dir>/node_modules/catalyst-core` path only finds a
                        // flat install. In a hoisted workspace (npm/yarn workspaces,
                        // pnpm with hoisting) the package can live several levels above
                        // `dir` instead. require.resolve with `paths` walks node_modules
                        // up the tree the same way Node's own module resolution does, so
                        // it finds the installed copy regardless of hoisting.
                        let installedVersion = null
                        let installed = false
                        try {
                            const nmPkgPath = require.resolve("catalyst-core/package.json", { paths: [dir] })
                            const nmPkg = JSON.parse(fs.readFileSync(nmPkgPath, "utf8"))
                            installedVersion = nmPkg.version || null
                            installed = true
                        } catch {
                            /* not installed relative to dir */
                        }
                        const isGithubRef = declaredRef.startsWith("github:") || declaredRef.includes("#")
                        return {
                            dir,
                            pkg,
                            catalystPackageName: "catalyst-core",
                            catalystVersion: declaredRef, // what package.json says (may be github ref)
                            version: declaredRef,
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
    function safeProjectPath(rel) {
        if (typeof rel !== "string" || path.isAbsolute(rel)) return null
        const normalized = path.normalize(rel)
        if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) return null
        return `${root}${path.sep}${normalized}`
    }

    function fileExists(rel) {
        const filePath = safeProjectPath(rel)
        return Boolean(filePath && fs.existsSync(filePath))
    }

    function readJson(rel) {
        const filePath = safeProjectPath(rel)
        if (!filePath) return null
        try {
            return JSON.parse(fs.readFileSync(filePath, "utf8"))
        } catch {
            return null
        }
    }

    function readText(rel) {
        const filePath = safeProjectPath(rel)
        if (!filePath) return null
        try {
            return fs.readFileSync(filePath, "utf8")
        } catch {
            return null
        }
    }

    /**
     * Walk src/**\/*.{js,jsx,ts,tsx} and return relative paths that match pattern.
     */
    function grepSrc(pattern) {
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
                const full = `${dir}${path.sep}${e.name}`
                if (e.isDirectory()) {
                    walk(full)
                } else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) {
                    try {
                        const content = fs.readFileSync(full, "utf8")
                        if (pattern.test(content)) {
                            matches.push(path.relative(root, full))
                        }
                    } catch {
                        // Ignore unreadable files during source scan.
                    }
                }
            }
        }
        walk(`${root}${path.sep}src`)
        return matches
    }

    return { fileExists, readJson, readText, grepSrc }
}

const CLIENT_ENTRY_CANDIDATES = ["client/index.js", "client/index.jsx", "client/index.ts", "client/index.tsx"]

// Hooks that talk to the native bridge need WebBridge.init() in the client entry: it sets window.WebBridge and
// isNative. Without it they run with isNative=false inside the WebView and fail silently. useAI and useVision are exempt
// (they also run on cloud/in-browser engines), so importing only those does not count as native use.
const HOOKS_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']catalyst-core\/hooks["']|import\s+(?!type\b)[\w$]+\s*(?:,\s*\{[^}]*\})?\s*from\s*["']catalyst-core\/hooks["']|require\(\s*["']catalyst-core\/hooks["']\s*\)/g

function usesNativeHooks(source) {
    for (const m of source.matchAll(HOOKS_IMPORT)) {
        if (m[1] === undefined) return true // default/namespace import or require: cannot tell which hooks
        const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)
        if (names.some((n) => n !== "useAI" && n !== "useVision")) return true
    }
    return false
}

/**
 * Is WebBridge.init() in place where native hooks need it?
 *   state: "no-hooks" | "no-entry" | "ok" | "missing-init" | "missing-import" | "misplaced"
 * "misplaced" = init runs before hydrationReady(): at module scope it can break hydration with
 * "Cannot read properties of null (reading 'useContext')". It belongs inside hydrationReady().then(...) just
 * before hydrateRoot.
 */
function inspectWebBridgeInit(root) {
    const { grepSrc, readText } = makeProjectHelpers(root)
    const hookFiles = grepSrc(/catalyst-core\/hooks/).filter((f) => usesNativeHooks(readText(f) || ""))
    const entry = CLIENT_ENTRY_CANDIDATES.find((f) => readText(f) !== null && readText(f) !== undefined)
    const base = { hookFiles, entry: entry || null }
    if (!entry) return { ...base, state: hookFiles.length ? "no-entry" : "no-hooks" }
    const src = readText(entry) || ""
    const initAt = src.search(/WebBridge\s*\.\s*init\s*\(/)
    if (initAt === -1) return { ...base, state: hookFiles.length ? "missing-init" : "no-hooks" }
    if (!/import[^;]*\bWebBridge\b[^;]*from|require\([^)]*WebBridge/.test(src)) return { ...base, state: "missing-import" }
    const readyAt = src.search(/hydrationReady\s*\(/)
    if (readyAt !== -1 && initAt < readyAt) return { ...base, state: "misplaced" }
    return { ...base, state: "ok" }
}

const WEBBRIDGE_INIT_SNIPPET = `window.addEventListener("load", () => {
    hydrationReady().then(() => {
        // ...store / router / Application as before...
        WebBridge.init()   // inside hydrationReady, just before hydrateRoot
        hydrateRoot(document.getElementById("app"), Application)
    })
})`

module.exports = {
    inspectWebBridgeInit,
    WEBBRIDGE_INIT_SNIPPET,
    findCatalystRoot,
    makeProjectHelpers,
    versionOlderThan,
    parseVersion,
    catalystGeneration,
    VITE_RUNTIME_VERSION,
}
