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

    // Each file is read once per set of helpers: the source walk, the filters that follow it and the entry lookup all want the same
    // files, and a check that runs several of them used to read every file again each time.
    const textCache = new Map()

    function readText(rel) {
        if (textCache.has(rel)) return textCache.get(rel)
        const filePath = safeProjectPath(rel)
        if (!filePath) return null
        let text = null
        try {
            text = fs.readFileSync(filePath, "utf8")
        } catch {
            text = null
        }
        textCache.set(rel, text)
        return text
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
                        const rel = path.relative(root, full)
                        const content = textCache.has(rel) ? textCache.get(rel) : fs.readFileSync(full, "utf8")
                        textCache.set(rel, content)
                        if (pattern.test(content)) {
                            matches.push(rel)
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

/**
 * The catalyst-core version installed for the project at `root`: the copy in
 * its node_modules (hoisted installs included), then the declared range in
 * its package.json. Null when neither says.
 */
function installedCatalystVersion(root) {
    try {
        const pkgPath = require.resolve("catalyst-core/package.json", { paths: [root] })
        const version = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version
        if (version) return version
    } catch {
        /* not installed relative to root */
    }
    try {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - root is the local project being checked; "package.json" is a fixed literal.
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
        if (pkg.name === "catalyst-core") return pkg.version || null
        const deps = { ...pkg.dependencies, ...pkg.devDependencies }
        return deps["catalyst-core"] || null
    } catch {
        return null
    }
}

// From catalyst-core 1.2.0 both builds use public/icon.png as the app icon
// when the platform has no sized icons. Mirrors src/native/appIcon.js.
const SINGLE_APP_ICON_MIN_VERSION = "1.2.0"
const MIN_APP_ICON_SIZE = 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Width, height and alpha from a PNG's header: colour type 4 or 6, or a tRNS
 * chunk before the image data. Null when the bytes are not a PNG. Same rules
 * as readPngInfo in src/native/appIcon.js.
 */
function readPngInfo(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 33) return null
    if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
    if (buffer.toString("ascii", 12, 16) !== "IHDR") return null
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    const colorType = buffer[25]
    let hasTransparencyChunk = false
    let offset = 8
    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset)
        const type = buffer.toString("ascii", offset + 4, offset + 8)
        if (type === "tRNS") {
            hasTransparencyChunk = true
            break
        }
        if (type === "IDAT" || type === "IEND") break
        offset += 12 + length
    }
    return { width, height, colorType, hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk }
}

/**
 * What the builds would say about public/icon.png: null when it is missing,
 * else { info, problem } where problem is why the build rejects it
 * (ANDROID-010 / IOS-005) or null. Alpha is reported through info.hasAlpha.
 */
function checkSingleAppIcon(root) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - root is the local project being checked; the rest are fixed literals.
    const file = path.join(root, "public", "icon.png")
    if (!fs.existsSync(file)) return null
    let info = null
    try {
        info = readPngInfo(fs.readFileSync(file))
    } catch {
        info = null
    }
    if (!info) return { info: null, problem: "is not a PNG file" }
    if (info.width !== info.height)
        return { info, problem: `is ${info.width}x${info.height}; it must be square` }
    if (info.width < MIN_APP_ICON_SIZE)
        return {
            info,
            problem: `is ${info.width}x${info.height}; it must be at least ${MIN_APP_ICON_SIZE}x${MIN_APP_ICON_SIZE}`,
        }
    return { info, problem: null }
}

/** True when public/android/appIcons has an icon-<density> file, which the Android build prefers over icon.png. */
function hasAndroidSizedIcons(root) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - root is the local project being checked; the rest are fixed literals.
    const dir = path.join(root, "public", "android", "appIcons")
    return ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"].some((density) =>
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - dir is derived from the project root; density and ext come from fixed lists.
        ["png", "jpg", "jpeg"].some((ext) => fs.existsSync(path.join(dir, `icon-${density}.${ext}`)))
    )
}

/** True when public/ios/appIcons exists: the iOS build then uses it instead of icon.png. */
function hasIosSizedIcons(root) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - root is the local project being checked; the rest are fixed literals.
    return fs.existsSync(path.join(root, "public", "ios", "appIcons"))
}

const CLIENT_ENTRY_CANDIDATES = ["client/index.js", "client/index.jsx", "client/index.ts", "client/index.tsx"]

// Hooks that talk to the native bridge need WebBridge.init() in the client entry: it sets window.WebBridge and
// isNative. Without it they run with isNative=false inside the WebView and fail silently. useAI and useVision are exempt
// (they also run on cloud/in-browser engines), so importing only those does not count as native use.
const HOOKS_MODULE = String.raw`["']catalyst-core\/hooks["']`
const NAMED_IMPORT = new RegExp(String.raw`import\s+(type\s+)?\{([^}]*)\}\s*from\s*` + HOOKS_MODULE, "g")
// default or namespace import, optionally with a named list after it: which hooks are used cannot be told
const OTHER_IMPORT = new RegExp(String.raw`import\s+(?!type\b)(?:[\w$]+|\*\s+as\s+[\w$]+)\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?\s*from\s*` + HOOKS_MODULE)
const DESTRUCTURED_REQUIRE = new RegExp(String.raw`(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*` + HOOKS_MODULE + String.raw`\s*\)`, "g")
const ANY_REQUIRE = new RegExp(String.raw`require\(\s*` + HOOKS_MODULE + String.raw`\s*\)`, "g")
const EXEMPT_HOOKS = new Set(["useAI", "useVision"])

/** Imported names from `{ a, b as c, type d }` or `{ a, b: c }`: the exported name, with type-only specifiers left out. */
function hookNames(list) {
    return list
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n && !/^type\s/.test(n))
        .map((n) => n.split(/\s+as\s+|\s*:\s*/)[0].trim())
        .filter(Boolean)
}

function usesNativeHooks(source) {
    // A type-only import (`import type { ... }`) is erased by the compiler, so it is not runtime use of any hook.
    for (const m of source.matchAll(NAMED_IMPORT)) {
        if (m[1]) continue
        if (hookNames(m[2]).some((n) => !EXEMPT_HOOKS.has(n))) return true
    }
    if (OTHER_IMPORT.test(source)) return true
    // `const { useAI } = require(...)` gets the same exemption as the import form.
    const destructured = [...source.matchAll(DESTRUCTURED_REQUIRE)]
    for (const m of destructured) if (hookNames(m[1]).some((n) => !EXEMPT_HOOKS.has(n))) return true
    // A require that is not destructured hands over the whole module: which hooks it uses cannot be told.
    return [...source.matchAll(ANY_REQUIRE)].length > destructured.length
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
    // The check is about apps that use native hooks. A project without any can call WebBridge.init() however it likes.
    if (!hookFiles.length) return { ...base, state: "no-hooks" }
    // The Catalyst bridge itself, from its own module: an unrelated `WebBridge` from another package does not count.
    const bridgeImport = /import\s+[^;]*?\bWebBridge\b[^;]*?from\s*["']catalyst-core\/WebBridge["']|\bWebBridge\b\s*=\s*require\(\s*["']catalyst-core\/WebBridge["']\s*\)|import\s*\(\s*["']catalyst-core\/WebBridge["']\s*\)/
    if (!bridgeImport.test(src)) return { ...base, state: "missing-import" }
    const readyAt = src.search(/hydrationReady\s*\(/)
    if (readyAt !== -1 && initAt < readyAt) return { ...base, state: "misplaced" }
    // It must also come before hydrateRoot: after it, the first render has already run without the bridge. (A textual check, not a scope
    // analysis: it cannot tell which function an init() call sits in.)
    const hydrateAt = src.search(/hydrateRoot\s*\(/)
    if (hydrateAt !== -1 && initAt > hydrateAt) return { ...base, state: "misplaced" }
    return { ...base, state: "ok" }
}

const WEBBRIDGE_INIT_SNIPPET = `window.addEventListener("load", () => {
    hydrationReady().then(() => {
        // ...store / router / Application as before...
        WebBridge.init()   // inside the readiness callback, just before hydrateRoot
        hydrateRoot(document.getElementById("app"), Application)
    })
})
// catalyst-core 0.3.x and later. On 0.2.x the readiness callback is loadableReady(() => { ... }) from @loadable/component.`

module.exports = {
    inspectWebBridgeInit,
    usesNativeHooks,
    WEBBRIDGE_INIT_SNIPPET,
    findCatalystRoot,
    makeProjectHelpers,
    versionOlderThan,
    parseVersion,
    catalystGeneration,
    VITE_RUNTIME_VERSION,
    installedCatalystVersion,
    SINGLE_APP_ICON_MIN_VERSION,
    MIN_APP_ICON_SIZE,
    readPngInfo,
    checkSingleAppIcon,
    hasAndroidSizedIcons,
    hasIosSizedIcons,
}
