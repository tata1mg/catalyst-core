const REQUEST_LANES = new Set(["network", "cache", "bridge", "native-api"])

function durationOf(row) {
    if (Number.isFinite(row.durationMs)) return row.durationMs
    if (Number.isFinite(row.startTime) && Number.isFinite(row.endTime)) {
        return Math.max(0, Math.round(row.endTime - row.startTime))
    }
    return null
}

function toRow(record, lane, group = null) {
    const startTime = record.startTime ?? record.time ?? 0
    const endTime = record.endTime ?? startTime
    return {
        id: record.id,
        lane,
        group,
        kind: record.kind ?? record.type ?? lane,
        label: record.label ?? record.name ?? record.type ?? record.kind ?? lane,
        startTime,
        endTime,
        durationMs: durationOf({ ...record, startTime, endTime }),
        severity: record.severity ?? null,
        detail: record.detail ?? record,
    }
}

function byStartTime(a, b) {
    return (a.startTime ?? 0) - (b.startTime ?? 0)
}

function overlaps(row, start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false
    const rowStart = row.startTime ?? 0
    const rowEnd = row.endTime ?? rowStart
    return rowStart < end && rowEnd >= start
}

function isStandaloneEvent(event) {
    return event.kind === "startup" || event.type === "navigation-back" || event.type === "page-load-error"
}

function isTimelineMetric(metric) {
    return metric.kind !== "memory" && metric.kind !== "memory-summary"
}

function rowsForWindow(data, start, end, group) {
    return [
        ...data.sessions.map((session) => toRow(session, session.kind, group)),
        ...data.requests.map((request) => toRow(request, request.kind, group)),
        ...data.metrics.filter(isTimelineMetric).map((metric) => toRow(metric, metric.kind, group)),
        ...data.events.filter(isStandaloneEvent).map((event) => toRow(event, event.kind ?? "event", group)),
        ...data.insights.map((insight) => toRow(insight, "insight", group)),
    ]
        .filter((row) => overlaps(row, start, end))
        .sort(byStartTime)
}

function buildPageLoadWaterfall(data) {
    const pageLoads = data.sessions.filter((session) => session.kind === "page-load")
    if (pageLoads.length === 0) {
        return [
            ...data.events
                .filter((event) => event.kind === "startup" || event.type?.startsWith("boot-"))
                .map((event) => toRow(event, "startup", "page-load")),
            ...data.metrics
                .filter((metric) => metric.kind === "paint" || metric.kind === "startup")
                .map((metric) => toRow(metric, metric.kind, "page-load")),
        ].sort(byStartTime)
    }

    return pageLoads
        .flatMap((pageLoad, index) => {
            const group = pageLoad.label
            const startupRows =
                index === 0
                    ? data.events
                          .filter(
                              (event) =>
                                  event.kind === "startup" && (event.startTime ?? 0) <= pageLoad.endTime
                          )
                          .map((event) => toRow(event, "startup", group))
                    : []
            return [
                ...startupRows,
                toRow(pageLoad, "page-load", group),
                ...rowsForWindow(data, pageLoad.startTime, pageLoad.endTime, group).filter(
                    (row) => row.id !== pageLoad.id
                ),
            ]
        })
        .sort(byStartTime)
}

function buildRouteWaterfall(data) {
    const routes = data.sessions.filter((session) => session.kind === "route")
    return routes
        .flatMap((route) => [
            toRow(route, "route", route.label),
            ...rowsForWindow(data, route.startTime, route.endTime + 1000, route.label).filter(
                (row) => row.id !== route.id
            ),
        ])
        .sort(byStartTime)
}

function buildRequestWaterfall(data) {
    return data.requests
        .filter((request) => REQUEST_LANES.has(request.kind))
        .map((request) => toRow(request, request.kind, request.sessionId ?? request.navigationId ?? null))
        .sort(byStartTime)
}

function buildNativeBridgeWaterfall(data) {
    return data.requests
        .filter((request) => request.kind === "bridge" || request.kind === "native-api")
        .map((request) => toRow(request, request.kind, request.sessionId ?? null))
        .sort(byStartTime)
}

function buildInteractionWaterfall(data) {
    const interactions = data.sessions.filter((session) => session.kind === "interaction")
    return interactions
        .flatMap((interaction) => {
            const group = interaction.label
            const matchingSession = (row) => {
                const detail = row.detail ?? {}
                return (
                    detail.sessionId === interaction.sessionId ||
                    detail.interactionId === interaction.sessionId ||
                    overlaps(row, interaction.startTime, interaction.endTime)
                )
            }
            return [
                toRow(interaction, "interaction", group),
                ...[
                    ...data.requests.map((request) => toRow(request, request.kind, group)),
                    ...data.metrics
                        .filter(isTimelineMetric)
                        .map((metric) => toRow(metric, metric.kind, group)),
                    ...data.insights.map((insight) => toRow(insight, "insight", group)),
                ].filter((row) => row.id !== interaction.id && matchingSession(row)),
            ]
        })
        .sort(byStartTime)
}

function buildRenderJankWaterfall(data) {
    const renderKinds = new Set(["fps-drop", "long-task", "loaf", "layout-shift", "hw-accel"])
    return [
        ...data.metrics
            .filter((metric) => renderKinds.has(metric.kind))
            .map((metric) => toRow(metric, "render", metric.context ?? null)),
        ...data.sessions
            .filter((session) => session.kind === "hw-accel")
            .map((session) => toRow(session, "render", session.detail?.trigger ?? null)),
    ].sort(byStartTime)
}

function buildScrollWaterfall(data) {
    const scrolls = data.sessions.filter((session) => session.kind === "scroll")
    return scrolls
        .flatMap((scroll) => [
            toRow(scroll, "scroll", scroll.label),
            ...rowsForWindow(data, scroll.startTime, scroll.endTime, scroll.label).filter(
                (row) =>
                    row.id !== scroll.id &&
                    ["fps-drop", "long-task", "loaf", "layout-shift", "insight"].includes(row.kind)
            ),
        ])
        .sort(byStartTime)
}

function buildKeyboardWaterfall(data) {
    const keyboards = data.sessions.filter((session) => session.kind === "keyboard")
    return keyboards
        .flatMap((keyboard) => [
            toRow(keyboard, "keyboard", keyboard.label),
            ...rowsForWindow(data, keyboard.startTime, keyboard.endTime, keyboard.label).filter(
                (row) =>
                    row.id !== keyboard.id &&
                    ["viewport-resize", "scroll", "layout-shift", "insight"].includes(row.kind)
            ),
        ])
        .sort(byStartTime)
}

function buildCacheWaterfall(data) {
    return [
        ...data.requests
            .filter((request) => request.kind === "cache")
            .map((request) => toRow(request, "cache", request.cacheStatus ?? null)),
        ...data.metrics
            .filter((metric) => metric.kind === "cache-summary")
            .map((metric) => toRow(metric, "cache-summary")),
    ].sort(byStartTime)
}

function buildMemoryTimeline(data) {
    return data.metrics
        .filter((metric) => metric.kind === "memory" || metric.kind === "memory-summary")
        .map((metric) => toRow(metric, "memory"))
        .sort(byStartTime)
}

function buildAllWaterfall(data) {
    return [
        ...data.sessions.map((session) => toRow(session, session.kind)),
        ...data.requests.map((request) => toRow(request, request.kind)),
        ...data.metrics.filter(isTimelineMetric).map((metric) => toRow(metric, metric.kind)),
        ...data.events.filter(isStandaloneEvent).map((event) => toRow(event, event.kind ?? "event")),
        ...data.insights.map((insight) => toRow(insight, "insight")),
    ].sort(byStartTime)
}

export function buildWaterfall(data, type = "all") {
    switch (type) {
        case "page-load":
        case "page":
            return buildPageLoadWaterfall(data)
        case "route":
        case "navigation":
            return buildRouteWaterfall(data)
        case "requests":
        case "request":
            return buildRequestWaterfall(data)
        case "native-bridge":
        case "bridge":
        case "api":
            return buildNativeBridgeWaterfall(data)
        case "interactions":
        case "interaction":
            return buildInteractionWaterfall(data)
        case "render":
        case "jank":
        case "render-jank":
            return buildRenderJankWaterfall(data)
        case "scroll":
            return buildScrollWaterfall(data)
        case "keyboard":
        case "input":
            return buildKeyboardWaterfall(data)
        case "cache":
            return buildCacheWaterfall(data)
        case "memory":
            return buildMemoryTimeline(data)
        case "all":
        default:
            return buildAllWaterfall(data)
    }
}

export function listWaterfalls() {
    return [
        "page-load",
        "navigation",
        "requests",
        "native-bridge",
        "interactions",
        "render-jank",
        "scroll",
        "keyboard",
        "cache",
        "memory",
        "all",
    ]
}
