import { describe, it, expect } from "vitest"
import { WebMcpError, WEBMCP_ERROR_CODES, toWebMcpError } from "./errors.js"

describe("WebMcpError", () => {
    it("falls back to the code as message and keeps an optional cause", () => {
        const cause = new Error("root")
        const e = new WebMcpError(WEBMCP_ERROR_CODES.EXECUTE_FAILED, { cause })
        expect(e.message).toBe(WEBMCP_ERROR_CODES.EXECUTE_FAILED)
        expect(e.cause).toBe(cause)
    })

    it("toResult() is a plain agent-facing object", () => {
        const e = new WebMcpError(WEBMCP_ERROR_CODES.INVALID_ARGS, {
            message: "bad",
            details: "d",
            suggestedAction: "retry",
        })
        expect(e.toResult()).toEqual({
            ok: false,
            code: WEBMCP_ERROR_CODES.INVALID_ARGS,
            message: "bad",
            details: "d",
            suggestedAction: "retry",
        })
    })
})

describe("toWebMcpError", () => {
    it("passes a WebMcpError through untouched", () => {
        const e = new WebMcpError(WEBMCP_ERROR_CODES.ABORTED)
        expect(toWebMcpError(e)).toBe(e)
    })

    it("wraps an Error as EXECUTE_FAILED with the original as cause", () => {
        const orig = new Error("boom")
        const w = toWebMcpError(orig)
        expect(w.code).toBe(WEBMCP_ERROR_CODES.EXECUTE_FAILED)
        expect(w.message).toBe("boom")
        expect(w.cause).toBe(orig)
    })

    it("stringifies non-Error throwables and honours a fallback code", () => {
        const w = toWebMcpError("plain string", WEBMCP_ERROR_CODES.INVALID_ARGS)
        expect(w.message).toBe("plain string")
        expect(w.code).toBe(WEBMCP_ERROR_CODES.INVALID_ARGS)
    })
})
