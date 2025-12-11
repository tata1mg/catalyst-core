import express from "express"

const router = express.Router()

router.use(function rendererMiddleware(req, res, next) {
    let handler = ""

    if (process.env.NODE_ENV === "production") {
        handler = require("./handler").default
    } else {
        handler = require("../../../.catalyst-dev/server/renderer/handler.development.js").default
    }

    if (res.locals.rendererWrapper) {
        logger.debug({ message: "Handler wrapped" })
        res.locals.rendererWrapper(handler)(req, res, next)
    } else {
        handler(req, res, next)
    }
})

export default router
