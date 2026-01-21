import express from "express"

const router = express.Router()

router.use(function rendererMiddleware(req, res, next) {

    let handler = require("./handler").default
    if (res.locals.rendererWrapper) {
        logger.debug({ message: "Handler wrapped" })
        res.locals.rendererWrapper(handler)(req, res, next)
    } else {
        handler(req, res, next)
    }
})

export default router
