import fs from "fs"
import os from "os"
import path from "path"
import { nativeError } from "./utils.js"

// ---------------------------------------------------------------------------
// The one resolver between config/config.json and a native build.
//
// Apps write the new shape (WEBVIEW_CONFIG.url, appId, appName,
// allowPrivateHost) or the shipped legacy one (LOCAL_IP, port, useHttps,
// android.packageName, ios.appBundleId / bundleIdentifier, per-platform
// appName). The resolver turns either into the legacy shape the Android and
// iOS shells already read, and drops the new keys, so the generic Swift and
// properties emitters never see `url`, `appId`, `appName` or
// `allowPrivateHost`. Nothing here writes config.json.
// ---------------------------------------------------------------------------

/** Keys of the new shape that never reach the native emitters. */
const RESOLVER_ONLY_KEYS = ["url", "appId", "appName", "allowPrivateHost"]

/** The ids the templates ship with: a release must never go out under one. */
const TEMPLATE_APP_IDS = ["io.yourname.androidproject", "com.catalyst.framework.app", "com.debug.webview"]

/** What each shell falls back to when no id is configured. */
const DEFAULT_APP_IDS = { android: "io.yourname.androidproject", ios: "com.catalyst.framework.app" }

const DEFAULT_DEV_PORT = 3005

// The build number is the whole minutes since this instant: always rising,
// no state to keep, and far below Google Play's 2100000000 ceiling.
const BUILD_NUMBER_EPOCH_MS = Date.UTC(2024, 0, 1, 0, 0, 0)
const MAX_BUILD_NUMBER = 2100000000

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

/** True for an app id a store build must not ship with. */
function isPlaceholderAppId(appId) {
    const id = String(appId || "")
        .trim()
        .toLowerCase()
    return !id || id.startsWith("com.example.") || TEMPLATE_APP_IDS.includes(id)
}

/**
 * Parse `WEBVIEW_CONFIG.url` (or `--url`): an origin with an http or https
 * scheme. The port defaults from the scheme; HTTPS on a port other than 443
 * is refused, because the iOS shell always loads HTTPS on 443.
 *
 * @param {string} value
 * @param {object} [options]
 * @param {string} [options.source] - where the value came from, for the error
 * @returns {{ scheme: "http" | "https", host: string, port: number, origin: string }}
 */
function parseAppUrl(value, { source = "WEBVIEW_CONFIG.url" } = {}) {
    const text = String(value ?? "").trim()
    const fail = (why) => nativeError("NATIVE-004", `${source} "${text}" ${why}`)
    if (!text) throw fail("is empty")
    let parsed
    try {
        parsed = new URL(text)
    } catch (error) {
        throw fail("is not a URL (expected e.g. https://shop.acme.com)")
    }
    const scheme = parsed.protocol.replace(/:$/, "")
    if (scheme !== "http" && scheme !== "https") throw fail("must start with https:// or http://")
    if (parsed.username || parsed.password) throw fail("must not contain a user name or password")
    if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
        throw fail("must be an origin only, without a path, query or fragment")
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, "")
    if (!host) throw fail("has no host")
    const port = parsed.port ? Number(parsed.port) : scheme === "https" ? 443 : 80
    if (scheme === "https" && port !== 443) throw fail("uses HTTPS on a port other than 443")
    const hostPart = host.includes(":") ? `[${host}]` : host
    const defaultPort = scheme === "https" ? 443 : 80
    return { scheme, host, port, origin: `${scheme}://${hostPart}${port === defaultPort ? "" : `:${port}`}` }
}

/**
 * The URL the app opens on launch, built the way each shell builds it from
 * the legacy keys: Android uses the configured port, iOS forces 443 under
 * HTTPS. With no LOCAL_IP, an Android release falls back to 127.0.0.1 and
 * iOS to localhost.
 */
function computeStartUrl(platform, wv = {}, { release = false } = {}) {
    const protocol = wv.useHttps ? "https" : "http"
    const fallbackHost = platform === "android" && release ? "127.0.0.1" : "localhost"
    const host = String(wv.LOCAL_IP || fallbackHost)
    let port
    if (platform === "ios") port = wv.port ? (wv.useHttps ? 443 : wv.port) : null
    else port = wv.port || 3005
    const initial = platform === "android" ? String(wv.initial_url || "") : ""
    const hostPart = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
    return { protocol, host, port, url: `${protocol}://${hostPart}${port ? `:${port}` : ""}/${initial}` }
}

function ipv4ToInt(ip) {
    return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0)
}

const PRIVATE_V4_RANGES = [
    ["0.0.0.0", 8, "not a routable address"],
    ["127.0.0.0", 8, "this machine's loopback address"],
    ["10.0.0.0", 8, "a private LAN address"],
    ["172.16.0.0", 12, "a private LAN address"],
    ["192.168.0.0", 16, "a private LAN address"],
    ["169.254.0.0", 16, "a link-local address"],
]

/**
 * True for an RFC 1918 or link-local IPv4 literal: an address a LAN could
 * hand this machine. Not 0.0.0.0/8 (a bind-all address) or 127.0.0.0/8.
 */
function isPrivateIPv4(host) {
    const text = String(host || "").trim()
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return false
    if (text.split(".").some((part) => Number(part) > 255)) return false
    const value = ipv4ToInt(text)
    return PRIVATE_V4_RANGES.some(([start, bits]) => {
        if (start === "0.0.0.0" || start === "127.0.0.0") return false
        const from = ipv4ToInt(start)
        return value >= from && value < from + 2 ** (32 - bits)
    })
}

/** This machine's own addresses and hostname: what a dev setup writes into LOCAL_IP. */
function localMachineHosts() {
    const hosts = new Set()
    try {
        for (const entries of Object.values(os.networkInterfaces())) {
            for (const entry of entries || []) hosts.add(entry.address.toLowerCase())
        }
    } catch (error) {
        // No interfaces to compare against.
    }
    try {
        hosts.add(os.hostname().toLowerCase())
    } catch (error) {
        // Hostname unavailable.
    }
    return hosts
}

// Reserved for documentation and testing (RFC 2606 / RFC 6761): never a
// production host.
const PLACEHOLDER_SUFFIXES = [".example", ".invalid", ".test"]
const PLACEHOLDER_DOMAINS = ["example.com", "example.org", "example.net"]

/**
 * Why a host can't serve a store build, or null when it can. Covers
 * localhost, loopback, RFC 1918, link-local, mDNS (.local) names, this
 * machine's own current addresses, and reserved placeholder domains. The
 * reason reads after "<host> is", e.g. "192.168.1.5 is a private LAN
 * address"; describePrivateHost puts the two together.
 *
 * @param {string} rawHost
 * @param {object} [options]
 * @param {Set<string>} [options.localHosts] - this machine's addresses; detected when omitted
 * @returns {string | null}
 */
function privateHostReason(rawHost, { localHosts = localMachineHosts() } = {}) {
    const host = String(rawHost || "")
        .trim()
        .toLowerCase()
        .replace(/^\[|\]$/g, "")
        .replace(/\.$/, "")
    if (!host) return "empty"
    if (host === "localhost" || host.endsWith(".localhost")) return "this machine"
    if (host.endsWith(".local")) return "a .local name that only the local network resolves"
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        const value = ipv4ToInt(host)
        for (const [start, bits, reason] of PRIVATE_V4_RANGES) {
            const from = ipv4ToInt(start)
            if (value >= from && value < from + 2 ** (32 - bits)) return reason
        }
    } else if (host.includes(":")) {
        if (host === "::") return "not a routable address"
        if (host === "::1") return "this machine's loopback address"
        if (/^fe[89ab]/.test(host)) return "a link-local address"
        if (/^f[cd]/.test(host)) return "a private LAN address"
        const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host)
        if (mapped) return privateHostReason(mapped[1], { localHosts })
    } else if (
        PLACEHOLDER_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
        PLACEHOLDER_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
    ) {
        return "a placeholder domain reserved for examples"
    }
    if (localHosts.has(host)) return "this machine's own address"
    return null
}

/** "localhost is this machine": a host and its privateHostReason, for messages. */
function describePrivateHost(host, reason) {
    const text = String(host || "").trim()
    return text ? `${text} is ${reason}` : "the host is empty"
}

/**
 * Fail a release whose start URL users' devices could never reach.
 * `WEBVIEW_CONFIG.allowPrivateHost: true` downgrades the failure to a
 * warning for internal apps. Plain HTTP is only ever a warning.
 *
 * @param {"android"|"ios"} platform
 * @param {object} wv - the resolved (legacy-shape) WEBVIEW_CONFIG
 * @param {object} [options]
 * @param {boolean} [options.allowPrivateHost]
 * @param {(message: string, type?: string) => void} [options.log]
 * @param {Set<string>} [options.localHosts]
 * @returns {{ protocol: string, host: string, port: number | null, url: string }}
 */
function assertReleaseHost(platform, wv, { allowPrivateHost = false, log = () => {}, localHosts } = {}) {
    const start = computeStartUrl(platform, wv, { release: true })
    const reason = privateHostReason(start.host, { localHosts })
    if (reason) {
        if (!allowPrivateHost) {
            throw nativeError("NATIVE-001", `${start.url} (${describePrivateHost(start.host, reason)})`)
        }
        log(
            `Release start URL ${start.url}: ${describePrivateHost(start.host, reason)}. Allowed by WEBVIEW_CONFIG.allowPrivateHost`,
            "warning"
        )
    }
    if (!wv.useHttps) {
        log(
            `Release start URL ${start.url} uses plain HTTP. Use an https:// url for store builds.`,
            "warning"
        )
    }
    return start
}

/**
 * The build number for this build: whole minutes since 2024-01-01T00:00:00Z,
 * or `CATALYST_BUILD_NUMBER` when set (for an app that already uploaded a
 * larger number, or a CI that wants its own).
 *
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {number} [options.now] - ms since the Unix epoch
 * @returns {{ buildNumber: number, buildNumberSource: "CATALYST_BUILD_NUMBER" | "clock" }}
 */
function computeBuildNumber({ env = process.env, now = Date.now() } = {}) {
    const override = env.CATALYST_BUILD_NUMBER
    if (override !== undefined && String(override).trim() !== "") {
        const text = String(override).trim()
        const number = Number(text)
        if (!/^\d+$/.test(text) || number < 1 || number > MAX_BUILD_NUMBER) {
            throw nativeError("NATIVE-002", `CATALYST_BUILD_NUMBER is "${text}"`)
        }
        return { buildNumber: number, buildNumberSource: "CATALYST_BUILD_NUMBER" }
    }
    return {
        buildNumber: Math.max(1, Math.floor((now - BUILD_NUMBER_EPOCH_MS) / 60000)),
        buildNumberSource: "clock",
    }
}

/**
 * The version an app set in the shipped `WEBVIEW_CONFIG.ios.version`
 * object ({ major, minor, patch?, buildNumber? }), read the way earlier
 * releases read it. Null when the object is absent.
 *
 * @param {unknown} value - WEBVIEW_CONFIG.ios.version
 * @returns {{ versionName: string, buildNumber: number | null } | null}
 */
function legacyPlatformVersion(value) {
    if (!isPlainObject(value)) return null
    const versionName = `${value.major || 1}.${value.minor || 0}.${value.patch || 0}`
    const text = String(value.buildNumber ?? "").trim()
    const number = Number(text)
    const buildNumber = /^\d+$/.test(text) && number >= 1 && number <= MAX_BUILD_NUMBER ? number : null
    return { versionName, buildNumber }
}

/**
 * The marketing version (package.json `version`) and the build number.
 * `CATALYST_BUILD_NUMBER` wins over everything. A `legacy` version (the
 * shipped ios.version object) wins over package.json and the clock, so an
 * app already in the store never ships a lower version or build number.
 *
 * @param {object} [options]
 * @param {string} [options.cwd] - the app root
 * @param {Record<string, string | undefined>} [options.env]
 * @param {number} [options.now]
 * @param {{ versionName: string, buildNumber: number | null } | null} [options.legacy] - legacyPlatformVersion()
 * @returns {{ versionName: string | undefined, buildNumber: number, buildNumberSource: string }}
 */
function resolveAppVersion({ cwd = process.cwd(), env = process.env, now, legacy = null } = {}) {
    let versionName
    try {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - cwd is the local app directory; the file name is fixed.
        const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"))
        if (typeof pkg.version === "string" && pkg.version.trim()) versionName = pkg.version.trim()
    } catch (error) {
        // No package.json version: the native project's default applies.
    }
    const build = computeBuildNumber({ env, now })
    if (!legacy) return { versionName, ...build }
    const keepLegacyBuild = build.buildNumberSource !== "CATALYST_BUILD_NUMBER" && legacy.buildNumber
    return {
        versionName: legacy.versionName,
        ...(keepLegacyBuild ? { buildNumber: legacy.buildNumber, buildNumberSource: "ios.version" } : build),
    }
}

/**
 * The app id: `appId`, then the platform keys as shipped (Android
 * `packageName`; iOS `bundleIdentifier`, then `appBundleId`, the order
 * Shared.xcconfig's PRODUCT_BUNDLE_IDENTIFIER has always used). Null when
 * none is set.
 */
function configuredAppId(platform, wv) {
    if (typeof wv.appId === "string" && wv.appId.trim()) return wv.appId.trim()
    const block = isPlainObject(wv[platform]) ? wv[platform] : {}
    const candidates =
        platform === "android" ? [block.packageName] : [block.bundleIdentifier, block.appBundleId]
    const legacy = candidates.find((value) => typeof value === "string" && value.trim())
    return legacy ? legacy.trim() : null
}

// Java keywords and literals: none can be a segment of an Android package name.
const JAVA_RESERVED = new Set(
    (
        "abstract assert boolean break byte case catch char class const continue default do double else " +
        "enum extends final finally float for goto if implements import instanceof int interface long " +
        "native new package private protected public return short static strictfp super switch " +
        "synchronized this throw throws transient try void volatile while true false null"
    ).split(" ")
)

/**
 * Why an app id is not a valid id for the platform, or null when it is.
 * Android (a Java package name): two or more dot-separated segments, each
 * starting with a letter, then letters, digits or underscores, and no Java
 * keyword. iOS (Apple's bundle id rule): two or more segments of letters,
 * digits and hyphens.
 *
 * @param {"android"|"ios"} platform
 * @param {string} appId
 * @returns {string | null}
 */
function appIdProblem(platform, appId) {
    const segments = String(appId).split(".")
    if (segments.length < 2) return "needs at least two dot-separated parts, like com.acme.shop"
    for (const segment of segments) {
        if (!segment) return "has an empty part"
        if (platform === "android") {
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(segment)) {
                return `part "${segment}" must start with a letter and use only letters, digits and _`
            }
            if (JAVA_RESERVED.has(segment)) return `part "${segment}" is a Java keyword`
        } else if (!/^[A-Za-z0-9-]+$/.test(segment)) {
            return `part "${segment}" may use only letters, digits and -`
        }
    }
    return null
}

/** Point a localhost URL (or one on the production origin) at the dev server. */
function remapToDevOrigin(value, { devOrigin, devHost, productionOrigin }) {
    if (typeof value !== "string" || !value) return value
    let parsed
    try {
        parsed = new URL(value)
    } catch (error) {
        return value
    }
    if (productionOrigin && parsed.origin === productionOrigin) {
        return devOrigin + value.slice(productionOrigin.length)
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, "")
    if ((host === "localhost" || host === "127.0.0.1" || host === "::1") && devHost !== "localhost") {
        parsed.hostname = devHost
        const text = parsed.toString()
        // URL adds a trailing slash to a bare origin; keep the user's form.
        return value.endsWith("/") || !text.endsWith("/") ? text : text.slice(0, -1)
    }
    return value
}

/** allowedUrls with the dev server's origin added, in the form the shells read. */
function withDevOrigin(allowedUrls, devOrigin) {
    const extra = [devOrigin, `${devOrigin}/*`]
    if (Array.isArray(allowedUrls)) return [...allowedUrls, ...extra.filter((u) => !allowedUrls.includes(u))]
    if (typeof allowedUrls === "string") {
        const list = allowedUrls
            .split(",")
            .map((u) => u.trim())
            .filter(Boolean)
        return [...list, ...extra.filter((u) => !list.includes(u))].join(",")
    }
    return allowedUrls
}

/**
 * Resolve config.json into what a native build uses.
 *
 * Release (`release: true`, or the deprecated `<platform>.buildType:
 * "release"`): the start URL comes from `url` (the `--url` flag), then
 * `WEBVIEW_CONFIG.url`, then the legacy LOCAL_IP/port/useHttps. It must be a
 * public host (NATIVE-001 unless `allowPrivateHost: true`), and the app id
 * must not be a placeholder (NATIVE-003).
 *
 * Debug: the app loads the dev server at `http://<devHost>:<port>`. `url` is
 * ignored. The dev origin is added to `accessControl.allowedUrls`, and a
 * localhost or production `apiBaseUrl` is pointed at it. A legacy config
 * whose LOCAL_IP is a public host (and no `url`) keeps loading that host,
 * with a warning, and `usesDevServer` is false.
 *
 * The result is in memory; `configPath` is a 0600 temp copy for tools that
 * read a path (Gradle's -PconfigPath). Call `cleanup()` when done.
 *
 * @param {"android"|"ios"} platform
 * @param {object} [options]
 * @param {boolean} [options.release] - `--release`
 * @param {string} [options.url] - `--url`, overrides WEBVIEW_CONFIG.url for a release
 * @param {string} [options.devHost] - debug: the host the app reaches the dev server on ("localhost" for emulators, simulators and adb-reversed phones; `<mac>.local` or the LAN IP for a physical iPhone)
 * @param {object} [options.config] - the parsed config.json; read from configPath when omitted
 * @param {string} [options.configPath] - defaults to <cwd>/config/config.json
 * @param {string} [options.cwd] - the app root, for config.json and package.json
 * @param {Record<string, string | undefined>} [options.env]
 * @param {number} [options.now] - for the build number
 * @param {Set<string>} [options.localHosts] - this machine's addresses, for the host guard
 * @param {(message: string, type?: string) => void} [options.log]
 */
function resolveNativeConfig(
    platform,
    {
        release: releaseFlag = false,
        url: urlFlag,
        devHost = "localhost",
        config,
        configPath,
        cwd = process.cwd(),
        env = process.env,
        now,
        localHosts,
        log = () => {},
    } = {}
) {
    if (platform !== "android" && platform !== "ios") throw new Error(`Unknown platform "${platform}"`)
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - cwd is the local app directory; the file name is fixed.
    const sourcePath = configPath || path.join(cwd, "config", "config.json")
    const raw = config || JSON.parse(fs.readFileSync(sourcePath, "utf8"))
    const base = isPlainObject(raw.WEBVIEW_CONFIG) ? raw.WEBVIEW_CONFIG : {}

    const platformBlock = isPlainObject(base[platform]) ? base[platform] : {}
    const configuredRelease = String(platformBlock.buildType || "").toLowerCase() === "release"
    if (configuredRelease && !releaseFlag) {
        log(
            `WEBVIEW_CONFIG.${platform}.buildType "release" is deprecated. ` +
                `Run catalyst buildApp:${platform} --release instead, and set buildType back to debug or remove it.`,
            "warning"
        )
    }
    const release = Boolean(releaseFlag || configuredRelease)
    const allowPrivateHost = base.allowPrivateHost === true

    // The new keys go; the legacy shape is rebuilt from them below.
    const WEBVIEW_CONFIG = Object.fromEntries(
        Object.entries(base).filter(([key]) => !RESOLVER_ONLY_KEYS.includes(key) && key !== "release")
    )
    for (const name of ["android", "ios"]) {
        WEBVIEW_CONFIG[name] = { ...(isPlainObject(base[name]) ? base[name] : {}) }
    }
    const block = WEBVIEW_CONFIG[platform]
    block.buildType = release ? "release" : "debug"

    // App id and name. Every reader of the platform keys (Gradle, the
    // xcconfig, simctl) gets the one resolved id, so the debug and release
    // ids can't drift apart.
    const explicitAppId = configuredAppId(platform, base)
    const appId = explicitAppId || DEFAULT_APP_IDS[platform]
    if (explicitAppId) {
        const problem = appIdProblem(platform, explicitAppId)
        if (problem) throw nativeError("NATIVE-010", `"${explicitAppId}" ${problem}`)
    }
    if (typeof base.appId === "string" && base.appId.trim()) {
        WEBVIEW_CONFIG.android.packageName = appId
        WEBVIEW_CONFIG.ios.appBundleId = appId
        WEBVIEW_CONFIG.ios.bundleIdentifier = appId
    } else if (platform === "ios" && explicitAppId) {
        WEBVIEW_CONFIG.ios.appBundleId = explicitAppId
        WEBVIEW_CONFIG.ios.bundleIdentifier = explicitAppId
    }
    const appName = (typeof base.appName === "string" && base.appName.trim()) || block.appName || undefined
    if (typeof base.appName === "string" && base.appName.trim()) {
        WEBVIEW_CONFIG.android.appName = base.appName.trim()
        WEBVIEW_CONFIG.ios.appName = base.appName.trim()
    }

    let startUrl
    let usesDevServer = false
    let devOrigin = null

    if (release) {
        const fromFlag = urlFlag !== undefined && urlFlag !== null
        const urlValue = fromFlag ? urlFlag : base.url
        if (urlValue !== undefined && urlValue !== null && urlValue !== "") {
            const origin = parseAppUrl(urlValue, { source: fromFlag ? "--url" : "WEBVIEW_CONFIG.url" })
            WEBVIEW_CONFIG.LOCAL_IP = origin.host
            WEBVIEW_CONFIG.port = String(origin.port)
            WEBVIEW_CONFIG.useHttps = origin.scheme === "https"
        } else if (!base.LOCAL_IP) {
            log(
                "No production URL: set WEBVIEW_CONFIG.url (e.g. https://shop.acme.com) or pass --url.",
                "warning"
            )
        }
        startUrl = assertReleaseHost(platform, WEBVIEW_CONFIG, { allowPrivateHost, log, localHosts }).url
        if (isPlaceholderAppId(appId)) {
            throw nativeError(
                "NATIVE-003",
                explicitAppId ? `"${appId}"` : `none is set, so the template's "${appId}" would ship`
            )
        }
    } else {
        const legacyPublicHost =
            !base.url && base.LOCAL_IP && !privateHostReason(base.LOCAL_IP, { localHosts: new Set() })
        if (legacyPublicHost) {
            log(
                `Debug build loads ${base.LOCAL_IP} from WEBVIEW_CONFIG.LOCAL_IP. ` +
                    "Move your production host to WEBVIEW_CONFIG.url so debug builds use the dev server.",
                "warning"
            )
            startUrl = computeStartUrl(platform, WEBVIEW_CONFIG).url
        } else {
            usesDevServer = true
            const port = Number(raw.NODE_SERVER_PORT || base.port || DEFAULT_DEV_PORT)
            const hostPart = devHost.includes(":") ? `[${devHost}]` : devHost
            devOrigin = `http://${hostPart}:${port}`
            WEBVIEW_CONFIG.LOCAL_IP = devHost
            WEBVIEW_CONFIG.port = String(port)
            WEBVIEW_CONFIG.useHttps = false
            startUrl = `${devOrigin}/`

            let productionOrigin = null
            try {
                productionOrigin = base.url ? parseAppUrl(base.url).origin : null
            } catch (error) {
                // A bad url only matters for a release.
            }
            if (isPlainObject(base.accessControl) && base.accessControl.allowedUrls !== undefined) {
                WEBVIEW_CONFIG.accessControl = {
                    ...base.accessControl,
                    allowedUrls: withDevOrigin(base.accessControl.allowedUrls, devOrigin),
                }
            }
            if (typeof base.apiBaseUrl === "string") {
                WEBVIEW_CONFIG.apiBaseUrl = remapToDevOrigin(base.apiBaseUrl, {
                    devOrigin,
                    devHost,
                    productionOrigin,
                })
            }
        }
    }

    // The shipped ios.version object still decides the iOS version, so an
    // app already in the App Store never ships a lower one.
    const legacyVersion = platform === "ios" ? legacyPlatformVersion(platformBlock.version) : null
    if (legacyVersion) {
        log(
            "WEBVIEW_CONFIG.ios.version is deprecated: set the version in package.json and, for a " +
                "build number above the automatic one, CATALYST_BUILD_NUMBER. Then remove ios.version.",
            "warning"
        )
    }
    const version = resolveAppVersion({ cwd, env, now, legacy: legacyVersion })

    const resolved = { ...raw, WEBVIEW_CONFIG }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `catalyst-${platform}-config-`))
    const resolvedPath = path.join(dir, "config.json")
    fs.writeFileSync(resolvedPath, JSON.stringify(resolved, null, 2), { mode: 0o600 })

    return {
        config: resolved,
        WEBVIEW_CONFIG,
        release,
        appId,
        appName,
        startUrl,
        usesDevServer,
        devOrigin,
        allowPrivateHost,
        version,
        configPath: resolvedPath,
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    }
}

export {
    RESOLVER_ONLY_KEYS,
    MAX_BUILD_NUMBER,
    BUILD_NUMBER_EPOCH_MS,
    isPlaceholderAppId,
    appIdProblem,
    isPrivateIPv4,
    localMachineHosts,
    legacyPlatformVersion,
    parseAppUrl,
    computeStartUrl,
    privateHostReason,
    describePrivateHost,
    assertReleaseHost,
    computeBuildNumber,
    resolveAppVersion,
    resolveNativeConfig,
}
