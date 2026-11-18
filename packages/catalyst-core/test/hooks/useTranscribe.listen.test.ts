// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ai: any = { generate: vi.fn(), cancel: vi.fn(), unload: vi.fn(), decide: vi.fn(), output: "", route: null, modelReady: true }
vi.mock("../../src/native/bridge/hooks/useAI.js", () => ({ useAI: vi.fn(() => ai) }))
const prepare = vi.fn()
vi.mock("../../src/native/bridge/hooks/aiGeneration.js", () => ({ prepareAudioChunks: (...a: any[]) => prepare(...a) }))

// The phone's recogniser and the recorder, as controllable fakes. Their callbacks are what the real hooks would fire.
const speech: any = { supported: true, start: vi.fn(), stop: vi.fn(), cancel: vi.fn() }
let speechOpts: any = {}
vi.mock("../../src/native/bridge/hooks/useSpeechRecognition.js", async () => {
    const actual: any = await vi.importActual("../../src/native/bridge/hooks/useSpeechRecognition.js")
    return { ...actual, useSpeechRecognition: (o: any) => { speechOpts = o; return speech } }
})
const mic: any = { level: 0, start: vi.fn(), stop: vi.fn(), cancel: vi.fn() }
let micOpts: any = {}
vi.mock("../../src/native/bridge/hooks/useMicrophone.js", () => ({ useMicrophone: (o: any) => { micOpts = o; return mic } }))

import { useTranscribe, TranscribeError } from "../../src/native/bridge/hooks/useTranscribe"

const CLIP = "data:audio/webm;base64,GkXfo"
const run = (id: string, engine?: string) => ({ action: "run", candidate: { id, engine }, reason: "r", scores: [], skipped: [] })
const platform = run("platform-speech", "platform-speech")
const gemma = run("gemma-e2b", "litert")
const said = (output: string) => ({ output, error: null, route: gemma })

afterEach(() => cleanup()) // no vitest globals here, so no automatic cleanup

beforeEach(() => {
    for (const fn of [ai.generate, ai.cancel, ai.unload, ai.decide, speech.start, speech.stop, speech.cancel, mic.start, mic.stop, mic.cancel, prepare]) fn.mockReset()
    ai.decide = ai.decide // present: provider "auto"
    speech.supported = true
    speech.start.mockResolvedValue({ started: true })
    mic.start.mockResolvedValue({ started: true })
    prepare.mockResolvedValue({ chunks: [{ data: "data:audio/wav;base64,P0", startSec: 0, endSec: 3, silent: false }], durationSec: 3, truncated: false })
})

const listenOnce = async (hook: any, consent?: any) => {
    let promise!: Promise<any>
    await act(async () => { promise = hook.result.current.listen(consent) })
    return promise
}

describe("useTranscribe.listen: the router picks the engine", () => {
    it("uses the phone's recogniser when it is chosen: partial text streams, the final text ends it, no model is involved", async () => {
        ai.decide.mockResolvedValue(platform)
        const hook = renderHook(() => useTranscribe())
        const done = listenOnce(hook)
        await vi.waitFor(() => expect(speech.start).toHaveBeenCalledTimes(1))
        // asked as a live transcribing call, with what only this hook knows: the shell can recognise speech
        const [args, consent, extra] = ai.decide.mock.calls[0]
        expect(args.task).toBe("speech.transcribe")
        expect(args.messages[0].content[0].type).toBe("audio")
        expect(consent).toEqual({})
        expect(extra).toEqual({ platformSpeech: true })
        expect(hook.result.current).toMatchObject({ status: "listening", listening: true, engine: "platform-speech", platformSpeech: true })

        act(() => speechOpts.onPartial("a red"))
        expect(hook.result.current.partial).toBe("a red")
        act(() => speechOpts.onEnd("a red boat at sea"))
        const result = await done
        expect(result).toMatchObject({ text: "a red boat at sea", engine: "platform-speech", truncated: false })
        expect(hook.result.current).toMatchObject({ status: "done", text: "a red boat at sea", partial: "", listening: false })
        expect(ai.generate).not.toHaveBeenCalled()
        expect(ai.unload).not.toHaveBeenCalled()
        expect(mic.start).not.toHaveBeenCalled()
    })

    it("records and sends the clip when the router picks a model: the clip goes to that engine, and the model is unloaded once", async () => {
        ai.decide.mockResolvedValue(gemma)
        ai.generate.mockResolvedValue(said("hello there"))
        const hook = renderHook(() => useTranscribe())
        const done = listenOnce(hook)
        await vi.waitFor(() => expect(mic.start).toHaveBeenCalledTimes(1))
        expect(speech.start).not.toHaveBeenCalled()
        expect(hook.result.current).toMatchObject({ status: "listening", engine: "recorder" })
        act(() => micOpts.onRecorded(CLIP, { seconds: 3 }))
        const result = await done
        expect(result).toMatchObject({ text: "hello there", engine: "recorder" })
        expect(ai.generate.mock.calls[0][1]).toMatchObject({ pin: "gemma-e2b" })
        expect(ai.unload).toHaveBeenCalledTimes(1)
        expect(hook.result.current.engine).toBe("recorder")
    })

    it("tells the router the recogniser is not available when the shell has not said yes", async () => {
        speech.supported = null
        ai.decide.mockResolvedValue(gemma)
        const hook = renderHook(() => useTranscribe())
        void listenOnce(hook)
        await vi.waitFor(() => expect(ai.decide).toHaveBeenCalled())
        expect(ai.decide.mock.calls[0][2]).toEqual({ platformSpeech: false })
        expect(hook.result.current.platformSpeech).toBeNull()
    })

    it("with an explicit provider there is nothing to route: it records and sends the clip to that provider", async () => {
        delete ai.decide
        ai.generate.mockResolvedValue(said("explicit"))
        const hook = renderHook(() => useTranscribe({ provider: "transformers" }))
        const done = listenOnce(hook)
        await vi.waitFor(() => expect(mic.start).toHaveBeenCalled())
        expect(speech.start).not.toHaveBeenCalled()
        act(() => micOpts.onRecorded(CLIP, { seconds: 2 }))
        expect(await done).toMatchObject({ text: "explicit", engine: "recorder" })
        expect(ai.generate.mock.calls[0][1]).not.toHaveProperty("pin", expect.anything())
        ai.decide = vi.fn()
    })
})

describe("useTranscribe.listen: consent and privacy", () => {
    it("stops at needs-consent without taking the microphone, and approve() replays listen with that consent", async () => {
        ai.decide.mockResolvedValueOnce({ action: "ask", candidate: null, reason: "r", scores: [], skipped: [] })
        const hook = renderHook(() => useTranscribe())
        expect(await listenOnce(hook)).toBeNull()
        expect(hook.result.current.status).toBe("needs-consent")
        expect(speech.start).not.toHaveBeenCalled()
        expect(mic.start).not.toHaveBeenCalled()

        ai.decide.mockResolvedValueOnce(platform)
        let replay!: Promise<any>
        await act(async () => { replay = hook.result.current.approve({ cloud: true }) })
        await vi.waitFor(() => expect(speech.start).toHaveBeenCalled())
        expect(ai.decide.mock.calls[1][1]).toEqual({ cloud: true })
        act(() => speechOpts.onEnd("ok"))
        expect(await replay).toMatchObject({ text: "ok" })
    })

    it("a denied decision never records", async () => {
        ai.decide.mockResolvedValue({ action: "deny", candidate: null, reason: "r", scores: [], skipped: [] })
        const hook = renderHook(() => useTranscribe())
        expect(await listenOnce(hook)).toBeNull()
        expect(hook.result.current.status).toBe("denied")
        expect(mic.start).not.toHaveBeenCalled()
    })
})

describe("useTranscribe.listen: when the recogniser is not usable here", () => {
    it("a start that is refused as unavailable is decided again without it, and the next engine takes over", async () => {
        ai.decide.mockResolvedValueOnce(platform).mockResolvedValueOnce(gemma)
        speech.start.mockResolvedValue({ started: false, code: "ON_DEVICE_UNAVAILABLE" })
        ai.generate.mockResolvedValue(said("fell back"))
        const hook = renderHook(() => useTranscribe())
        const done = listenOnce(hook)
        await vi.waitFor(() => expect(mic.start).toHaveBeenCalledTimes(1))
        expect(ai.decide).toHaveBeenCalledTimes(2)
        expect(ai.decide.mock.calls[1][2]).toEqual({ platformSpeech: false })
        act(() => micOpts.onRecorded(CLIP, { seconds: 2 }))
        expect(await done).toMatchObject({ text: "fell back", engine: "recorder" })
    })

    it("an ON_DEVICE_UNAVAILABLE from the shell before anything was heard (the iOS Simulator) also falls back", async () => {
        ai.decide.mockResolvedValueOnce(platform).mockResolvedValueOnce(gemma)
        const hook = renderHook(() => useTranscribe())
        void listenOnce(hook)
        await vi.waitFor(() => expect(speech.start).toHaveBeenCalled())
        act(() => speechOpts.onError("ON_DEVICE_UNAVAILABLE"))
        await vi.waitFor(() => expect(mic.start).toHaveBeenCalledTimes(1))
        expect(ai.decide.mock.calls[1][2]).toEqual({ platformSpeech: false })
    })

    it("the second decision still goes through the privacy policy: if it needs consent or is denied, nothing is recorded", async () => {
        ai.decide.mockResolvedValueOnce(platform).mockResolvedValueOnce({ action: "ask", candidate: null, reason: "r", scores: [], skipped: [] })
        speech.start.mockResolvedValue({ started: false, code: "LANGUAGE_UNAVAILABLE" })
        const hook = renderHook(() => useTranscribe())
        expect(await listenOnce(hook)).toBeNull()
        expect(hook.result.current.status).toBe("needs-consent")
        expect(mic.start).not.toHaveBeenCalled()
    })

    it("a failure after something was heard is reported, not answered with a fallback", async () => {
        ai.decide.mockResolvedValue(platform)
        const hook = renderHook(() => useTranscribe())
        const done = listenOnce(hook)
        await vi.waitFor(() => expect(speech.start).toHaveBeenCalled())
        act(() => speechOpts.onPartial("half a sentence"))
        act(() => speechOpts.onError("ON_DEVICE_UNAVAILABLE"))
        expect(await done).toBeNull()
        expect(hook.result.current.status).toBe("error")
        expect(ai.decide).toHaveBeenCalledTimes(1)
        expect(mic.start).not.toHaveBeenCalled()
    })

    it("a start refused for another reason (permission) is reported, not a reason to fall back", async () => {
        ai.decide.mockResolvedValue(platform)
        speech.start.mockResolvedValue({ started: false, code: "PERMISSION_DENIED" })
        const hook = renderHook(() => useTranscribe())
        expect(await listenOnce(hook)).toBeNull()
        expect(hook.result.current.error).toBeInstanceOf(TranscribeError)
        expect(hook.result.current.error?.message).toBe("Microphone or speech recognition permission was denied.")
        expect(ai.decide).toHaveBeenCalledTimes(1)
    })
})

describe("useTranscribe.listen: nothing heard, and the controls", () => {
    it("NO_SPEECH from the recogniser, or an empty final text, is a clear error", async () => {
        ai.decide.mockResolvedValue(platform)
        const first = renderHook(() => useTranscribe())
        const a = listenOnce(first)
        await vi.waitFor(() => expect(speech.start).toHaveBeenCalledTimes(1))
        act(() => speechOpts.onError("NO_SPEECH"))
        expect(await a).toBeNull()
        expect(first.result.current.error?.message).toBe("No speech was heard.")
        expect((first.result.current.error as TranscribeError).code).toBe("TRANSCRIBE_NO_SPEECH")

        const second = renderHook(() => useTranscribe())
        const b = listenOnce(second)
        await vi.waitFor(() => expect(speech.start).toHaveBeenCalledTimes(2))
        act(() => speechOpts.onEnd("   "))
        expect(await b).toBeNull()
        expect(second.result.current.error?.message).toBe("No speech was heard.")
    })

    it("a recording with no speech, or a microphone that will not open, is an error", async () => {
        ai.decide.mockResolvedValue(gemma)
        mic.start.mockResolvedValueOnce({ started: false, error: "Microphone permission was denied." })
        const first = renderHook(() => useTranscribe())
        expect(await listenOnce(first)).toBeNull()
        expect(first.result.current.error?.message).toBe("Microphone permission was denied.")

        const second = renderHook(() => useTranscribe())
        const done = listenOnce(second)
        await vi.waitFor(() => expect(mic.start).toHaveBeenCalledTimes(2))
        act(() => micOpts.onError("No speech was heard. Check the microphone and try again."))
        expect(await done).toBeNull()
        expect((second.result.current.error as TranscribeError).code).toBe("TRANSCRIBE_NO_SPEECH")
    })

    it("stopListening ends the recogniser's session or the recording, whichever is running", async () => {
        ai.decide.mockResolvedValueOnce(platform)
        const first = renderHook(() => useTranscribe())
        void listenOnce(first)
        await vi.waitFor(() => expect(speech.start).toHaveBeenCalled())
        act(() => first.result.current.stopListening())
        expect(speech.stop).toHaveBeenCalledTimes(1)
        expect(mic.stop).not.toHaveBeenCalled()

        ai.decide.mockResolvedValueOnce(gemma)
        const second = renderHook(() => useTranscribe())
        void listenOnce(second)
        await vi.waitFor(() => expect(mic.start).toHaveBeenCalled())
        act(() => second.result.current.stopListening())
        expect(mic.stop).toHaveBeenCalledTimes(1)
    })

    it("cancel() drops the session: both sources are cancelled and the pending listen() resolves null", async () => {
        ai.decide.mockResolvedValue(platform)
        const hook = renderHook(() => useTranscribe())
        const done = listenOnce(hook)
        await vi.waitFor(() => expect(speech.start).toHaveBeenCalled())
        act(() => hook.result.current.cancel())
        expect(await done).toBeNull()
        expect(speech.cancel).toHaveBeenCalled()
        expect(mic.cancel).toHaveBeenCalled()
        expect(hook.result.current.status).toBe("idle")
    })

    it("a new listen() replaces the one running; the old one resolves null", async () => {
        ai.decide.mockResolvedValue(platform)
        const hook = renderHook(() => useTranscribe())
        const first = listenOnce(hook)
        await vi.waitFor(() => expect(speech.start).toHaveBeenCalledTimes(1))
        const second = listenOnce(hook)
        expect(await first).toBeNull()
        await vi.waitFor(() => expect(speech.start).toHaveBeenCalledTimes(2))
        act(() => speechOpts.onEnd("the second"))
        expect(await second).toMatchObject({ text: "the second" })
    })

    it("unmounting does not leave a listen() hanging", async () => {
        ai.decide.mockResolvedValue(platform)
        const hook = renderHook(() => useTranscribe())
        const done = listenOnce(hook)
        await vi.waitFor(() => expect(speech.start).toHaveBeenCalled())
        hook.unmount()
        expect(await done).toBeNull()
    })

    it("the existing clip path still works alongside: transcribe(clip) is unchanged", async () => {
        ai.generate.mockResolvedValue(said("from a clip"))
        const hook = renderHook(() => useTranscribe())
        let out: any
        await act(async () => { out = await hook.result.current.transcribe(CLIP) })
        expect(out).toMatchObject({ text: "from a clip" })
        expect(out.engine).toBeUndefined()
    })
})
