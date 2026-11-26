// One signal for a client request: it aborts when the caller's signal does, or when the deadline passes, on every runtime.
// `AbortSignal.timeout` and `AbortSignal.any` are not everywhere; when only one existed the deadline silently disappeared
// (or a caller's signal replaced it). This uses a plain AbortController and a timer, so the deadline always holds.

/**
 * @param {AbortSignal | undefined} callerSignal
 * @param {number} ms
 * @returns {{ signal: AbortSignal, done: () => void }} `done` clears the timer once the request has finished.
 */
export function withDeadline(callerSignal, ms) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`The request took longer than ${Math.round(ms / 1000)} s`)), ms)
    const onCaller = () => controller.abort(callerSignal?.reason)
    if (callerSignal) {
        if (callerSignal.aborted) onCaller()
        else callerSignal.addEventListener("abort", onCaller, { once: true })
    }
    return {
        signal: controller.signal,
        done: () => {
            clearTimeout(timer)
            callerSignal?.removeEventListener("abort", onCaller)
        },
    }
}
