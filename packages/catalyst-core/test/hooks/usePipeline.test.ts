// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { codeStage, imageStage, usePipeline } from "../../src/native/bridge/hooks/usePipeline"
import type { Stage } from "../../src/native/bridge/hooks/usePipeline"

describe("usePipeline", () => {
    it("runs and exposes steps, output and status", async () => {
        const stages = [codeStage("a", "text", "text", (t: string) => t + "!"), codeStage("b", "text", "json", (t: string) => ({ t }))]
        const { result } = renderHook(() => usePipeline(stages))
        expect(result.current.status).toBe("idle")
        await act(async () => {
            await result.current.run("hi")
        })
        expect(result.current.status).toBe("done")
        expect(result.current.output).toEqual({ t: "hi!" })
        expect(result.current.steps.map((s) => s.type)).toEqual(["start", "end", "start", "end"])
        expect(result.current.error).toBeNull()
    })

    it("throws at render for a mismatched chain", () => {
        const stages = [codeStage("a", "text", "text", (t) => t), codeStage("b", "json", "json", (t) => t)]
        const spy = vi.spyOn(console, "error").mockImplementation(() => {})
        expect(() => renderHook(() => usePipeline(stages))).toThrow(/"a" outputs "text" but stage "b" expects "json"/)
        spy.mockRestore()
    })

    it("needs-consent, then re-run with cloudPolicy allow", async () => {
        const requestImage = vi.fn(async () => ({ images: [{ url: "u" }] }))
        const stages: Stage[] = [codeStage("tr", "audio", "json", () => ({ scene: "x" })), imageStage({ requestImage, prompt: (j: any) => j.scene })]
        const { result } = renderHook(() => usePipeline(stages, { cloudPolicy: "ask" }))
        await act(async () => {
            await result.current.run("file:///a.wav")
        })
        expect(result.current.status).toBe("needs-consent")
        expect(requestImage).not.toHaveBeenCalled()
        await act(async () => {
            await result.current.run("file:///a.wav", { cloudPolicy: "allow" })
        })
        expect(result.current.status).toBe("done")
        expect(requestImage).toHaveBeenCalledTimes(1)
    })

    it("cancel() ends a running pipeline as cancelled", async () => {
        const stages = [codeStage("slow", "text", "text", () => new Promise<string>(() => {}))]
        const { result } = renderHook(() => usePipeline(stages))
        let promise: Promise<any>
        act(() => {
            promise = result.current.run("x")
        })
        expect(result.current.status).toBe("running")
        await act(async () => {
            result.current.cancel()
            await promise
        })
        expect(result.current.status).toBe("cancelled")
    })

    it("applies the default maxCostUsd", async () => {
        const stages = [codeStage("a", "text", "text", (t, ctx) => { ctx.addCost(1); return t }), codeStage("b", "text", "text", (t) => t)]
        const { result } = renderHook(() => usePipeline(stages, { maxCostUsd: 0.5 }))
        await act(async () => {
            await result.current.run("x")
        })
        expect(result.current.status).toBe("max-spend")
        expect(result.current.spentUsd).toBe(1)
    })
})
