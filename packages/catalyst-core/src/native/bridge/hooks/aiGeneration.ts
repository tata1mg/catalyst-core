// image.generate / speech.synthesize for apps, which reach catalyst-ai only through catalyst-core/hooks.
// Same guarded, client-only load of catalyst-ai as useAI (see the note there on SSR and __CATALYST_PACKAGES__).
// The wrappers add nothing to the contract: they forward to catalyst-ai's requestImage/useImageGen/requestSpeech/
// useSpeech and fail with a clear message when the installed catalyst-ai is too old or AI support is compiled out.

declare const __CATALYST_PACKAGES__: { ai?: boolean } | undefined

const loadPackage = (): any =>
    typeof window !== "undefined" && (typeof __CATALYST_PACKAGES__ === "undefined" || __CATALYST_PACKAGES__?.ai)
        ? (() => {
              try {
                  return require(/* webpackIgnore: true */ "catalyst-ai")
              } catch (_) {
                  return null
              }
          })()
        : null

const _pkg = loadPackage()

const missing = (name: string) =>
    new Error(`${name} needs a catalyst-ai version that provides it (and AI support enabled in this build). Update catalyst-ai.`)

/** Builds the wrappers over a package getter. Exported for tests; apps use the bound exports below. */
export function createGenerationApi(getPkg: () => any) {
    const idle = (name: string, extra: Record<string, unknown>) => {
        const fail = async () => ({ ...extra, error: missing(name).message })
        return { loading: false, error: null, usage: null, generate: fail, speak: fail, cancel() {}, reset() {} }
    }
    return {
        /** POST {basePath}/{provider}/image. Resolves { images: [{ mimeType, data, url }], usage, model, cost, costPartial }. */
        async requestImage(args: Record<string, unknown>) {
            const pkg = getPkg()
            if (!pkg?.requestImage) throw missing("requestImage")
            return pkg.requestImage(args)
        },
        /** POST {basePath}/{provider}/speech. Resolves { audio: { mimeType, data, url }, usage, model }. */
        async requestSpeech(args: Record<string, unknown>) {
            const pkg = getPkg()
            if (!pkg?.requestSpeech) throw missing("requestSpeech")
            return pkg.requestSpeech(args)
        },
        /** { generate(prompt, overrides), images, loading, error, usage, cancel, reset }. */
        useImageGen(options: Record<string, unknown> = {}): any {
            const pkg = getPkg()
            // Stable for the life of the page (the package either loaded or did not), so hook order never changes.
            return pkg?.useImageGen ? pkg.useImageGen(options) : { ...idle("useImageGen", { images: [] }), images: [] }
        },
        /** Registers the on-device image engine once at startup: registerDeviceImageEngine(() => import("web-txt2img")). Then requestImage/useImageGen accept provider "device". */
        registerDeviceImageEngine(loader: (() => Promise<unknown>) | null, options: { wasmPaths?: string } = {}) {
            getPkg()?.registerDeviceImageEngine?.(loader, options)
        },
        /** { available, reason? }: whether on-device image generation can run here (WebGPU + a registered engine). */
        async deviceImageSupport(): Promise<{ available: boolean; reason?: string }> {
            const pkg = getPkg()
            return pkg?.deviceImageSupport ? pkg.deviceImageSupport() : { available: false, reason: missing("deviceImageSupport").message }
        },
        /** Frees the on-device image model from GPU/RAM (cached files stay). generate() already does this after each picture unless keepLoaded is set. */
        async unloadDeviceImage(): Promise<void> {
            await getPkg()?.unloadDeviceImage?.()
        },
        /** Live speech-to-text over the Gemini Live API: { start, stop, cancel, state, listening, partial, text, level, seconds, error }. */
        useLiveTranscribe(options: Record<string, unknown> = {}): any {
            const pkg = getPkg()
            return pkg?.useLiveTranscribe
                ? pkg.useLiveTranscribe(options)
                : { ...idle("useLiveTranscribe", {}), state: "idle", listening: false, partial: "", text: "", level: 0, seconds: 0, error: missing("useLiveTranscribe").message, start: async () => {}, stop: async () => "" }
        },
        /** { speak(text, overrides), audio, url, loading, error, usage, cancel, reset }. */
        useSpeech(options: Record<string, unknown> = {}): any {
            const pkg = getPkg()
            return pkg?.useSpeech ? pkg.useSpeech(options) : { ...idle("useSpeech", { audio: null }), audio: null, url: null }
        },
    }
}

const api = createGenerationApi(() => _pkg)
export const requestImage = api.requestImage
export const requestSpeech = api.requestSpeech
export const useImageGen = api.useImageGen
export const useSpeech = api.useSpeech
export const useLiveTranscribe = api.useLiveTranscribe
export const registerDeviceImageEngine = api.registerDeviceImageEngine
export const deviceImageSupport = api.deviceImageSupport
export const unloadDeviceImage = api.unloadDeviceImage
