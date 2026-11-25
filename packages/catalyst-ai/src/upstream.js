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

module.exports = { upstreamSignal, clientGoneSignal, GENERATE_MS, MEDIA_MS, TOKEN_MS }
