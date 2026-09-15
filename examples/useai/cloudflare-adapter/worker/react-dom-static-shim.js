// Catalyst's PPR/static renderer uses react-dom/static's Node stream API
// (prerenderToNodeStream), which the Node build backs with a Node Readable
// and workerd doesn't ship. The Web-Streams build react-dom's own `workerd`
// export condition selects (react-dom/static.edge, imported below) exposes
// the same underlying prerender via `prerender`, resolving `{ postponed,
// prelude }` where `prelude` is a Web ReadableStream instead of a Node one.
//
// `prerender` and `resume` (see react-dom-server-shim.js) come from the exact
// same internal module in both the edge and node builds, so a postponed
// state produced by this prerender is resumable by that shim's
// resumeToPipeableStream — the pairing only needs to be self-consistent
// within one build, which it is here (both edge).
//
// aliased for the bare `react-dom/static` specifier only; the import below
// uses `react-dom/static.edge` directly, so there's no self-recursion.
export * from "react-dom/static.edge"
import { prerender } from "react-dom/static.edge"

// Minimal Node-Readable-like wrapper around a Web ReadableStream — just
// enough of the `.on('data'|'end'|'error')` surface for handler.jsx's
// collectStream() to drain it into a Buffer.
function toNodeReadable(webStream) {
    const listeners = { data: [], end: [], error: [] }
    const emitter = {
        on(event, cb) {
            ;(listeners[event] || (listeners[event] = [])).push(cb)
            return emitter
        },
    }
    ;(async () => {
        const reader = webStream.getReader()
        try {
            for (;;) {
                const { done, value } = await reader.read()
                if (done) break
                for (const cb of listeners.data) cb(Buffer.from(value))
            }
            for (const cb of listeners.end) cb()
        } catch (err) {
            for (const cb of listeners.error) cb(err)
        }
    })()
    return emitter
}

export async function prerenderToNodeStream(node, options = {}) {
    const result = await prerender(node, options)
    return {
        prelude: result.prelude ? toNodeReadable(result.prelude) : null,
        postponed: result.postponed,
    }
}
