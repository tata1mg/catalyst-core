// @vitest-environment jsdom
// Regression: generate() is memoised, and the media-consent flag it checks changes when the caller switches engines
// (the example page starts on the Native tab, then moves to Cloud). A stale flag blocked images on an explicit cloud choice.
import { renderHook, act, waitFor } from "@testing-library/react"

const mod = import("../src/useCloudAI.js")

const PNG = "data:image/png;base64,iVBORw0KGgo="
const withImage = [{ role: "user", content: [{ type: "image", data: PNG }, { type: "text", text: "what is this?" }] }]

const okStream = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"token":"hi"}\n\ndata: [DONE]\n\n')); c.close() } }), { status: 200 })

describe("useCloudAI media consent follows the current flag", () => {
    afterEach(() => vi.unstubAllGlobals())

    it("allows media after allowMedia flips from false to true (switching to an explicit cloud choice)", async () => {
        const { useCloudAI } = await mod
        const fetchMock = vi.fn().mockImplementation(async () => okStream())
        vi.stubGlobal("fetch", fetchMock)
        const { result, rerender } = renderHook((props: { allowMedia: boolean }) => useCloudAI({ provider: "gemini", ...props }), {
            initialProps: { allowMedia: false },
        })

        rerender({ allowMedia: true })
        await act(async () => {
            await result.current.generate({ messages: withImage })
        })

        expect((result.current.error as any)?.reason).toBeUndefined()
        // The image resizer also calls fetch (on the data URL), so pick the request to the AI route.
        const aiCall = fetchMock.mock.calls.find(([url]) => typeof url === "string" && url.includes("/ai/gemini/"))
        expect(aiCall).toBeDefined()
        const sent = JSON.parse(aiCall![1].body)
        expect(sent.messages.at(-1).content.some((p: any) => p.type === "image")).toBe(true)
    })

    it("blocks media after allowMedia flips from true to false (falling back from an explicit choice)", async () => {
        const { useCloudAI } = await mod
        const fetchMock = vi.fn().mockImplementation(async () => okStream())
        vi.stubGlobal("fetch", fetchMock)
        const { result, rerender } = renderHook((props: { allowMedia: boolean }) => useCloudAI({ provider: "gemini", ...props }), {
            initialProps: { allowMedia: true },
        })

        rerender({ allowMedia: false })
        await act(async () => {
            await result.current.generate({ messages: withImage })
        })

        await waitFor(() => expect((result.current.error as any)?.reason).toBe("cloud-media-not-allowed"))
        expect(fetchMock.mock.calls.some(([url]) => typeof url === "string" && url.includes("/ai/"))).toBe(false)
    })
})
