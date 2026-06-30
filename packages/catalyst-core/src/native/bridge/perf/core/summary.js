const SLOW_MS = {
    interaction: 300,
    request: 500,
    bridge: 150,
    render: 50,
}

function round(value) {
    return Number.isFinite(value) ? Math.round(value) : value
}

function durationOf(record) {
    if (Number.isFinite(record?.durationMs)) return record.durationMs
    if (Number.isFinite(record?.startTime) && Number.isFinite(record?.endTime)) {
        return Math.max(0, record.endTime - record.startTime)
    }
    return 0
}

function byDurationDesc(a, b) {
    return durationOf(b) - durationOf(a)
}

function overlaps(record, start, end, padding = 0) {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false
    const recordStart = record.startTime ?? 0
    const recordEnd = record.endTime ?? recordStart
    return recordStart < end + padding && recordEnd >= start - padding
}

function top(records, count = 5) {
    return [...records].sort(byDurationDesc).slice(0, count)
}

function countBy(records, key) {
    return records.reduce((acc, record) => {
        const value = record?.[key] ?? "unknown"
        acc[value] = (acc[value] ?? 0) + 1
        return acc
    }, {})
}

function summarizeInteraction(interaction, data) {
    const start = interaction.startTime
    const end = interaction.endTime
    const sessionId = interaction.sessionId ?? interaction.detail?.sessionId
    const related = (record, padding = 150) => {
        const detail = record.detail ?? {}
        return (
            detail.sessionId === sessionId ||
            detail.interactionId === sessionId ||
            record.sessionId === sessionId ||
            record.interactionId === sessionId ||
            overlaps(record, start, end, padding)
        )
    }

    const requests = data.requests.filter((request) => related(request))
    const render = data.metrics
        .filter((metric) => ["fps-drop", "long-task", "loaf", "layout-shift"].includes(metric.kind))
        .filter((metric) => related(metric, 300))
    const insights = data.insights.filter((insight) => related(insight, 300))
    const bridgeTime = requests
        .filter((request) => request.kind === "bridge" || request.kind === "native-api")
        .reduce((total, request) => total + durationOf(request), 0)
    const networkTime = requests
        .filter((request) => request.kind === "network")
        .reduce((total, request) => total + durationOf(request), 0)
    const slowestRequest = top(requests, 1)[0] ?? null

    return {
        id: interaction.id,
        label: interaction.label,
        target: interaction.target ?? interaction.detail?.target ?? null,
        startTime: round(start),
        durationMs: round(durationOf(interaction)),
        requestCount: requests.length,
        renderIssueCount: render.length,
        insightCount: insights.length,
        bridgeTimeMs: round(bridgeTime),
        networkTimeMs: round(networkTime),
        slowestRequest: slowestRequest
            ? {
                  id: slowestRequest.id,
                  kind: slowestRequest.kind,
                  label: slowestRequest.label,
                  durationMs: round(durationOf(slowestRequest)),
              }
            : null,
        severity:
            durationOf(interaction) >= SLOW_MS.interaction || render.length > 0 || insights.length > 0
                ? "warning"
                : "ok",
    }
}

function buildFindings(data, interactionSummaries) {
    const findings = []
    const slowInteractions = interactionSummaries.filter(
        (interaction) => interaction.durationMs >= SLOW_MS.interaction
    )
    const slowRequests = data.requests.filter((request) => durationOf(request) >= SLOW_MS.request)
    const slowBridge = data.requests.filter(
        (request) =>
            (request.kind === "bridge" || request.kind === "native-api") &&
            durationOf(request) >= SLOW_MS.bridge
    )
    const renderIssues = data.metrics.filter((metric) =>
        ["fps-drop", "long-task", "loaf", "layout-shift"].includes(metric.kind)
    )
    const cacheMisses = data.requests.filter((request) => request.cacheStatus === "miss")

    if (slowInteractions.length > 0) {
        findings.push({
            severity: "warning",
            title: `${slowInteractions.length} slow interaction${slowInteractions.length === 1 ? "" : "s"}`,
            detail: `${slowInteractions[0].label} took ${slowInteractions[0].durationMs}ms`,
        })
    }
    if (slowRequests.length > 0) {
        const slowest = top(slowRequests, 1)[0]
        findings.push({
            severity: "warning",
            title: `${slowRequests.length} slow request${slowRequests.length === 1 ? "" : "s"}`,
            detail: `${slowest.label} took ${round(durationOf(slowest))}ms`,
        })
    }
    if (slowBridge.length > 0) {
        const slowest = top(slowBridge, 1)[0]
        findings.push({
            severity: "warning",
            title: `${slowBridge.length} slow native call${slowBridge.length === 1 ? "" : "s"}`,
            detail: `${slowest.label} took ${round(durationOf(slowest))}ms`,
        })
    }
    if (renderIssues.length > 0) {
        findings.push({
            severity: "warning",
            title: `${renderIssues.length} render issue${renderIssues.length === 1 ? "" : "s"}`,
            detail: renderIssues[0].label,
        })
    }
    if (cacheMisses.length > 0) {
        findings.push({
            severity: "info",
            title: `${cacheMisses.length} cache miss${cacheMisses.length === 1 ? "" : "es"}`,
            detail: cacheMisses[0].label,
        })
    }

    return findings
}

export function buildSummary(data) {
    const sessions = data.sessions ?? []
    const requests = data.requests ?? []
    const metrics = data.metrics ?? []
    const events = data.events ?? []
    const insights = data.insights ?? []
    const interactions = sessions.filter((session) => session.kind === "interaction")
    const renderIssues = metrics.filter((metric) =>
        ["fps-drop", "long-task", "loaf", "layout-shift"].includes(metric.kind)
    )
    const memory = metrics.find((metric) => metric.kind === "memory-summary") ?? null
    const interactionSummaries = top(interactions, 10).map((interaction) =>
        summarizeInteraction(interaction, data)
    )

    return {
        generatedAt: new Date().toISOString(),
        counts: {
            events: events.length,
            sessions: sessions.length,
            requests: requests.length,
            metrics: metrics.length,
            insights: insights.length,
        },
        byKind: {
            sessions: countBy(sessions, "kind"),
            requests: countBy(requests, "kind"),
            metrics: countBy(metrics, "kind"),
        },
        slowest: {
            interactions: top(interactions).map((record) => ({
                id: record.id,
                label: record.label,
                durationMs: round(durationOf(record)),
            })),
            requests: top(requests).map((record) => ({
                id: record.id,
                kind: record.kind,
                label: record.label,
                durationMs: round(durationOf(record)),
            })),
            render: top(renderIssues).map((record) => ({
                id: record.id,
                kind: record.kind,
                label: record.label,
                durationMs: round(durationOf(record)),
            })),
        },
        interactions: interactionSummaries,
        memory: memory
            ? {
                  label: memory.label,
                  latest: memory.detail?.latest ?? {},
                  peak: memory.detail?.peak ?? {},
                  sampleCount: memory.detail?.sampleCount ?? 0,
              }
            : null,
        findings: buildFindings(data, interactionSummaries),
    }
}
