import express from "express"
import handler from "./handler.jsx"

const router = express.Router()

router.use(handler)

export default router
