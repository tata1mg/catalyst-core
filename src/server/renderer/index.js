import express from "express"
import handler from "./handler"

const router = express.Router()

router.use((req, res, next) => {
    if (res.locals.rendererWrapper) {
        logger.debug({ message: "Handler wrapped" })
        res.locals.rendererWrapper(handler)(req, res, next)
    } else {
        handler(req, res, next)
    }
})

export default router
