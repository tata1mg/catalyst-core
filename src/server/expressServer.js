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

// This middleware is being used to extract the body of the request
app.use(bodyParser.json({ limit: "100kb" }))

// This middleware has been added to accommodate “byetstream array”
app.use(bodyParser.raw({ type: "application/*", limit: "100kb" }))

// This middleware is being used to parse cookies!
app.use(cookieParser())

// All the middlewares defined by the user will run here.
if (validateMiddleware(addMiddlewares)) addMiddlewares(app)

// The middleware will attempt to compress response bodies for all request that traverse through the middleware
app.use(compression())

// This endpoint will serve the built assets from the node server. The requests will be made to PUBLIC_STATIC_ASSET_PATH which has been defined in the application config.
// expressStaticGzip will compress the assets.
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

// This middleware handles document requests.
app.use("*", ReactRenderer)

export default app
