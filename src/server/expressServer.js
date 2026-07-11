import path from "path"
import express from "express"
import bodyParser from "body-parser"
import compression from "compression"
import cookieParser from "cookie-parser"
import expressStaticGzip from "express-static-gzip"
import { createServer as createViteServer } from "vite"
import util from "node:util"
import pc from "picocolors"
import fs from "fs"
const { cyan, yellow, green } = pc

import { validateMiddleware, safeCall } from "./utils/validator.js"
import { botDetectionMiddleware } from "./utils/botDetectionMiddleware.js"
const { addMiddlewares } = await import(path.join(process.env.src_path, "server/server.js"))

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
    console.log(process.stderr.fd)
    console.log(`Caught exception: ${err}\n` + `Exception origin: ${origin}`)
})

process.on("uncaughtExceptionMonitor", (err, origin) => {
    console.log(err, origin)
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

    // response.compress + response.flush spans straddle compression — they
    // attribute the time past the `handler` span (gzip/brotli, then egress).
    // MUST be mounted immediately before compression() so its outer res.end
    // hook reliably wraps compression's patch (no-op when OTEL off).
    app.use(responseFlushMiddleware(SSR_SERVICE, "response.flush", "response.compress"))

    // The middleware will attempt to compress response bodies for all request that traverse through the middleware
    app.use(
        compression({
            level: 6, // Balance between speed and compression (1-9)
            threshold: 1024, // Only compress responses > 1KB
            filter: (req, res) => {
                // Don't compress if client doesn't accept it
                if (req.headers["x-no-compression"]) {
                    return false
                }
                // Use default filter (checks Accept-Encoding)
                return compression.filter(req, res)
            },
        })
    )

    let vite

    if (isProduction) {
        // In production, serve built assets. Build manifests themselves are
        // loaded once at startup by ./manifestCache.js — handler reads from
        // that singleton instead of attaching them to every `req`.
        const buildPath = path.join(process.env.src_path, process.env.BUILD_OUTPUT_PATH || "build")
        // vite.config.client.js emits every chunk/asset under "client/assets/"
        // (relative to outDir) — e.g. build/client/assets/foo.js. The mount
        // prefix below is "client/assets", so publicPath must point at that
        // same "assets" subfolder, or every request 404s one directory short.
        const publicPath = path.join(buildPath, "client", "assets")
        // Serve static assets — prefers pre-compressed .br / .gz files generated at build time.
        // Leading slash is required: Express (path-to-regexp) treats a mount path
        // without one as never matching, so this silently fell through to the SSR
        // catch-all for every asset request.
        app.use(
            "/client/assets",
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

    app.use("*", async (req, res) => {
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
                await render.default(req, res)
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

        if (error) {
            console.log("An error occured while starting the Application server : ", error)
            safeCall(onServerError)
            return
        }

        if (process.env.NODE_ENV === "development") console.log(green("Compiled successfully!"))

        console.log(`\nYou can now view ${APPLICATION} in the browser.\n`)
        console.log(
            util.format("\tLocal:".padEnd(8), cyan(`http://${NODE_SERVER_HOSTNAME}:${NODE_SERVER_PORT}`))
        )

        if (process.env.NODE_ENV === "development") {
            console.log("\nNote that the development build is not optimized.")
            console.log("To create a production build, use " + cyan("npm run build"))
        } else {
            console.log(
                green(`\nProduction server running in ${isProduction ? "production" : "development"} mode`)
            )
        }

        console.log("\nFind out more about deployment here:")
        console.log(yellow("\n https://catalyst.1mg.com/public_docs/content/deployment\n"))
    })
}

createServer()
