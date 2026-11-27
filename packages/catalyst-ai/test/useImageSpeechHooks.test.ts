// @vitest-environment jsdom
// The React wrappers around requestImage / requestSpeech: state transitions, cancel, reset, override precedence and
// the "cancelled" result when a newer call supersedes an older one.
import { renderHook, act } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useImageGen, toImageInput } from "../src/useImageGen.js"
import { useSpeech } from "../src/useSpeech.js"

const json = (body: any, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => body })
const IMG = { images: [{ mimeType: "image/png", data: "QUJD" }], usage: { n: 1 }, model: "m" }
const AUDIO = { audio: { mimeType: "audio/wav", data: "QUJD" }, usage: { chars: 2 }, model: "tts" }

afterEach(() => {
    vi.unstubAllGlobals()
})

/** A fetch that never resolves until its signal aborts, so a second call can supersede the first. */
function hangingFetch() {
    return vi.fn((_url: string, init: any) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
    }))
}

describe("toImageInput", () => {
    it("accepts data URLs and { mimeType, data }, and rejects everything else", () => {
        expect(toImageInput("data:image/png;base64,QUJD")).toEqual({ mimeType: "image/png", data: "QUJD" })
        expect(toImageInput({ mimeType: "image/jpeg", data: "QQ==" })).toEqual({ mimeType: "image/jpeg", data: "QQ==" })
        expect(() => toImageInput("nope")).toThrow(/base64 data URLs/)
        expect(() => toImageInput({ mimeType: 1 } as any)).toThrow(/base64 data URLs/)
    })
})

describe("useImageGen", () => {
    it("generates, exposes the images and usage, and merges per-call overrides over the hook options", async () => {
        const fetchMock = vi.fn(async () => json(IMG))
        vi.stubGlobal("fetch", fetchMock)
        const { result } = renderHook(() => useImageGen({ provider: "gemini", size: "512x512" }))
        expect(result.current.loading).toBe(false)
        let out: any
        await act(async () => { out = await result.current.generate("a cat", { size: "1024x1024", model: "x" }) })
        expect(out.error).toBeNull()
        expect((result.current.images as any[])[0].url).toBe("data:image/png;base64,QUJD")
        expect(result.current.usage).toEqual({ n: 1 })
        expect(result.current.loading).toBe(false)
        const [url, init] = fetchMock.mock.calls[0] as any
        expect(url).toBe("/ai/gemini/image")
        expect(JSON.parse(init.body)).toMatchObject({ prompt: "a cat", size: "1024x1024", model: "x" })
    })

    it("reports a failed request in state and in the result", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => json({ error: "quota" }, false, 429)))
        const { result } = renderHook(() => useImageGen())
        let out: any
        await act(async () => { out = await result.current.generate("a cat") })
        expect(out).toEqual({ images: [], usage: null, error: "quota" })
        expect(result.current.error).toBe("quota")
        expect(result.current.loading).toBe(false)
    })

    it("a newer generate() supersedes an older in-flight one, which resolves as cancelled", async () => {
        const fetchMock = hangingFetch()
        vi.stubGlobal("fetch", fetchMock)
        const { result } = renderHook(() => useImageGen())
        let first: any
        let firstDone: Promise<void> = Promise.resolve()
        act(() => { firstDone = result.current.generate("one").then((r: any) => { first = r }) })
        expect(result.current.loading).toBe(true)
        vi.stubGlobal("fetch", vi.fn(async () => json(IMG)))
        await act(async () => { await result.current.generate("two"); await firstDone })
        expect(first).toEqual({ images: [], usage: null, error: "cancelled" })
        expect(result.current.images).toHaveLength(1)
    })

    it("cancel() aborts the in-flight call and reset() clears the state", async () => {
        vi.stubGlobal("fetch", hangingFetch())
        const { result } = renderHook(() => useImageGen())
        let pending: Promise<any> = Promise.resolve()
        act(() => { pending = result.current.generate("one") })
        act(() => { result.current.cancel() })
        let out: any
        await act(async () => { out = await pending })
        expect(out.error).toBeTruthy()
        act(() => { result.current.reset() })
        expect(result.current).toMatchObject({ images: [], loading: false, error: null, usage: null })
    })
})

describe("useSpeech", () => {
    it("speaks, exposes audio and url, and merges overrides", async () => {
        const fetchMock = vi.fn(async () => json(AUDIO))
        vi.stubGlobal("fetch", fetchMock)
        const { result } = renderHook(() => useSpeech({ provider: "gemini", voice: "Puck" }))
        expect(result.current.url).toBeNull()
        let out: any
        await act(async () => { out = await result.current.speak("hello", { voice: "Kore" }) })
        expect(out.error).toBeNull()
        expect(result.current.url).toBe("data:audio/wav;base64,QUJD")
        expect(result.current.usage).toEqual({ chars: 2 })
        const [url, init] = fetchMock.mock.calls[0] as any
        expect(url).toBe("/ai/gemini/speech")
        expect(JSON.parse(init.body)).toMatchObject({ text: "hello", voice: "Kore" })
    })

    it("reports a failed request in state and in the result", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => json({ error: "no key" }, false, 401)))
        const { result } = renderHook(() => useSpeech())
        let out: any
        await act(async () => { out = await result.current.speak("hello") })
        expect(out).toEqual({ audio: null, usage: null, error: "no key" })
        expect(result.current.error).toBe("no key")
    })

    it("a newer speak() supersedes an older in-flight one, which resolves as cancelled", async () => {
        vi.stubGlobal("fetch", hangingFetch())
        const { result } = renderHook(() => useSpeech())
        let first: any
        let firstDone: Promise<void> = Promise.resolve()
        act(() => { firstDone = result.current.speak("one").then((r: any) => { first = r }) })
        vi.stubGlobal("fetch", vi.fn(async () => json(AUDIO)))
        await act(async () => { await result.current.speak("two"); await firstDone })
        expect(first).toEqual({ audio: null, usage: null, error: "cancelled" })
        expect(result.current.audio).not.toBeNull()
    })

    it("cancel() aborts the in-flight call and reset() clears the state", async () => {
        vi.stubGlobal("fetch", hangingFetch())
        const { result } = renderHook(() => useSpeech())
        let pending: Promise<any> = Promise.resolve()
        act(() => { pending = result.current.speak("one") })
        act(() => { result.current.cancel() })
        await act(async () => { await pending })
        act(() => { result.current.reset() })
        expect(result.current).toMatchObject({ audio: null, loading: false, error: null, usage: null, url: null })
    })
})
