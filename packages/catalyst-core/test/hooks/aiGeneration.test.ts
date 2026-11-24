import { describe, expect, it, vi } from "vitest"
import { createGenerationApi } from "../../src/native/bridge/hooks/aiGeneration"

describe("aiGeneration wrappers", () => {
    it("forwards requestImage and requestSpeech to catalyst-ai", async () => {
        const pkg = { requestImage: vi.fn().mockResolvedValue({ images: [1] }), requestSpeech: vi.fn().mockResolvedValue({ audio: 2 }) }
        const api = createGenerationApi(() => pkg)
        expect(await api.requestImage({ prompt: "a" })).toEqual({ images: [1] })
        expect(await api.requestSpeech({ text: "b" })).toEqual({ audio: 2 })
        expect(pkg.requestImage).toHaveBeenCalledWith({ prompt: "a" })
        expect(pkg.requestSpeech).toHaveBeenCalledWith({ text: "b" })
    })

    it("forwards the hooks with their options", () => {
        const pkg = { useImageGen: vi.fn().mockReturnValue("img"), useSpeech: vi.fn().mockReturnValue("sp") }
        const api = createGenerationApi(() => pkg)
        expect(api.useImageGen({ provider: "gemini" })).toBe("img")
        expect(api.useSpeech({ voice: "x" })).toBe("sp")
        expect(pkg.useImageGen).toHaveBeenCalledWith({ provider: "gemini" })
    })

    it("fails clearly when catalyst-ai is missing or too old", async () => {
        const api = createGenerationApi(() => null)
        await expect(api.requestImage({ prompt: "a" })).rejects.toThrow(/Update catalyst-ai/)
        await expect(createGenerationApi(() => ({})).requestSpeech({ text: "b" })).rejects.toThrow(/requestSpeech needs/)
        const hook = api.useImageGen()
        expect(hook.images).toEqual([])
        expect((await hook.generate("a")).error).toMatch(/useImageGen needs/)
        const speech = api.useSpeech()
        expect(speech.audio).toBeNull()
        expect((await speech.speak("a")).error).toMatch(/useSpeech needs/)
    })
})
