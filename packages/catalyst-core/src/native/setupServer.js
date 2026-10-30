import { execFileSync, spawn } from "child_process"
import fs from "fs"
import http from "http"
import net from "net"
import os from "os"
import path from "path"
import { nativeError } from "./utils.js"
import { isPrivateIPv4, localMachineHosts } from "./nativeConfig.js"
import { readLocalState, writeLocalState } from "./localState.js"

// The dev server for debug native builds. The CLI never rewrites
// config.json to reach it: Android emulators and USB phones get
// `adb reverse` on the ports below, the iOS simulator uses localhost, and a
// physical iPhone gets the Mac's Bonjour name (or LAN IP) injected into the
// build only. The server is always started through `catalyst start` with
// KEY=value overrides.

const DEFAULT_PORT = 3005
// Vite's HMR websocket port when buildConfig.devServer.hmr sets none.
const DEFAULT_HMR_PORT = 24678

/** Lower is better: the Wi-Fi/Ethernet a phone on the same network can reach. */
function interfaceRank(name) {
    if (name === "en0") return 0
    if (/^(en\d+|wlan\d+|wl\w+)$/.test(name)) return 1
    if (/^(eth\d+|enp\w+|eno\w+)$/.test(name)) return 2
    return 3
}

/**
 * This machine's LAN address: the first non-internal IPv4, preferring en0 and
 * Wi-Fi/Ethernet over VPN tunnels and VM bridges. Null when there is none.
 *
 * @param {ReturnType<typeof os.networkInterfaces>} [interfaces]
 * @returns {string | null}
 */
function getLocalIPAddress(interfaces = os.networkInterfaces()) {
    const candidates = []
    for (const [name, entries] of Object.entries(interfaces || {})) {
        for (const entry of entries || []) {
            // `family` is the number 4 on Node 18.0-18.3.
            const v4 = entry.family === "IPv4" || entry.family === 4
            if (v4 && !entry.internal) candidates.push({ name, address: entry.address })
        }
    }
    candidates.sort((a, b) => interfaceRank(a.name) - interfaceRank(b.name))
    return candidates.length ? candidates[0].address : null
}

/**
 * The host a physical device on the same network reaches this Mac on:
 * `<LocalHostName>.local` (Bonjour, survives DHCP changes), else the LAN IP.
 * Null when neither is available.
 *
 * @param {object} [options]
 * @param {() => string} [options.localHostName] - returns `scutil --get LocalHostName`
 * @param {ReturnType<typeof os.networkInterfaces>} [options.interfaces]
 * @returns {{ host: string, source: "bonjour" | "lan" } | null}
 */
function getDeviceReachableHost({ localHostName = readLocalHostName, interfaces } = {}) {
    let name = ""
    try {
        name = String(localHostName() || "").trim()
    } catch (error) {
        // Not macOS, or scutil failed: fall back to the LAN IP.
    }
    if (/^[A-Za-z0-9-]+$/.test(name)) return { host: `${name}.local`, source: "bonjour" }
    const ip = getLocalIPAddress(interfaces)
    return ip ? { host: ip, source: "lan" } : null
}

function readLocalHostName() {
    if (process.platform !== "darwin") return ""
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - fixed argv.
    return execFileSync("scutil", ["--get", "LocalHostName"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
    })
}

/**
 * Vite's HMR port for the app: buildConfig.js `devServer.hmr.port`, else
 * 24678. Best effort: an unreadable buildConfig gives the default.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @returns {Promise<number>}
 */
async function readHmrPort({ cwd = process.cwd() } = {}) {
    for (const name of ["buildConfig.js", "webpackConfig.js"]) {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - fixed file names in the app root.
        const file = path.join(cwd, name)
        if (!fs.existsSync(file)) continue
        try {
            // A plain path, not a file:// URL: the published copy is compiled
            // to CommonJS, where import() becomes require(), which loads the
            // app's ESM buildConfig.js by path (Node 22.12+) but not by URL.
            const mod = await import(file)
            const port = Number((mod.default || mod)?.devServer?.hmr?.port)
            return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_HMR_PORT
        } catch (error) {
            return DEFAULT_HMR_PORT
        }
    }
    return DEFAULT_HMR_PORT
}

/** Every `localhost:<port>` / `127.0.0.1:<port>` in the config's string values. */
function localhostPortsIn(value, found = new Set()) {
    if (typeof value === "string") {
        for (const match of value.matchAll(/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})\b/gi)) {
            const port = Number(match[1])
            if (port > 0 && port < 65536) found.add(port)
        }
    } else if (value && typeof value === "object") {
        for (const child of Object.values(value)) localhostPortsIn(child, found)
    }
    return found
}

/**
 * The ports an Android device needs reversed to reach the dev machine:
 * NODE_SERVER_PORT, the HMR port, and every localhost:<port> in config.json
 * (API_URL and the like). Sorted, no duplicates.
 *
 * @param {object} config - the parsed config.json
 * @param {object} [options]
 * @param {number} [options.hmrPort] - from readHmrPort(); 24678 when omitted
 * @returns {number[]}
 */
function devServerPorts(config = {}, { hmrPort = DEFAULT_HMR_PORT } = {}) {
    const ports = localhostPortsIn(config)
    ports.add(Number(config.NODE_SERVER_PORT || config.WEBVIEW_CONFIG?.port || DEFAULT_PORT))
    if (hmrPort) ports.add(Number(hmrPort))
    return [...ports].filter((port) => Number.isInteger(port) && port > 0).sort((a, b) => a - b)
}

/**
 * Whether an HTTP server answers at host:port. Any status counts: a 500 from
 * a broken page still means the server is up.
 *
 * @param {{ host?: string, port: number, timeoutMs?: number }} target
 * @returns {Promise<boolean>}
 */
function isServerAnswering({ host = "localhost", port, timeoutMs = 2000 }) {
    return new Promise((resolve) => {
        const request = http.get({ host, port, path: "/", timeout: timeoutMs }, (response) => {
            response.resume()
            resolve(true)
        })
        request.on("timeout", () => {
            request.destroy()
            resolve(false)
        })
        request.on("error", () => resolve(false))
    })
}

/** The bin script of this catalyst-core, for `catalyst start`. */
function catalystBin() {
    // dist/native/setupServer.js (and src/native in a checkout) -> bin/catalyst.js
    // eslint-disable-next-line no-undef
    const here = typeof __dirname !== "undefined" ? __dirname : process.cwd()
    return path.resolve(here, "..", "..", "bin", "catalyst.js")
}

/**
 * Start `catalyst start KEY=value ...` detached, output in a log file. It has
 * to outlive this process, so it gets no pipe back to it.
 *
 * @returns {{ child: import("child_process").ChildProcess, logFile: string }}
 */
function startDevServerProcess({ cwd, port, overrides = {} }) {
    const logFile = path.join(os.tmpdir(), `catalyst-dev-server-${port || "default"}.log`)
    const out = fs.openSync(logFile, "a")
    const args = [
        catalystBin(),
        "start",
        ...Object.entries(overrides).map(([key, value]) => `${key}=${value}`),
    ]
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - fixed command with an argv array.
    const child = spawn(process.execPath, args, {
        cwd,
        detached: true,
        stdio: ["ignore", out, out],
        // `catalyst start` reads the app from PWD, not cwd.
        env: { ...process.env, PWD: cwd },
    })
    child.on("error", () => {})
    child.unref()
    fs.closeSync(out)
    return { child, logFile }
}

const isLoopback = (host) => ["localhost", "127.0.0.1", "::1"].includes(String(host).toLowerCase())

/** Whether a process with this pid exists (EPERM: it does, owned by someone else). */
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return error.code === "EPERM"
    }
}

/**
 * The dev server this CLI started on `port` and that is still running, from
 * .catalyst/local.json: { host, port, pid }. Null for a server the user
 * started, or when the recorded process is gone.
 */
function startedDevServer({ cwd, port, isAlive }) {
    const record = readLocalState({ cwd }).devServer
    if (!record || typeof record !== "object" || Number(record.port) !== port) return null
    if (!Number.isInteger(record.pid) || record.pid <= 0 || !isAlive(record.pid)) return null
    return record
}

/**
 * Make sure the dev server answers, starting it when it does not.
 *
 * `host` is the host the app will load the server on: "localhost" for
 * emulators, simulators and adb-reversed phones; `<mac>.local` or the LAN IP
 * for a physical iPhone. For a non-loopback host the server is started bound
 * to all interfaces with PUBLIC_STATIC_ASSET_URL on that host, and a server
 * already running on localhost only is an error (NATIVE-006) rather than a
 * silent blank screen. A server this CLI started is recorded in
 * .catalyst/local.json with the host it was started for; reusing it for a
 * different host (an iPhone after the simulator, or back) is NATIVE-006 too,
 * because its asset URL and bind address are for the other target.
 *
 * @param {object} options
 * @param {string} [options.host] - default "localhost"
 * @param {string} [options.cwd] - the app root
 * @param {object} [options.config] - the parsed config.json; read from cwd when omitted
 * @param {Record<string, string | number>} [options.overrides] - extra KEY=value for `catalyst start`
 * @param {number} [options.timeoutMs] - default 120000
 * @param {number} [options.intervalMs] - default 500
 * @param {(message: string, type?: string) => void} [options.log]
 * @param {typeof isServerAnswering} [options.probe] - for tests
 * @param {typeof startDevServerProcess} [options.start] - for tests
 * @param {(pid: number) => boolean} [options.isAlive] - for tests
 * @returns {Promise<{ started: boolean, url: string, port: number, logFile?: string }>}
 */
async function ensureDevServer({
    host = "localhost",
    cwd = process.cwd(),
    config,
    overrides = {},
    timeoutMs = 120000,
    intervalMs = 500,
    log = () => {},
    probe = isServerAnswering,
    start = startDevServerProcess,
    isAlive = isProcessAlive,
} = {}) {
    const appConfig =
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - cwd is the app root; the file name is fixed.
        config || JSON.parse(fs.readFileSync(path.join(cwd, "config", "config.json"), "utf8"))
    const port = Number(appConfig.NODE_SERVER_PORT || appConfig.WEBVIEW_CONFIG?.port || DEFAULT_PORT)
    const loopback = isLoopback(host)
    const hostPart = String(host).includes(":") ? `[${host}]` : host
    const url = `http://${hostPart}:${port}`
    const answers = () => probe({ host: loopback ? "localhost" : host, port })
    const hostKey = loopback ? "localhost" : String(host).toLowerCase()

    if (await answers()) {
        const ours = startedDevServer({ cwd, port, isAlive })
        if (ours && ours.host !== hostKey) {
            throw nativeError(
                "NATIVE-006",
                `the dev server on port ${port} was started for ${ours.host}, and this build needs ${url}`,
                {
                    hint: `Stop that dev server (kill ${ours.pid}) and run the build again, so Catalyst starts one for ${hostKey}.`,
                }
            )
        }
        log(`Dev server already running at ${url}`, "info")
        return { started: false, url, port }
    }
    if (!loopback && (await probe({ host: "localhost", port }))) {
        throw nativeError(
            "NATIVE-006",
            `a dev server is running on port ${port} but only for this machine, so ${url} does not answer`,
            {
                hint: "Stop the running dev server (Ctrl+C in its terminal) and run the build again, so Catalyst starts one the phone can reach.",
            }
        )
    }

    const startOverrides = {
        ...(loopback ? {} : { NODE_SERVER_HOSTNAME: "0.0.0.0", PUBLIC_STATIC_ASSET_URL: url }),
        // Vite 6 answers 403 to a Host header that is not localhost or an IP
        // (server.allowedHosts), so a `<mac>.local` name has to be allowed.
        ...(loopback || net.isIP(host) ? {} : { CATALYST_DEV_ALLOWED_HOSTS: host }),
        ...overrides,
    }
    const { child, logFile } = start({ cwd, port, overrides: startOverrides })
    log(`Starting the dev server at ${url} (output in ${logFile})`, "info")
    if (Number.isInteger(child?.pid)) {
        writeLocalState({ devServer: { host: hostKey, port, pid: child.pid } }, { cwd })
    }

    let exited = null
    child?.on?.("exit", (code) => {
        exited = code ?? "signal"
    })
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (await answers()) return { started: true, url, port, logFile }
        if (exited !== null) {
            throw nativeError(
                "NATIVE-006",
                `catalyst start exited (${exited}) before ${url} answered; output in ${logFile}`
            )
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    throw nativeError(
        "NATIVE-006",
        `${url} did not answer within ${Math.round(timeoutMs / 1000)}s; output in ${logFile}`
    )
}

// ---------------------------------------------------------------------------
// One-time migration: older setups wrote this machine's LAN address into
// config.json (every "localhost", and any http://<ip>), which makes Express
// bind only that address and breaks adb reverse. Put localhost back, but only
// for this machine's own addresses: a container IP, 0.0.0.0 or a loopback
// address is the app's own setting.
// ---------------------------------------------------------------------------

const MIGRATION_KEY = "lanAddresses"

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

const isCI = (env) => {
    const value = env.CI
    return value !== undefined && value !== "" && value !== "0" && String(value).toLowerCase() !== "false"
}

/**
 * The changes the migration would make, without writing anything. Only a
 * value equal to one of this machine's current IPv4 addresses, or to the
 * private address in WEBVIEW_CONFIG.LOCAL_IP (what an earlier setup wrote
 * there, even after DHCP moved the machine), or an http:// URL on one of
 * those hosts, goes back to localhost. WEBVIEW_CONFIG.url is never touched,
 * and nothing is when WEBVIEW_CONFIG.allowPrivateHost is true.
 *
 * @param {object} config - the parsed config.json (not modified)
 * @param {object} [options]
 * @param {Set<string>} [options.localHosts] - this machine's addresses; detected when omitted
 * @returns {{ config: object, changes: { path: string, from: string, to: string }[] }}
 */
function planLanAddressMigration(config, { localHosts = localMachineHosts() } = {}) {
    const changes = []
    const wv = config?.WEBVIEW_CONFIG
    // An app that opts into private hosts means its addresses.
    if (wv?.allowPrivateHost === true) return { config, changes }
    // This machine's IPv4 addresses, without loopback and 0.0.0.0/8.
    const saved = new Set([...localHosts].filter((host) => IPV4.test(host) && !/^(?:127|0)\./.test(host)))
    const localIp = typeof wv?.LOCAL_IP === "string" ? wv.LOCAL_IP.trim() : ""
    if (isPrivateIPv4(localIp)) saved.add(localIp)
    if (!saved.size) return { config, changes }

    const restore = (value) => {
        if (saved.has(value.trim())) return "localhost"
        return value.replace(/http:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?=[:/?#]|$)/g, (match, ip) =>
            saved.has(ip) ? "http://localhost" : match
        )
    }
    const walk = (value, at) => {
        // WEBVIEW_CONFIG.url is new: no earlier setup ever wrote it.
        if (at === "WEBVIEW_CONFIG.url") return value
        if (typeof value === "string") {
            const next = restore(value)
            if (next !== value) changes.push({ path: at, from: value, to: next })
            return next
        }
        if (Array.isArray(value)) return value.map((item, index) => walk(item, `${at}[${index}]`))
        if (value && typeof value === "object") {
            return Object.fromEntries(
                Object.entries(value).map(([key, child]) => [key, walk(child, at ? `${at}.${key}` : key)])
            )
        }
        return value
    }
    return { config: walk(config, ""), changes }
}

/**
 * Run the LAN-address migration once per checkout (recorded in
 * .catalyst/local.json). Rewrites config/config.json only when something
 * changes, keeps its indentation, and logs each change. Never throws: a
 * failure is logged as a warning and the build goes on. It never runs for a
 * release (`--release` or the deprecated buildType "release") or in CI: a
 * store build or a CI checkout must not rewrite the config it was given.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {string} [options.configPath] - defaults to <cwd>/config/config.json
 * @param {boolean} [options.force] - run even when already recorded
 * @param {boolean} [options.release] - `--release`
 * @param {"android"|"ios"} [options.platform] - whose buildType to check
 * @param {Record<string, string | undefined>} [options.env]
 * @param {Set<string>} [options.localHosts] - this machine's addresses; detected when omitted
 * @param {(message: string, type?: string) => void} [options.log]
 * @returns {{ ran: boolean, changes: { path: string, from: string, to: string }[] }}
 */
function migrateLanAddresses({
    cwd = process.cwd(),
    configPath,
    force = false,
    release = false,
    platform,
    env = process.env,
    localHosts,
    log = () => {},
} = {}) {
    const skipped = { ran: false, changes: [] }
    if (release || isCI(env)) return skipped
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - cwd is the app root; the file name is fixed.
    const file = configPath || path.join(cwd, "config", "config.json")
    if (!force && readLocalState({ cwd }).migrations?.[MIGRATION_KEY]) return skipped
    try {
        const text = fs.readFileSync(file, "utf8")
        const parsed = JSON.parse(text)
        const buildType = platform ? parsed?.WEBVIEW_CONFIG?.[platform]?.buildType : undefined
        if (String(buildType || "").toLowerCase() === "release") return skipped
        const { config, changes } = planLanAddressMigration(parsed, localHosts ? { localHosts } : undefined)
        if (changes.length) {
            const indent = /^[ \t]+(?=")/m.exec(text)?.[0] || "    "
            fs.writeFileSync(file, JSON.stringify(config, null, indent) + (text.endsWith("\n") ? "\n" : ""))
            log(
                `Put localhost back in config/config.json where an earlier setup saved this machine's LAN address:`,
                "info"
            )
            for (const change of changes) log(`  ${change.path}: ${change.from} -> ${change.to}`, "info")
        }
        const state = readLocalState({ cwd })
        writeLocalState(
            { migrations: { ...(state.migrations || {}), [MIGRATION_KEY]: new Date().toISOString() } },
            { cwd }
        )
        return { ran: true, changes }
    } catch (error) {
        log(`Could not check config/config.json for saved LAN addresses: ${error.message}`, "warning")
        return skipped
    }
}

export {
    DEFAULT_HMR_PORT,
    getLocalIPAddress,
    getDeviceReachableHost,
    readHmrPort,
    devServerPorts,
    isServerAnswering,
    startDevServerProcess,
    ensureDevServer,
    planLanAddressMigration,
    migrateLanAddresses,
}
