const THREADS = {
    navigation: 1,
    input: 2,
    render: 3,
    memory: 4,
    network: 5,
    bridge: 6,
    insights: 7,
    events: 8,
}

const THREAD_NAMES = {
    [THREADS.navigation]: "Navigation",
    [THREADS.input]: "Input",
    [THREADS.render]: "Render",
    [THREADS.memory]: "Memory",
    [THREADS.network]: "Network / Cache",
    [THREADS.bridge]: "Bridge / Native API",
    [THREADS.insights]: "Insights",
    [THREADS.events]: "Events",
}

function us(ms) {
    return Math.max(0, Math.round((Number(ms) || 0) * 1000))
}

function durationMs(record) {
    if (Number.isFinite(record.durationMs)) return Math.max(0.001, record.durationMs)
    if (Number.isFinite(record.startTime) && Number.isFinite(record.endTime)) {
        return Math.max(0.001, record.endTime - record.startTime)
    }
    return 0.001
}

function label(record, fallback) {
    return record.label ?? record.title ?? record.name ?? record.type ?? record.kind ?? fallback
}

function detail(record) {
    return record.detail ?? record
}

function sessionThread(kind) {
    if (kind === "page-load" || kind === "route") return THREADS.navigation
    if (kind === "scroll" || kind === "keyboard" || kind === "interaction") return THREADS.input
    if (kind === "hw-accel" || kind === "hook") return THREADS.render
    return THREADS.events
}

function requestThread(kind) {
    if (kind === "bridge" || kind === "native-api") return THREADS.bridge
    return THREADS.network
}

function metricThread(kind) {
    if (kind === "memory" || kind === "memory-summary") return THREADS.memory
    if (kind === "startup" || kind === "paint") return THREADS.navigation
    return THREADS.render
}

function addMetadata(events, pid) {
    events.push({ ph: "M", pid, tid: 0, name: "process_name", args: { name: "Catalyst" } })
    for (const [tid, name] of Object.entries(THREAD_NAMES)) {
        events.push({ ph: "M", pid, tid: Number(tid), name: "thread_name", args: { name } })
    }
}

function addDuration(events, record, tid, category, fallbackName) {
    const startTime = record.startTime ?? record.time ?? 0
    events.push({
        name: label(record, fallbackName),
        cat: category,
        ph: "X",
        ts: us(startTime),
        dur: us(durationMs(record)),
        pid: 1,
        tid,
        args: detail(record),
    })
}

function addInstant(events, record, tid, category, fallbackName) {
    events.push({
        name: label(record, fallbackName),
        cat: category,
        ph: "i",
        s: "t",
        ts: us(record.startTime ?? record.time ?? 0),
        pid: 1,
        tid,
        args: detail(record),
    })
}

function addCounter(events, record) {
    const args = {}
    const source = record.detail ?? record
    for (const key of ["jvmMb", "webviewMb", "nativeMb", "otherMb", "totalMb", "peakMb"]) {
        if (Number.isFinite(source[key])) args[key] = source[key]
    }
    if (Object.keys(args).length === 0 && Number.isFinite(record.value)) {
        args.value = record.value
    }
    events.push({
        name: label(record, "Memory"),
        cat: "Catalyst Memory",
        ph: "C",
        ts: us(record.startTime ?? record.time ?? 0),
        pid: 1,
        tid: THREADS.memory,
        args,
    })
}

export function buildChromeTrace(data) {
    const traceEvents = []
    addMetadata(traceEvents, 1)

    for (const session of data.sessions ?? []) {
        addDuration(traceEvents, session, sessionThread(session.kind), `Catalyst ${session.kind}`, "Session")
    }

    for (const request of data.requests ?? []) {
        addDuration(traceEvents, request, requestThread(request.kind), `Catalyst ${request.kind}`, "Request")
    }

    for (const metric of data.metrics ?? []) {
        if (metric.kind === "memory" || metric.kind === "memory-summary") {
            addCounter(traceEvents, metric)
        } else {
            addDuration(traceEvents, metric, metricThread(metric.kind), `Catalyst ${metric.kind}`, "Metric")
        }
    }

    for (const event of data.events ?? []) {
        addInstant(traceEvents, event, THREADS.events, `Catalyst ${event.kind ?? "event"}`, "Event")
    }

    for (const insight of data.insights ?? []) {
        addInstant(traceEvents, insight, THREADS.insights, "Catalyst Insights", "Insight")
    }

    return {
        traceEvents: traceEvents.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0)),
        metadata: {
            source: "CatalystPerf",
            createdAt: new Date().toISOString(),
            storeCreatedAt: data.createdAt ?? null,
            version: data.version ?? 1,
        },
    }
}

export function downloadChromeTrace(data, filename) {
    const trace = buildChromeTrace(data)
    const traceJson = JSON.stringify(trace)
    const resolvedFilename =
        filename ?? `catalyst-trace-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    const eventCount = trace.traceEvents.length
    const isIOSNative = typeof window !== "undefined" && !!window.webkit?.messageHandlers?.NativeBridge
    const isAndroidNative = typeof window !== "undefined" && !!window.NativeBridge

    if (typeof console !== "undefined") {
        console.info(`[CatalystPerf] Trace ready: ${resolvedFilename} (${eventCount} events)`)
    }

    if (isIOSNative) {
        window.webkit.messageHandlers.NativeBridge.postMessage({
            command: "exportCatalystTrace",
            data: {
                filename: resolvedFilename,
                trace: traceJson,
            },
        })
        if (typeof console !== "undefined") {
            console.info(`[CatalystPerf] Sent ${resolvedFilename} to the iOS share sheet.`)
        }
        return
    }

    if (isAndroidNative) {
        return
    }

    if (typeof document === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
        return
    }

    const link = document.createElement("a")
    if (!("download" in link)) {
        if (typeof console !== "undefined") {
            console.warn(
                "[CatalystPerf] Browser does not support blob downloads. Use CatalystPerf.trace() instead."
            )
        }
        return
    }

    const blob = new Blob([traceJson], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    link.href = url
    link.download = resolvedFilename
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30000)

    if (typeof console !== "undefined") {
        console.info(`[CatalystPerf] Download started. Check your browser Downloads for ${resolvedFilename}.`)
    }
}
