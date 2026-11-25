/* global globalThis */
// Live speech-to-text over the Gemini Live API (#611). The browser streams microphone audio straight to Gemini on a
// WebSocket opened with a one-use ephemeral token from POST {basePath}/gemini/live-token, so the API key never leaves
// the server. Partial text arrives while you talk; stop() asks for the final text. Cloud only: the audio goes to Google.

import { useCallback, useEffect, useRef, useState } from "react"

export const LIVE_RATE = 16000
const CHUNK_SAMPLES = 1600 // 100 ms at 16 kHz
const FINISH_QUIET_MS = 1800 // after the end signal, done once the server has been quiet this long (and sent a final)
const FINISH_MAX_MS = 8000

/** Float samples in [-1, 1] at inputRate -> 16-bit PCM at 16 kHz (linear resample, clamped). */
export function floatToPcm16(samples, inputRate = LIVE_RATE) {
    const length = inputRate === LIVE_RATE ? samples.length : Math.floor((samples.length * LIVE_RATE) / inputRate)
    const out = new Int16Array(length)
    const ratio = inputRate / LIVE_RATE
    for (let i = 0; i < length; i++) {
        let v
        if (ratio === 1) v = samples[i]
        else {
            const pos = i * ratio
            const idx = Math.floor(pos)
            const next = Math.min(idx + 1, samples.length - 1)
            v = samples[idx] * (1 - (pos - idx)) + samples[next] * (pos - idx)
        }
        const c = Math.max(-1, Math.min(1, v))
        out[i] = c < 0 ? c * 0x8000 : c * 0x7fff
    }
    return out
}

export function pcm16ToBase64(int16) {
    const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength)
    let binary = ""
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
}

/** The client message carrying one audio chunk. */
export const audioMessage = (int16) => ({ realtimeInput: { audio: { data: pcm16ToBase64(int16), mimeType: `audio/pcm;rate=${LIVE_RATE}` } } })

/**
 * One server message -> { kind, text? }. kinds: "ready" (setupComplete), "partial" (running text of the current phrase),
 * "final" (a finished phrase), "done" (turnComplete), "goAway", "other". Never throws on malformed input.
 */
export function parseLiveMessage(raw) {
    let m
    try {
        m = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw))
    } catch {
        return { kind: "other" }
    }
    if (m?.setupComplete) return { kind: "ready" }
    if (m?.goAway) return { kind: "goAway" }
    const sc = m?.serverContent
    if (sc?.inputTranscription?.text != null) return { kind: "final", text: String(sc.inputTranscription.text) }
    if (sc?.interimInputTranscription?.text != null) return { kind: "partial", text: String(sc.interimInputTranscription.text) }
    if (sc?.turnComplete) return { kind: "done" }
    return { kind: "other" }
}

/**
 * @param {any} [options] Typed loosely: see the TypeScript 7 note on destructured defaults.
 * @returns {Promise<any>} the short-lived token and WebSocket URL
 */
export async function requestLiveToken({ basePath = "/ai", model, signal } = {}) {
    const response = await fetch(`${basePath}/gemini/live-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(model ? { model } : {}),
        signal,
    })
    let data = null
    try {
        data = await response.json()
    } catch {
        // non-JSON error body
    }
    if (!response.ok) throw new Error(data?.error || `Live token request failed (${response.status})`)
    return data
}

const WORKLET = `class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor("pcm-capture",P)`

async function openMicrophone(onSamples) {
    const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext
    let context
    try {
        context = new Context({ sampleRate: LIVE_RATE })
    } catch {
        context = new Context()
    }
    const source = context.createMediaStreamSource(media)
    let node
    if (context.audioWorklet) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }))
        await context.audioWorklet.addModule(url)
        URL.revokeObjectURL(url)
        node = new AudioWorkletNode(context, "pcm-capture")
        node.port.onmessage = (e) => onSamples(e.data, context.sampleRate)
    } else {
        node = context.createScriptProcessor(4096, 1, 1)
        node.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)), context.sampleRate)
    }
    source.connect(node)
    node.connect(context.destination) // some browsers only run the node when connected; it outputs silence
    return () => {
        node.disconnect()
        source.disconnect()
        media.getTracks().forEach((t) => t.stop())
        context.close?.().catch(() => {})
    }
}

/**
 * Starts streaming. Resolves once the microphone is open and Gemini accepted the session.
 * -> { stop(): Promise<string> final text, cancel() }. Callbacks: onPartial(text), onFinal(textSoFar), onLevel(0..1),
 * onStatus("connecting"|"listening"|"finishing"|"closed"), onError(Error).
 * @param {any} [options] Destructured here; typed loosely so TypeScript 7 does not narrow callers to the listed defaults.
 */
export async function startLiveTranscription({ basePath = "/ai", model, onPartial, onFinal, onLevel, onStatus, onError, signal, WebSocketImpl = globalThis.WebSocket, openMic = openMicrophone } = {}) {
    onStatus?.("connecting")
    const live = await requestLiveToken({ basePath, model, signal })
    const ws = new WebSocketImpl(`${live.url}?access_token=${encodeURIComponent(live.token)}`)
    const finals = []
    let partial = ""
    let ended = false
    let closeMic = null
    let finishTimer = null
    let hardTimer = null
    let resolveFinish = null
    const pending = []
    const textSoFar = () => [...finals, partial && !finals.length ? partial : ""].filter(Boolean).join(" ").trim()

    const settle = () => {
        clearTimeout(finishTimer)
        clearTimeout(hardTimer)
        const text = (finals.join(" ").trim() || partial).trim()
        // However the session ends (stop, an unexpected close, an error), the microphone is released here, once.
        if (closeMic) {
            const release = closeMic
            closeMic = null
            try { release() } catch { /* already stopped */ }
        }
        try {
            ws.close()
        } catch {
            // already closed
        }
        onStatus?.("closed")
        resolveFinish?.(text)
        resolveFinish = null
        return text
    }

    await new Promise((resolve, reject) => {
        ws.onerror = () => reject(new Error("Could not open the live connection to Gemini"))
        ws.onclose = (e) => {
            if (!ended) reject(new Error(`Live connection closed${e?.reason ? `: ${e.reason}` : ""}`))
        }
        ws.onopen = () => ws.send(JSON.stringify({ setup: live.setup }))
        ws.onmessage = async (ev) => {
            const data = typeof ev.data === "string" || ev.data instanceof ArrayBuffer ? ev.data : await ev.data.arrayBuffer()
            const msg = parseLiveMessage(data)
            if (msg.kind === "ready") return resolve()
            if (msg.kind === "partial") {
                partial = msg.text
                onPartial?.(partial)
            } else if (msg.kind === "final") {
                finals.push(msg.text.trim())
                partial = ""
                onFinal?.(finals.join(" ").trim())
            }
            if (ended) {
                clearTimeout(finishTimer)
                if (finals.length) finishTimer = setTimeout(settle, FINISH_QUIET_MS)
            }
        }
    })

    ws.onerror = () => onError?.(new Error("The live connection to Gemini failed"))
    ws.onclose = () => {
        if (!ended) onError?.(new Error("The live connection to Gemini closed unexpectedly"))
        ended = true
        settle()
    }

    try {
        closeMic = await openMic((samples, rate) => {
            if (ended || ws.readyState !== 1) return
            let sum = 0
            for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
            onLevel?.(Math.min(1, Math.sqrt(sum / samples.length) * 6))
            pending.push(...floatToPcm16(samples, rate))
            while (pending.length >= CHUNK_SAMPLES) ws.send(JSON.stringify(audioMessage(Int16Array.from(pending.splice(0, CHUNK_SAMPLES)))))
        })
    } catch (err) {
        ws.close()
        throw err
    }
    if (ended) {
        // The connection closed while the microphone was still opening: settle() ran with no microphone to release, so this one
        // has to be released here, and the caller must not be handed a session that is already over.
        try { closeMic?.() } catch { /* already stopped */ }
        closeMic = null
        throw new Error("The live connection closed before listening could start")
    }
    onStatus?.("listening")

    return {
        stop() {
            if (ended) return Promise.resolve(textSoFar())
            ended = true
            closeMic?.()
            onStatus?.("finishing")
            if (pending.length && ws.readyState === 1) ws.send(JSON.stringify(audioMessage(Int16Array.from(pending.splice(0)))))
            if (ws.readyState === 1) ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
            return new Promise((resolve) => {
                resolveFinish = resolve
                hardTimer = setTimeout(settle, FINISH_MAX_MS)
                // A phrase finished earlier may be the only final there will be; the last one usually lands within a second.
                if (finals.length) finishTimer = setTimeout(settle, FINISH_QUIET_MS)
            })
        },
        cancel() {
            ended = true
            closeMic?.()
            clearTimeout(finishTimer)
            clearTimeout(hardTimer)
            try {
                ws.close()
            } catch {
                // already closed
            }
            onStatus?.("closed")
        },
    }
}

/** React wrapper: { start, stop, cancel, state, partial, text, level, seconds, error }. `onFinished(text)` fires after stop(). */
export function useLiveTranscribe({ basePath = "/ai", model, onFinished } = {}) {
    const [state, setState] = useState("idle") // idle | connecting | listening | finishing
    const [partial, setPartial] = useState("")
    const [text, setText] = useState("")
    const [level, setLevel] = useState(0)
    const [seconds, setSeconds] = useState(0)
    const [error, setError] = useState(null)
    const session = useRef(null)
    const timer = useRef(null)
    // One number per start(). cancel() and unmount move it on, so a startup that is still connecting (token, socket, microphone)
    // can tell, when it finishes, that nobody wants it any more and shut it down instead of leaving a live microphone running.
    const startId = useRef(0)
    const mounted = useRef(true)
    const onFinishedRef = useRef(onFinished)
    onFinishedRef.current = onFinished

    const clear = useCallback(() => {
        clearInterval(timer.current)
        session.current = null
        setLevel(0)
        setState("idle")
    }, [])

    const start = useCallback(async () => {
        if (session.current) return
        setError(null)
        setPartial("")
        setText("")
        setSeconds(0)
        session.current = { starting: true }
        const mine = ++startId.current
        try {
            const s = await startLiveTranscription({
                basePath,
                model,
                // Every callback is tied to this start: a cancelled or replaced startup can still be connecting, and must not
                // write into the state of the one that replaced it.
                onPartial: (t) => { if (mine === startId.current) setPartial(t) },
                onFinal: (t) => {
                    if (mine !== startId.current) return
                    setText(t)
                    setPartial("")
                },
                onLevel: (l) => { if (mine === startId.current) setLevel(l) },
                onStatus: (st) => {
                    if (mine !== startId.current) return
                    // "closed" is how an unexpected close (the provider hung up) reaches us: stop the clock and go idle, keeping the error.
                    if (st === "closed") {
                        clearInterval(timer.current)
                        session.current = null
                        setLevel(0)
                        setState("idle")
                    } else setState(st)
                },
                onError: (e) => { if (mine === startId.current) setError(e.message || String(e)) },
            })
            if (mine !== startId.current || !mounted.current) {
                // cancelled, replaced or unmounted while connecting: do not install it, and do not leave it running
                s.cancel()
                return
            }
            session.current = s
            const startedAt = Date.now()
            timer.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500)
        } catch (err) {
            if (mine !== startId.current || !mounted.current) return // abandoned: nothing to report
            setError(err?.name === "NotAllowedError" ? "Microphone permission was denied." : err?.message || String(err))
            clear()
        }
    }, [basePath, model, clear])

    const stop = useCallback(async () => {
        const s = session.current
        if (!s?.stop) return ""
        const final = await s.stop()
        setText(final)
        setPartial("")
        clear()
        if (final) onFinishedRef.current?.(final)
        return final
    }, [clear])

    const cancel = useCallback(() => {
        startId.current++
        session.current?.cancel?.()
        clear()
    }, [clear])

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            startId.current++
            session.current?.cancel?.()
        }
    }, [])

    return { start, stop, cancel, state, listening: state === "listening", partial, text, level, seconds, error }
}
