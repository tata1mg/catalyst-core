import express from "express"

const router = express.Router()

if (process.env.NODE_ENV === "production") {
    const handler = require("./handler")

    router.use(handler)
} else {
    const developmentHandler =
        require("../../../.catalyst-dev/server/renderer/handler.development.js").default

    router.use(developmentHandler)
}

export default router
