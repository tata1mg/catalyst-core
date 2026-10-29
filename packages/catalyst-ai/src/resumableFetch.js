// A fetch for large model files that survives a bad connection, for the in-browser engine (Transformers.js takes it as
// `env.fetch`). Native downloads got the same treatment in the iOS/Android downloaders (see ResumableDownloader.kt and
// Support/ResumableDownload.swift); keep the rules in step.
//
// The idea: hand Transformers.js a Response whose body keeps going when the network does not. When the connection
// drops, goes offline or turns too slow, the stream pauses, waits, and asks for the rest with `Range: bytes=N-`,
// then carries on. The caller never sees the interruption. Bytes are also written to storage as they arrive, so a
// page reload resumes too instead of starting a multi-gigabyte download again.
//
// Rules worth knowing:
//  - Hugging Face's CDN ignores `If-Range` and answers 206 whatever validator is sent, so the ETag on every resumed
//    response is compared with the stored one. A different or missing ETag means the file changed (or cannot be
//    verified): the partial is thrown away rather than spliced.
//  - Only big files with a strong ETag and byte-range support are persisted. Everything else (config.json, tokenizers,
//    a server without ranges) passes through untouched.
//
// createResumableFetch is ONE self-contained function (everything it needs is nested inside) because the inference
// worker is a Blob script and embeds it with Function.prototype.toString(). Do not reference module-level names in it.

export function createResumableFetch(options = {}) {
    const baseFetch = options.fetch || ((...args) => fetch(...args))
    const storage = options.storage
    const onStatus = options.onStatus || (() => {})
    const log = options.log || (() => {})
    const policy = Object.assign(
        {
            minBytesPerSec: 50000,
            windowSec: 20,
            resumeDelaySec: 10,
            maxDelaySec: 120,
            maxIdleRetries: 8,
            heldRetrySec: 120,
            minResumableBytes: 8 * 1024 * 1024,
            replayChunkBytes: 4 * 1024 * 1024,
        },
        options.policy || {}
    )

    let online = options.online !== undefined ? options.online : typeof navigator === "undefined" || navigator.onLine !== false
    const active = new Set() // AbortControllers of transfers in flight
    const sleepers = new Set() // wake functions of backoff waits

    function wakeSleepers() {
        for (const wake of [...sleepers]) wake(true)
    }

    // Resolves true when woken early (the page said the network is back), false when the time ran out.
    function nap(seconds) {
        return new Promise((resolve) => {
            let timer = null
            const done = (woken) => {
                clearTimeout(timer)
                sleepers.delete(done)
                resolve(woken)
            }
            sleepers.add(done)
            timer = setTimeout(() => done(false), Math.max(seconds, 0) * 1000)
        })
    }

    const isStrong = (etag) => !!etag && !String(etag).startsWith("W/")
    const toInt = (value) => {
        const n = Number.parseInt(value, 10)
        return Number.isFinite(n) ? n : null
    }
    const fileLabel = (url) => url.split("?")[0].split("/").slice(-2).join("/")

    function hashKey(text) {
        let h = 2166136261
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i)
            h = Math.imul(h, 16777619)
        }
        return (h >>> 0).toString(16) + "-" + text.length
    }

    function parseContentRange(header) {
        const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec((header || "").trim())
        if (m) return { start: Number(m[1]), end: Number(m[2]), total: m[3] === "*" ? null : Number(m[3]) }
        const star = /^bytes\s+\*\/(\d+)$/i.exec((header || "").trim())
        return star ? { start: null, end: null, total: Number(star[1]) } : null
    }

    // What a response means for a download that is `offset` bytes in (0 = we asked for the whole file).
    function interpret(res, offset, expectedETag) {
        const range = parseContentRange(res.headers.get("content-range"))
        const etag = res.headers.get("etag")
        if (res.status === 206) {
            if (!(offset > 0 && range && range.start === offset && range.total !== null && range.total > offset)) return { kind: "restart" }
            if (expectedETag && (etag || "").trim() !== expectedETag) return { kind: "restart" }
            return { kind: "append", total: range.total }
        }
        if (res.status === 200) return { kind: "full", total: toInt(res.headers.get("content-length")) }
        if (res.status === 416) return offset > 0 && range && range.total === offset ? { kind: "complete", total: offset } : { kind: "restart" }
        return { kind: "fail" }
    }

    function backoff(attempt) {
        return Math.min(policy.maxDelaySec, policy.resumeDelaySec * Math.pow(2, Math.max(attempt - 1, 0)))
    }

    // Bytes per second over a sliding window, started by the first chunk. Returns the rate when it is too low.
    function makeWindow() {
        let start = null
        let bytes = 0
        return (count) => {
            const now = Date.now()
            if (start === null) {
                start = now
                bytes = 0
                return null
            }
            bytes += count
            const elapsed = (now - start) / 1000
            if (elapsed < policy.windowSec) return null
            const rate = bytes / elapsed
            start = now
            bytes = 0
            return rate < policy.minBytesPerSec ? rate : null
        }
    }

    function mergeHeaders(initHeaders, extra) {
        const headers = new Headers(initHeaders || {})
        for (const [name, value] of Object.entries(extra)) headers.set(name, value)
        return headers
    }

    // One request, tracked so setOnline(false) can interrupt it.
    async function send(url, init, rangeFrom) {
        const controller = new AbortController()
        active.add(controller)
        if (init.signal) {
            if (init.signal.aborted) controller.abort()
            else init.signal.addEventListener("abort", () => controller.abort(), { once: true })
        }
        const extra = rangeFrom > 0 ? { Range: "bytes=" + rangeFrom + "-" } : {}
        try {
            const res = await baseFetch(url, Object.assign({}, init, { headers: mergeHeaders(init.headers, extra), signal: controller.signal }))
            return { res, controller }
        } catch (error) {
            active.delete(controller)
            throw error
        }
    }

    // A request that waits out being offline and retries transient failures with backoff, so the caller of fetch()
    // does not see "Failed to fetch" for a connection that comes back in a minute.
    async function sendPatiently(url, init, rangeFrom, label, received) {
        let idle = 0
        for (;;) {
            if (!online) {
                onStatus({ file: label, state: "paused", reason: "offline", retryInSec: null, loaded: received })
                const woken = await nap(policy.heldRetrySec)
                if (!woken) online = true // safety net: the page never said the network came back, so try anyway
                onStatus({ file: label, state: "resuming", loaded: received })
            }
            if (init.signal && init.signal.aborted) throw new DOMException("Aborted", "AbortError")
            try {
                return await send(url, init, rangeFrom)
            } catch (error) {
                if (init.signal && init.signal.aborted) throw error
                idle += 1
                if (idle > policy.maxIdleRetries) throw error
                const delay = backoff(idle)
                log("request failed (" + (error && error.message) + "); retrying in " + delay + "s")
                onStatus({ file: label, state: "paused", reason: online ? "error" : "offline", retryInSec: Math.ceil(delay), loaded: received })
                await nap(delay)
                onStatus({ file: label, state: "resuming", loaded: received })
            }
        }
    }

    async function safeRemove(key) {
        try {
            await storage.remove(key)
        } catch (error) {
            log("could not remove partial: " + (error && error.message))
        }
    }

    async function resumableFetch(input, init = {}) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        const method = String(init.method || (typeof input === "object" && input.method) || "GET").toUpperCase()
        const callerHeaders = new Headers(init.headers || (typeof input === "object" && input.headers) || {})
        if (!storage || method !== "GET" || callerHeaders.has("range") || !/^https?:/i.test(url)) return baseFetch(input, init)

        const key = hashKey(url)
        const label = fileLabel(url)
        let meta = null
        let have = 0
        try {
            meta = await storage.getMeta(key)
            have = meta && meta.url === url ? await storage.size(key) : 0
            if (!(have > 0 && isStrong(meta && meta.etag))) {
                if (meta || have) await safeRemove(key)
                meta = null
                have = 0
            }
        } catch (error) {
            log("storage unavailable (" + (error && error.message) + "); not resumable")
            return baseFetch(input, init)
        }

        const baseInit = Object.assign({}, init, { headers: callerHeaders })
        let attempt = await sendPatiently(url, baseInit, have, label, have)
        let outcome = interpret(attempt.res, have, meta && meta.etag)

        if (outcome.kind === "restart" && have > 0) {
            // Wrong place, or the file changed since the partial was written: start over.
            attempt.controller.abort()
            active.delete(attempt.controller)
            await safeRemove(key)
            meta = null
            have = 0
            attempt = await sendPatiently(url, baseInit, 0, label, 0)
            outcome = interpret(attempt.res, 0, null)
        }

        const { res } = attempt
        const finish = () => active.delete(attempt.controller)

        if (outcome.kind === "complete") {
            // The partial is already the whole file.
            finish()
            const body = replayStream(key, 0, have, () => safeRemove(key))
            return new Response(body, { status: 200, headers: responseHeaders(res, have, meta && meta.etag) })
        }
        if (outcome.kind === "fail") {
            finish()
            if (have > 0 && res.status >= 500) {
                // A transient server error with a partial on disk: keep it and try again rather than failing the load.
                const delay = backoff(1)
                onStatus({ file: label, state: "paused", reason: "error", retryInSec: Math.ceil(delay), loaded: have })
                await nap(delay)
                return resumableFetch(input, init)
            }
            if (res.status >= 400 && res.status < 500) await safeRemove(key)
            return res
        }

        let total
        let resumed = false
        if (outcome.kind === "append") {
            total = outcome.total
            resumed = true
        } else {
            // 200: the whole file. Persist only what is worth resuming.
            const etag = res.headers.get("etag")
            const length = outcome.total
            const eligible = res.ok && isStrong(etag) && /bytes/i.test(res.headers.get("accept-ranges") || "") && length !== null && length >= policy.minResumableBytes
            if (have > 0) await safeRemove(key)
            if (!eligible) return res
            have = 0
            total = length
        }
        const etag = resumed ? meta.etag : res.headers.get("etag")
        try {
            await storage.setMeta(key, { url, etag, total })
        } catch (error) {
            log("could not record the download (" + (error && error.message) + "); not resumable")
            finish()
            return resumed ? baseFetch(input, init) : res
        }

        if (resumed) log("picking up " + label + " from the partial on disk: " + have + " of " + total + " bytes")
        const stream = buildStream({ url, init: baseInit, key, label, etag, total, firstAttempt: attempt, replayBytes: resumed ? have : 0 })
        return new Response(stream, { status: 200, headers: responseHeaders(res, total, etag) })
    }

    function responseHeaders(res, total, etag) {
        const headers = new Headers()
        const type = res.headers.get("content-type")
        if (type) headers.set("content-type", type)
        headers.set("content-length", String(total))
        if (etag) headers.set("etag", etag)
        headers.set("accept-ranges", "bytes")
        return headers
    }

    // Bytes [from, to) of the stored partial, in chunks.
    function replayStream(key, from, to, then) {
        let position = from
        return new ReadableStream({
            async pull(controller) {
                if (position >= to) {
                    controller.close()
                    if (then) await then()
                    return
                }
                const chunk = await storage.read(key, position, Math.min(policy.replayChunkBytes, to - position))
                position += chunk.length
                controller.enqueue(chunk)
            },
        })
    }

    function buildStream({ url, init, key, label, etag, total, firstAttempt, replayBytes }) {
        let replayed = 0
        let received = replayBytes // file bytes safely in storage (replayed + appended)
        let reader = firstAttempt.res.body.getReader()
        let controller = firstAttempt.controller
        let interruption = null // { kind: "weak", rate } when we cut the transfer ourselves
        let window = makeWindow()
        let idle = 0
        let progressAtLastFailure = received
        let closed = false

        const abortActive = () => {
            if (controller) controller.abort()
        }
        // setOnline(false) aborts every active controller; make ours distinguishable from a network failure.
        const stopTransfer = () => {
            if (controller) {
                active.delete(controller)
                controller = null
            }
            if (reader) {
                reader.cancel().catch(() => {})
                reader = null
            }
        }

        async function recover(cause) {
            stopTransfer()
            if (received > progressAtLastFailure) idle = 0
            else idle += 1
            progressAtLastFailure = received
            if (idle > policy.maxIdleRetries) {
                throw new Error("Download of " + label + " made no progress after " + idle + " attempts; the partial is kept for the next try")
            }
            const reason = !online ? "offline" : interruption ? "weak" : "error"
            if (interruption) log("weak connection (" + Math.round(interruption.rate / 1000) + " KB/s) on " + label)
            else log("download of " + label + " interrupted (" + (cause && cause.message) + ")")
            interruption = null
            window = makeWindow()

            if (!online) {
                onStatus({ file: label, state: "paused", reason: "offline", retryInSec: null, loaded: received, total })
                const woken = await nap(policy.heldRetrySec)
                if (!woken) online = true // safety net
            } else {
                const delay = backoff(Math.max(idle, 1))
                onStatus({ file: label, state: "paused", reason, retryInSec: Math.ceil(delay), loaded: received, total })
                await nap(delay)
            }
            onStatus({ file: label, state: "resuming", loaded: received, total })
            log("resuming " + label + " from byte " + received + " of " + total)

            const next = await sendPatiently(url, init, received, label, received)
            const outcome = interpret(next.res, received, etag)
            if (outcome.kind === "complete") {
                next.controller.abort()
                active.delete(next.controller)
                return null
            }
            if (outcome.kind === "fail" && (next.res.status >= 500 || next.res.status === 429)) {
                // The server is struggling, not the file gone: wait and try again (counted like any attempt with no bytes).
                next.controller.abort()
                active.delete(next.controller)
                return recover(new Error("server answered " + next.res.status))
            }
            if (outcome.kind !== "append") {
                next.controller.abort()
                active.delete(next.controller)
                // Bytes already went to the caller from the old version; they cannot be taken back mid-stream.
                await safeRemove(key)
                throw new Error(outcome.kind === "restart" ? "The model file " + label + " changed while it was downloading. Reload to download it again." : "Server answered " + next.res.status + " while resuming " + label)
            }
            controller = next.controller
            reader = next.res.body.getReader()
            return reader
        }

        return new ReadableStream({
            async pull(out) {
                try {
                    // 1) a reload resumed this download: hand back what was already on disk first
                    if (replayed < replayBytes) {
                        const chunk = await storage.read(key, replayed, Math.min(policy.replayChunkBytes, replayBytes - replayed))
                        replayed += chunk.length
                        out.enqueue(chunk)
                        return
                    }
                    // 2) the network part, which heals itself
                    for (;;) {
                        if (received >= total) {
                            closed = true
                            stopTransfer()
                            await safeRemove(key) // the caller keeps the complete file (Cache API); drop our copy
                            onStatus({ file: label, state: "done", loaded: total, total })
                            out.close()
                            return
                        }
                        let step
                        try {
                            step = reader ? await reader.read() : { done: true, value: undefined }
                        } catch (error) {
                            await recover(error)
                            continue
                        }
                        if (step.done) {
                            if (received >= total) continue
                            await recover(new Error("connection ended early"))
                            continue
                        }
                        await storage.append(key, step.value)
                        received += step.value.length
                        out.enqueue(step.value)
                        const rate = window(step.value.length)
                        if (rate !== null) {
                            interruption = { kind: "weak", rate }
                            abortActive()
                        }
                        return
                    }
                } catch (error) {
                    closed = true
                    stopTransfer()
                    out.error(error)
                }
            },
            cancel() {
                // The consumer gave up (worker terminated, page left): stop, but keep the partial for next time.
                closed = true
                stopTransfer()
            },
        })
    }

    return {
        fetch: resumableFetch,
        /** The page's view of the connection. Offline interrupts every transfer; online wakes the waiting ones. */
        setOnline(value) {
            const was = online
            online = !!value
            if (!online && was) for (const c of [...active]) c.abort()
            if (online) wakeSleepers()
        },
        get online() {
            return online
        },
    }
}

// Storage in the browser's origin-private file system, for the worker (it needs synchronous access handles, which only
// workers have). Returns null where that is not available, in which case downloads are simply not resumable.
export async function createOpfsStorage() {
    if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.getDirectory) return null
    let dir
    try {
        const root = await navigator.storage.getDirectory()
        dir = await root.getDirectoryHandle("catalyst-ai-models", { create: true })
        const probe = await dir.getFileHandle(".probe", { create: true })
        if (typeof probe.createSyncAccessHandle !== "function") return null
    } catch (error) {
        return null
    }
    const open = new Map()
    const FLUSH_EVERY = 8 * 1024 * 1024
    const unflushed = new Map()

    async function handle(name, create) {
        if (open.has(name)) return open.get(name)
        let fileHandle
        try {
            fileHandle = await dir.getFileHandle(name, { create })
        } catch (error) {
            if (error && error.name === "NotFoundError") return null
            throw error
        }
        const access = await fileHandle.createSyncAccessHandle()
        open.set(name, access)
        return access
    }
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

    return {
        async getMeta(key) {
            const access = await handle(key + ".json", false)
            if (!access) return null
            const size = access.getSize()
            if (!size) return null
            const bytes = new Uint8Array(size)
            access.read(bytes, { at: 0 })
            try {
                return JSON.parse(decoder.decode(bytes))
            } catch (error) {
                return null
            }
        },
        async setMeta(key, meta) {
            const access = await handle(key + ".json", true)
            const bytes = encoder.encode(JSON.stringify(meta))
            access.truncate(0)
            access.write(bytes, { at: 0 })
            access.flush()
        },
        async size(key) {
            const access = await handle(key + ".part", false)
            return access ? access.getSize() : 0
        },
        async read(key, offset, length) {
            const access = await handle(key + ".part", false)
            const bytes = new Uint8Array(length)
            const n = access.read(bytes, { at: offset })
            return n === length ? bytes : bytes.subarray(0, n)
        },
        async append(key, chunk) {
            const access = await handle(key + ".part", true)
            access.write(chunk, { at: access.getSize() })
            const pending = (unflushed.get(key) || 0) + chunk.length
            if (pending >= FLUSH_EVERY) {
                access.flush()
                unflushed.set(key, 0)
            } else unflushed.set(key, pending)
        },
        async remove(key) {
            for (const name of [key + ".part", key + ".json"]) {
                const access = open.get(name)
                if (access) {
                    try {
                        access.close()
                    } catch (error) {
                        /* already closed */
                    }
                    open.delete(name)
                }
                try {
                    await dir.removeEntry(name)
                } catch (error) {
                    if (!error || error.name !== "NotFoundError") throw error
                }
            }
            unflushed.delete(key)
        },
    }
}

/** In-memory storage with the same interface, for tests and for environments without OPFS. */
export function createMemoryStorage() {
    const parts = new Map()
    const metas = new Map()
    return {
        parts,
        metas,
        async getMeta(key) {
            return metas.get(key) || null
        },
        async setMeta(key, meta) {
            metas.set(key, meta)
        },
        async size(key) {
            return parts.has(key) ? parts.get(key).length : 0
        },
        async read(key, offset, length) {
            return parts.get(key).subarray(offset, offset + length)
        },
        async append(key, chunk) {
            const old = parts.get(key) || new Uint8Array(0)
            const next = new Uint8Array(old.length + chunk.length)
            next.set(old, 0)
            next.set(chunk, old.length)
            parts.set(key, next)
        },
        async remove(key) {
            parts.delete(key)
            metas.delete(key)
        },
    }
}
