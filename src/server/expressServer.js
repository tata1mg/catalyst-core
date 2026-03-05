import path from "path"
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
