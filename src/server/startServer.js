/**
 * startServer.js
 *
 * Entry point for the Catalyst Node.js server process. Handles:
 *   1. Process-level error and signal handlers
 *   2. Port availability check before binding
 *   3. Hot-reload in development:
 *        - Watches loadable-stats.json (rebuilt by webpack on every client-side change)
 *          to know when a new bundle is ready, then clears the require cache so the
 *          next request picks up the latest server bundle.
 *        - Watches the app's /server directory and fully restarts the Express server
 *          whenever server-side source files change.
 *   4. Safe server restart logic that prevents EADDRINUSE by nulling the instance
 *      reference before closing, ensuring concurrent watcher events don't each
 *      queue an independent startServer() callback on the same closing socket.
 */

import fs from "fs"
import net from "net"
import path from "path"
import util from "node:util"
import chokidar from "chokidar"
import { cyan, yellow, green } from "picocolors"

import { preServerInit, onServerError } from "@catalyst/template/server/index.js"
import { safeCall } from "@catalyst/server/utils/validator.js"

const env = process.env.NODE_ENV || "development"

// Run any app-defined pre-start hook (e.g. seed config, connect to DB)
safeCall(preServerInit)

// ─── Process-level error handlers ────────────────────────────────────────────

process.on("uncaughtException", (err, origin) => {
    console.log(process.stderr.fd)
    console.log(`Caught exception: ${err}\n` + `Exception origin: ${origin}`)
})

process.on("uncaughtExceptionMonitor", (err, origin) => {
    console.log(err, origin)
})

process.on("unhandledRejection", (err) => console.log("unhandledRejection in Catalyst", safeStringify(err)))

// Graceful shutdown on Ctrl-C
process.on("SIGINT", function (data) {
    console.log("SIGINT")
    console.log(data)
    process.exit(0)
})

// Parent process can send "shutdown" to trigger a clean exit (used by cluster managers)
process.on("message", function (msg) {
    if (msg == "shutdown") {
        console.log("Closing all connections...")
        setTimeout(function () {
            console.log("Finished closing connections")
            process.exit(0)
        }, 1500)
    }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeStringify(err) {
    try {
        return JSON.stringify(err)
    } catch (e) {
        console.log("error in safeStringify", e)
        return err
    }
}

// ─── Configuration ────────────────────────────────────────────────────────────

const port = process.env.NODE_SERVER_PORT ?? 3005
const host = process.env.NODE_SERVER_HOSTNAME ?? "localhost"

// loadable-stats.json is emitted by webpack (@loadable/webpack-plugin) after every
// successful client-side build. Its presence signals that at least one build has
// completed and the server can safely start serving SSR responses.
let statsPath = path.join(__dirname, "../../", `loadable-stats.json`)

if (env === "production") {
    statsPath = path.join(process.env.src_path, `${process.env.BUILD_OUTPUT_PATH}/public/loadable-stats.json`)
}

// Watcher on loadable-stats.json — used to detect completed webpack rebuilds
const watcher = chokidar.watch(statsPath, { persistent: true })

// Holds the active http.Server instance. Kept at module scope so restartServer()
// can close the old instance before creating a new one.
let serverInstance = null

// ─── Cache management ─────────────────────────────────────────────────────────

/**
 * Purges all app and framework modules from Node's require cache.
 * Called after every webpack rebuild so that the next require("./expressServer")
 * loads the freshly compiled server bundle instead of the stale cached version.
 * node_modules are intentionally left in cache to avoid re-evaluating them on
 * every hot reload.
 */
const clearServerCache = (filePath = "") => {
    const projectPath = process.env.src_path
    Object.keys(require.cache).forEach((key) => {
        if (key.startsWith(projectPath) || key.includes("catalyst-core") || key.includes(filePath)) {
            delete require.cache[key]
        }
    })
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

/**
 * Safely restarts the Express server.
 *
 * Nulls out `serverInstance` before calling close() so that any watcher events
 * that fire concurrently (e.g. an editor writing multiple files on save) hit the
 * `!serverInstance` guard and schedule a single startServer() — rather than each
 * queuing their own close() callback that would all call startServer() once the
 * socket finally closes, causing EADDRINUSE on the second and later attempts.
 */
const restartServer = () => {
    if (!serverInstance) {
        startServer()
        return
    }
    const closing = serverInstance
    serverInstance = null
    closing.close(() => startServer())
}

/**
 * Requires and starts the Express server.
 * expressServer.js is re-required on every call so that, combined with
 * clearServerCache(), hot-reloaded changes are always picked up.
 */
const startServer = () => {
    const server = require("./expressServer.js").default

    serverInstance = server.listen({ port, host }, (error) => {
        const { APPLICATION, NODE_SERVER_HOSTNAME, NODE_SERVER_PORT } = process.env

        if (error) {
            console.log("An error occured while starting the Application server : ", error)
            safeCall(onServerError)
            return
        }

        if (env === "development") console.log(green("Compiled successfully!"))

        console.log(`\nYou can now view ${APPLICATION} in the browser.\n`)
        console.log(
            util.format("\tLocal:".padEnd(8), cyan(`http://${NODE_SERVER_HOSTNAME}:${NODE_SERVER_PORT}`))
        )

        if (env === "development") {
            console.log("\nNote that the development build is not optimized.")
            console.log("To create a production build, use " + cyan("npm run build"))
        }

        console.log("\nFind out more about deployment here:")
        console.log(
            yellow(
                "\n https://catalyst.1mg.com/public_docs/content/Deployment%20and%20Production/deployment\n"
            )
        )
    })
}

// ─── Port check ───────────────────────────────────────────────────────────────

/**
 * Verifies the target port is free before we attempt to bind.
 * Probing with a temporary server gives a clear, actionable error message
 * instead of a cryptic EADDRINUSE from Express.
 */
const checkPortAvailability = (port, host) => {
    return new Promise((resolve, reject) => {
        const tester = net
            .createServer()
            .once("error", (err) => {
                tester.close(() => {
                    if (err.code === "EADDRINUSE") {
                        reject(
                            new Error(
                                `Port ${port} is already in use on ${host}. Please free the port or set a different NODE_SERVER_PORT.`
                            )
                        )
                    } else {
                        reject(err)
                    }
                })
            })
            .once("listening", () => {
                tester.close(() => resolve())
            })
            .listen(port, host)
    })
}

// ─── Startup ──────────────────────────────────────────────────────────────────

checkPortAvailability(port, host)
    .then(() => {
        if (process.env.NODE_ENV === "development") {
            if (fs.existsSync(statsPath)) {
                // loadable-stats.json already exists (e.g. dev server restarted mid-session):
                // start immediately and clear the module cache on every subsequent webpack rebuild
                // so SSR always uses the latest client chunks.
                watcher.on("change", () => {
                    clearServerCache()
                })
                startServer()
            } else {
                // First boot — webpack hasn't finished the initial build yet.
                // Wait for loadable-stats.json to be created before starting the server,
                // otherwise @loadable/server would fail trying to read chunk metadata.
                watcher.on("add", () => {
                    startServer()
                })
            }

            // Watch the app's /server directory for source changes.
            // Any modification, addition, or deletion of a server-side file triggers
            // a full server restart so the new code is loaded via a fresh require().
            const serverPath = path.join(process.env.src_path, "server")

            const serverWatcher = chokidar.watch(serverPath, {
                persistent: true,
                ignoreInitial: true, // Don't trigger on initial scan
                ignored: /node_modules/,
            })

            serverWatcher.on("change", (filePath) => {
                clearServerCache(filePath)
                restartServer()
            })
            serverWatcher.on("add", () => restartServer())
            serverWatcher.on("unlink", () => restartServer())
        } else {
            startServer()
        }
    })
    .catch((err) => {
        console.error(`\n[Catalyst] Server startup failed: ${err.message}\n`)
        process.exit(1)
    })
