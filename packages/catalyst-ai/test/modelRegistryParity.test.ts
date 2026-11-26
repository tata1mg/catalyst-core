// The on-device model registry exists twice, in Kotlin (Android) and in Swift (iOS), because each platform downloads the
// model itself. When a Hugging Face repo is reorganised one copy gets updated and the other does not, and the stale one
// 404s on first download. This pins the two to each other (not to the network: CI must not depend on Hugging Face).
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8")

function kotlin(src: string) {
    const out: Record<string, { url: string; filename: string; size: number }> = {}
    for (const m of src.matchAll(/"([\w.-]+)"\s+to\s+ModelEntry\(\s*url\s*=\s*"([^"]+)",\s*filename\s*=\s*"([^"]+)",\s*sizeHint\s*=\s*([\d_]+)L/g)) {
        out[m[1]] = { url: m[2], filename: m[3], size: Number(m[4].replace(/_/g, "")) }
    }
    return out
}
function swift(src: string) {
    const out: Record<string, { url: string; filename: string; size: number }> = {}
    for (const m of src.matchAll(/"([\w.-]+)":\s*ModelEntry\(\s*url:\s*"([^"]+)",\s*filename:\s*"([^"]+)",\s*sizeHint:\s*([\d_]+)/g)) {
        out[m[1]] = { url: m[2], filename: m[3], size: Number(m[4].replace(/_/g, "")) }
    }
    return out
}

describe("on-device model registry", () => {
    const android = kotlin(read("android/src/main/java/io/catalyst/nativeai/NativeBridgeAI.kt"))
    const ios = swift(read("plugins/ai/ios/NativeBridgeAI.swift"))

    it("lists the same models on both platforms, each with the same URL, file name and exact size", () => {
        expect(Object.keys(android).sort()).toEqual(["gemma-4-E2B", "qwen3-0.6B"])
        expect(ios).toEqual(android)
    })

    it("names the file the URL points at, and the size is a whole-file byte count, not a rounded hint", () => {
        for (const [id, e] of Object.entries(android)) {
            expect(e.url.endsWith(`/${e.filename}`), id).toBe(true)
            expect(e.url, id).toMatch(/^https:\/\/huggingface\.co\/litert-community\/[^/]+\/resolve\/main\//)
            expect(e.size, id).toBeGreaterThan(100_000_000)
            expect(e.size % 1000 === 0, `${id} looks rounded`).toBe(false)
        }
    })
})
