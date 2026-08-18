import express from "express"
import path from "path"
import { fileURLToPath } from "url"
import { getDogBreeds } from "../src/js/utils/dogApi.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function addMiddlewares(app) {
    app.use("/assets", express.static(path.join(__dirname, "../src/static/images")))

    app.get("/api/breeds/list/all", (req, res) => {
        res.send(getDogBreeds())
    })

    // /api/breed/:breed/images and /api/breeds/related/:breed are now
    // defineApi routes (server/api/index.js) — catalyst-core mounts those
    // before addMiddlewares, so they already take priority here regardless;
    // removing the old hand-written duplicates rather than leaving dead code.

    app.use("/api", (req, res) => {
        res.send({
            message: "With regards, from server",
        })
    })
}
