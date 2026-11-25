// Deadlines and disconnect handling for the calls this server makes to AI providers. The streaming routes already abort when the
// browser goes away; the plain JSON routes (generate, image, speech, live-token) did not, so a stalled provider could keep the
// request, the parsed (possibly multi-megabyte) body and the provider connection alive for as long as the provider liked.

const GENERATE_MS = 120_000
const MEDIA_MS = 180_000 // images and speech: matches the client's own 180 s limit
const TOKEN_MS = 30_000

/** A signal that aborts after `ms`, or as soon as `clientSignal` (the browser going away) aborts, whichever comes first. */
function upstreamSignal(ms, clientSignal) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`The provider did not answer within ${Math.round(ms / 1000)} s`)), ms)
    timer.unref?.() // never keep the process alive for a deadline
    if (clientSignal) {
        if (clientSignal.aborted) controller.abort()
        else clientSignal.addEventListener("abort", () => controller.abort(), { once: true })
    }
    return controller.signal
}

/** Aborts when the response closes before it finished: the caller hung up, so there is nobody to answer. */
function clientGoneSignal(res) {
    const controller = new AbortController()
    // Express always has `on`; a bare test double may not.
    if (typeof res?.on === "function") {
        res.on("close", () => {
            if (!res.writableFinished) controller.abort()
        })
    }
    return controller.signal
}

/**
 * Reads a provider response body, stopping as soon as it exceeds `maxBytes`. A missing or wrong content-length no longer lets the
 * whole body be buffered first (`arrayBuffer()` and `json()` read everything before any size can be checked).
 */
async function readBodyLimited(response, maxBytes) {
    const tooLarge = () => Object.assign(new Error(`The provider's response is larger than the allowed ${maxBytes} bytes`), { code: "RESPONSE_TOO_LARGE" })
    const declared = Number(response.headers?.get?.("content-length"))
    if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge()
    if (!response.body || typeof response.body.getReader !== "function") {
        const whole = Buffer.from(await response.arrayBuffer())
        if (whole.length > maxBytes) throw tooLarge()
        return whole
    }
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > maxBytes) {
            reader.cancel().catch(() => {})
            throw tooLarge()
        }
        chunks.push(value)
    }
    return Buffer.concat(chunks)
}

async function readJsonLimited(response, maxBytes) {
    // A response object with no body to read (a test double with only json()) cannot be bounded: use it as it is.
    if (!response.body && typeof response.arrayBuffer !== "function" && typeof response.json === "function") return response.json()
    return JSON.parse((await readBodyLimited(response, maxBytes)).toString("utf8"))
}

module.exports = { upstreamSignal, clientGoneSignal, readBodyLimited, readJsonLimited, GENERATE_MS, MEDIA_MS, TOKEN_MS }
