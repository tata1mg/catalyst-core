import { afterEach, describe, expect, it } from "vitest"
import express from "express"
import bodyParser from "body-parser"
import type { Server } from "node:http"
import { resolveAIBodyConfig, mountAIBodyParser } from "../../src/server/utils/aiBodyParser.js"

// Image/audio requests to the AI route are far larger than body-parser's 100 kb default. Only the AI path gets the
// larger limit; every other route keeps the default. These tests go through a real HTTP server because the original
// failure (413 before the router ran) cannot be seen by calling the router directly.

describe("resolveAIBodyConfig", () => {
    it("defaults to /ai and 20 MB", () => {
        expect(resolveAIBodyConfig({})).toEqual({ basePath: "/ai", limit: "20mb" })
    })

    it("honours basePath and maxRequestMB", () => {
        expect(resolveAIBodyConfig({ basePath: "/api/ai", maxRequestMB: 8 })).toEqual({ basePath: "/api/ai", limit: "8mb" })
    })

    it("ignores nonsense limits and falls back to the default", () => {
        for (const bad of [0, -3, "lots", NaN, null, 5000]) {
            expect(resolveAIBodyConfig({ maxRequestMB: bad as any }).limit).toBe("20mb")
        }
    })

    it("returns null when AI is disabled", () => {
        expect(resolveAIBodyConfig({ enabled: false })).toBeNull()
    })
})

describe("mountAIBodyParser (real HTTP)", () => {
    let server: Server | undefined
    afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())))

    async function start(aiConfig: object) {
        const app = express()
        // Same order as expressServer.ts: AI parser first, then the global default parser.
        mountAIBodyParser(app, aiConfig)
        app.use(bodyParser.json())
        app.post("/ai/echo", (req, res) => res.json({ bytes: JSON.stringify(req.body).length }))
        app.post("/other", (req, res) => res.json({ bytes: JSON.stringify(req.body).length }))
        await new Promise<void>((resolve) => (server = app.listen(0, resolve)))
        const { port } = server!.address() as { port: number }
        return (path: string, megabytes: number) =>
            fetch(`http://127.0.0.1:${port}${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ blob: "a".repeat(megabytes * 1024 * 1024) }),
            })
    }

    it("accepts a 3 MB body on the AI path", async () => {
        const post = await start({})
        const res = await post("/ai/echo", 3)
        expect(res.status).toBe(200)
    })

    it("rejects a body over the AI limit with 413", async () => {
        const post = await start({ maxRequestMB: 2 })
        expect((await post("/ai/echo", 3)).status).toBe(413)
    })

    it("keeps the default 100 kb limit on other routes", async () => {
        const post = await start({})
        expect((await post("/other", 1)).status).toBe(413)
    })

    it("does not touch other routes when the base path is customised", async () => {
        const post = await start({ basePath: "/ai" })
        expect((await post("/other", 1)).status).toBe(413)
    })
})
