import loadEnvironmentVariables from "../scripts/loadEnvironmentVariables.js"
loadEnvironmentVariables()
import path from "path"
import express from "express"
import bodyParser from "body-parser"
import compression from "compression"
import cookieParser from "cookie-parser"
import { createServer as createViteServer } from "vite"
import util from "node:util"
import pc from "picocolors"
import fs from "fs"
const { cyan, yellow, green } = pc

import { validateMiddleware } from "./utils/validator.js"
const { addMiddlewares } = await import(path.join(process.env.src_path, "server/server.js"))

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

    // The middleware will attempt to compress response bodies for all request that traverse through the middleware
    app.use(compression())

    let vite
    let manifest
    let ssrManifest
    let assetManifest

    if (isProduction) {
        // In production, serve built assets
        const buildPath = path.join(process.env.src_path, "build")
        const publicPath = path.join(buildPath, "public")

        // Serve static assets
        app.use(
            process.env.PUBLIC_STATIC_ASSET_PATH || "/assets",
            express.static(publicPath, {
                maxAge: "1y",
                etag: true,
                lastModified: true,
            })
        )

        // Load build manifests
        try {
            const manifestPath = path.join(buildPath, ".vite", "manifest.json")
            const ssrManifestPath = path.join(buildPath, ".vite", "ssr-manifest.json")
            const assetManifestPath = path.join(buildPath, ".vite", "asset-categories.json")

            if (fs.existsSync(manifestPath)) {
                manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
            }

            if (fs.existsSync(ssrManifestPath)) {
                ssrManifest = JSON.parse(fs.readFileSync(ssrManifestPath, "utf-8"))
            }
            if (fs.existsSync(assetManifestPath)) {
                assetManifest = JSON.parse(fs.readFileSync(assetManifestPath, "utf-8"))
            }
        } catch (error) {
            console.warn("Could not load build manifests:", error.message)
        }
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

    app.use(async (req, res) => {
        try {
            let render

            if (isProduction) {
                // In production, load the built server module
                const serverPath = path.join(process.env.src_path, "build", "server", "server.js")
                if (fs.existsSync(serverPath)) {
                    render = await import(serverPath)
                } else {
                    // Fallback to renderer if server.js doesn't exist
                    const rendererPath = path.join(process.env.src_path, "build", "server", "index.js")
                    render = await import(rendererPath)
                }
            } else {
                // In development, load through Vite SSR
                const rendererPath = path.join(__dirname, "./renderer/index.js")
                render = await vite.ssrLoadModule(rendererPath)
            }

            // Render your app
            if (render && render.default) {
                // Pass manifests to renderer in production
                if (isProduction) {
                    req.manifest = manifest
                    req.ssrManifest = ssrManifest
                    req.assetManifest = assetManifest
                }
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

        if (error) console.log("An error occured while starting the Application server : ", error)

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
