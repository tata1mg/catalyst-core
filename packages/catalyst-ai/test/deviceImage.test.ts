import { generateOnDevice, deviceImageSupport, parseDeviceSize, registerDeviceImageEngine, unloadDeviceImage } from "../src/deviceImage.js"
import { requestImage } from "../src/useImageGen.js"

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })

function fakeLib(overrides: Record<string, unknown> = {}) {
    return {
        isModelLoaded: vi.fn().mockReturnValue(false),
        loadModel: vi.fn().mockImplementation(async (_id: string, o: any) => {
            o.onProgress?.({ phase: "loading", pct: 50, message: "unet" })
            return { ok: true, backendUsed: "webgpu" }
        }),
        unloadModel: vi.fn().mockResolvedValue(undefined),
        generateImage: vi.fn().mockResolvedValue({ ok: true, blob: PNG, timeMs: 1234 }),
        ...overrides,
    }
}

describe("on-device image generation", () => {
    beforeEach(() => vi.stubGlobal("navigator", { gpu: {} }))
    afterEach(() => {
        vi.unstubAllGlobals()
        registerDeviceImageEngine(null as any)
    })

    it("loads SD-Turbo on WebGPU once, reports progress, and returns the cloud route's result shape", async () => {
        const lib = fakeLib()
        const progress: any[] = []
        const out = await generateOnDevice({ prompt: "a red boat", seed: 7, load: async () => lib as any, onProgress: (p: any) => progress.push(p) })
        expect(lib.loadModel).toHaveBeenCalledWith("sd-turbo", expect.objectContaining({ backendPreference: ["webgpu"] }))
        expect(progress[0]).toEqual({ phase: "loading", pct: 50, message: "unet" })
        expect(lib.generateImage).toHaveBeenCalledWith(expect.objectContaining({ model: "sd-turbo", prompt: "a red boat", seed: 7, width: 512, height: 512 }))
        expect(out.images[0].mimeType).toBe("image/png")
        expect(out.images[0].url).toBe(`data:image/png;base64,${out.images[0].data}`)
        expect(out.images[0].data).toBe(Buffer.from([137, 80, 78, 71]).toString("base64"))
        expect(out.cost).toBe(0)
        expect(out.usage).toMatchObject({ model: "sd-turbo", images: 1, onDevice: true, timeMs: 1234 })
    })

    it("passes the app's wasmPaths to the engine", async () => {
        const lib = fakeLib()
        registerDeviceImageEngine(async () => lib as any, { wasmPaths: "https://example.test/ort/" })
        await generateOnDevice({ prompt: "a boat" })
        expect(lib.loadModel).toHaveBeenCalledWith("sd-turbo", expect.objectContaining({ wasmPaths: "https://example.test/ort/" }))
    })

    it("does not reload a model that is already loaded", async () => {
        const lib = fakeLib({ isModelLoaded: vi.fn().mockReturnValue(true) })
        await generateOnDevice({ prompt: "a boat", load: async () => lib as any })
        expect(lib.loadModel).not.toHaveBeenCalled()
    })

    it("refuses what it cannot do, before loading anything", async () => {
        const lib = fakeLib()
        const load = async () => lib as any
        await expect(generateOnDevice({ prompt: " ", load })).rejects.toThrow(/prompt/)
        await expect(generateOnDevice({ prompt: "a", n: 2, load })).rejects.toThrow(/one picture/)
        await expect(generateOnDevice({ prompt: "a", images: ["data:image/png;base64,AA"], load })).rejects.toThrow(/cannot edit/)
        await expect(generateOnDevice({ prompt: "a", size: "1024x1024", load })).rejects.toThrow(/512x512/)
        expect(lib.loadModel).not.toHaveBeenCalled()
    })

    it("explains a missing WebGPU or an unregistered engine", async () => {
        vi.stubGlobal("navigator", {})
        expect((await deviceImageSupport()).reason).toMatch(/no WebGPU/)
        vi.stubGlobal("navigator", { gpu: {} })
        const s = await deviceImageSupport({ load: async () => { throw new Error("x") } })
        expect(s.available).toBe(false)
        await expect(generateOnDevice({ prompt: "a" })).rejects.toThrow(/registered|No on-device/)
    })

    it("surfaces load and generation failures, and maps a cancel", async () => {
        await expect(generateOnDevice({ prompt: "a", load: async () => fakeLib({ loadModel: vi.fn().mockResolvedValue({ ok: false, reason: "backend_unavailable", message: "no adapter" }) }) as any })).rejects.toThrow(/no adapter/)
        await expect(generateOnDevice({ prompt: "a", load: async () => fakeLib({ generateImage: vi.fn().mockResolvedValue({ ok: false, reason: "cancelled" }) }) as any })).rejects.toThrow("cancelled")
        await expect(generateOnDevice({ prompt: "a", load: async () => fakeLib({ generateImage: vi.fn().mockResolvedValue({ ok: false, reason: "internal_error", message: "oom" }) }) as any })).rejects.toThrow(/oom/)
    })

    it("parseDeviceSize accepts auto/512x512 only", () => {
        expect(parseDeviceSize(undefined)).toEqual({ width: 512, height: 512 })
        expect(parseDeviceSize("auto")).toEqual({ width: 512, height: 512 })
        expect(() => parseDeviceSize("big")).toThrow()
    })

    it("frees the model from GPU/RAM after the picture, and keeps it only when asked", async () => {
        const lib = fakeLib()
        await generateOnDevice({ prompt: "a boat", load: async () => lib as any })
        expect(lib.unloadModel).toHaveBeenCalledWith("sd-turbo")
        const kept = fakeLib()
        await generateOnDevice({ prompt: "a boat", keepLoaded: true, load: async () => kept as any })
        expect(kept.unloadModel).not.toHaveBeenCalled()
    })

    it("frees the model when generation fails or is cancelled, too", async () => {
        const lib = fakeLib({ generateImage: vi.fn().mockResolvedValue({ ok: false, reason: "cancelled" }) })
        await expect(generateOnDevice({ prompt: "a boat", load: async () => lib as any })).rejects.toThrow("cancelled")
        expect(lib.unloadModel).toHaveBeenCalledWith("sd-turbo")
    })

    it("unloadDeviceImage frees a loaded model and is a no-op when nothing is loaded or registered", async () => {
        await expect(unloadDeviceImage()).resolves.toBeUndefined() // nothing registered
        const loaded = fakeLib({ isModelLoaded: vi.fn().mockReturnValue(true) })
        await unloadDeviceImage({ load: async () => loaded as any })
        expect(loaded.unloadModel).toHaveBeenCalledWith("sd-turbo")
        const idle = fakeLib()
        await unloadDeviceImage({ load: async () => idle as any })
        expect(idle.unloadModel).not.toHaveBeenCalled()
    })

    it("requestImage with provider device never calls the cloud route", async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        registerDeviceImageEngine(async () => fakeLib() as any)
        const out = await requestImage({ provider: "device", prompt: "a lighthouse" })
        expect(fetchMock).not.toHaveBeenCalled()
        expect(out.images).toHaveLength(1)
        expect(out.cost).toBe(0)
    })
})
