import path from "path"
import fs from "fs"
import express from "express"
import bodyParser from "body-parser"
import compression from "compression"
import cookieParser from "cookie-parser"
import expressStaticGzip from "express-static-gzip"

import ReactRenderer from "@catalyst/server/renderer"
import { addMiddlewares } from "@catalyst/template/server/server.js"
import { validateMiddleware } from "@catalyst/server/utils/validator"

const env = process.env.NODE_ENV || "development"

const app = express()

const sendBuiltPublicFile = (res, fileName, headers = {}) => {
    const publicFilePath = path.join(
        process.env.src_path,
        `./${process.env.BUILD_OUTPUT_PATH}/public`,
        fileName
    )

    if (!fs.existsSync(publicFilePath)) {
        res.status(404).end()
        return
    }

    res.set(headers)
    res.sendFile(publicFilePath)
}

app.get("/catalyst-sw.js", (_req, res) => {
    sendBuiltPublicFile(res, "catalyst-sw.js", {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Service-Worker-Allowed": "/",
    })
})

app.get("/catalyst-offline-manifest.json", (_req, res) => {
    sendBuiltPublicFile(res, "catalyst-offline-manifest.json", {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
    })
})

app.get("/offline.html", (_req, res) => {
    sendBuiltPublicFile(res, "offline.html", {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
    })
})

// This middleware is being used to extract the body of the request
app.use(bodyParser.json({ limit: "100kb" }))

// Handles "bytestream array" content types sent as raw application/* bodies
app.use(bodyParser.raw({ type: "application/*", limit: "100kb" }))

app.use(cookieParser())

if (validateMiddleware(addMiddlewares)) addMiddlewares(app)

app.use(compression())

// Serve pre-compressed static assets (brotli preferred) from the build output directory
if (env === "production") {
    app.use(
        process.env.PUBLIC_STATIC_ASSET_PATH,
        expressStaticGzip(path.join(process.env.src_path, `./${process.env.BUILD_OUTPUT_PATH}/public`), {
            enableBrotli: true,
            orderPreference: ["br", "gzip", "deflate"],
        })
    )
} else {
    app.use(
        process.env.PUBLIC_STATIC_ASSET_PATH,
        express.static(path.join(process.env.src_path, `./${process.env.BUILD_OUTPUT_PATH}/public`))
    )
}

// Catch-all: every non-asset request is handled by the SSR renderer
app.use("*", ReactRenderer)

export default app
