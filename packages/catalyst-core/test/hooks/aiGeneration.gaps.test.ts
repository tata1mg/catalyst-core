// @vitest-environment jsdom
// The wrappers in aiGeneration.ts: what they do with a catalyst-ai that has the call, and with one that does not. These are
// the paths an app hits on an older catalyst-ai, so they have to fail with a clear message instead of a TypeError.
import { describe, expect, it, vi } from "vitest"
import { createGenerationApi } from "../../src/native/bridge/hooks/aiGeneration"

describe("prepareAudioChunks", () => {
    it("hands the clip and options to catalyst-ai", async () => {
        const prepareAudioChunks = vi.fn(async () => ({ chunks: [], durationSec: 3, truncated: false }))
        const api = createGenerationApi(() => ({ prepareAudioChunks }))
        expect(await api.prepareAudioChunks("data:audio/wav;base64,AA==", { chunkSeconds: 10 })).toMatchObject({ durationSec: 3 })
        expect(prepareAudioChunks).toHaveBeenCalledWith("data:audio/wav;base64,AA==", { chunkSeconds: 10 })
    })

    it("says which catalyst-ai version is needed when the call is missing", async () => {
        const api = createGenerationApi(() => ({}))
        await expect(api.prepareAudioChunks("data:audio/wav;base64,AA==")).rejects.toThrow(/prepareAudioChunks needs a catalyst-ai version/)
        await expect(createGenerationApi(() => null).prepareAudioChunks("x")).rejects.toThrow(/Update catalyst-ai/)
    })
})

describe("useLiveTranscribe and useSpeech", () => {
    it("delegate to catalyst-ai when it has them", () => {
        const useLiveTranscribe = vi.fn(() => ({ state: "listening" }))
        const useSpeech = vi.fn(() => ({ url: "blob:x" }))
        const api = createGenerationApi(() => ({ useLiveTranscribe, useSpeech }))
        expect(api.useLiveTranscribe({ model: "m" })).toEqual({ state: "listening" })
        expect(api.useSpeech({ voice: "v" })).toEqual({ url: "blob:x" })
        expect(useLiveTranscribe).toHaveBeenCalledWith({ model: "m" })
        expect(useSpeech).toHaveBeenCalledWith({ voice: "v" })
    })

    it("return an idle shape whose calls explain what is missing, when catalyst-ai lacks them", async () => {
        const api = createGenerationApi(() => ({}))
        const live: any = api.useLiveTranscribe()
        expect(live).toMatchObject({ state: "idle", listening: false, partial: "", text: "", level: 0, seconds: 0 })
        expect(String(live.error?.message ?? live.error)).toMatch(/useLiveTranscribe needs a catalyst-ai version/)
        const speech: any = api.useSpeech()
        expect(speech).toMatchObject({ audio: null, url: null, loading: false })
        expect((await speech.speak("hi")).error).toMatch(/useSpeech needs a catalyst-ai version/)
    })
})

describe("loading catalyst-ai in a browser", () => {
    it("the module-level loader runs without throwing when the package cannot be required", async () => {
        const mod = await import("../../src/native/bridge/hooks/aiGeneration")
        expect(typeof mod.requestImage).toBe("function")
        expect(typeof mod.prepareAudioChunks).toBe("function")
    })
})
