import express from "express"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Server middlewares are added here.

export function addMiddlewares(app) {
    app.use("/favicon.ico", express.static(path.join(__dirname, "../public/favicon.ico")))
}
