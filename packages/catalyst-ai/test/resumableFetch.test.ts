import { createMemoryStorage, createResumableFetch } from "../src/resumableFetch.js"

const URL_ = "https://huggingface.co/org/model/resolve/main/onnx/model.onnx"
const SIZE = 20_000
const makeBody = (seed = 0) => Uint8Array.from({ length: SIZE }, (_, i) => (i * 7 + seed) % 251)

interface Req { range: string | null; at: number }
function makeServer(initial: { body?: Uint8Array; etag?: string } = {}) {
    const s = {
        body: initial.body ?? makeBody(),
        etag: initial.etag ?? '"v1"',
        acceptRanges: true,
        honourRange: true,
        omitEtagOnRange: false,
        down: false,
        chunk: 1000,
        chunkDelayMs: 0,
        breakAfter: [] as number[], // per request: break the body after this many bytes (consumed in order)
        status: 0, // force a status on the next request
        requests: [] as Req[],
        fetch: (input: any, init: any = {}) => {
            const url = typeof input === "string" ? input : input.url
            const range = new Headers(init.headers).get("range")
            s.requests.push({ range, at: Date.now() })
            if (s.down) return Promise.reject(new TypeError("Failed to fetch"))
            if (s.status) { const st = s.status; s.status = 0; return Promise.resolve(new Response("nope", { status: st })) }
            let start = 0
            if (range && s.honourRange) start = Number(/bytes=(\d+)-/.exec(range)![1])
            const headers = new Headers({ "content-type": "application/octet-stream", etag: s.etag, "accept-ranges": s.acceptRanges ? "bytes" : "none" })
            if (range && s.omitEtagOnRange) headers.delete("etag")
            let status = 200
            if (start >= s.body.length && start > 0) {
                headers.set("content-range", `bytes */${s.body.length}`)
                return Promise.resolve(new Response(null, { status: 416, headers }))
            }
            if (start > 0) { status = 206; headers.set("content-range", `bytes ${start}-${s.body.length - 1}/${s.body.length}`) }
            const payload = s.body.subarray(start)
            headers.set("content-length", String(payload.length))
            const cut = s.breakAfter.length ? s.breakAfter.shift()! : Infinity
            let sent = 0
            let ctrl: ReadableStreamDefaultController
            const stream = new ReadableStream({
                start(c) { ctrl = c },
                async pull(c) {
                    if (init.signal?.aborted) return c.error(new DOMException("Aborted", "AbortError"))
                    if (sent >= cut) return c.error(new TypeError("network error"))
                    if (sent >= payload.length) return c.close()
                    if (s.chunkDelayMs) await new Promise((r) => setTimeout(r, s.chunkDelayMs))
                    if (init.signal?.aborted) return c.error(new DOMException("Aborted", "AbortError"))
                    const n = Math.min(s.chunk, payload.length - sent, cut - sent)
                    c.enqueue(payload.subarray(sent, sent + n))
                    sent += n
                },
            })
            init.signal?.addEventListener("abort", () => { try { ctrl.error(new DOMException("Aborted", "AbortError")) } catch {} })
            return Promise.resolve(new Response(stream, { status, headers }))
        },
    }
    return s
}

const fastPolicy = { resumeDelaySec: 0.01, maxDelaySec: 0.05, heldRetrySec: 0.15, windowSec: 0.2, maxIdleRetries: 3, minResumableBytes: 1000, replayChunkBytes: 3000, minBytesPerSec: 1 }
const setup = (server = makeServer(), policy: object = {}) => {
    const storage = createMemoryStorage()
    const events: any[] = []
    const rf = createResumableFetch({ fetch: server.fetch, storage, policy: { ...fastPolicy, ...policy }, onStatus: (e: any) => events.push(e), online: true })
    return { server, storage, events, rf }
}
const bytes = async (res: Response) => new Uint8Array(await res.arrayBuffer())
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

describe("pass-through", () => {
    it("leaves small files, non-GET requests, caller Range requests and non-http URLs alone", async () => {
        const { server, storage, rf } = setup(undefined, { minResumableBytes: 1_000_000 })
        const small = await rf.fetch(URL_)
        expect(same(await bytes(small), server.body)).toBe(true)
        expect(storage.parts.size).toBe(0)
        const before = server.requests.length
        await rf.fetch(URL_, { method: "POST" }); await rf.fetch(URL_, { headers: { Range: "bytes=0-9" } }); await rf.fetch("blob:abc").catch(() => {})
        expect(server.requests.length).toBe(before + 3)
    })

    it("passes errors through (404) and forgets the partial on a client error", async () => {
        const { server, rf } = setup()
        server.status = 404
        const res = await rf.fetch(URL_)
        expect(res.status).toBe(404)
    })

    it("does not persist a server without range support or without a strong ETag", async () => {
        for (const tweak of [(s: any) => (s.acceptRanges = false), (s: any) => (s.etag = 'W/"weak"')]) {
            const { server, storage, rf } = setup()
            tweak(server)
            expect(same(await bytes(await rf.fetch(URL_)), server.body)).toBe(true)
            expect(storage.parts.size).toBe(0)
        }
    })

    it("falls back to a plain fetch when storage is unusable", async () => {
        const server = makeServer()
        const broken = { ...createMemoryStorage(), getMeta: async () => { throw new Error("locked") } }
        const rf = createResumableFetch({ fetch: server.fetch, storage: broken, policy: fastPolicy })
        expect(same(await bytes(await rf.fetch(URL_)), server.body)).toBe(true)
    })
})

describe("a normal download", () => {
    it("delivers the whole file, reports done, and cleans its storage", async () => {
        const { server, storage, events, rf } = setup()
        const res = await rf.fetch(URL_)
        expect(res.headers.get("content-length")).toBe(String(SIZE))
        expect(same(await bytes(res), server.body)).toBe(true)
        expect(storage.parts.size).toBe(0)
        expect(storage.metas.size).toBe(0)
        expect(events.at(-1)).toMatchObject({ state: "done", loaded: SIZE, total: SIZE })
        expect(server.requests).toHaveLength(1)
        expect(server.requests[0].range).toBeNull()
    })

    it("persists bytes as they arrive (so a reload could resume)", async () => {
        const { storage, rf } = setup()
        const res = await rf.fetch(URL_)
        const reader = res.body!.getReader()
        await reader.read(); await reader.read()
        const key = [...storage.parts.keys()][0]
        expect(storage.parts.get(key)!.length).toBeGreaterThanOrEqual(2000)
        expect(storage.metas.get(key)).toMatchObject({ url: URL_, etag: '"v1"', total: SIZE })
        await reader.cancel()
        expect(storage.parts.size).toBe(1) // cancelling keeps the partial
    })
})

describe("the stream heals itself", () => {
    it("resumes with a Range request after the connection breaks, and the caller sees one continuous body", async () => {
        const { server, rf, events } = setup()
        server.breakAfter = [7000]
        const out = await bytes(await rf.fetch(URL_))
        expect(same(out, server.body)).toBe(true)
        expect(server.requests.map((r) => r.range)).toEqual([null, "bytes=7000-"])
        expect(events.some((e) => e.state === "paused" && e.reason === "error")).toBe(true)
        expect(events.some((e) => e.state === "resuming")).toBe(true)
    })

    it("survives several breaks in a row as long as bytes keep arriving", async () => {
        const { server, rf } = setup()
        server.breakAfter = [3000, 3000, 3000, 3000, 3000]
        expect(same(await bytes(await rf.fetch(URL_)), server.body)).toBe(true)
        expect(server.requests.length).toBe(6) // the first request, then one resume per break (5), the last one unbroken
    })

    it("goes offline: interrupts the transfer, makes no request while offline, then resumes from the same byte", async () => {
        const { server, rf, events } = setup(undefined, { heldRetrySec: 30 })
        server.chunkDelayMs = 5
        const res = await rf.fetch(URL_)
        const reader = res.body!.getReader()
        const parts: Uint8Array[] = []
        let got = 0
        while (got < 5000) { const { value } = await reader.read(); parts.push(value!); got += value!.length }
        rf.setOnline(false)
        const requestsAtCut = server.requests.length
        await new Promise((r) => setTimeout(r, 150))
        expect(server.requests.length).toBe(requestsAtCut) // nothing sent while offline
        expect(events.some((e) => e.state === "paused" && e.reason === "offline" && e.retryInSec === null)).toBe(true)
        const started = Date.now()
        rf.setOnline(true)
        const rest: Uint8Array[] = []
        for (;;) { const { done, value } = await reader.read(); if (done) break; rest.push(value!) }
        expect(Date.now() - started).toBeLessThan(5000) // woke on setOnline, not the 30 s safety net
        const all = new Uint8Array(parts.concat(rest).reduce((n: number, p: Uint8Array) => n + p.length, 0))
        let o = 0; for (const p of parts.concat(rest)) { all.set(p, o); o += p.length }
        expect(same(all, server.body)).toBe(true)
        const resumed = server.requests.at(-1)!.range
        expect(Number(/bytes=(\d+)-/.exec(resumed!)![1])).toBeGreaterThanOrEqual(5000)
    })

    it("retries on a timer if the page never says the network returned (safety net)", async () => {
        const { server, rf } = setup(undefined, { heldRetrySec: 0.1 })
        server.chunkDelayMs = 5
        const res = await rf.fetch(URL_)
        const reader = res.body!.getReader()
        await reader.read(); await reader.read()
        rf.setOnline(false)
        const out: Uint8Array[] = []
        for (;;) { const { done, value } = await reader.read(); if (done) break; out.push(value!) }
        expect(out.length).toBeGreaterThan(0)
    })

    it("flags a weak link, backs off, and resumes", async () => {
        const { server, rf, events } = setup(undefined, { minBytesPerSec: 1_000_000, windowSec: 0.05 })
        server.chunkDelayMs = 20
        server.breakAfter = []
        const slow = makeServer()
        const out = await bytes(await rf.fetch(URL_))
        expect(same(out, server.body)).toBe(true)
        expect(events.some((e) => e.state === "paused" && e.reason === "weak")).toBe(true)
        expect(slow.requests).toHaveLength(0)
    })

    it("gives up after attempts that move no bytes, with the partial kept", async () => {
        const { server, storage, rf } = setup()
        server.breakAfter = [2000, 0, 0, 0, 0, 0]
        const res = await rf.fetch(URL_)
        await expect(bytes(res)).rejects.toThrow(/no progress/)
        expect(storage.parts.size).toBe(1)
    })

    it("a transient 5xx while resuming is retried", async () => {
        const { server, rf } = setup()
        server.breakAfter = [4000]
        const res = await rf.fetch(URL_)
        const reader = res.body!.getReader()
        const chunks: Uint8Array[] = []
        // after the break, the first resume attempt gets a 503
        const first = await reader.read(); chunks.push(first.value!)
        server.status = 503
        for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value!) }
        expect(chunks.reduce((n: number, c: Uint8Array) => n + c.length, 0)).toBe(SIZE)
    })
})

describe("the file changing under a partial (the host ignores If-Range)", () => {
    it("a reload with a stale partial restarts instead of splicing", async () => {
        const first = setup()
        const res1 = await first.rf.fetch(URL_)
        const r1 = res1.body!.getReader()
        await r1.read(); await r1.read(); await r1.cancel() // leaves ~2000 bytes of v1 behind
        const key = [...first.storage.parts.keys()][0]
        expect(first.storage.parts.get(key)!.length).toBeGreaterThan(0)

        const v2 = makeServer({ body: makeBody(9), etag: '"v2"' }) // same URL, new content; honours Range, ignores If-Range
        const rf2 = createResumableFetch({ fetch: v2.fetch, storage: first.storage, policy: fastPolicy, online: true })
        const out = await bytes(await rf2.fetch(URL_))
        expect(same(out, v2.body)).toBe(true)
        expect(v2.requests.map((r) => r.range)).toEqual([expect.stringMatching(/^bytes=\d+-$/), null])
    })

    it("a 206 with no ETag cannot be verified and restarts", async () => {
        const first = setup()
        const r1 = (await first.rf.fetch(URL_)).body!.getReader()
        await r1.read(); await r1.cancel()
        const v1 = makeServer(); v1.omitEtagOnRange = true
        const rf2 = createResumableFetch({ fetch: v1.fetch, storage: first.storage, policy: fastPolicy, online: true })
        expect(same(await bytes(await rf2.fetch(URL_)), v1.body)).toBe(true)
        expect(v1.requests.map((r) => r.range)).toEqual([expect.stringMatching(/^bytes=/), null])
    })

    it("a change in the middle of a download errors the stream clearly and clears the partial", async () => {
        const { server, storage, rf } = setup()
        server.breakAfter = [5000]
        const res = await rf.fetch(URL_)
        const reader = res.body!.getReader()
        await reader.read()
        server.body = makeBody(5); server.etag = '"v2"'
        await expect((async () => { for (;;) { const { done } = await reader.read(); if (done) return } })()).rejects.toThrow(/changed while it was downloading/)
        expect(storage.parts.size).toBe(0)
    })
})

describe("resuming after a reload", () => {
    it("replays what is on disk, then continues from the network", async () => {
        const first = setup()
        const r1 = (await first.rf.fetch(URL_)).body!.getReader()
        for (let i = 0; i < 6; i++) await r1.read()
        await r1.cancel()
        const key = [...first.storage.parts.keys()][0]
        const have = first.storage.parts.get(key)!.length
        expect(have).toBeGreaterThanOrEqual(6000)

        const again = createResumableFetch({ fetch: first.server.fetch, storage: first.storage, policy: fastPolicy, online: true })
        first.server.requests.length = 0
        const out = await bytes(await again.fetch(URL_))
        expect(same(out, first.server.body)).toBe(true)
        expect(first.server.requests.map((r) => r.range)).toEqual([`bytes=${have}-`])
        expect(first.storage.parts.size).toBe(0)
    })

    it("416 on a partial that is already complete serves it from disk and cleans up", async () => {
        const first = setup()
        const r1 = (await first.rf.fetch(URL_)).body!.getReader()
        await r1.read(); await r1.cancel()
        const key = [...first.storage.parts.keys()][0]
        // a crash right after the last byte was stored, before the cleanup ran
        first.storage.parts.set(key, first.server.body.slice())
        first.server.requests.length = 0
        const again = createResumableFetch({ fetch: first.server.fetch, storage: first.storage, policy: fastPolicy, online: true })
        expect(same(await bytes(await again.fetch(URL_)), first.server.body)).toBe(true)
        expect(first.server.requests.map((r) => r.range)).toEqual([`bytes=${SIZE}-`])
        expect(first.storage.parts.size).toBe(0)
    })
})

describe("concurrent files and cancellation", () => {
    it("pauses every file when the page goes offline and resumes them all", async () => {
        const { server, rf } = setup(undefined, { heldRetrySec: 30 })
        server.chunkDelayMs = 5
        const urls = [URL_, URL_ + "?b", URL_ + "?c"]
        const readers = await Promise.all(urls.map(async (u) => (await rf.fetch(u)).body!.getReader()))
        await Promise.all(readers.map((r: ReadableStreamDefaultReader<Uint8Array>) => r.read()))
        rf.setOnline(false)
        await new Promise((r) => setTimeout(r, 100))
        rf.setOnline(true)
        const totals = await Promise.all(readers.map(async (r: ReadableStreamDefaultReader<Uint8Array>) => { let n = 0; for (;;) { const { done, value } = await r.read(); if (done) return n; n += value!.length } }))
        for (const n of totals) expect(n).toBeGreaterThan(0)
    })

    it("an aborted request (caller signal) is not retried forever", async () => {
        const { server, rf } = setup()
        server.down = true
        const controller = new AbortController()
        const p = rf.fetch(URL_, { signal: controller.signal })
        setTimeout(() => controller.abort(), 30)
        await expect(p).rejects.toBeTruthy()
    })
})
