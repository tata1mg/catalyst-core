/**
 * NetworkTimingCollector.js
 *
 * Adds lightweight Catalyst timeline spans for fetch() and XMLHttpRequest.
 * Chrome already has detailed network timing; these spans exist to attach
 * network work to Catalyst interaction sessions via sessionId.
 */

import { TRACK, PREFIX, COLOR, THRESHOLD } from "../core/constants.js"

const FETCH_WRAPPED = "__catalystNetworkTimingFetchWrapped"
const XHR_WRAPPED = "__catalystNetworkTimingXhrWrapped"
const XHR_META = "__catalystNetworkTimingMeta"
const MAX_LABEL_LENGTH = 72

export class NetworkTimingCollector {
    constructor(measure) {
        this._measure = measure
        this._getInteraction = null
        this._requestSeq = 0
    }

    setInteractionSource(fn) {
        this._getInteraction = fn
    }

    setWaterfallSource(fn) {
        this._notifyWaterfall = fn
    }

    init() {
        if (typeof window === "undefined") return
        this._wrapFetch()
        this._wrapXhr()
    }

    _wrapFetch() {
        const originalFetch = window.fetch
        if (typeof originalFetch !== "function" || originalFetch[FETCH_WRAPPED]) return

        const collector = this

        function catalystFetch(input, init) {
            const span = collector._start(
                "fetch",
                init?.method ?? input?.method ?? "GET",
                init?.url ?? input?.url ?? input
            )

            try {
                return originalFetch.apply(this, arguments).then(
                    (response) => {
                        collector._finish(span, {
                            status: response?.status ?? null,
                            ok: response?.ok ?? null,
                        })
                        return response
                    },
                    (error) => {
                        collector._finish(span, { outcome: "error", ok: false })
                        throw error
                    }
                )
            } catch (error) {
                collector._finish(span, { outcome: "error", ok: false })
                throw error
            }
        }

        catalystFetch[FETCH_WRAPPED] = true
        window.fetch = catalystFetch
    }

    _wrapXhr() {
        const proto = window.XMLHttpRequest?.prototype
        if (!proto || proto[XHR_WRAPPED]) return
        if (typeof proto.open !== "function" || typeof proto.send !== "function") return

        const originalOpen = proto.open
        const originalSend = proto.send
        const collector = this

        proto.open = function catalystXhrOpen(method, url) {
            this[XHR_META] = { method, url }
            return originalOpen.apply(this, arguments)
        }

        proto.send = function catalystXhrSend() {
            const meta = this[XHR_META] ?? {}
            const span = collector._start("xhr", meta.method ?? "GET", meta.url ?? "unknown")
            let emitted = false

            const finish = (outcome = "complete") => {
                if (emitted) return
                emitted = true
                const status = this.status
                collector._finish(span, {
                    status,
                    ok: collector._statusOk(status),
                    outcome,
                })
            }

            this.addEventListener?.("loadend", () => finish(), { once: true })

            try {
                return originalSend.apply(this, arguments)
            } catch (error) {
                finish("error")
                throw error
            }
        }

        proto[XHR_WRAPPED] = true
    }

    _start(api, method, rawUrl) {
        const startTime = performance.now()
        const normalizedMethod = String(method || "GET").toUpperCase()
        const url = this._normalizeUrl(rawUrl)
        const label = this._labelForUrl(url)
        const requestId = `${api}:${++this._requestSeq}`
        const measureName = `${PREFIX.NETWORK_TIMING}/${api}|${normalizedMethod}|${label}`
        const startMark = `${measureName}:start:${requestId}`

        performance.mark(startMark, { startTime })

        const interaction = this._getInteraction?.()
        const sessionId = interaction?.activeSessionId ?? null
        if (sessionId) interaction?.onNetworkCall?.()

        return { api, method: normalizedMethod, url, requestId, measureName, startMark, startTime, sessionId }
    }

    _finish(span, result = {}) {
        const endTime = performance.now()
        const durationMs = Math.round(endTime - span.startTime)
        const outcome = result.outcome ?? "complete"
        const ok = result.ok ?? this._statusOk(result.status)
        const color =
            outcome !== "complete" || ok === false || durationMs > THRESHOLD.FETCH_SLOW_MS
                ? COLOR.ERROR
                : COLOR.SECONDARY
        const detail = {
            api: span.api,
            method: span.method,
            url: span.url,
            status: result.status ?? null,
            ok,
            outcome,
            durationMs,
            sessionId: span.sessionId,
            requestId: span.requestId,
            simulatorValid: true,
        }

        this._notifyWaterfall?.({
            ...detail,
            startTime: span.startTime,
            endTime,
        })

        this._measure.emit(span.measureName, span.startMark, endTime, detail, TRACK.BRIDGE, color)
    }

    _normalizeUrl(rawUrl) {
        const value = rawUrl?.url ?? rawUrl ?? "unknown"
        try {
            const parsed = new URL(String(value), window.location?.href)
            return `${parsed.origin}${parsed.pathname}`
        } catch {
            return String(value).split("?")[0].split("#")[0]
        }
    }

    _labelForUrl(url) {
        try {
            const parsed = new URL(url, window.location?.href)
            const label =
                parsed.origin === window.location?.origin
                    ? parsed.pathname
                    : `${parsed.host}${parsed.pathname}`
            return (label || "/").slice(0, MAX_LABEL_LENGTH)
        } catch {
            return String(url || "unknown").slice(0, MAX_LABEL_LENGTH)
        }
    }

    _statusOk(status) {
        return typeof status === "number" && status >= 200 && status < 400
    }
}
