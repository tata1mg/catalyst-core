// The default decoder: the browser's AudioContext. Everything else in audioPrep injects its own decoder in tests; this is the one
// that runs in a real WebView, so its two outcomes (no AudioContext, and a clip that decodes) need to be pinned down.
// ES module: loaded with import() like the other audioPrep tests, so coverage sees it (require() would bypass the instrumented loader).
const mod = import("../src/audioPrep.js")

const wavLike = "data:audio/wav;base64," + Buffer.from(new Uint8Array(64)).toString("base64")

describe("the browser decoder", () => {
    afterEach(() => vi.unstubAllGlobals())

    it("reports a WebView with no AudioContext in plain words", async () => {
        vi.stubGlobal("AudioContext", undefined)
        vi.stubGlobal("webkitAudioContext", undefined)
        await expect((await mod).prepareAudioChunks(wavLike)).rejects.toThrow(/cannot decode audio \(no AudioContext\)/)
    })

    it("decodes through AudioContext, then closes it", async () => {
        const close = vi.fn()
        class FakeContext {
            decodeAudioData = vi.fn(async () => ({ numberOfChannels: 1, sampleRate: 16000, getChannelData: () => new Float32Array(16000).fill(0.2) }))
            close = close
        }
        vi.stubGlobal("AudioContext", FakeContext)
        const result = await (await mod).prepareAudioChunks(wavLike)
        expect(result.durationSec).toBeCloseTo(1, 1)
        expect(result.chunks.length).toBeGreaterThan(0)
        expect(close).toHaveBeenCalled()
    })

    it("closes the context even when decoding fails", async () => {
        const close = vi.fn()
        class FailingContext {
            decodeAudioData = vi.fn(async () => { throw new Error("EncodingError") })
            close = close
        }
        vi.stubGlobal("AudioContext", FailingContext)
        await expect((await mod).prepareAudioChunks(wavLike)).rejects.toThrow()
        expect(close).toHaveBeenCalled()
    })
})
