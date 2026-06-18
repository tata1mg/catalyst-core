import { buildWaterfall, listWaterfalls } from "./waterfalls.js"
import { buildSummary } from "./summary.js"
import { buildChromeTrace, downloadChromeTrace } from "./traceExport.js"

const MAX_RECORDS = 5000

const CACHE_STATUS_BY_TYPE = {
    "cache-hit-memory": "memory-hit",
    "cache-hit-disk": "disk-hit",
    "cache-miss-fetch": "miss",
    "network-fetch-complete": "fetch",
}

const BOOT_LABEL_BY_TYPE = {
    "boot-activity-created": "Activity created",
    "boot-webview-constructed": "WebView constructed",
    "boot-load-url": "loadUrl called",
    "boot-page-started": "Page started",
    "boot-page-finished": "Page finished",
}

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function round(value) {
    return Number.isFinite(value) ? Math.round(value) : value
}

function shortUrl(url) {
    if (!url) return ""
    try {
        const parsed = new URL(url, window.location?.href)
        return parsed.pathname || parsed.host
    } catch {
        return String(url).slice(0, 80)
    }
}

function isFiniteNumber(value) {
    return Number.isFinite(value)
}

export class PerfStore {
    constructor(nativeToWeb) {
        this._nativeToWeb = nativeToWeb ?? ((time) => time)
        this._seq = 0
        this._pendingPageLoads = new Map()
        this._pendingHwAccel = null
        this._pendingInteractions = new Map()
        this._data = this._createData()
    }

    expose() {
        if (typeof window === "undefined") return

        window.__catalystPerfStore = this._data
        const api = {
            version: this._data.version,
            store: () => this.snapshot(),
            events: () => clone(this._data.events),
            requests: () => clone(this._data.requests),
            sessions: () => clone(this._data.sessions),
            metrics: () => clone(this._data.metrics),
            insights: () => clone(this._data.insights),
            waterfalls: () => listWaterfalls(),
            waterfall: (type = "all") => buildWaterfall(this.snapshot(), type),
            summary: () => buildSummary(this.snapshot()),
            trace: () => JSON.stringify(buildChromeTrace(this.snapshot())),
            downloadTrace: (filename) => downloadChromeTrace(this.snapshot(), filename),
            export: () => this.snapshot(),
            clear: () => this.clear(),
        }
        window.CatalystPerf = api
    }

    snapshot() {
        return clone(this._data)
    }

    clear() {
        this._seq = 0
        this._data.createdAt = new Date().toISOString()
        this._data.events.length = 0
        this._data.requests.length = 0
        this._data.sessions.length = 0
        this._data.metrics.length = 0
        this._data.insights.length = 0
        this._pendingPageLoads.clear()
        this._pendingInteractions.clear()
        this._pendingHwAccel = null
    }

    recordNativeEvent(event, source = "native") {
        if (!event?.type) return

        const time = this._nativeEventTime(event)
        if (event.type === "memory-snapshot") {
            this._recordNativeDerivedData(event, time)
            return
        }

        this._add("events", {
            id: this._id("event"),
            type: event.type,
            kind: this._eventKind(event.type),
            label: this._nativeEventLabel(event),
            source,
            startTime: time,
            endTime: time + 1,
            durationMs: event.durationMs ?? 1,
            detail: { ...event },
        })

        this._recordNativeDerivedData(event, time)
    }

    recordNavigation(data) {
        if (!data) return
        if (data.label === "LCP" || data.label === "FCP") {
            this._add("metrics", {
                id: this._id("metric"),
                kind: "paint",
                name: data.label,
                label: data.label,
                startTime: data.startTime ?? 0,
                endTime: data.endTime ?? data.durationMs ?? 0,
                durationMs: data.durationMs,
                value: data.durationMs,
                unit: "ms",
                detail: { ...data },
            })
            return
        }

        this._add("sessions", {
            id: this._id("session"),
            kind: "route",
            label: data.label ?? "Route transition",
            startTime: data.startTime,
            endTime: data.endTime,
            durationMs: data.durationMs,
            detail: { ...data },
        })
    }

    recordInteraction(data) {
        if (!data) return

        if (data.phase === "start") {
            this._pendingInteractions.set(data.sessionId, data)
            this._add("events", {
                id: this._id("event"),
                type: "interaction-start",
                kind: "interaction",
                label: data.target ? `Tap ${data.target}` : "Tap",
                source: "web",
                startTime: data.startTime,
                endTime: data.startTime + 1,
                durationMs: 1,
                detail: { ...data },
            })
            return
        }

        if (data.phase === "end") {
            const start = this._pendingInteractions.get(data.sessionId)
            this._pendingInteractions.delete(data.sessionId)
            const startTime = start?.startTime ?? data.startTime
            const endTime = data.endTime ?? startTime
            this._add("sessions", {
                id: this._id("session"),
                kind: "interaction",
                sessionId: data.sessionId,
                label: data.target ? `Tap ${data.target}` : "Interaction",
                startTime,
                endTime,
                durationMs: data.durationMs ?? round(endTime - startTime),
                target: data.target ?? start?.target ?? null,
                detail: { ...start, ...data },
            })
        }
    }

    recordNetwork(data) {
        if (!data) return
        this._add("requests", {
            id: this._id("request"),
            kind: "network",
            label: `${data.method ?? "GET"} ${shortUrl(data.url)}`,
            url: data.url,
            method: data.method,
            status: data.status,
            startTime: data.startTime,
            endTime: data.endTime,
            durationMs: data.durationMs,
            sessionId: data.sessionId ?? null,
            interactionId: data.sessionId ?? null,
            detail: { ...data },
        })
    }

    recordBridge(data) {
        if (!data) return
        this._add("requests", {
            id: this._id("request"),
            kind: "bridge",
            label: `Bridge ${data.method ?? "call"}`,
            method: data.method,
            startTime: data.startTime,
            endTime: data.endTime,
            durationMs: data.durationMs,
            sessionId: data.sessionId ?? null,
            interactionId: data.sessionId ?? null,
            detail: { ...data },
        })
    }

    recordNativeApi(data) {
        if (!data) return
        this._add("requests", {
            id: this._id("request"),
            kind: "native-api",
            label: `Native ${data.method ?? "API"}`,
            method: data.method,
            startTime: data.startTime,
            endTime: data.endTime,
            durationMs: data.durationMs,
            sessionId: data.sessionId ?? null,
            interactionId: data.sessionId ?? null,
            detail: { ...data },
        })
    }

    recordRender(data) {
        if (!data || data.metric === "memory") return
        this._add("metrics", {
            id: this._id("metric"),
            kind: data.metric,
            name: data.metric,
            label: this._renderLabel(data),
            startTime: data.startTime,
            endTime: data.endTime,
            durationMs: data.durationMs,
            value: data.value ?? data.minFps ?? data.durationMs ?? null,
            unit: this._renderUnit(data.metric),
            context: data.sessionId ?? null,
            detail: { ...data },
        })
    }

    recordHook(data) {
        if (!data) return
        this._add("sessions", {
            id: this._id("session"),
            kind: "hook",
            label: data.label ?? `Hook ${data.hookType ?? "work"}`,
            startTime: data.startTime,
            endTime: data.endTime,
            durationMs: data.durationMs,
            detail: { ...data },
        })
    }

    recordScroll(data) {
        if (!data) return
        this._add("sessions", {
            id: this._id("session"),
            kind: "scroll",
            label: data.janky ? "Scroll jank" : "Scroll",
            startTime: data.startTime,
            endTime: data.endTime,
            durationMs: data.durationMs,
            detail: { ...data },
        })
    }

    recordKeyboard(data) {
        if (!data) return
        if (data.metric) {
            this.recordRender(data)
            return
        }

        this._add("sessions", {
            id: this._id("session"),
            kind: "keyboard",
            label: "Keyboard",
            startTime: data.startTime,
            endTime: data.endTime,
            durationMs: data.durationMs,
            detail: { ...data },
        })
    }

    recordInsight(data) {
        if (!data) return
        this._add("insights", {
            id: this._id("insight"),
            kind: "insight",
            severity: data.severity,
            rule: data.rule,
            label: data.title ?? data.rule,
            title: data.title ?? data.rule,
            category: data.category ?? "general",
            message: data.message,
            fix: data.fix,
            startTime: data.startTime,
            endTime: data.endTime ?? (data.startTime ?? 0) + 1,
            durationMs: data.durationMs ?? 1,
            interactionId: data.interactionId ?? null,
            callId: data.callId ?? null,
            requestId: data.requestId ?? null,
            memoryId: data.memoryId ?? null,
            detail: { ...data },
        })
    }

    _recordNativeDerivedData(event, time) {
        const { type } = event

        if (type === "cold-start") {
            this._add("metrics", {
                id: this._id("metric"),
                kind: "startup",
                name: "cold-start",
                label: `Cold start ${round(event.durationMs)}ms`,
                startTime: Math.max(0, time - (event.durationMs ?? 0)),
                endTime: time,
                durationMs: event.durationMs,
                value: event.durationMs,
                unit: "ms",
                detail: { ...event },
            })
            return
        }

        if (type?.startsWith("boot-")) return

        if (type === "page-load-start") {
            this._pendingPageLoads.set(event.url, { startTime: time, event })
            return
        }

        if (type === "page-load-end" || type === "page-load-error") {
            const pending = this._pendingPageLoads.get(event.url)
            this._pendingPageLoads.delete(event.url)
            const durationMs = event.durationMs ?? null
            const startTime =
                pending?.startTime ?? (durationMs != null ? Math.max(0, time - durationMs) : time)
            this._add("sessions", {
                id: this._id("session"),
                kind: "page-load",
                label: event.url ? `Page ${shortUrl(event.url)}` : "Page load",
                startTime,
                endTime: time,
                durationMs: durationMs ?? round(time - startTime),
                url: event.url,
                detail: { ...(pending?.event ?? {}), ...event },
            })
            return
        }

        if (CACHE_STATUS_BY_TYPE[type]) {
            this._recordCacheRequest(event, time)
            return
        }

        if (type === "cache-summary") {
            this._add("metrics", {
                id: this._id("metric"),
                kind: "cache-summary",
                name: "cache-summary",
                label: `Cache ${event.hitRatePct ?? 0}% hit`,
                startTime: time,
                endTime: time + 1,
                durationMs: 1,
                value: event.hitRatePct,
                unit: "%",
                detail: { ...event },
            })
            return
        }

        if (type === "memory-snapshot") {
            this._updateMemorySummary(event, time)
            return
        }

        if (type === "hw-accel-change") {
            this._recordHwAccel(event, time)
        }
    }

    _recordCacheRequest(event, time) {
        const durationMs = event.durationMs ?? 0
        const startTime = isFiniteNumber(event.nativeStartMs)
            ? this._nativeToWeb(event.nativeStartMs)
            : Math.max(0, time - durationMs)
        const endTime = startTime + durationMs
        const cacheStatus = CACHE_STATUS_BY_TYPE[event.type]
        const label = `${cacheStatus} ${shortUrl(event.url)}`

        this._add("requests", {
            id: this._id("request"),
            kind: "cache",
            label,
            url: event.url,
            status: event.statusCode ?? null,
            startTime,
            endTime,
            durationMs,
            source: event.type.includes("memory")
                ? "memory"
                : event.type.includes("disk")
                  ? "disk"
                  : event.type === "network-fetch-complete"
                    ? "network"
                    : "cache",
            cacheStatus,
            resourceType: event.resourceType ?? "other",
            detail: { ...event },
        })
    }

    _recordHwAccel(event, time) {
        if (event.state === "off") {
            this._pendingHwAccel = { startTime: time, event }
            return
        }

        if (event.state !== "on" || !this._pendingHwAccel) return

        const start = this._pendingHwAccel
        this._pendingHwAccel = null
        this._add("sessions", {
            id: this._id("session"),
            kind: "hw-accel",
            label: "Software render window",
            startTime: start.startTime,
            endTime: time,
            durationMs: round(time - start.startTime),
            detail: { ...start.event, restored: event },
        })
    }

    _updateMemorySummary(event, time) {
        let summary = this._data.metrics.find((metric) => metric.kind === "memory-summary")
        if (!summary) {
            summary = this._add("metrics", {
                id: "metric-memory-summary",
                kind: "memory-summary",
                name: "memory-summary",
                label: "Memory summary",
                startTime: time,
                endTime: time,
                durationMs: 1,
                value: event.totalMb,
                unit: "MB",
                detail: {
                    sampleCount: 0,
                    firstTime: time,
                    lastTime: time,
                    latest: {},
                    peak: {},
                    min: {},
                    max: {},
                },
            })
        }

        const detail = summary.detail
        const latest = {
            jvmMb: event.jvmMb,
            webviewMb: event.webviewMb,
            otherMb: event.otherMb,
            totalMb: event.totalMb,
            peakMb: event.peakMb,
            coldStartMs: event.coldStartMs ?? null,
            thread: event.thread ?? null,
        }
        const fields = ["jvmMb", "webviewMb", "otherMb", "totalMb", "peakMb"]

        detail.sampleCount += 1
        detail.lastTime = time
        detail.latest = latest

        for (const field of fields) {
            const value = latest[field]
            if (!Number.isFinite(value)) continue
            detail.min[field] = Number.isFinite(detail.min[field])
                ? Math.min(detail.min[field], value)
                : value
            detail.max[field] = Number.isFinite(detail.max[field])
                ? Math.max(detail.max[field], value)
                : value
            detail.peak[field] = detail.max[field]
        }

        summary.label = `Memory ${round(event.totalMb)}MB total`
        summary.startTime = detail.firstTime
        summary.endTime = time
        summary.durationMs = Math.max(1, round(time - detail.firstTime))
        summary.value = event.totalMb
    }

    _nativeEventTime(event) {
        if (isFiniteNumber(event.nativeTime)) return this._nativeToWeb(event.nativeTime)
        if (isFiniteNumber(event.nativeEndMs)) return this._nativeToWeb(event.nativeEndMs)
        if (isFiniteNumber(event.endNativeTime)) return this._nativeToWeb(event.endNativeTime)
        if (isFiniteNumber(event.nativeStartMs)) return this._nativeToWeb(event.nativeStartMs)
        if (isFiniteNumber(event.startNativeTime)) return this._nativeToWeb(event.startNativeTime)
        return performance.now()
    }

    _nativeEventLabel(event) {
        if (BOOT_LABEL_BY_TYPE[event.type]) return BOOT_LABEL_BY_TYPE[event.type]
        if (event.type === "page-load-start") return `Page started ${shortUrl(event.url)}`
        if (event.type === "page-load-end") return `Page finished ${shortUrl(event.url)}`
        if (event.type === "page-load-error") return `Page error ${shortUrl(event.url)}`
        if (CACHE_STATUS_BY_TYPE[event.type])
            return `${CACHE_STATUS_BY_TYPE[event.type]} ${shortUrl(event.url)}`
        return event.type
    }

    _eventKind(type) {
        if (type?.startsWith("boot-") || type === "cold-start") return "startup"
        if (type?.startsWith("page-load")) return "page-load"
        if (type?.startsWith("cache-") || type === "network-fetch-complete") return "cache"
        if (type?.startsWith("keyboard")) return "keyboard"
        if (type?.startsWith("scroll")) return "scroll"
        if (type === "fps-drop-episode" || type === "long-task") return "render"
        return "event"
    }

    _renderLabel(data) {
        if (data.metric === "fps-drop") return `FPS drop min ${data.minFps?.toFixed?.(1) ?? "?"}`
        if (data.metric === "long-task") return `Long task ${round(data.durationMs)}ms`
        if (data.metric === "loaf") return `LoAF ${round(data.durationMs)}ms`
        if (data.metric === "layout-shift") return `Layout shift ${data.value?.toFixed?.(3) ?? "?"}`
        return data.metric
    }

    _renderUnit(metric) {
        if (metric === "fps-drop") return "fps"
        if (metric === "layout-shift") return "score"
        return "ms"
    }

    _add(bucket, record) {
        this._data[bucket].push(record)
        if (this._data[bucket].length > MAX_RECORDS) {
            this._data[bucket].shift()
        }
        return record
    }

    _id(prefix) {
        this._seq += 1
        return `${prefix}-${this._seq}`
    }

    _createData() {
        return {
            version: 1,
            createdAt: new Date().toISOString(),
            events: [],
            requests: [],
            sessions: [],
            metrics: [],
            insights: [],
        }
    }
}
