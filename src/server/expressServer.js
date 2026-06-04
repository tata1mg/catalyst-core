import path from "path"
import express from "express"
import bodyParser from "body-parser"
import compression from "compression"
import cookieParser from "cookie-parser"
import expressStaticGzip from "express-static-gzip"

import ReactRenderer from "@catalyst/server/renderer"
import { addMiddlewares } from "@catalyst/template/server/server.js"
import { validateMiddleware } from "@catalyst/server/utils/validator"
import { responseFlushMiddleware } from "../otel"

const env = process.env.NODE_ENV || "development"

// Same service name as the renderer's tracing (handler.js), so the
// response-flush span groups under the same service.
const SSR_SERVICE = process.env.SERVICE_NAME || `pwa-${process.env.APPLICATION}-node-server-otel`

const app = express()

app.use(bodyParser.json({ limit: "100kb" }))

// Handles "bytestream array" content types sent as raw application/* bodies
app.use(bodyParser.raw({ type: "application/*", limit: "100kb" }))

app.use(cookieParser())

// Span that ends on the response 'finish'/'close' event — captures the body
// flush/egress time that lives past the `handler` span (no-op when the OTEL
// SDK isn't started).
app.use(responseFlushMiddleware(SSR_SERVICE, "response.send"))

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
