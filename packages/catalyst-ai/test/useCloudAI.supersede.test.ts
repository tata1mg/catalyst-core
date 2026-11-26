// @vitest-environment jsdom
// A call that is replaced while it is still waiting must keep its own result, and must not write into the newer call's result.
import { renderHook, act } from "@testing-library/react"
import { useCloudAI } from "../src/useCloudAI.js"

const messages = [{ role: "user", content: "hi" }]
const jsonResponse = (body: any) => new Response(JSON.stringify(body), { status: 200 })

afterEach(() => vi.unstubAllGlobals())

describe("a superseded generate()", () => {
    it("a late answer to the older call does not end up in the newer call's result", async () => {
        const resolvers: Array<(r: Response) => void> = []
        // Each request waits until the test answers it, and ignores the abort: the way a slow server behaves.
        vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolvers.push(resolve) })))
        const hook = renderHook(() => useCloudAI({ provider: "openai", model: "m", genConfig: { stream: false } }))
        let older!: Promise<any>, newer!: Promise<any>
        act(() => { older = hook.result.current.generate({ messages }) })
        await vi.waitFor(() => expect(resolvers).toHaveLength(1))
        act(() => { newer = hook.result.current.generate({ messages }) })
        await vi.waitFor(() => expect(resolvers).toHaveLength(2))
        await act(async () => { resolvers[1](jsonResponse({ output: "NEWER", usage: { promptTokens: 1, completionTokens: 1 } })); await newer })
        await act(async () => { resolvers[0](jsonResponse({ output: "OLDER-LATE", usage: { promptTokens: 1, completionTokens: 1 } })); await older })
        const newerResult = await newer
        expect(newerResult.output).toBe("NEWER")
        expect(hook.result.current.output).toBe("NEWER")
    })
})
