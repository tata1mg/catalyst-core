import path from "path"
import express from "express"
import bodyParser from "body-parser"
import compression from "compression"
import cookieParser from "cookie-parser"
import expressStaticGzip from "express-static-gzip"
import { createServer as createViteServer } from "vite"
import os from "node:os"
import fs from "fs"

import { toMountPathPrefix } from "../vite/resolveDevServerConfig.js"
import { validateMiddleware, safeCall } from "./utils/validator.js"
import { botDetectionMiddleware } from "./utils/botDetectionMiddleware.js"
import { cjsRequire } from "./utils/cjsRequire.js"

const { header, row, glyph, t, GUTTER, duration } = cjsRequire("../../cli/theme.js")
const { diagnostic } = cjsRequire("../../cli/diagnostic.js")
const { hintFor } = cjsRequire("../../cli/hints.js")

// Stamped at module load so "Ready in" measures the whole boot, not just the
// listen() call -- which is what the number is meant to tell you.
const serverStartedAt = Date.now()

// Invisible fences around the banner block. The wrapper strips these; if the
// server is run directly they are two blank-looking lines.
const { BANNER_START, BANNER_END, NEXT_STEP } = cjsRequire("../../cli/devOutput.js")

/** First non-internal IPv4 address, so the banner can offer a LAN URL. */
function lanAddress() {
    try {
        for (const interfaces of Object.values(os.networkInterfaces())) {
            for (const entry of interfaces || []) {
                if (entry.family === "IPv4" && !entry.internal) return entry.address
            }
        }
    } catch (error) {
        // Not worth failing a server start over.
    }
    return null
}
const { addMiddlewares } = await import(path.join(process.env.src_path, "server/server.js"))

// Mount AI route if catalyst-ai is installed
function mountAIRouter(app) {
    let aiPackagePath
    try {
        aiPackagePath = cjsRequire.resolve("catalyst-ai/route", {
            paths: [process.env.src_path || process.cwd()],
        })
    } catch (resolveErr) {
        if (resolveErr.code !== "MODULE_NOT_FOUND") {
            console.error("[catalyst-core/ai] Unexpected error resolving catalyst-ai:", resolveErr)
        } else {
            console.debug("[catalyst-core/ai] catalyst-ai not installed — AI routes unavailable")
        }
        return
    }

    try {
        const aiRouter = cjsRequire(aiPackagePath)
        let aiConfig = {}
        try {
            const parsedConfig = JSON.parse(process.env.AI_CONFIG || "{}")
            if (parsedConfig && typeof parsedConfig === "object" && !Array.isArray(parsedConfig)) {
                aiConfig = parsedConfig
            } else {
                console.warn("[catalyst-core/ai] AI_CONFIG must be a JSON object, ignoring it")
            }
        } catch (e) {
            console.warn(`[catalyst-core/ai] Invalid AI_CONFIG JSON, ignoring: ${e.message}`)
        }

        if (aiConfig.enabled === false) {
            console.log("[catalyst-core/ai] AI_CONFIG.enabled is false, skipping AI router")
            return
        }

        const aiBasePath = aiConfig.basePath || "/ai"
        app.use(aiBasePath, aiRouter)
    } catch (mountErr) {
        console.error("[catalyst-core/ai] Failed to mount AI router:", mountErr)
    }
}

// OpenTelemetry is opt-in (OTEL_ENABLE) — mirrors server/renderer/handler.jsx.
// Passthrough no-op middleware when disabled or packages aren't installed.
let responseFlushMiddleware = () => (_req, _res, next) => next()
if (process.env.OTEL_ENABLE === true) {
    try {
        const otel = await import("../otel.js")
        responseFlushMiddleware = otel.responseFlushMiddleware
    } catch {
        // otel packages not installed — continue without the flush span
    }
}

const SSR_SERVICE = process.env.SERVICE_NAME || `pwa-${process.env.APPLICATION}-node-server`

// ─── Load app-defined server lifecycle hooks ──────────────────────────────────
let onServerError
try {
    const hooks = await import(path.join(process.env.src_path, "server/index.js"))
    onServerError = hooks.onServerError
} catch {
    // No hooks file — onServerError remains undefined
}

// ─── Process-level error handlers ─────────────────────────────────────────────

function safeStringify(err) {
    try {
        return JSON.stringify(err)
    } catch (e) {
        console.log("error in safeStringify", e)
        return err
    }
}

process.on("uncaughtException", (err, origin) => {
    // A server that cannot bind its port is dead -- swallowing that left the
    // process alive but useless, so `catalyst start` hung with a blank screen.
    // Report it the way every other failure is reported, then exit.
    if (err && (err.code === "EADDRINUSE" || err.code === "EACCES")) {
        const known = hintFor(err.message)
        process.stderr.write(
            diagnostic({
                message: err.message,
                scope: "dev server",
                hint: known?.hint,
                docs: known?.docs,
            })
        )
        process.exit(1)
    }

    process.stderr.write(diagnostic({ message: `Uncaught exception (${origin}): ${err?.stack || err}` }))
})

process.on("unhandledRejection", (err) => console.log("unhandledRejection in Catalyst", safeStringify(err)))

process.on("SIGINT", function () {
    console.log("SIGINT")
    process.exit(0)
})

process.on("message", function (msg) {
    if (msg == "shutdown") {
        console.log("Closing all connections...")
        setTimeout(function () {
            console.log("Finished closing connections")
            process.exit(0)
        }, 1500)
    }
})

import { fileURLToPath } from "url"
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isProduction = process.env.NODE_ENV === "production"

function serveBuildFile(app, buildPath, urlPath, fileName, headers = {}) {
    app.get(urlPath, (_req, res, next) => {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - fileName is always a hardcoded literal passed at each serveBuildFile call site, never derived from the request.
        const filePath = path.join(buildPath, fileName)
        if (!fs.existsSync(filePath)) return next()
        res.set(headers)
        res.sendFile(filePath)
    })
}

async function createServer() {
    const port = process.env.NODE_SERVER_PORT ?? 3005
    const host = process.env.NODE_SERVER_HOSTNAME ?? "localhost"
    const app = express()

    // This middleware is being used to extract the body of the request
    app.use(bodyParser.json())

    // // This middleware has been added to accommodate "byetstream array"
    app.use(bodyParser.raw({ type: "application/*" }))

    // This middleware is being used to parse cookies!
    app.use(cookieParser())

    // All the middlewares defined by the user will run here.
    if (validateMiddleware(addMiddlewares)) addMiddlewares(app)

    mountAIRouter(app)

    // response.compress + response.flush spans straddle compression — they
    // attribute the time past the `handler` span (gzip/brotli, then egress).
    // MUST be mounted immediately before compression() so its outer res.end
    // hook reliably wraps compression's patch (no-op when OTEL off).
    app.use(responseFlushMiddleware(SSR_SERVICE, "response.flush", "response.compress"))

    // The middleware will attempt to compress response bodies for all request that traverse through the middleware
    app.use(compression())

    let vite

    if (isProduction) {
        // In production, serve built assets. Build manifests themselves are
        // loaded once at startup by ./manifestCache.js — handler reads from
        // that singleton instead of attaching them to every `req`.
        const buildPath = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build")
        const publicPath = path.join(buildPath, "client", "assets")
        const publicAssetBase = `/${(process.env.PUBLIC_STATIC_ASSET_PATH || "/assets/")
            .replace(/^\/+|\/+$/g, "")
            .replace(/\/+/g, "/")}/client/assets`

        serveBuildFile(app, buildPath, "/catalyst-offline-manifest.json", "catalyst-offline-manifest.json", {
            "cache-control": "no-store",
        })
        serveBuildFile(app, buildPath, "/catalyst-sw.js", "catalyst-sw.js", {
            "cache-control": "no-cache",
            "service-worker-allowed": "/",
        })
        serveBuildFile(app, buildPath, "/offline.html", "offline.html", {
            "cache-control": "no-cache",
        })

        // Serve static assets — prefers pre-compressed .br / .gz files generated at build time
        app.use(
            publicAssetBase,
            expressStaticGzip(publicPath, {
                enableBrotli: true,
                orderPreference: ["br", "gz"],
                serveStatic: {
                    maxAge: "1y",
                    etag: true,
                    lastModified: true,
                },
            })
        )
    } else {
        // In development, use Vite middleware
        vite = await createViteServer({
            configFile: "./dist/vite/vite.config.js",
            server: {
                middlewareMode: true,
            },
            appType: "custom",
            root: process.env.src_path,
        })

        // Expose Vite's resolved base to the SSR renderer so the URLs it injects
        // (client entry, react-refresh preamble) match the path Vite serves under.
        // Vite normalizes base with a trailing slash; trim it for clean URL joins.
        process.env.APP_MOUNT_PATH = toMountPathPrefix(vite.config.base)

        app.use(vite.middlewares)
    }

    // In production, resolve the render module once at startup so the ESM
    // loader and lazy-chunk cache are not re-entered on every request.
    let productionRender
    if (isProduction) {
        const serverPath = path.join(
            process.env.src_path,
            process.env.BUILD_OUTPUT_PATH || "build",
            "server",
            "server.js"
        )
        if (fs.existsSync(serverPath)) {
            productionRender = await import(serverPath)
        } else {
            const rendererPath = path.join(
                process.env.src_path,
                process.env.BUILD_OUTPUT_PATH || "build",
                "server",
                "index.js"
            )
            productionRender = await import(rendererPath)
        }
    }

    app.use(botDetectionMiddleware)

    app.use("*", async (req, res, next) => {
        try {
            let render

            if (isProduction) {
                render = productionRender
            } else {
                // In development, load through Vite SSR per-request to support HMR
                const rendererPath = path.join(__dirname, "./renderer/index.js")
                render = await vite.ssrLoadModule(rendererPath)
            }

            // Render your app
            if (render && render.default) {
                await render.default(req, res, next)
            } else {
                console.error("Renderer not found or invalid")
                res.status(500).send("Error loading renderer")
            }
        } catch (err) {
            console.error("SSR Error:", err)
            if (vite) {
                vite.ssrFixStacktrace(err)
            }
            res.status(500).send("Internal Server Error")
        }
    })

    app.listen({ port, host }, (error) => {
        const { APPLICATION, NODE_SERVER_HOSTNAME, NODE_SERVER_PORT } = process.env

        const isDev = process.env.NODE_ENV === "development"

        if (error) {
            const known = hintFor(error.message)
            process.stderr.write(
                diagnostic({
                    message: `Could not start the server: ${error.message}`,
                    scope: isDev ? "dev server" : "server",
                    hint: known?.hint,
                    docs: known?.docs,
                })
            )
            safeCall(onServerError)
            return
        }

        // Reached from the listen callback, so this means a port was bound --
        // it says nothing about whether anything compiled. Claiming a
        // successful compile here was an outright lie when the bundle failed.
        const elapsed = Date.now() - serverStartedAt

        // Fence the banner so the wrapper can forward it verbatim instead of
        // guessing from its text -- colour codes made pattern-matching the
        // lines unreliable, and the guesswork mis-filed the rule and the URL.
        const wrapped = process.env.CATALYST_WRAPPED === "1"
        if (wrapped) process.stdout.write(`${BANNER_START}\n`)
        process.stdout.write(header(`catalyst ${isDev ? "dev" : "serve"}`, APPLICATION))
        console.log(`${GUTTER}${t.ok(glyph.done)} Ready in ${t.bold(duration(elapsed))}\n`)

        // An app can bind to a LAN address rather than localhost, in which case
        // "Local" and "Network" would print the same URL twice. Show the bound
        // address as Local, and only offer a Network line when it differs.
        const boundHost = NODE_SERVER_HOSTNAME || "localhost"
        console.log(row("Local", t.accent(`http://${boundHost}:${NODE_SERVER_PORT}`)))

        const lan = lanAddress()
        const reachableEverywhere = boundHost === "0.0.0.0" || boundHost === "::"
        if (lan && lan !== boundHost && (reachableEverywhere || boundHost === "localhost")) {
            console.log(row("Network", t.dim(`http://${lan}:${NODE_SERVER_PORT}`)))
        }

        // The next-step line is the one thing to act on, so it is handed to the
        // wrapper fenced rather than printed here -- the wrapper prints it after
        // any notices, which would otherwise bury it.
        process.stdout.write(
            `${wrapped ? NEXT_STEP : ""}${GUTTER}${t.dim(isDev ? "Run " : "Serving the production build from ")}` +
                `${t.accent(isDev ? "catalyst build" : process.env.BUILD_OUTPUT_PATH || "build")}` +
                `${t.dim(isDev ? " for a production bundle" : "")}\n`
        )
        if (wrapped) process.stdout.write(`${BANNER_END}\n`)
    })
}

createServer()
