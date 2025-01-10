import express from "express"
import handler from "./handler"
import developmentHandler from "../../../.catalyst-dev/server/renderer/handler.development.js"

const router = express.Router()

if (process.env.NODE_ENV === "production") {
    router.use(handler)
} else {
    router.use(developmentHandler)
}

export default router
