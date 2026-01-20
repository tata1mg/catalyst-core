const express = require("express")
const path = require("path")
const { handlePromptRequest } = require("./api/prompt")
const { handleDialogueRequest } = require("./api/dialogue")

export function addMiddlewares(app) {
    // Middleware for parsing JSON
    app.use(express.json({ limit: '10mb' }))
    app.use(express.urlencoded({ extended: true }))

    // Static assets
    app.use("/assets", express.static(path.join(__dirname, "../src/static/images")))

    // CORS middleware for API routes
    app.use("/api", (req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*')
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')
        
        if (req.method === 'OPTIONS') {
            res.sendStatus(200)
        } else {
            next()
        }
    })

    // API routes
    app.use("/api/prompt", handlePromptRequest)
    app.use("/api/dialogue", handleDialogueRequest)

    // Default API route
    app.use("/api", (req, res) => {
        res.send({
            message: "AI SDK Server API",
            version: "1.0.0",
            endpoints: [
                "POST /api/prompt - Generate or stream text from prompts",
                "POST /api/dialogue - Generate or stream dialogue responses"
            ]
        })
    })
}
