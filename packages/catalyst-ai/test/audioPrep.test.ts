// Audio normalisation for on-device models: whatever the picker returns (m4a, 3gp, 44.1 kHz stereo, ...) becomes
// 16 kHz mono 16-bit WAV, capped in length, before it crosses the native bridge. Decoding is injected so these
// tests need no browser.
const mod = import("../src/audioPrep.js")

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")
const dataUrl = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${b64(bytes)}`
const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.slice(from, from + len))

describe("encodeWav", () => {
    it("writes a 16-bit mono PCM header and clamped samples", async () => {
        const { encodeWav } = await mod
        const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000)
        const view = new DataView(wav.buffer)
        expect(ascii(wav, 0, 4)).toBe("RIFF")
        expect(ascii(wav, 8, 4)).toBe("WAVE")
        expect(view.getUint16(22, true)).toBe(1) // channels
        expect(view.getUint32(24, true)).toBe(16000)
        expect(view.getUint16(34, true)).toBe(16) // bits
        expect(view.getUint32(40, true)).toBe(8) // 4 samples * 2 bytes
        expect(view.getInt16(46, true)).toBe(32767)
        expect(view.getInt16(48, true)).toBe(-32768)
        expect(view.getInt16(50, true)).toBe(32767) // 2 clamps to full scale
    })
})

describe("toMono16k", () => {
    it("averages channels and resamples to the target rate", async () => {
        const { toMono16k } = await mod
        const left = new Float32Array(48000).fill(1)
        const right = new Float32Array(48000).fill(0)
        const out = toMono16k([left, right], 48000)
        expect(out.length).toBe(16000)
        expect(out[100]).toBeCloseTo(0.5, 5)
    })

    it("caps the length at maxSeconds", async () => {
        const { toMono16k } = await mod
        const out = toMono16k([new Float32Array(16000 * 40)], 16000, { maxSeconds: 30 })
        expect(out.length).toBe(16000 * 30)
    })
})

describe("prepareAudioParts", () => {
    const decode = async () => ({ channels: [new Float32Array(32000).fill(0.25)], sampleRate: 32000 })

    it("converts audio parts to wav and leaves text and images untouched", async () => {
        const { prepareAudioParts } = await mod
        const image = { type: "image", data: dataUrl("image/png", new Uint8Array([1])) }
        const out = await prepareAudioParts(
            [{ role: "user", content: [image, { type: "audio", data: dataUrl("audio/mp4", new Uint8Array([9, 9])) }, { type: "text", text: "go" }] }],
            { decode }
        )
        const parts = out[0].content as any[]
        expect(parts[0]).toBe(image)
        expect(parts[1].data.startsWith("data:audio/wav;base64,")).toBe(true)
        expect(parts[2]).toEqual({ type: "text", text: "go" })
        const wav = Buffer.from(parts[1].data.split(",")[1], "base64")
        expect(wav.readUInt32LE(24)).toBe(16000)
    })

    it("returns string-content messages as they are", async () => {
        const { prepareAudioParts } = await mod
        const msgs = [{ role: "user", content: "hi" }]
        expect(await prepareAudioParts(msgs, { decode })).toEqual(msgs)
    })

    it("keeps the original audio when decoding fails, and reports it", async () => {
        const { prepareAudioParts } = await mod
        const original = { type: "audio", data: dataUrl("audio/3gpp", new Uint8Array([7])) }
        const onError = vi.fn()
        const out = await prepareAudioParts([{ role: "user", content: [original] }], {
            decode: async () => {
                throw new Error("cannot decode")
            },
            onError,
        })
        expect((out[0].content as any[])[0]).toBe(original)
        expect(onError).toHaveBeenCalledTimes(1)
    })
})

describe("normalizeAudioMime / normalizeAudioParts", () => {
    it("strips codec parameters and lowercases the type, leaving the payload alone", async () => {
        const { normalizeAudioMime } = await mod
        expect(normalizeAudioMime("data:audio/webm;codecs=opus;base64,AAAA")).toBe("data:audio/webm;base64,AAAA")
        expect(normalizeAudioMime("data:Audio/WebM;base64,AAAA")).toBe("data:audio/webm;base64,AAAA")
        expect(normalizeAudioMime("data:audio/wav;base64,AAAA")).toBe("data:audio/wav;base64,AAAA")
    })

    it("returns anything that is not a base64 audio data URL unchanged", async () => {
        const { normalizeAudioMime } = await mod
        expect(normalizeAudioMime("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA")
        expect(normalizeAudioMime("https://x/y.webm")).toBe("https://x/y.webm")
        expect(normalizeAudioMime(undefined as any)).toBeUndefined()
    })

    it("rewrites audio parts only and keeps other parts and string messages as the same objects", async () => {
        const { normalizeAudioParts } = await mod
        const text = { type: "text", text: "hi" }
        const plain = { role: "system", content: "be brief" }
        const out = normalizeAudioParts([plain, { role: "user", content: [text, { type: "audio", data: "data:audio/webm;codecs=opus;base64,AAAA" }] }])
        expect(out[0]).toBe(plain)
        expect(out[1].content[0]).toBe(text)
        expect(out[1].content[1].data).toBe("data:audio/webm;base64,AAAA")
    })
})
