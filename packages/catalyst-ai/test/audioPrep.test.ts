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

describe("prepareAudioParts fallback", () => {
    it("strips codec parameters from a clip it could not re-encode, and reports why", async () => {
        const { prepareAudioParts } = await mod
        const onError = vi.fn()
        const messages = [{ role: "user", content: [{ type: "audio", data: "data:audio/webm;codecs=opus;base64,AAAA" }] }]
        const out = await prepareAudioParts(messages as any, { decode: async () => { throw new Error("cannot decode") }, onError })
        expect((out[0].content as any)[0].data).toBe("data:audio/webm;base64,AAAA")
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "cannot decode" }))
    })
})

describe("splitAudio / prepareAudioChunks", () => {
    const RATE = 16000
    // `seconds` of a 220 Hz tone with a silent gap [gapAt, gapAt+0.3) so the splitter has somewhere to cut.
    const tone = (seconds: number, gaps: number[] = []) => {
        const out = new Float32Array(Math.floor(seconds * RATE))
        for (let i = 0; i < out.length; i++) {
            const t = i / RATE
            out[i] = gaps.some((g) => t >= g && t < g + 0.3) ? 0 : 0.3 * Math.sin(2 * Math.PI * 220 * t)
        }
        return out
    }

    it("returns a clip that fits as a single chunk", async () => {
        const { splitAudio } = await mod
        const chunks = splitAudio(tone(10))
        expect(chunks).toHaveLength(1)
        expect(chunks[0]).toMatchObject({ startSec: 0, endSec: 10, silent: false })
    })

    it("cuts a long clip in the quiet gap before the limit, every chunk within the limit, no overlap, nothing lost", async () => {
        const { splitAudio, CHUNK_SECONDS } = await mod
        const samples = tone(70, [25.5, 52.4])
        const chunks = splitAudio(samples)
        expect(chunks.length).toBeGreaterThanOrEqual(3)
        for (const c of chunks) expect(c.endSec - c.startSec).toBeLessThanOrEqual(CHUNK_SECONDS + 1e-6)
        expect(chunks[0].endSec).toBeGreaterThanOrEqual(25.5)
        expect(chunks[0].endSec).toBeLessThanOrEqual(25.8) // inside the gap
        for (let i = 1; i < chunks.length; i++) expect(chunks[i].startSec).toBe(chunks[i - 1].endSec)
        expect(chunks.reduce((n, c) => n + c.samples.length, 0)).toBe(samples.length)
    })

    it("flags near-silent chunks so a caller can skip them", async () => {
        const { splitAudio } = await mod
        const chunks = splitAudio(new Float32Array(RATE * 5))
        expect(chunks[0].silent).toBe(true)
    })

    it("prepareAudioChunks decodes once and returns WAV data URLs; over the maximum it says truncated", async () => {
        const { prepareAudioChunks } = await mod
        const decode = vi.fn(async () => ({ channels: [tone(150)], sampleRate: RATE }))
        const out = await prepareAudioChunks("data:audio/webm;codecs=opus;base64,AAAA", { decode })
        expect(decode).toHaveBeenCalledTimes(1)
        expect(out.truncated).toBe(true)
        expect(out.durationSec).toBe(120)
        expect(out.chunks.length).toBeGreaterThanOrEqual(5)
        expect(out.chunks.every((c: any) => c.data.startsWith("data:audio/wav;base64,"))).toBe(true)
        const short = await prepareAudioChunks("data:audio/wav;base64,AAAA", { decode: async () => ({ channels: [tone(40)], sampleRate: RATE }) })
        expect(short.truncated).toBe(false)
        expect(short.chunks).toHaveLength(2)
    })

    it("rejects input that is not a data URL, and surfaces a decode failure", async () => {
        const { prepareAudioChunks } = await mod
        await expect(prepareAudioChunks("not a url")).rejects.toThrow(/data URL/)
        await expect(prepareAudioChunks("data:audio/webm;base64,AAAA", { decode: async () => { throw new Error("cannot decode") } })).rejects.toThrow("cannot decode")
    })
})

describe("splitAudio refuses a chunk size that cannot make progress", () => {
    it("rejects zero, negative, non-finite and sub-sample sizes instead of looping forever", async () => {
        const { splitAudio } = await import("../src/audioPrep.js")
        const samples = new Float32Array(16000 * 3).fill(0.1)
        for (const chunkSeconds of [0, -5, NaN, Infinity, -Infinity, 1e-9, "10" as any, null as any]) {
            expect(() => splitAudio(samples, { chunkSeconds }), String(chunkSeconds)).toThrow(RangeError)
        }
    })

    it("still splits with a valid size", async () => {
        const { splitAudio } = await import("../src/audioPrep.js")
        const chunks = splitAudio(new Float32Array(16000 * 3).fill(0.1), { chunkSeconds: 1 })
        expect(chunks.length).toBeGreaterThanOrEqual(3)
    })
})
