import path from "path"
import express from "express"
import bodyParser from "body-parser"
import compression from "compression"
import cookieParser from "cookie-parser"
import expressStaticGzip from "express-static-gzip"
import { createServer as createViteServer } from "vite"
import util from "node:util"
import os from "node:os"
import pc from "picocolors"
import qrcode from "qrcode-terminal"
import fs from "fs"
const { cyan, yellow, green } = pc

import { toMountPathPrefix } from "../vite/resolveDevServerConfig.js"
import { validateMiddleware, safeCall } from "./utils/validator.js"
import { botDetectionMiddleware } from "./utils/botDetectionMiddleware.js"
import { cjsRequire } from "./utils/cjsRequire.js"
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
        console.log(`[catalyst-core/ai] mounting AI router at ${aiBasePath}`)
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

// ─── LAN address resolution for the Catalyst Companion QR code ────────────────

// A host is usable for the QR only if a phone on the same network can reach it,
// so loopback and link-local (169.254.*) addresses are rejected.
function isExternalIPv4(address) {
    if (!address) return false
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return false
    if (address.startsWith("127.") || address.startsWith("169.254.")) return false
    return true
}

// Returns the LAN IPv4 to encode in the QR, or null when the machine has none.
// Prefers an explicitly configured non-loopback hostname over interface scanning.
export function resolveLanAddress(hostname, interfaces = os.networkInterfaces()) {
    if (isExternalIPv4(hostname)) return hostname

    for (const details of Object.values(interfaces)) {
        for (const net of details ?? []) {
            const family = typeof net.family === "string" ? net.family : `IPv${net.family}`
            if (family !== "IPv4" || net.internal) continue
            if (isExternalIPv4(net.address)) return net.address
        }
    }

    return null
}

// TTY-only by default so CI logs are not spammed with ASCII blocks.
// CATALYST_QR=1 forces the QR on, CATALYST_QR=0 suppresses it even on a TTY.
function shouldPrintQr(env = process.env, isTTY = process.stdout.isTTY) {
    if (env.CATALYST_QR === "0") return false
    if (env.CATALYST_QR === "1") return true
    return Boolean(isTTY)
}

const PREVIEW_CONFIG_SCHEMA = 1

function readWebviewConfig(srcPath = process.env.src_path) {
    try {
        const configPath = path.join(srcPath, "config", "config.json")
        const { WEBVIEW_CONFIG } = JSON.parse(fs.readFileSync(configPath, "utf8"))
        return WEBVIEW_CONFIG ?? {}
    } catch {
        return {}
    }
}

export function buildPreviewConfig(webviewConfig = {}) {
    const config = { ...webviewConfig }
    delete config.android
    delete config.ios
    return { schema: PREVIEW_CONFIG_SCHEMA, config }
}

function servePreviewConfig(app) {
    app.get("/__catalyst/preview-config", (_req, res) => {
        res.set("Cache-Control", "no-store")
        res.json(buildPreviewConfig(readWebviewConfig()))
    })
}

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

    if (!isProduction) servePreviewConfig(app)

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

        // Print a scannable LAN URL so a phone running the Catalyst Companion
        // app can reach this server. Silently skipped when there is no LAN.
        const lanAddress = resolveLanAddress(NODE_SERVER_HOSTNAME)
        if (lanAddress) {
            const lanUrl = `http://${lanAddress}:${NODE_SERVER_PORT}`

            if (lanAddress !== NODE_SERVER_HOSTNAME) {
                console.log(util.format("\tNetwork:".padEnd(8), cyan(lanUrl)))
            }

            if (shouldPrintQr()) {
                console.log("\nScan with Catalyst Companion to preview on your phone:")
                qrcode.generate(lanUrl, { small: true }, (code) => console.log(code))
            }
        }

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
