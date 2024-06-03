import express from "express"
import handler from "./handler"

const router = express.Router()

router.use(handler)

export default router
