const { execFile, spawn } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

/** Lower is better: the Wi-Fi/Ethernet a phone on the same network can reach. */
function interfaceRank(name) {
    if (name === "en0") return 0
    if (/^(en\d+|wlan\d+|wl\w+)$/.test(name)) return 1
    if (/^(eth\d+|enp\w+|eno\w+)$/.test(name)) return 2
    return 3
}

/**
 * This machine's LAN address: the first non-internal IPv4, preferring en0 and
 * Wi-Fi/Ethernet over VPN tunnels and VM bridges. "localhost" when there is none.
 *
 * @param {ReturnType<typeof os.networkInterfaces>} [interfaces]
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
    if (!candidates.length) {
        console.warn("Could not get local IP, using localhost")
        return "localhost"
    }
    return candidates[0].address
}

/**
 * Check if server is running on given port
 */
async function isServerRunning(port) {
    return new Promise((resolve) => {
        const normalizedPort = Number(port)
        if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
            resolve(false)
            return
        }

        execFile("lsof", ["-i", `:${normalizedPort}`], (error, stdout) => {
            if (error) {
                resolve(false)
                return
            }
            resolve(stdout.includes("LISTEN"))
        })
    })
}

/**
 * Start `npm start` detached, with its output in a log file. It has to outlive
 * this process, so it gets no pipe back to it: a pipe closes when the CLI
 * exits and the server's next log line would then fail on it.
 *
 * @returns {string} the log file
 */
function startServerBackground(port) {
    const logFile = path.join(os.tmpdir(), `catalyst-dev-server-${port || "default"}.log`)
    const out = fs.openSync(logFile, "a")
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process - Fixed command with an argv array.
    const serverProcess = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["start"], {
        detached: true,
        stdio: ["ignore", out, out],
    })
    serverProcess.on("error", () => {})
    serverProcess.unref()
    fs.closeSync(out)
    return logFile
}

/**
 * Recursively replace localhost and different IPs with current local IP
 */
function replaceIPInObject(obj, localIP, path = "") {
    let updated = false

    for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key

        if (typeof value === "string") {
            let newValue = value
            let shouldUpdate = false

            // Replace localhost with local IP
            if (value.includes("localhost")) {
                newValue = value.replace(/localhost/g, localIP)
                shouldUpdate = true
            }

            // Replace different IP addresses in URLs
            const urlPattern = /http:\/\/(\d+\.\d+\.\d+\.\d+)/g
            const matches = [...value.matchAll(urlPattern)]
            for (const match of matches) {
                if (match[1] !== localIP) {
                    newValue = newValue.replace(match[1], localIP)
                    shouldUpdate = true
                }
            }

            // Replace standalone IP addresses that are not localhost
            const ipPattern = /^(\d+\.\d+\.\d+\.\d+)$/
            const ipMatch = value.match(ipPattern)
            if (ipMatch && ipMatch[1] !== localIP) {
                newValue = localIP
                shouldUpdate = true
            }

            if (shouldUpdate && newValue !== value) {
                obj[key] = newValue
                updated = true
            }
        } else if (typeof value === "object" && value !== null) {
            // Recursively process nested objects
            const nestedUpdated = replaceIPInObject(value, localIP, currentPath)
            updated = updated || nestedUpdated
        }
    }

    return updated
}

/**
 * Update config.json with current local IP address
 */
function updateConfigWithLocalIP(configPath, localIP, log = () => {}) {
    try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"))

        // Recursively update all IP addresses in the config
        const updated = replaceIPInObject(config, localIP)

        // Write back if updated
        if (updated) {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8")
            log(`Updated config addresses to ${localIP}`)
        }

        return config
    } catch (error) {
        console.error("Error updating config:", error.message)
        throw error
    }
}

/**
 * Main function: Setup server with IP validation and background startup
 * @param {string} configPath - Path to config.json file
 * @returns {Promise<{serverURL: string, localIP: string, port: number}>}
 */
/**
 * @param {string} configPath
 * @param {(message: string, type?: string) => void} [log] - progress sink.
 *   Defaults to silence: this runs inside a progress sequence, where a stray
 *   console.log lands at column 0 and collides with the live spinner row.
 */
async function setupServer(configPath, log = () => {}) {
    // Get local IP
    const localIP = getLocalIPAddress()

    // Update config with current IP
    const config = updateConfigWithLocalIP(configPath, localIP, log)

    // Get port from config
    const port = config.WEBVIEW_CONFIG?.port || 3005
    const serverURL = `http://${localIP}:${port}`

    // Check if server is running
    const running = await isServerRunning(port)

    if (!running) {
        const logFile = startServerBackground(port)
        log(`Starting server at ${serverURL} (output in ${logFile})`)
        // Give it a moment to start
        await new Promise((resolve) => setTimeout(resolve, 3000))
    } else {
        log(`Server already running at ${serverURL}`)
    }

    return {
        serverURL,
        localIP,
        port,
    }
}

/**
 * Whether a build should make sure the dev server is up: debug builds of a
 * configured platform with a configured port. Release builds load a remote
 * host and never need it.
 */
function shouldEnsureDevServer(platform, webviewConfig, { release = false } = {}) {
    const platformConfig = webviewConfig?.[platform]
    if (release || !platformConfig || !webviewConfig.port) return false
    return String(platformConfig.buildType || "debug").toLowerCase() !== "release"
}

/**
 * For buildApp in debug: run setupServer (LAN address into the config, server
 * started in the background) only when nothing is listening on the port yet.
 *
 * @returns {Promise<{ started: boolean, port: number }>}
 */
async function ensureDevServer(configPath, log = () => {}) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    const port = config.WEBVIEW_CONFIG?.port || 3005
    if (await isServerRunning(port)) {
        log(`Dev server already running on port ${port}`)
        return { started: false, port }
    }
    const result = await setupServer(configPath, log)
    return { started: true, ...result }
}

module.exports = {
    setupServer,
    ensureDevServer,
    shouldEnsureDevServer,
    getLocalIPAddress,
    isServerRunning,
    startServerBackground,
}
