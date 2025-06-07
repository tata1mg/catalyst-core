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
const { cyan, yellow, green } = pc

import { validateMiddleware } from "./utils/validator.js"
const { addMiddlewares } = await import(path.join(process.env.src_path, "server/server.js"))

import { fileURLToPath } from "url"
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

    // This endpoint will serve the built assets from the node server. The requests will be made to PUBLIC_STATIC_ASSET_PATH which has been defined in the application config.
    // expressStaticGzip will compress the assets.
    // if (process.env.NODE_ENV === "production") {
    //     app.use(
    //         process.env.PUBLIC_STATIC_ASSET_PATH,
    //         expressStaticGzip(path.join(process.env.src_path, `build/public`), {
    //             enableBrotli: true,
    //             orderPreference: ["br", "gzip", "deflate"],
    //         })
    //     )
    // } else {
    //     app.use(
    //         process.env.PUBLIC_STATIC_ASSET_PATH,
    //         express.static(path.join(process.env.src_path, `build/public`))
    //     )
    // }

    const vite = await createViteServer({
        configFile: "./dist/server/vite.config.js",
        server: {
            middlewareMode: true,
        },
        appType: "custom",
        root: process.env.src_path,
    })
    app.use(vite.middlewares) // May need to match the base config

    app.use(async (req, res) => {
        // Load your server entry point through Vite
        const rendererPath = path.join(__dirname, "./renderer/index.js")
        try {
            const render = await vite.ssrLoadModule(rendererPath)
            // Render your app
            if (render && render.default) {
                await render.default(req, res)
            } else {
                res.status(500).send("Error loading renderer")
            }
        } catch (err) {
            console.log(err)
            // vite.ssrFixStacktrace(err)
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
        }

        console.log("\nFind out more about deployment here:")
        console.log(yellow("\n https://catalyst.1mg.com/public_docs/content/deployment\n"))
    })
}

createServer()
