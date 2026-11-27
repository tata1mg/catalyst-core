// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const ai = { generate: vi.fn(), cancel: vi.fn(), output: "", route: null as any }
vi.mock("../../src/native/bridge/hooks/useAI.js", () => ({ useAI: vi.fn(() => ai) }))

import { useAI } from "../../src/native/bridge/hooks/useAI.js"
import { useAgent } from "../../src/native/bridge/hooks/useAgent"

const ok = (o: object | string) => ({ output: typeof o === "string" ? o : JSON.stringify(o), error: null })

beforeEach(() => {
    ai.generate.mockReset()
    ai.cancel.mockReset()
    ;(useAI as any).mockClear()
})

describe("useAgent", () => {
    it("runs tools, streams the steps into state and ends done", async () => {
        const read = vi.fn(async () => ({ total: 42 }))
        ai.generate.mockResolvedValueOnce(ok({ tool: "read", args: {} })).mockResolvedValueOnce(ok({ final: "total is 42" }))
        const { result } = renderHook(() => useAgent({ tools: [{ name: "read", description: "Read the report", run: read }] }))
        expect(result.current.status).toBe("idle")
        let res: any
        await act(async () => { res = await result.current.run("read the report") })
        expect(res.status).toBe("done")
        expect(result.current).toMatchObject({ status: "done", output: "total is 42", error: null })
        expect(result.current.steps.map((s) => s.type)).toEqual(["tool", "final"])
        expect(read).toHaveBeenCalledTimes(1)
    })

    it("routes with auto by default and passes the remaining options to useAI, not the tools", () => {
        renderHook(() => useAgent({ tools: [], instructions: "x", limits: { maxSteps: 2 }, model: "m", routing: { cloud: "ask" } }))
        expect((useAI as any).mock.calls[0][0]).toEqual({ provider: "auto", model: "m", routing: { cloud: "ask" } })
    })

    it("passes consent to every model call and reports needs-consent when routing asks", async () => {
        ai.generate.mockResolvedValueOnce({ output: "", route: { action: "ask", reason: "cloud needs consent" } })
        const { result } = renderHook(() => useAgent({ tools: [] }))
        await act(async () => { await result.current.run("g") })
        expect(result.current.status).toBe("needs-consent")
        expect(result.current.route).toMatchObject({ action: "ask" })

        ai.generate.mockResolvedValueOnce(ok({ final: "ok" }))
        await act(async () => { await result.current.run("g", { cloud: true }) })
        expect(ai.generate.mock.calls.at(-1)[1]).toEqual({ cloud: true })
        expect(result.current.status).toBe("done")
    })

    it("waits for approval before a side-effecting tool, then runs it", async () => {
        const send = vi.fn(async () => "sent")
        ai.generate.mockResolvedValueOnce(ok({ tool: "send", args: {} })).mockResolvedValueOnce(ok({ final: "sent it" }))
        const { result } = renderHook(() => useAgent({ tools: [{ name: "send", description: "Send the form", sideEffect: true, run: send }] }))
        let done: Promise<any>
        act(() => { done = result.current.run("send it") })
        await waitFor(() => expect(result.current.status).toBe("awaiting-confirmation"))
        expect(result.current.pendingConfirmation).toMatchObject({ tool: "send", description: "Send the form" })
        expect(send).not.toHaveBeenCalled()
        act(() => result.current.approve())
        await act(async () => { await done })
        expect(send).toHaveBeenCalledTimes(1)
        expect(result.current).toMatchObject({ status: "done", pendingConfirmation: null })
    })

    it("deny() keeps the tool from running and the agent carries on", async () => {
        const send = vi.fn()
        ai.generate.mockResolvedValueOnce(ok({ tool: "send" })).mockResolvedValueOnce(ok({ final: "did not send" }))
        const { result } = renderHook(() => useAgent({ tools: [{ name: "send", description: "d", sideEffect: true, run: send }] }))
        let done: Promise<any>
        act(() => { done = result.current.run("g") })
        await waitFor(() => expect(result.current.pendingConfirmation).not.toBeNull())
        act(() => result.current.deny())
        await act(async () => { await done })
        expect(send).not.toHaveBeenCalled()
        expect(result.current.steps[0]).toMatchObject({ outcome: "declined" })
        expect(result.current.status).toBe("done")
    })

    it("cancel() while waiting for approval refuses the tool and stops", async () => {
        const send = vi.fn()
        ai.generate.mockResolvedValue(ok({ tool: "send" }))
        const { result } = renderHook(() => useAgent({ tools: [{ name: "send", description: "d", sideEffect: true, run: send }] }))
        let done: Promise<any>
        act(() => { done = result.current.run("g") })
        await waitFor(() => expect(result.current.pendingConfirmation).not.toBeNull())
        act(() => result.current.cancel())
        let res: any
        await act(async () => { res = await done })
        expect(send).not.toHaveBeenCalled()
        expect(res.status).toBe("cancelled")
        expect(ai.cancel).toHaveBeenCalled()
    })

    it("unmounting during a pending approval refuses the tool", async () => {
        const send = vi.fn()
        ai.generate.mockResolvedValue(ok({ tool: "send" }))
        const { result, unmount } = renderHook(() => useAgent({ tools: [{ name: "send", description: "d", sideEffect: true, run: send }] }))
        let done: Promise<any>
        act(() => { done = result.current.run("g") })
        await waitFor(() => expect(result.current.pendingConfirmation).not.toBeNull())
        unmount()
        await done!
        expect(send).not.toHaveBeenCalled()
    })

    it("a newer run replaces an older one", async () => {
        ai.generate.mockResolvedValueOnce(ok({ final: "first" })).mockResolvedValueOnce(ok({ final: "second" }))
        const { result } = renderHook(() => useAgent({ tools: [] }))
        await act(async () => { await result.current.run("one") })
        await act(async () => { await result.current.run("two") })
        expect(result.current.output).toBe("second")
        expect(result.current.steps).toHaveLength(1)
    })
})
