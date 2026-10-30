const { exec, execFile, execSync, spawn } = require("child_process")
const dgram = require("dgram")
const fs = require("fs")
const os = require("os")
const { listeningPidFromNetstat } = require("../cli/devOutput.js")
const { isWindows } = require("../cli/platform.js")

/**
 * The address of the interface holding the default route. Windows machines carry
 * virtual adapters (Hyper-V, WSL, VPNs) whose addresses a phone cannot reach, so
 * the first one listed is often the wrong one. Connecting a UDP socket sends
 * nothing: it only makes the OS choose a route.
 */
function defaultRouteAddress() {
    return new Promise((resolve) => {
        const socket = dgram.createSocket("udp4")
        const finish = (address) => {
            socket.close()
            resolve(address)
        }
        socket.once("error", () => finish(null))
        socket.connect(53, "8.8.8.8", (error) => finish(error ? null : socket.address().address))
    })
}

function firstLanAddress() {
    for (const entries of Object.values(os.networkInterfaces())) {
        for (const entry of entries || []) {
            if (entry.family === "IPv4" && !entry.internal) return entry.address
        }
    }
    return null
}

/**
 * Get local IP address: from the routing table on Windows, using ifconfig on macOS
 */
async function getLocalIPAddress() {
    if (isWindows()) {
        return (await defaultRouteAddress()) || firstLanAddress() || "localhost"
    }
    try {
        const command = `ifconfig | grep "inet " | grep -v 127.0.0.1 | head -n 1 | awk '{print $2}'`
        // An empty answer is not an error to the pipeline: no ifconfig on a Linux
        // box without net-tools would otherwise write http://:3005 into the config.
        return execSync(command).toString().trim() || firstLanAddress() || "localhost"
    } catch (error) {
        console.warn("Could not get local IP, using localhost")
        return "localhost"
    }
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

        if (isWindows()) {
            execFile("netstat", ["-ano"], { windowsHide: true }, (error, stdout) => {
                resolve(!error && Boolean(listeningPidFromNetstat(stdout, normalizedPort)))
            })
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
 * Start server in background using npm start
 */
function startServerBackground() {
    if (isWindows()) {
        // Through a shell because npm is a .cmd here, and hidden because detached
        // would otherwise open a console window. exec() would also leave the
        // server writing to pipes that die with this process.
        // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true, javascript.lang.security.detect-child-process.detect-child-process - fixed command string with no interpolation.
        spawn("npm start", { shell: true, detached: true, stdio: "ignore", windowsHide: true }).unref()
        return
    }

    const serverProcess = exec("npm start", {
        detached: true,
        stdio: "ignore",
    })

    if (serverProcess.pid) {
        serverProcess.unref() // Allow parent to exit
    }
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
    const localIP = await getLocalIPAddress()

    // Update config with current IP
    const config = updateConfigWithLocalIP(configPath, localIP, log)

    // Get port from config
    const port = config.WEBVIEW_CONFIG?.port || 3005
    const serverURL = `http://${localIP}:${port}`

    // Check if server is running
    const running = await isServerRunning(port)

    if (!running) {
        log(`Starting server at ${serverURL}`)
        startServerBackground()
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

module.exports = { setupServer }
