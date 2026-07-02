import express from "express"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function addMiddlewares(app) {
    app.use("/assets", express.static(path.join(__dirname, "../src/static/images")))

    app.use("/api", (req, res) => {
        res.send({
            message: "With regards, from server",
        })
    })
}
