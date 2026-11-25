// The OpenAI and Gemini speech adapters, driven directly with a faked fetch: every failure shape (provider error, empty
// or oversize audio, no audio part) and every success shape (mp3 passthrough, playable Gemini audio, raw PCM wrapped as WAV).
import { afterEach, describe, expect, it, vi } from "vitest"

const { createSpeechAdapters }: { createSpeechAdapters: any } = require("../src/speechGen.js")

const createError = (message: string) => new Error(message)
const throwProviderError = vi.fn(async (provider: string, response: any) => { throw new Error(`${provider} failed ${response.status}`) })
const { openai, gemini } = createSpeechAdapters({ throwProviderError, createError })

// A real Response, as fetch returns: bytes for audio bodies, JSON text otherwise. (A double whose json() and arrayBuffer() hand back the
// same object cannot be read through a bounded reader, and no real response behaves that way.)
const okResponse = (body: any, headers: Record<string, string> = {}) =>
    new Response(body instanceof ArrayBuffer || ArrayBuffer.isView(body) ? (body as BodyInit) : JSON.stringify(body), { status: 200, headers })

afterEach(() => {
    vi.unstubAllGlobals()
    throwProviderError.mockClear()
})

describe("openai speech", () => {
    const call = (extra: any = {}) => openai({ apiKey: "k", model: "tts-1", text: "hello", ...extra })

    it("returns the audio as base64 with the mime type for the format, and counts characters", async () => {
        const bytes = new Uint8Array([1, 2, 3]).buffer
        vi.stubGlobal("fetch", vi.fn(async () => okResponse(bytes)))
        const out = await call({ format: "wav", voice: "nova" })
        expect(out.audio.data).toBe(Buffer.from([1, 2, 3]).toString("base64"))
        expect(out.audio.mimeType).toMatch(/wav/)
        expect(out.usage).toMatchObject({ model: "tts-1", characters: 5 })
        expect((await call()).audio.mimeType).toMatch(/mpeg|mp3/)
    })

    it("hands a non-ok response to the shared provider-error path", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, headers: { get: () => null } })))
        await expect(call()).rejects.toThrow("openai failed 429")
        expect(throwProviderError).toHaveBeenCalledWith("openai", expect.objectContaining({ status: 429 }))
    })

    it("refuses audio that is declared too large, empty, or too large after download", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => okResponse(new ArrayBuffer(1), { "content-length": String(25 * 1024 * 1024) })))
        await expect(call()).rejects.toThrow(/larger than the allowed size/)
        vi.stubGlobal("fetch", vi.fn(async () => okResponse(new ArrayBuffer(0))))
        await expect(call()).rejects.toThrow(/no audio data/)
        vi.stubGlobal("fetch", vi.fn(async () => okResponse(new ArrayBuffer(24 * 1024 * 1024 + 1))))
        await expect(call()).rejects.toThrow(/larger than the allowed size/)
    })
})

describe("gemini speech", () => {
    const call = (extra: any = {}) => gemini({ apiKey: "k", model: "gemini-tts", text: "hi there", ...extra })
    const withParts = (parts: any[], usageMetadata?: any) => vi.stubGlobal("fetch", vi.fn(async () => okResponse({ candidates: [{ content: { parts } }], usageMetadata })))

    it("only returns wav", async () => {
        await expect(call({ format: "mp3" })).rejects.toThrow(/returned as wav/)
    })

    it("hands a non-ok response to the shared provider-error path", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })))
        await expect(call()).rejects.toThrow("gemini failed 500")
    })

    it("reports when no audio part came back, including any text the model said instead", async () => {
        withParts([{ text: "I cannot say that" }])
        await expect(call()).rejects.toThrow("gemini returned no audio: I cannot say that")
        withParts([])
        await expect(call()).rejects.toThrow(/^gemini returned no audio$/)
        vi.stubGlobal("fetch", vi.fn(async () => okResponse({})))
        await expect(call()).rejects.toThrow(/gemini returned no audio/)
    })

    it("refuses oversize inline audio", async () => {
        withParts([{ inlineData: { mimeType: "audio/wav", data: "A".repeat(32 * 1024 * 1024 + 1) } }])
        await expect(call()).rejects.toThrow(/larger than the allowed size/)
    })

    it("passes a playable container through unchanged, with the mime parameters trimmed and usage mapped", async () => {
        withParts([{ inlineData: { mimeType: "Audio/WAV; charset=x", data: "QUJD" } }], { promptTokenCount: 3, candidatesTokenCount: 4 })
        const out = await call()
        expect(out.audio).toEqual({ mimeType: "audio/wav", data: "QUJD" })
        expect(out.usage).toMatchObject({ characters: 8, promptTokens: 3, completionTokens: 4 })
    })

    it("wraps raw PCM as WAV, using the declared sample rate or 24 kHz when none is given", async () => {
        const pcm = Buffer.alloc(8).toString("base64")
        withParts([{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=16000", data: pcm } }])
        const rated = Buffer.from((await call()).audio.data, "base64")
        expect(rated.subarray(0, 4).toString("ascii")).toBe("RIFF")
        expect(rated.readUInt32LE(24)).toBe(16000)
        withParts([{ inlineData: { mimeType: "audio/L16", data: pcm } }])
        expect(Buffer.from((await call()).audio.data, "base64").readUInt32LE(24)).toBe(24000)
    })
})
