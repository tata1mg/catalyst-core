import { describe, expect, it, vi } from "vitest"
import { mountAIBodyParser, parseAIConfig } from "../../src/server/utils/aiBodyParser"

describe("parseAIConfig", () => {
    it("reads a JSON object and treats anything else as no config", () => {
        expect(parseAIConfig('{"enabled":true,"maxRequestMB":30}')).toEqual({ enabled: true, maxRequestMB: 30 })
        for (const raw of [undefined, "", "not json", "[]", "5", "null", '"text"']) expect(parseAIConfig(raw as any), String(raw)).toEqual({})
    })
})

describe("mountAIBodyParser", () => {
    it("mounts a JSON parser on the AI base path only", () => {
        const app = { use: vi.fn() }
        mountAIBodyParser(app, { basePath: "/assistant", maxRequestMB: 30 })
        expect(app.use).toHaveBeenCalledTimes(1)
        const [path, middleware] = app.use.mock.calls[0]
        expect(path).toBe("/assistant")
        expect(typeof middleware).toBe("function")
    })

    it("mounts nothing when AI is disabled", () => {
        const app = { use: vi.fn() }
        mountAIBodyParser(app, { enabled: false })
        expect(app.use).not.toHaveBeenCalled()
    })
})
