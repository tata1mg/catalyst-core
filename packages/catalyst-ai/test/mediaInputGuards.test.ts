// Input guards on the client side of media handling: how many clips one request may carry, which model names count as Gemma 4,
// what the "cloud needs an explicit choice" error tells the caller to do, and how much of a long recording is mixed down.
const contentParts = import("../src/contentParts.js")
const audioPrep = import("../src/audioPrep.js")

const WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="
const user = (content: unknown) => ({ role: "user", content })

describe("audio clips per request", () => {
    it("allows two, refuses a third before any clip is decoded", async () => {
        const { normalizeMessages } = await contentParts
        const clip = { type: "audio", data: WAV }
        expect(() => normalizeMessages([user([clip, clip])])).not.toThrow()
        expect(() => normalizeMessages([user([clip, clip, clip])])).toThrow(/At most 2 audio clips/)
        expect(() => normalizeMessages([user([clip]), user([clip]), user([clip])])).toThrow(/At most 2 audio clips/) // counted across messages
    })
})

describe("which model names are Gemma 4", () => {
    it("matches the family as a whole name part, and not a substring of something else", async () => {
        const { supportsWebMedia, webModelKind } = await contentParts
        for (const name of ["onnx-community/gemma-4-E2B-it-ONNX", "google/gemma4-e2b", "gemma-4", "gemma4", "GEMMA-4-E4B", "org/gemma-4_it"]) {
            expect(supportsWebMedia(name), name).toBe(true)
            expect(webModelKind(name), name).toBe("gemma4")
        }
        for (const name of ["org/legacygemma4x", "org/notgemma-4", "org/gemma-4n-it", "org/gemma-3-4b", "org/gemma-40", "", undefined, null]) {
            expect(supportsWebMedia(name as any), String(name)).toBe(false)
            expect(webModelKind(name as any), String(name)).not.toBe("gemma4")
        }
    })
})

describe("the cloud-media refusal", () => {
    it("names providers that exist, not a 'cloud' provider that the route would reject", async () => {
        const { assertCloudMediaAllowed } = await contentParts
        let message = ""
        try { assertCloudMediaAllowed(new Set(["image"]), false) } catch (e: any) { message = e.message }
        expect(message).toMatch(/provider: "openai" \| "gemini" \| "anthropic"/)
        expect(message).not.toMatch(/provider: "cloud"/)
    })
})

describe("mixing a long recording down to mono", () => {
    // A view of a channel that counts how many samples were read, to show the tail past the cap is never touched.
    const counting = (length: number, fill: number) => {
        const data = new Float32Array(length).fill(fill)
        const reads = { n: 0 }
        const proxy = new Proxy(data, { get(target, key) { if (typeof key === "string" && /^\d+$/.test(key)) reads.n++; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value } })
        return { proxy: proxy as unknown as Float32Array, reads }
    }

    it("reads only the first maxSeconds, and the output is the same as before", async () => {
        const { toMono16k } = await audioPrep
        const rate = 16000, seconds = 60
        const left = counting(rate * seconds, 0.5), right = counting(rate * seconds, 0.25)
        const out = toMono16k([left.proxy, right.proxy], rate, { maxSeconds: 2 })
        expect(out.length).toBe(rate * 2)
        expect(out.every((v: number) => Math.abs(v - 0.375) < 1e-6)).toBe(true)
        // 2 s of 16 kHz is 32,000 frames per channel; the 58 s that are cut off cost nothing.
        expect(left.reads.n).toBeLessThan(rate * 2 + 10)
        expect(right.reads.n).toBeLessThan(rate * 2 + 10)
    })

    it("a clip shorter than the cap is converted whole", async () => {
        const { toMono16k } = await audioPrep
        const out = toMono16k([new Float32Array(8000).fill(0.2)], 8000, { maxSeconds: 30 })
        expect(out.length).toBe(16000) // 1 s at 8 kHz becomes 1 s at 16 kHz
        expect(Math.abs(out[100] - 0.2)).toBeLessThan(1e-6)
    })
})
