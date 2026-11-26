// @vitest-environment jsdom
import { createRequire } from "node:module"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The body of useAI only runs when catalyst-ai loads, and under Vitest's ES modules `require` is undefined, so it never did. Giving the test
// a global `require` lets the hook load the real catalyst-ai (the workspace copy) and run its routing and call handling for real.
// What is faked is the network only: `fetch`.
;(globalThis as any).require = createRequire(import.meta.url)

const cloudConfig = (cloud: "allow" | "ask" | "deny") =>
    JSON.stringify({
        routing: {
            policy: { objective: "balanced", order: ["onDevice", "cost"], cloud, cloudMedia: "deny" },
            onDevice: { web: [], ios: [], android: [] },
            cloud: [{ id: "gpt", provider: "openai", model: "gpt-test", modalities: ["text"] }],
        },
    })

const fetchMock = vi.fn()
const messages = [{ role: "user", content: "hello" }]

beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset().mockImplementation(() => new Promise(() => {})) // a request that never answers: we only watch whether one is made
    vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    delete process.env.AI_PUBLIC_CONFIG
})

const load = async () => (await import("../../src/native/bridge/hooks/useAI")).useAI

describe("useAI with catalyst-ai installed", () => {
    it("returns the hook's own state, not the not-installed hook", async () => {
        const useAI = await load()
        const { result } = renderHook(() => useAI({ provider: "openai" }))
        expect(result.current.error).toBeNull()
        expect(typeof result.current.generate).toBe("function")
        expect(result.current.isNative).toBe(false)
    })

    it("auto routing: a policy that denies the cloud answers with the decision and sends nothing", async () => {
        process.env.AI_PUBLIC_CONFIG = cloudConfig("deny")
        const useAI = await load()
        const { result } = renderHook(() => useAI({ provider: "auto" }))
        let outcome: any
        await act(async () => { outcome = await result.current.generate({ messages }) })
        expect(outcome.output).toBe("")
        expect(outcome.route?.action).toBe("deny")
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("auto routing: a policy that asks stops at the question and sends nothing", async () => {
        process.env.AI_PUBLIC_CONFIG = cloudConfig("ask")
        const useAI = await load()
        const { result } = renderHook(() => useAI({ provider: "auto" }))
        let outcome: any
        await act(async () => { outcome = await result.current.generate({ messages }) })
        expect(outcome.route?.action).toBe("ask")
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("auto routing: an allowed cloud call goes to the provider", async () => {
        process.env.AI_PUBLIC_CONFIG = cloudConfig("allow")
        const useAI = await load()
        const { result } = renderHook(() => useAI({ provider: "auto" }))
        await act(async () => { void result.current.generate({ messages }) })
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
        expect(String(fetchMock.mock.calls[0][0])).toContain("/openai")
    })

    it("cancel() while the call is still being routed ends it: nothing is sent afterwards", async () => {
        process.env.AI_PUBLIC_CONFIG = cloudConfig("allow")
        const useAI = await load()
        const { result } = renderHook(() => useAI({ provider: "auto" }))
        let outcome: any
        await act(async () => {
            const pending = result.current.generate({ messages })
            result.current.cancel() // routing is asynchronous: at this moment nothing is parked yet
            outcome = await pending
        })
        await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
        expect(outcome.output).toBe("")
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("a call made after a cancel is not affected by it", async () => {
        process.env.AI_PUBLIC_CONFIG = cloudConfig("allow")
        const useAI = await load()
        const { result } = renderHook(() => useAI({ provider: "auto" }))
        await act(async () => {
            const first = result.current.generate({ messages })
            result.current.cancel()
            await first
        })
        await act(async () => { void result.current.generate({ messages }) })
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    })

    it("generate() refuses a task it cannot run, with a registry error", async () => {
        const useAI = await load()
        const { result } = renderHook(() => useAI({ provider: "auto", task: "image.generate" } as any))
        let outcome: any
        await act(async () => { outcome = await result.current.generate({ messages }) })
        expect(outcome.error?.code).toBe("AI-003")
    })
})
