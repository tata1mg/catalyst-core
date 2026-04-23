const express = require("express")
const path = require("path")

// Server middlewares are added here.

export function addMiddlewares(app) {
    app.use("/favicon.ico", express.static(path.join(__dirname, "../public/favicon.ico")))
}
