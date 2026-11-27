// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ai = { generate: vi.fn(), cancel: vi.fn(), unload: vi.fn(), output: "", route: null as any, modelReady: true }
vi.mock("../../src/native/bridge/hooks/useAI.js", () => ({ useAI: vi.fn(() => ai) }))
const prepare = vi.fn()
vi.mock("../../src/native/bridge/hooks/aiGeneration.js", () => ({ prepareAudioChunks: (...a: any[]) => prepare(...a) }))

import { useAI } from "../../src/native/bridge/hooks/useAI.js"
import { useTranscribe, TranscribeError } from "../../src/native/bridge/hooks/useTranscribe"

const CLIP = "data:audio/webm;codecs=opus;base64,GkXfo"
const piece = (n: number, silent = false) => ({ data: `data:audio/wav;base64,P${n}`, startSec: n * 28, endSec: n * 28 + 28, silent })
const prepared = (chunks: any[], extra: any = {}) => ({ chunks, durationSec: 60, truncated: false, ...extra })
const run = { action: "run", candidate: { id: "whisper" }, reason: "r", scores: [], skipped: [] }
const said = (output: string, route: any = run) => ({ output, error: null, route })

afterEach(() => cleanup()) // no vitest globals here, so no automatic cleanup

beforeEach(() => {
    ai.generate.mockReset()
    ai.cancel.mockReset()
    ai.unload.mockReset()
    prepare.mockReset()
    ;(useAI as any).mockClear()
})

describe("useTranscribe", () => {
    it("joins the transcript of every piece, in order, and reports progress", async () => {
        prepare.mockResolvedValue(prepared([piece(0), piece(1), piece(2)]))
        ai.generate.mockResolvedValueOnce(said("one")).mockResolvedValueOnce(said("two")).mockResolvedValueOnce(said("three"))
        const { result } = renderHook(() => useTranscribe())
        let out: any
        await act(async () => { out = await result.current.transcribe(CLIP) })
        expect(out).toMatchObject({ text: "one two three", chunks: 3, skipped: 0, truncated: false })
        expect(result.current).toMatchObject({ status: "done", text: "one two three", progress: null, error: null })
        expect(ai.generate.mock.calls.map((c) => c[0].messages[0].content[0].data)).toEqual(piece(0).data ? [piece(0).data, piece(1).data, piece(2).data] : [])
        expect(ai.generate.mock.calls[0][0].task).toBe("speech.transcribe")
    })

    it("defaults provider to auto and passes other options to useAI", () => {
        renderHook(() => useTranscribe({ routing: { cloudMedia: "deny" }, model: "m" }))
        expect((useAI as any).mock.calls[0][0]).toMatchObject({ provider: "auto", routing: { cloudMedia: "deny" }, model: "m" })
    })

    it("stays on the engine the first piece chose, so routing cannot switch models mid-recording", async () => {
        prepare.mockResolvedValue(prepared([piece(0), piece(1)]))
        ai.generate.mockResolvedValueOnce(said("a")).mockResolvedValueOnce(said("b"))
        const { result } = renderHook(() => useTranscribe())
        await act(async () => { await result.current.transcribe(CLIP) })
        expect(ai.generate.mock.calls[0][1]).toEqual({})
        expect(ai.generate.mock.calls[1][1]).toEqual({ pin: "whisper" })
    })

    it("skips silent pieces and says how many", async () => {
        prepare.mockResolvedValue(prepared([piece(0), piece(1, true), piece(2)]))
        ai.generate.mockResolvedValueOnce(said("a")).mockResolvedValueOnce(said("c"))
        const { result } = renderHook(() => useTranscribe())
        await act(async () => { await result.current.transcribe(CLIP) })
        expect(ai.generate).toHaveBeenCalledTimes(2)
        expect(result.current.result).toMatchObject({ text: "a c", chunks: 2, skipped: 1 })
    })

    it("a recording with nothing but silence finishes with an empty transcript and loads no model", async () => {
        prepare.mockResolvedValue(prepared([piece(0, true)]))
        const { result } = renderHook(() => useTranscribe())
        await act(async () => { await result.current.transcribe(CLIP) })
        expect(ai.generate).not.toHaveBeenCalled()
        expect(ai.unload).not.toHaveBeenCalled()
        expect(result.current).toMatchObject({ status: "done", text: "" })
    })

    it("reports truncation instead of silently dropping the rest", async () => {
        prepare.mockResolvedValue(prepared([piece(0)], { durationSec: 120, truncated: true }))
        ai.generate.mockResolvedValueOnce(said("a"))
        const { result } = renderHook(() => useTranscribe({ maxSeconds: 120 }))
        await act(async () => { await result.current.transcribe(CLIP) })
        expect(prepare).toHaveBeenCalledWith(CLIP, { maxSeconds: 120 })
        expect(result.current).toMatchObject({ truncated: true })
    })

    it("stops at needs-consent on the first piece, and approve() gives that consent to every piece", async () => {
        prepare.mockResolvedValue(prepared([piece(0), piece(1)]))
        const ask = { ...run, action: "ask", candidate: null }
        ai.generate.mockResolvedValueOnce({ output: "", error: null, route: ask })
        const { result } = renderHook(() => useTranscribe())
        await act(async () => { await result.current.transcribe(CLIP) })
        expect(result.current.status).toBe("needs-consent")
        expect(ai.generate).toHaveBeenCalledTimes(1)
        expect(ai.unload).not.toHaveBeenCalled()

        ai.generate.mockResolvedValueOnce(said("a")).mockResolvedValueOnce(said("b"))
        await act(async () => { await result.current.approve({ cloud: true }) })
        expect(result.current).toMatchObject({ status: "done", text: "a b" })
        expect(ai.generate.mock.calls[1][1]).toEqual({ cloud: true })
        expect(ai.generate.mock.calls[2][1]).toEqual({ cloud: true, pin: "whisper" })
    })

    it("reports a denied route", async () => {
        prepare.mockResolvedValue(prepared([piece(0)]))
        ai.generate.mockResolvedValueOnce({ output: "", error: null, route: { ...run, action: "deny", candidate: null } })
        const { result } = renderHook(() => useTranscribe())
        await act(async () => { await result.current.transcribe(CLIP) })
        expect(result.current.status).toBe("denied")
    })

    it("unloads the model once at the end of a multi-piece recording, not after every piece", async () => {
        prepare.mockResolvedValue(prepared([piece(0), piece(1), piece(2), piece(3)]))
        ai.generate.mockResolvedValue(said("x"))
        const { result } = renderHook(() => useTranscribe())
        await act(async () => { await result.current.transcribe(CLIP) })
        expect(ai.unload).toHaveBeenCalledTimes(1)
    })

    it("keeps the model when unloadWhenDone is false", async () => {
        prepare.mockResolvedValue(prepared([piece(0)]))
        ai.generate.mockResolvedValueOnce(said("x"))
        const { result } = renderHook(() => useTranscribe({ unloadWhenDone: false }))
        await act(async () => { await result.current.transcribe(CLIP) })
        expect(ai.unload).not.toHaveBeenCalled()
    })

    it("fails with the engine's error, keeps what was heard so far, and still unloads", async () => {
        prepare.mockResolvedValue(prepared([piece(0), piece(1)]))
        ai.generate.mockResolvedValueOnce(said("first")).mockResolvedValueOnce({ output: "", error: new Error("boom"), route: run })
        const { result } = renderHook(() => useTranscribe())
        await act(async () => { await result.current.transcribe(CLIP) })
        expect(result.current).toMatchObject({ status: "error", text: "first" })
        expect(result.current.error?.message).toBe("boom")
        expect(result.current.lastError()?.message).toBe("boom")
        expect(ai.unload).toHaveBeenCalledTimes(1)
    })

    it("sends the recording whole when chunkSeconds is null, without decoding it", async () => {
        ai.generate.mockResolvedValueOnce(said("whole"))
        const { result } = renderHook(() => useTranscribe({ chunkSeconds: null }))
        await act(async () => { await result.current.transcribe(CLIP) })
        expect(prepare).not.toHaveBeenCalled()
        expect(ai.generate.mock.calls[0][0].messages[0].content[0].data).toBe(CLIP)
        expect(result.current.text).toBe("whole")
    })

    it("turns a Blob into a data URL, and refuses input that is neither", async () => {
        prepare.mockResolvedValue(prepared([piece(0)]))
        ai.generate.mockResolvedValueOnce(said("x"))
        const { result } = renderHook(() => useTranscribe())
        await act(async () => { await result.current.transcribe(new Blob(["abc"], { type: "audio/webm" })) })
        expect(prepare.mock.calls[0][0]).toMatch(/^data:audio\/webm;base64,/)
        await act(async () => { await result.current.transcribe("not a data url") })
        expect(result.current.status).toBe("error")
        expect(result.current.error).toBeInstanceOf(TranscribeError)
        expect((result.current.error as TranscribeError).code).toBe("TRANSCRIBE_SOURCE")
    })

    it("reports a clip that cannot be decoded, and an outdated catalyst-ai", async () => {
        prepare.mockRejectedValueOnce(new Error("Unable to decode audio data"))
        const { result } = renderHook(() => useTranscribe())
        await act(async () => { await result.current.transcribe(CLIP) })
        expect((result.current.error as TranscribeError).code).toBe("TRANSCRIBE_DECODE")
        prepare.mockRejectedValueOnce(new Error("prepareAudioChunks needs a catalyst-ai version that provides it. Update catalyst-ai."))
        await act(async () => { await result.current.transcribe(CLIP) })
        expect((result.current.error as TranscribeError).code).toBe("TRANSCRIBE_UNAVAILABLE")
    })

    it("a newer transcription supersedes a running one and does not unload under it", async () => {
        prepare.mockResolvedValue(prepared([piece(0), piece(1)]))
        let release: (v: any) => void = () => {}
        ai.generate.mockImplementationOnce(() => new Promise((r) => { release = r }))
        const { result } = renderHook(() => useTranscribe())
        let first: Promise<any>
        act(() => { first = result.current.transcribe(CLIP) })
        await vi.waitFor(() => expect(ai.generate).toHaveBeenCalledTimes(1))
        ai.generate.mockResolvedValueOnce(said("new")).mockResolvedValueOnce(said("er"))
        await act(async () => { await result.current.transcribe(CLIP) })
        const unloadsBefore = ai.unload.mock.calls.length
        await act(async () => { release(said("old")); expect(await first).toBeNull() })
        expect(ai.unload).toHaveBeenCalledTimes(unloadsBefore) // the superseded call did not unload
        expect(result.current.text).toBe("new er")
    })

    it("cancel() stops a running transcription", async () => {
        prepare.mockResolvedValue(prepared([piece(0), piece(1)]))
        let release: (v: any) => void = () => {}
        ai.generate.mockImplementationOnce(() => new Promise((r) => { release = r }))
        const { result } = renderHook(() => useTranscribe())
        let pending: Promise<any>
        act(() => { pending = result.current.transcribe(CLIP) })
        await vi.waitFor(() => expect(ai.generate).toHaveBeenCalledTimes(1))
        act(() => result.current.cancel())
        await act(async () => { release(said("late")); expect(await pending).toBeNull() })
        expect(ai.generate).toHaveBeenCalledTimes(1) // no second piece after cancel
        expect(result.current.status).toBe("idle")
        expect(ai.cancel).toHaveBeenCalled()
    })
})
