import express from "express"
import path from "path"
import { fileURLToPath } from "url"
import { getDogBreeds, getDogImages } from "../src/js/utils/dogApi.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function addMiddlewares(app) {
    app.use("/assets", express.static(path.join(__dirname, "../src/static/images")))

    app.get("/api/breeds/list/all", (req, res) => {
        res.send(getDogBreeds())
    })

    app.get("/api/breed/:breed/images", (req, res) => {
        res.send(getDogImages())
    })

    app.use("/api", (req, res) => {
        res.send({
            message: "With regards, from server",
        })
    })
}
