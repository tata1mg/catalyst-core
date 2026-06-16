export const PROFILER_ROUTE = "/__catalyst/profiler"
const ROOT_ID = "catalyst-profiler-dashboard"

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.shell {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    background: #0f1115;
    color: #edf0f7;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
}
.topbar {
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    border-bottom: 1px solid #282d38;
    background: #151923;
}
.title { font-size: 15px; font-weight: 700; }
.meta { color: #9ca7bb; font-size: 12px; margin-left: 10px; }
.actions { display: flex; gap: 8px; }
button {
    appearance: none;
    border: 1px solid #343b4a;
    background: #1c2230;
    color: #edf0f7;
    border-radius: 6px;
    padding: 7px 10px;
    font: inherit;
    cursor: pointer;
}
button:hover { background: #252d3d; }
.tabs {
    display: flex;
    gap: 2px;
    padding: 8px 12px 0;
    border-bottom: 1px solid #282d38;
    background: #11151d;
}
.tab {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    color: #aeb8ca;
}
.tab.active {
    color: #ffffff;
    background: #222938;
    border-color: #3d4658;
}
.content {
    flex: 1;
    overflow: auto;
    padding: 16px;
}
.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
}
.panel {
    border: 1px solid #2b3240;
    background: #151a24;
    border-radius: 8px;
    padding: 12px;
}
.metric { color: #9ca7bb; font-size: 12px; }
.value { font-size: 22px; font-weight: 700; margin-top: 4px; }
.section { margin: 0 0 14px; }
.section h3 { font: inherit; font-size: 13px; font-weight: 700; margin: 0 0 8px; color: #d9dfeb; }
.list { display: grid; gap: 8px; }
.row {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) 90px 90px;
    gap: 10px;
    align-items: center;
    border: 1px solid #29303d;
    background: #121721;
    border-radius: 7px;
    padding: 9px 10px;
    cursor: pointer;
}
.row:hover, .row.selected { border-color: #5d78ff; background: #182033; }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: #9ca7bb; }
.pill {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    border-radius: 999px;
    padding: 2px 7px;
    background: #243044;
    color: #c9d4e8;
    font-size: 11px;
}
.warning { color: #ffd166; }
.bad { color: #ff7b7b; }
.ok { color: #71e19b; }
.timeline {
    position: relative;
    min-width: 720px;
    display: grid;
    gap: 7px;
}
.time-row {
    display: grid;
    grid-template-columns: 170px 1fr 70px;
    gap: 10px;
    align-items: center;
    cursor: pointer;
}
.bar-track {
    height: 18px;
    position: relative;
    border-radius: 4px;
    background: #10141c;
    overflow: hidden;
}
.bar {
    position: absolute;
    height: 100%;
    min-width: 2px;
    border-radius: 4px;
    background: #5d78ff;
}
.lane-network .bar { background: #4cc9f0; }
.lane-bridge .bar, .lane-native-api .bar { background: #f4a261; }
.lane-interaction .bar { background: #71e19b; }
.lane-render .bar, .lane-fps-drop .bar, .lane-long-task .bar, .lane-loaf .bar { background: #ff7b7b; }
.lane-cache .bar { background: #b48cff; }
.details {
    margin-top: 14px;
    border: 1px solid #30384a;
    background: #10141c;
    border-radius: 8px;
    padding: 12px;
}
pre {
    overflow: auto;
    max-height: 320px;
    margin: 8px 0 0;
    padding: 10px;
    border-radius: 6px;
    background: #080b10;
    color: #d7deea;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
}
@media (max-width: 700px) {
    .topbar { height: auto; align-items: flex-start; gap: 10px; padding: 12px; }
    .actions { flex-wrap: wrap; justify-content: flex-end; }
    .tabs { overflow-x: auto; }
    .row { grid-template-columns: 1fr 72px; }
    .row .pill { display: none; }
}
`

function formatMs(value) {
    return Number.isFinite(value) ? `${Math.round(value)}ms` : "-"
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}

function json(value) {
    return escapeHtml(JSON.stringify(value, null, 2))
}

function row(record, onClick = "") {
    return `
        <div class="row" data-id="${escapeHtml(record.id ?? "")}" ${onClick}>
            <div class="label">${escapeHtml(record.label ?? record.title ?? "-")}</div>
            <span class="pill">${escapeHtml(record.kind ?? record.severity ?? "")}</span>
            <div class="muted">${formatMs(record.durationMs)}</div>
        </div>
    `
}

function empty(label) {
    return `<div class="panel muted">${escapeHtml(label)}</div>`
}

function renderOverview(summary) {
    const memory = summary.memory
    return `
        <div class="grid">
            <div class="panel"><div class="metric">Events</div><div class="value">${summary.counts.events}</div></div>
            <div class="panel"><div class="metric">Sessions</div><div class="value">${summary.counts.sessions}</div></div>
            <div class="panel"><div class="metric">Requests</div><div class="value">${summary.counts.requests}</div></div>
            <div class="panel"><div class="metric">Insights</div><div class="value">${summary.counts.insights}</div></div>
            <div class="panel"><div class="metric">Memory</div><div class="value">${memory?.latest?.totalMb ? `${Math.round(memory.latest.totalMb)}MB` : "-"}</div></div>
        </div>
        <div class="section">
            <h3>Findings</h3>
            <div class="list">
                ${
                    summary.findings.length
                        ? summary.findings
                              .map(
                                  (finding) => `
                                      <div class="panel">
                                          <div class="${finding.severity === "warning" ? "warning" : "muted"}">${escapeHtml(finding.title)}</div>
                                          <div class="muted">${escapeHtml(finding.detail)}</div>
                                      </div>
                                  `
                              )
                              .join("")
                        : empty("No findings yet. Interact with the app and refresh.")
                }
            </div>
        </div>
        <div class="section">
            <h3>Slowest Interactions</h3>
            <div class="list">${summary.slowest.interactions.map((item) => row(item)).join("") || empty("No interactions recorded")}</div>
        </div>
        <div class="section">
            <h3>Slowest Requests</h3>
            <div class="list">${summary.slowest.requests.map((item) => row(item)).join("") || empty("No requests recorded")}</div>
        </div>
    `
}

function renderInteractions(summary) {
    return `
        <div class="section">
            <h3>Interactions</h3>
            <div class="list">
                ${
                    summary.interactions
                        .map(
                            (item) => `
                                <div class="panel">
                                    <div class="label ${item.severity === "warning" ? "warning" : ""}">${escapeHtml(item.label)}</div>
                                    <div class="muted">
                                        ${formatMs(item.durationMs)} · ${item.requestCount} requests · ${item.renderIssueCount} render issues · bridge ${formatMs(item.bridgeTimeMs)} · network ${formatMs(item.networkTimeMs)}
                                    </div>
                                    ${
                                        item.slowestRequest
                                            ? `<div class="muted">Slowest: ${escapeHtml(item.slowestRequest.label)} (${formatMs(item.slowestRequest.durationMs)})</div>`
                                            : ""
                                    }
                                </div>
                            `
                        )
                        .join("") || empty("No interactions recorded")
                }
            </div>
        </div>
    `
}

function renderRequests(data) {
    const requests = [...(data.requests ?? [])].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    return `
        <div class="section">
            <h3>Network / Bridge / Native</h3>
            <div class="list">${requests.map((item) => row(item, 'data-select="1"')).join("") || empty("No requests recorded")}</div>
        </div>
    `
}

function renderMemory(summary) {
    if (!summary.memory) return empty("No memory snapshots recorded")
    return `
        <div class="grid">
            <div class="panel"><div class="metric">Samples</div><div class="value">${summary.memory.sampleCount}</div></div>
            <div class="panel"><div class="metric">Latest Total</div><div class="value">${Math.round(summary.memory.latest.totalMb ?? 0)}MB</div></div>
            <div class="panel"><div class="metric">Latest WebView</div><div class="value">${Math.round(summary.memory.latest.webviewMb ?? 0)}MB</div></div>
            <div class="panel"><div class="metric">Peak Total</div><div class="value">${Math.round(summary.memory.peak.totalMb ?? 0)}MB</div></div>
        </div>
        <pre>${json(summary.memory)}</pre>
    `
}

function renderTimeline(api, selectedId) {
    const rows = api.waterfall("all")
    const start = rows.reduce((min, item) => Math.min(min, item.startTime ?? 0), Infinity)
    const end = rows.reduce((max, item) => Math.max(max, item.endTime ?? item.startTime ?? 0), 0)
    const span = Math.max(1, end - (Number.isFinite(start) ? start : 0))
    const selected = rows.find((item) => item.id === selectedId)
    return `
        <div class="timeline">
            ${
                rows
                    .map((item) => {
                        const left = (((item.startTime ?? 0) - start) / span) * 100
                        const width = Math.max(0.5, ((item.durationMs ?? 1) / span) * 100)
                        return `
                            <div class="time-row lane-${escapeHtml(item.lane)} ${item.id === selectedId ? "selected" : ""}" data-id="${escapeHtml(item.id)}">
                                <div class="label">${escapeHtml(item.label)}</div>
                                <div class="bar-track"><div class="bar" style="left:${left}%;width:${width}%"></div></div>
                                <div class="muted">${formatMs(item.durationMs)}</div>
                            </div>
                        `
                    })
                    .join("") || empty("No timeline rows yet")
            }
        </div>
        <div class="details">
            <strong>${escapeHtml(selected?.label ?? "Select a row")}</strong>
            ${selected ? `<pre>${json(selected)}</pre>` : ""}
        </div>
    `
}

function renderExport(data) {
    return `<pre>${json(data)}</pre>`
}

export function openDashboard(api) {
    if (typeof document === "undefined") return

    let host = document.getElementById(ROOT_ID)
    if (!host) {
        host = document.createElement("div")
        host.id = ROOT_ID
        document.documentElement.appendChild(host)
    }

    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" })
    const state = { tab: "overview", selectedId: null }
    const tabs = [
        ["overview", "Overview"],
        ["timeline", "Timeline"],
        ["interactions", "Interactions"],
        ["requests", "Network / Bridge"],
        ["memory", "Memory"],
        ["export", "Export"],
    ]

    function render() {
        const data = api.export()
        const summary = api.summary()
        const content =
            state.tab === "overview"
                ? renderOverview(summary)
                : state.tab === "timeline"
                  ? renderTimeline(api, state.selectedId)
                  : state.tab === "interactions"
                    ? renderInteractions(summary)
                    : state.tab === "requests"
                      ? renderRequests(data)
                      : state.tab === "memory"
                        ? renderMemory(summary)
                        : renderExport(data)

        root.innerHTML = `
            <style>${CSS}</style>
            <div class="shell">
                <div class="topbar">
                    <div><span class="title">Catalyst Profiler</span><span class="meta">${data.createdAt}</span></div>
                    <div class="actions">
                        <button data-action="refresh">Refresh</button>
                        <button data-action="clear">Clear</button>
                        <button data-action="close">Close</button>
                    </div>
                </div>
                <div class="tabs">
                    ${tabs.map(([id, label]) => `<button class="tab ${state.tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`).join("")}
                </div>
                <div class="content">${content}</div>
            </div>
        `
    }

    root.addEventListener("click", (event) => {
        const target = event.target
        const tab = target?.closest?.("[data-tab]")?.getAttribute("data-tab")
        const action = target?.closest?.("[data-action]")?.getAttribute("data-action")
        const rowId = target?.closest?.("[data-id]")?.getAttribute("data-id")

        if (tab) {
            state.tab = tab
            render()
            return
        }
        if (action === "close") {
            host.remove()
            return
        }
        if (action === "refresh") {
            render()
            return
        }
        if (action === "clear") {
            api.clear()
            state.selectedId = null
            render()
            return
        }
        if (rowId && state.tab === "timeline") {
            state.selectedId = rowId
            render()
        }
    })

    render()
}

export function installDashboardRoute(api, route = PROFILER_ROUTE) {
    if (typeof window === "undefined" || typeof document === "undefined") return
    if (window.__catalystProfilerRouteInstalled) return
    window.__catalystProfilerRouteInstalled = true

    const matchesRoute = () => window.location.pathname === route
    const syncRoute = () => {
        if (matchesRoute()) {
            openDashboard(api)
        }
    }

    const wrapHistory = (method) => {
        const original = window.history[method]
        window.history[method] = function catalystProfilerHistoryWrapper(...args) {
            const result = original.apply(this, args)
            setTimeout(syncRoute, 0)
            return result
        }
    }

    wrapHistory("pushState")
    wrapHistory("replaceState")
    window.addEventListener("popstate", syncRoute)
    window.addEventListener("hashchange", syncRoute)
    syncRoute()
}
