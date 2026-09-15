// Catalyst's SSR renderer uses react-dom/server's Node streaming API
// (renderToPipeableStream/resumeToPipeableStream, piping to the Express response). On
// the Workers runtime that stream never completes and the request hangs, so both are
// replaced with implementations backed by react-dom/server.edge's Web-Streams API
// (renderToReadableStream/resume).
//
// `start()`'s returned promise still resolves at the real "shell ready" moment (fast —
// independent of any still-suspended content inside the tree, which renders its
// fallback into the shell instead of blocking it), so onShellReady fires then, same as
// Node's real timing. onAllReady only fires once the stream truly ends (including
// anything that was suspended, resolved and flushed later). But the actual byte
// delivery to `destination` is single-shot, not incremental — see writeAllAndEnd's
// comment for why.
//
// pipe(destination) has to work whichever callback the caller invokes it from:
// handler.jsx's classic path pipes from onShellReady, its PPR resume path pipes from
// onAllReady (i.e. after draining has already finished) — both end up going through
// writeAllAndEnd with whatever's in `html` at that point.
//
// aliased for the bare `react-dom/server` specifier only; the import below uses
// `react-dom/server.edge` (the Web-Streams build react-dom's own `workerd` export
// condition selects), so there's no self-recursion and it resolves on the Workers runtime.
export * from "react-dom/server.edge"
import { renderToReadableStream, resume } from "react-dom/server.edge"

// `destination` here is a real Node stream (handler.jsx's `tail` Transform, itself
// piped to `res` via real `tail.pipe(res)`) — NOT the fetch-style object this shim
// otherwise imitates.
//
// This used to forward each chunk to `destination.write()` live as it was decoded off
// the webStream reader, matching real react-dom/server's incremental streaming. Under
// workerd that reliably delivered only the FIRST written chunk to the client and then
// stalled: `tail`'s writable side never reached 'finish' even after `.end()`, and
// nothing past that first chunk reached `res` — a many-small-writes pattern into a
// Transform piped to http.ServerResponse doesn't appear to fully drain through
// workerd's Node-compat bridge (no public documentation confirms the exact mechanism;
// empirically, collapsing to a single write reliably avoids it). So on this runtime
// the whole render is buffered here first (`html` — already collected for the
// PPR-resume case below) and flushed to each destination in exactly one write() + one
// end(), waiting for the destination's own 'finish' before letting onAllReady resolve
// handler.jsx's render Promise. This trades true incremental streaming (shell first,
// dynamic content flushed as it resolves) for correctness — the shell/PPR split still
// keeps onShellReady firing at the real "shell ready" moment, but the byte flush
// itself is single-shot rather than progressive.
function writeAllAndEnd(destination, html) {
    return new Promise((resolve, reject) => {
        destination.once("finish", resolve)
        destination.once("error", reject)
        if (html) destination.write(Buffer.from(html, "utf8"))
        destination.end()
    })
}

function streamingPipeableStream(start, options) {
    let html = ""
    let finished = false
    let error = null
    const destinations = []

    ;(async () => {
        let webStream
        try {
            webStream = await start()
        } catch (e) {
            const onErr = options.onShellError || options.onError
            if (onErr) onErr(e)
            return
        }

        if (options.onShellReady) options.onShellReady()

        try {
            const reader = webStream.getReader()
            const decoder = new TextDecoder()
            for (;;) {
                const { done, value } = await reader.read()
                if (done) break
                html += decoder.decode(value, { stream: true })
            }
            await Promise.all(destinations.map((d) => writeAllAndEnd(d, html)))
        } catch (e) {
            error = e
            if (options.onError) options.onError(e)
            return
        }

        finished = true
        if (options.onAllReady) options.onAllReady()
    })()

    return {
        pipe(destination) {
            if (error || !destination) return destination
            if (finished) {
                // Draining already finished before pipe() was called (PPR resume,
                // piped from onAllReady) — write everything accumulated in one shot.
                writeAllAndEnd(destination, html)
            } else {
                // Still draining (classic mode, piped from onShellReady) — this
                // destination gets the single buffered write once the read loop above
                // finishes.
                destinations.push(destination)
            }
            return destination
        },
        abort() {},
    }
}

export function renderToPipeableStream(node, options = {}) {
    return streamingPipeableStream(() => renderToReadableStream(node, { onError: options.onError }), options)
}

// PPR's resume phase (handler.jsx's _renderMarkUpPPR) — same streaming, driven by
// react-dom/server.edge's `resume` instead of a fresh render.
export function resumeToPipeableStream(node, postponedState, options = {}) {
    return streamingPipeableStream(
        () => resume(node, postponedState, { onError: options.onError }),
        options,
    )
}
