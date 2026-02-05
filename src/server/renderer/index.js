import express from "express"

const router = express.Router()

if (process.env.NODE_ENV === "production") {
    const handlerModule = require("./handler")
    const handler = handlerModule.default || handlerModule

    router.use(handler)
} else {
    const devModule = require("../../../.catalyst-dev/server/renderer/handler.development.js")
    const developmentHandler = devModule.default || devModule

    router.use(developmentHandler)
}

export default router
