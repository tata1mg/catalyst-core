/* global globalThis */
// Normalises audio for on-device models: any format the platform can decode -> 16 kHz mono 16-bit WAV, capped in
// length. Done in JS so Android and iOS get identical input regardless of what the file picker or recorder produced
// (m4a, 3gp, 44.1 kHz stereo, ...). If the browser cannot decode a file, the original is sent unchanged and the
// native engine decides; the failure is reported through `onError`, never swallowed.

export const TARGET_RATE = 16000
// Gemma-family audio encoders take short clips; longer input is truncated rather than rejected.
export const MAX_AUDIO_SECONDS = 30

/** Float samples in [-1, 1] -> 16-bit mono PCM WAV bytes (values outside the range are clamped). */
export function encodeWav(samples, sampleRate = TARGET_RATE) {
    const bytes = new Uint8Array(44 + samples.length * 2)
    const view = new DataView(bytes.buffer)
    const write = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
    write(0, "RIFF")
    view.setUint32(4, 36 + samples.length * 2, true)
    write(8, "WAVE")
    write(12, "fmt ")
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // mono
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    write(36, "data")
    view.setUint32(40, samples.length * 2, true)
    samples.forEach((s, i) => {
        const clamped = Math.max(-1, Math.min(1, s))
        view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    })
    return bytes
}

/** Average channels to mono, linear-resample to 16 kHz, cap at maxSeconds. */
export function toMono16k(channels, inputRate, { maxSeconds = MAX_AUDIO_SECONDS } = {}) {
    const length = channels[0].length
    const mono = new Float32Array(length)
    for (const channel of channels) for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length

    const outLength = Math.min(Math.floor((length * TARGET_RATE) / inputRate), TARGET_RATE * maxSeconds)
    const out = new Float32Array(outLength)
    const ratio = inputRate / TARGET_RATE
    for (let i = 0; i < outLength; i++) {
        const position = i * ratio
        const index = Math.floor(position)
        const next = Math.min(index + 1, length - 1)
        const fraction = position - index
        out[i] = mono[index] * (1 - fraction) + mono[next] * fraction
    }
    return out
}

function bytesToBase64(bytes) {
    let binary = ""
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
}

function base64ToBytes(base64) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

async function browserDecode(bytes) {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!Context) throw new Error("This WebView cannot decode audio (no AudioContext)")
    const context = new Context()
    try {
        const buffer = await context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
        return { channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), sampleRate: buffer.sampleRate }
    } finally {
        context.close?.()
    }
}

/**
 * Returns messages with every audio part re-encoded as 16 kHz mono WAV. Other parts are returned as the same objects.
 * @param {any[]} messages
 * @param {{ decode?: (bytes: Uint8Array) => Promise<{ channels: Float32Array[], sampleRate: number }>, onError?: (error: Error) => void }} [options]
 */
export async function prepareAudioParts(messages, { decode = browserDecode, onError } = {}) {
    return Promise.all(
        messages.map(async (message) => {
            if (!Array.isArray(message.content)) return message
            const content = await Promise.all(
                message.content.map(async (part) => {
                    if (part?.type !== "audio" || typeof part.data !== "string") return part
                    try {
                        const bytes = base64ToBytes(part.data.slice(part.data.indexOf(",") + 1))
                        const { channels, sampleRate } = await decode(bytes)
                        const wav = encodeWav(toMono16k(channels, sampleRate))
                        return { ...part, data: `data:audio/wav;base64,${bytesToBase64(wav)}` }
                    } catch (error) {
                        onError?.(error)
                        return part
                    }
                })
            )
            return { ...message, content }
        })
    )
}
