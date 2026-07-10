import express from "express"
import path from "path"

export function addMiddlewares(app) {
    app.use("/favicon.ico", express.static(path.join(__dirname, "../public/favicon.ico")))
}
