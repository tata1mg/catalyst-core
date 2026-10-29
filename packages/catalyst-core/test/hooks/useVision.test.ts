// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ai = { generate: vi.fn(), cancel: vi.fn(), output: "", route: null as any }
vi.mock("../../src/native/bridge/hooks/useAI.js", () => ({ useAI: vi.fn(() => ai) }))

import { useAI } from "../../src/native/bridge/hooks/useAI.js"
import { useVision, VisionError } from "../../src/native/bridge/hooks/useVision"

const schema = { type: "object", required: ["total"], properties: { total: { type: "number" } } } as const
const PNG = "data:image/png;base64,iVBORw0KGgo="
const ok = (output: string, route?: any) => ({ output, error: null, ...(route && { route }) })
const run = { action: "run", candidate: { id: "gemma" }, reason: "r", scores: [], skipped: [] }

afterEach(() => cleanup()) // no vitest globals here, so no automatic cleanup

beforeEach(() => {
    ai.generate.mockReset()
    ai.cancel.mockReset()
    ;(useAI as any).mockClear()
})

describe("useVision", () => {
    it("returns the validated data and sends the image with a schema prompt", async () => {
        ai.generate.mockResolvedValueOnce(ok('{"total": 42}', run))
        const { result } = renderHook(() => useVision<{ total: number }>({ schema, instructions: "Read the receipt." }))
        let data: any
        await act(async () => { data = await result.current.scan(PNG) })
        expect(data).toEqual({ total: 42 })
        expect(result.current).toMatchObject({ status: "done", data: { total: 42 }, attempts: 1, error: null })
        const [args, consent] = ai.generate.mock.calls[0]
        expect(consent).toEqual({})
        const parts = args.messages[0].content
        expect(parts[0]).toEqual({ type: "image", data: PNG })
        expect(parts[1].text).toContain("Read the receipt.")
        expect(parts[1].text).toContain('"total"')
    })

    it("defaults provider to auto and passes other options to useAI", () => {
        renderHook(() => useVision({ schema, routing: { cloudMedia: "deny" }, model: "m" }))
        expect((useAI as any).mock.calls[0][0]).toMatchObject({ provider: "auto", routing: { cloudMedia: "deny" }, model: "m" })
        renderHook(() => useVision({ schema, provider: "gemini" }))
        expect((useAI as any).mock.calls[1][0].provider).toBe("gemini")
    })

    it("tells the model what was wrong and tries once more", async () => {
        ai.generate.mockResolvedValueOnce(ok("I cannot read this")).mockResolvedValueOnce(ok('```json\n{"total": 7}\n```'))
        const { result } = renderHook(() => useVision({ schema }))
        await act(async () => { await result.current.scan(PNG) })
        expect(result.current).toMatchObject({ status: "done", data: { total: 7 }, attempts: 2 })
        const second = ai.generate.mock.calls[1][0].messages
        expect(second).toHaveLength(3)
        expect(second[1]).toEqual({ role: "assistant", content: "I cannot read this" })
        expect(second[2].content).toContain("did not contain valid JSON")
    })

    it("fails with the problems and the raw reply when every attempt is unusable", async () => {
        ai.generate.mockResolvedValue(ok('{"total": "lots"}'))
        const { result } = renderHook(() => useVision({ schema, maxAttempts: 2 }))
        let data: any = "unset"
        await act(async () => { data = await result.current.scan(PNG) })
        expect(data).toBeNull()
        expect(ai.generate).toHaveBeenCalledTimes(2)
        expect(result.current.status).toBe("error")
        expect(result.current.raw).toBe('{"total": "lots"}')
        const error = result.current.error as VisionError
        expect(error).toBeInstanceOf(VisionError)
        expect(error.code).toBe("VISION_INVALID_OUTPUT")
        expect(error.problems).toEqual(["$.total should be number, got string"])
    })

    it("stops at needs-consent when the router asks, and approve() runs the same scan with consent", async () => {
        const ask = { action: "ask", candidate: { id: "gemini" }, reason: "needs consent", scores: [], skipped: [] }
        ai.generate.mockResolvedValueOnce({ output: "", error: null, route: ask }).mockResolvedValueOnce(ok('{"total": 1}', run))
        const { result } = renderHook(() => useVision({ schema }))
        await act(async () => { await result.current.scan(PNG) })
        expect(result.current.status).toBe("needs-consent")
        expect(result.current.route?.action).toBe("ask")
        expect(result.current.data).toBeNull()
        await act(async () => { await result.current.approve({ cloud: true }) })
        expect(ai.generate.mock.calls[1][1]).toEqual({ cloud: true })
        expect(ai.generate.mock.calls[1][0].messages[0].content[0].data).toBe(PNG)
        expect(result.current).toMatchObject({ status: "done", data: { total: 1 } })
    })

    it("reports denied when no model may serve the call", async () => {
        const deny = { action: "deny", candidate: null, reason: "no model can serve this call", scores: [], skipped: [{ id: "x", why: "cloud denied for media" }] }
        ai.generate.mockResolvedValueOnce({ output: "", error: null, route: deny })
        const { result } = renderHook(() => useVision({ schema }))
        await act(async () => { await result.current.scan(PNG) })
        expect(result.current.status).toBe("denied")
        expect(result.current.route?.skipped[0].why).toBe("cloud denied for media")
        expect(result.current.loading).toBe(false)
    })

    it("surfaces an engine error without retrying", async () => {
        const boom = new Error("model crashed")
        ai.generate.mockResolvedValueOnce({ output: "", error: boom, route: run })
        const { result } = renderHook(() => useVision({ schema }))
        await act(async () => { await result.current.scan(PNG) })
        expect(result.current.status).toBe("error")
        expect(result.current.error).toBe(boom)
        expect(ai.generate).toHaveBeenCalledTimes(1)
    })

    it("rejects a source that is not an image before calling the model", async () => {
        const { result } = renderHook(() => useVision({ schema }))
        await act(async () => { await result.current.scan("data:text/plain;base64,aGk=") })
        expect(result.current.status).toBe("error")
        expect((result.current.error as VisionError).code).toBe("VISION_SOURCE")
        expect(ai.generate).not.toHaveBeenCalled()
    })

    it("reports unavailable when catalyst-ai is missing (the inert hook resolves nothing)", async () => {
        ai.generate.mockReturnValueOnce(undefined)
        const { result } = renderHook(() => useVision({ schema }))
        await act(async () => { await result.current.scan(PNG) })
        expect((result.current.error as VisionError).code).toBe("VISION_UNAVAILABLE")
    })

    it("ignores the result of a scan that a newer scan replaced", async () => {
        let release!: (v: any) => void
        ai.generate
            .mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
            .mockResolvedValueOnce(ok('{"total": 2}', run))
        const { result } = renderHook(() => useVision({ schema }))
        let first!: Promise<any>
        act(() => { first = result.current.scan(PNG) })
        await act(async () => { await result.current.scan(PNG) })
        expect(result.current.data).toEqual({ total: 2 })
        await act(async () => { release(ok('{"total": 99}', run)); await first })
        expect(result.current.data).toEqual({ total: 2 })
        expect(ai.cancel).toHaveBeenCalled()
    })

    it("clear() resets everything and approve() with nothing scanned is a no-op", async () => {
        ai.generate.mockResolvedValueOnce(ok('{"total": 5}', run))
        const { result } = renderHook(() => useVision({ schema }))
        await act(async () => { expect(await result.current.approve({ cloud: true })).toBeNull() })
        await act(async () => { await result.current.scan(PNG) })
        act(() => result.current.clear())
        expect(result.current).toMatchObject({ status: "idle", data: null, raw: "", attempts: 0 })
    })

    it("does not update state after unmount", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {})
        let release!: (v: any) => void
        ai.generate.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
        const { result, unmount } = renderHook(() => useVision({ schema }))
        let pending!: Promise<any>
        act(() => { pending = result.current.scan(PNG) })
        await waitFor(() => expect(ai.generate).toHaveBeenCalled()) // the image is converted first; unmount while generate is in flight
        unmount()
        await act(async () => { release(ok('{"total": 1}', run)); await pending })
        expect(errors).not.toHaveBeenCalled()
        errors.mockRestore()
    })
})
