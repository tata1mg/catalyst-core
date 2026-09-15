import React, { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { ensureModelContext } from "./shim.js"
import { inspect, invokeTool } from "./registry.js"

/**
 * DevPanel — a hand-driven stand-in for a browser AI agent.
 *
 * There is no shipping browser agent to point at this app, so the panel is how
 * you exercise the integration: it shows what `document.modelContext.getTools()`
 * returns (discovery), lets you call `executeTool(name, args)` with JSON args,
 * and — per @jo32's note on the discussion — keeps the *registration receipt*
 * (a tool appeared / disappeared) visually separate from the *execution result*
 * (a call ran and returned / threw).
 *
 * Rendered via portal into the <div id="webmcp-panel" /> that App mounts.
 * Client-only.
 */
export function DevPanel({ tick, snapshot }) {
    const [mountEl, setMountEl] = useState(null)
    const [open, setOpen] = useState(true)
    const [log, setLog] = useState([]) // { kind, at, ...payload }
    const [selected, setSelected] = useState(null)
    const [argsText, setArgsText] = useState("{}")
    const [running, setRunning] = useState(false)

    useEffect(() => {
        setMountEl(document.getElementById("webmcp-panel"))
    }, [])

    // Subscribe to the shim's lifecycle events → registration-side log.
    useEffect(() => {
        const onReg = (e) =>
            pushLog({ kind: "register", at: Date.now(), name: e.detail.name, id: e.detail.id, replaced: e.detail.replaced })
        const onUnreg = (e) => pushLog({ kind: "unregister", at: Date.now(), name: e.detail.name, id: e.detail.id })
        const onExecStart = (e) =>
            pushLog({ kind: "exec-start", at: Date.now(), name: e.detail.name, args: e.detail.args, callId: e.detail.callId })
        const onExecEnd = (e) =>
            pushLog({
                kind: "exec-end",
                at: Date.now(),
                name: e.detail.name,
                callId: e.detail.callId,
                ok: e.detail.ok,
                result: e.detail.result,
                error: e.detail.error,
            })
        document.addEventListener("webmcp:register", onReg)
        document.addEventListener("webmcp:unregister", onUnreg)
        document.addEventListener("webmcp:execute:start", onExecStart)
        document.addEventListener("webmcp:execute:end", onExecEnd)
        return () => {
            document.removeEventListener("webmcp:register", onReg)
            document.removeEventListener("webmcp:unregister", onUnreg)
            document.removeEventListener("webmcp:execute:start", onExecStart)
            document.removeEventListener("webmcp:execute:end", onExecEnd)
        }
    }, [])

    function pushLog(entry) {
        setLog((prev) => [entry, ...prev].slice(0, 40))
    }

    const reg = inspect() // framework-side truth: name → routePath, isNative

    // Discovery view — prefer what an agent would actually see
    // (document.modelContext.getTools()); fall back to the registry's own list
    // when the backend has no usable page-side getTools() (native shapes vary:
    // it may not exist, may return a Promise, or an object rather than an array).
    const discovered = useMemo(() => {
        const fromRegistry = () =>
            inspect().tools.map((t) => ({
                id: t.receiptId || t.name,
                name: t.name,
                description: "(registered via useTool)",
                inputSchema: { type: "object", properties: {} },
            }))

        const { api } = ensureModelContext()
        if (api && typeof api.getTools === "function") {
            try {
                const raw = api.getTools()
                const list = Array.isArray(raw)
                    ? raw
                    : Array.isArray(raw && raw.tools)
                      ? raw.tools
                      : null
                if (list) {
                    return list.map((t) => ({
                        id: t.id || t.name,
                        name: t.name,
                        description: t.description || "",
                        inputSchema: t.inputSchema || { type: "object", properties: {} },
                    }))
                }
            } catch {
                /* fall through */
            }
        }
        return fromRegistry()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick, log.length])

    async function runSelected() {
        if (!selected) return
        let args
        try {
            args = JSON.parse(argsText || "{}")
        } catch (err) {
            pushLog({ kind: "exec-end", at: Date.now(), name: selected, ok: false, error: { message: `bad JSON: ${err.message}` } })
            return
        }
        setRunning(true)
        try {
            // Go through the registry's wrapped execute so this works whether or
            // not the backend exposes a page-side executeTool(). Result / error
            // are rendered from the webmcp:execute:* events.
            await invokeTool(selected, args)
        } catch {
            /* captured via event */
        } finally {
            setRunning(false)
        }
    }

    if (!mountEl) return null

    return createPortal(
        <div style={S.root}>
            <div style={S.header} onClick={() => setOpen((o) => !o)}>
                <strong>WebMCP</strong>
                <span style={S.badge}>{snapshot && snapshot.isNative ? "native" : "shim"}</span>
                <span style={S.count}>{discovered.length} tool(s)</span>
                <span style={S.toggle}>{open ? "▾" : "▸"}</span>
            </div>

            {open && (
                <div style={S.body}>
                    <div style={S.section}>
                        <div style={S.sectionTitle}>Discovered — document.modelContext.getTools()</div>
                        {discovered.length === 0 && <div style={S.dim}>none registered</div>}
                        {discovered.map((t) => {
                            const meta = reg.tools.find((r) => r.name === t.name)
                            return (
                                <label key={t.id} style={S.toolRow}>
                                    <input
                                        type="radio"
                                        name="webmcp-tool"
                                        checked={selected === t.name}
                                        onChange={() => {
                                            setSelected(t.name)
                                            setArgsText(seedArgs(t.inputSchema))
                                        }}
                                    />
                                    <span style={S.toolName}>{t.name}</span>
                                    {meta && meta.routePath && <span style={S.route}>{meta.routePath}</span>}
                                    <span style={S.toolDesc}>{t.description}</span>
                                </label>
                            )
                        })}
                    </div>

                    <div style={S.section}>
                        <div style={S.sectionTitle}>Invoke — executeTool(name, args)</div>
                        <textarea
                            style={S.args}
                            value={argsText}
                            spellCheck={false}
                            onChange={(e) => setArgsText(e.target.value)}
                            rows={3}
                        />
                        <button style={S.run} disabled={!selected || running} onClick={runSelected}>
                            {running ? "running…" : selected ? `run ${selected}` : "select a tool"}
                        </button>
                    </div>

                    <div style={S.section}>
                        <div style={S.sectionTitle}>Activity — registration vs execution</div>
                        <div style={S.log}>
                            {log.length === 0 && <div style={S.dim}>nothing yet</div>}
                            {log.map((e, i) => (
                                <div key={i} style={S.logRow}>
                                    <span style={{ ...S.tag, ...tagStyle(e.kind) }}>{tagLabel(e.kind)}</span>
                                    <span style={S.logName}>{e.name}</span>
                                    <span style={S.logDetail}>{logDetail(e)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>,
        mountEl
    )
}

function seedArgs(schema) {
    if (!schema || !schema.properties) return "{}"
    const obj = {}
    for (const [k, p] of Object.entries(schema.properties)) {
        if (p.type === "number" || p.type === "integer") obj[k] = p.minimum ?? 1
        else if (p.type === "string") obj[k] = ""
        else if (p.type === "boolean") obj[k] = false
    }
    return JSON.stringify(obj, null, 2)
}

function tagLabel(kind) {
    return {
        register: "REGISTERED",
        unregister: "UNREGISTERED",
        "exec-start": "CALL →",
        "exec-end": "RESULT",
    }[kind] || kind
}

function tagStyle(kind) {
    if (kind === "register") return { background: "#dcfce7", color: "#166534" }
    if (kind === "unregister") return { background: "#fee2e2", color: "#991b1b" }
    if (kind === "exec-start") return { background: "#e0e7ff", color: "#3730a3" }
    if (kind === "exec-end") return { background: "#fef9c3", color: "#854d0e" }
    return { background: "#e5e7eb", color: "#374151" }
}

function logDetail(e) {
    if (e.kind === "register") return e.replaced ? `id ${short(e.id)} (replaced previous)` : `id ${short(e.id)}`
    if (e.kind === "unregister") return `id ${short(e.id)}`
    if (e.kind === "exec-start") return JSON.stringify(e.args)
    if (e.kind === "exec-end") {
        if (e.ok) return `✓ ${typeof e.result === "string" ? e.result : JSON.stringify(e.result)}`
        return `✗ ${e.error ? e.error.code ? `[${e.error.code}] ` : "" : ""}${e.error && e.error.message}`
    }
    return ""
}

const short = (id) => (id ? String(id).slice(-6) : "")

const S = {
    root: {
        position: "fixed",
        right: 12,
        bottom: 12,
        width: 380,
        maxHeight: "70vh",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        border: "1px solid #d1d5db",
        borderRadius: 10,
        boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
        font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#111827",
        zIndex: 99999,
        overflow: "hidden",
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        background: "#f9fafb",
        borderBottom: "1px solid #e5e7eb",
        cursor: "pointer",
        userSelect: "none",
    },
    badge: { padding: "1px 6px", borderRadius: 999, background: "#111827", color: "#fff", fontSize: 10 },
    count: { marginLeft: "auto", color: "#6b7280" },
    toggle: { color: "#6b7280" },
    body: { overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 12 },
    section: { display: "flex", flexDirection: "column", gap: 6 },
    sectionTitle: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "#6b7280" },
    dim: { color: "#9ca3af" },
    toolRow: { display: "flex", alignItems: "baseline", gap: 6, padding: "3px 0", cursor: "pointer" },
    toolName: { fontWeight: 700 },
    route: { padding: "0 4px", borderRadius: 4, background: "#eef2ff", color: "#4338ca", fontSize: 10 },
    toolDesc: { color: "#6b7280", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    args: {
        width: "100%",
        boxSizing: "border-box",
        border: "1px solid #d1d5db",
        borderRadius: 6,
        padding: 6,
        font: "inherit",
        resize: "vertical",
    },
    run: {
        padding: "6px 10px",
        border: "1px solid #111827",
        borderRadius: 6,
        background: "#111827",
        color: "#fff",
        cursor: "pointer",
    },
    log: { display: "flex", flexDirection: "column", gap: 3, maxHeight: 200, overflowY: "auto" },
    logRow: { display: "flex", alignItems: "baseline", gap: 6 },
    tag: { padding: "0 5px", borderRadius: 4, fontSize: 9, fontWeight: 700, whiteSpace: "nowrap" },
    logName: { fontWeight: 700, whiteSpace: "nowrap" },
    logDetail: { color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
}
