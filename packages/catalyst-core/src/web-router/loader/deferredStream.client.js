import { decode } from "turbo-stream"

/**
 * Decodes `window.__CATALYST_LOADER_DATA__` (written by deferredStream.server.js)
 * back into a `{ [routeId]: Promise }` map matching what buildLoaderPromiseMap
 * produces server-side, so RouteDataProvider's first render (hydration) reads
 * an equivalent value instead of re-fetching anything the server already
 * resolved. Every field is a plain resolved value by the time the server
 * serializes it (see deferredStream.server.js's flush()-timing note) — wrapped
 * in Promise.resolve() here so `use()` reads it synchronously on the client
 * too, exactly like it did during SSR.
 *
 * @returns {Promise<Object.<string, Promise<any>>>} empty object if nothing was serialized
 */
export const decodeLoaderData = async () => {
    const encoded = typeof window !== "undefined" ? window.__CATALYST_LOADER_DATA__ : undefined
    if (!encoded) return {}

    const text = atob(encoded)
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(text)
            controller.close()
        },
    })

    const decoded = await decode(stream)
    return Object.fromEntries(Object.entries(decoded).map(([id, value]) => [id, Promise.resolve(value)]))
}
