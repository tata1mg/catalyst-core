import express from "express"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function addMiddlewares(app) {
    app.use("/assets", express.static(path.join(__dirname, "../src/static/images")))

    // /api/breeds/list/all and /api/breed/:breed/images are now defined once in
    // server/api/index.js via defineApi() and served through the API registry
    // (mounted before addMiddlewares runs, so they take priority over this catch-all).

    app.use("/api", (req, res) => {
        res.send({
            message: "With regards, from server",
        })
    })
}
