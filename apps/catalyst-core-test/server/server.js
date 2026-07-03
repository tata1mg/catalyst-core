import express from "express"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dogBreeds = {
    affenpinscher: [],
    beagle: [],
    boxer: [],
    bulldog: ["boston", "english", "french"],
    chihuahua: [],
    dalmatian: [],
    doberman: [],
    husky: [],
    labrador: [],
    malamute: [],
    pug: [],
    retriever: ["golden"],
}

const dogImages = [
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240' viewBox='0 0 320 240'%3E%3Crect width='320' height='240' fill='%23e8f1ff'/%3E%3Ccircle cx='160' cy='108' r='54' fill='%237a4f2a'/%3E%3Ccircle cx='137' cy='96' r='8' fill='%23000'/%3E%3Ccircle cx='183' cy='96' r='8' fill='%23000'/%3E%3Cpath d='M140 132q20 18 40 0' stroke='%23000' stroke-width='8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E",
]

export function addMiddlewares(app) {
    app.use("/assets", express.static(path.join(__dirname, "../src/static/images")))

    app.get("/api/breeds/list/all", (req, res) => {
        res.send({
            message: dogBreeds,
            status: "success",
        })
    })

    app.get("/api/breed/:breed/images", (req, res) => {
        res.send({
            message: dogImages,
            status: "success",
        })
    })

    app.use("/api", (req, res) => {
        res.send({
            message: "With regards, from server",
        })
    })
}
