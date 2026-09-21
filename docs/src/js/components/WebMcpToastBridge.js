import React, { useEffect, useRef, useState } from 'react'

/**
 * WebMcpToastBridge — visible, real-time feedback for what a WebMCP agent is
 * doing in this app. There is no dev panel in docs (that's an app-level
 * choice examples/webmcp-poc made differently); this is docs' own answer to
 * "what is the AI doing right now" — a toast per tool call, auto-dismissing,
 * rather than a persistent sidebar.
 *
 * Two sources feed the toast stream:
 *
 *   1. AUTO-SYNTHESIZED narration, derived from the registry's own
 *      webmcp:execute:start/end events (see catalyst-core/webmcp's
 *      registry.js — the same events a dev panel would subscribe to). This
 *      needs zero integration on the agent side: it works the instant a
 *      tool call happens, for any agent/extension driving the page.
 *      Deliberately NOT presented as the model's literal words — it is
 *      composed-in-code narration ("Searching docs for…"), not a quote.
 *
 *   2. window.__webmcpNarrate(text) — an escape hatch for an integration
 *      that DOES have the agent's real response text (a custom chat UI
 *      embedded in the page, a modified Inspector wiring) to push it
 *      directly into the same toast stream, independent of any tool call.
 *      Not correlated to a specific callId — kept simple as a flat stream.
 *
 * Client-only; SSR renders nothing (there's no document to attach to, and
 * no agent calls tools during a server render anyway).
 */

const MAX_VISIBLE = 5
const MAX_RETAINED = 20
const DISMISS_AFTER_MS = 4500

let _toastSeq = 0

/**
 * Turn one execute:start/execute:end event into a short, human sentence.
 * Unknown tool names (any future tool, in this app or elsewhere) fall
 * through to a generic template rather than being silently dropped.
 */
function narrate(kind, detail) {
    const { name, args, ok, result, error } = detail

    if (kind === 'start') {
        if (name === 'search_docs') return `Searching docs for "${args?.query ?? ''}"…`
        if (name === 'open_doc') return `Opening "${args?.url ?? ''}"…`
        if (name === 'navigate') return `Navigating to ${args?.path ?? ''}…`
        if (name === 'get_page_info') return 'Reading the current page…'
        if (name === 'get_current_route') return 'Checking what tools are callable…'
        const argsText = args && Object.keys(args).length ? truncate(JSON.stringify(args)) : ''
        return `Calling ${name}(${argsText})…`
    }

    // kind === 'end'
    if (!ok) {
        return `${name} failed: ${truncate(error?.message || 'unknown error')}`
    }
    if (name === 'search_docs') {
        const count = result?.count ?? (Array.isArray(result?.results) ? result.results.length : undefined)
        return count !== undefined ? `Found ${count} result${count === 1 ? '' : 's'}.` : `${name} done.`
    }
    if (name === 'open_doc' || name === 'navigate') {
        const dest = result?.url || result?.path
        return dest ? `Navigated to ${dest}.` : `${name} done.`
    }
    if (typeof result === 'string') return truncate(result)
    return result === undefined ? `${name} done.` : `${name} → ${truncate(JSON.stringify(result))}`
}

/** Keeps an unknown-shape result readable in a toast rather than dumping raw JSON. */
function truncate(text, max = 240) {
    return text.length > max ? `${text.slice(0, max)}…` : text
}

function iconFor(toast) {
    if (toast.source === 'narrate') return '💬'
    if (toast.kind === 'end' && toast.ok === false) return '⚠️'
    if (toast.kind === 'start') return '⏳'
    return '✓'
}

const WebMcpToastBridge = () => {
    const [toasts, setToasts] = useState([])
    const timersRef = useRef(new Map())

    const pushToast = (toast) => {
        const id = ++_toastSeq
        setToasts((prev) => [...prev, { id, at: Date.now(), ...toast }].slice(-MAX_RETAINED))
        const timer = setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id))
            timersRef.current.delete(id)
        }, DISMISS_AFTER_MS)
        timersRef.current.set(id, timer)
    }

    useEffect(() => {
        if (typeof document === 'undefined') return undefined

        // Captured once per mount — this effect only ever runs on mount/
        // unmount (empty deps), so `timers` and `timersRef.current` are the
        // same Map for the component's whole lifetime. Read through this
        // local rather than `timersRef.current` directly in the cleanup so
        // the lint rule (which can't know the ref never gets reassigned
        // here) doesn't warn about a stale ref read.
        const timers = timersRef.current

        const onExecStart = (e) => {
            pushToast({ source: 'tool', kind: 'start', name: e.detail.name, text: narrate('start', e.detail) })
        }
        const onExecEnd = (e) => {
            pushToast({
                source: 'tool',
                kind: 'end',
                name: e.detail.name,
                ok: e.detail.ok,
                text: narrate('end', e.detail),
            })
        }

        document.addEventListener('webmcp:execute:start', onExecStart)
        document.addEventListener('webmcp:execute:end', onExecEnd)

        // The escape hatch: any external integration with the agent's own
        // real text can call this directly. Installed once, here — kept
        // stable across re-renders since pushToast is recreated per render
        // but we only need the LATEST closure at call time, so we read
        // through a ref rather than re-registering the global on every
        // render.
        window.__webmcpNarrate = (text, opts = {}) => {
            if (typeof text !== 'string' || !text.trim()) return
            pushToast({ source: 'narrate', kind: opts.level === 'error' ? 'end' : 'start', ok: opts.level !== 'error', text })
        }

        return () => {
            document.removeEventListener('webmcp:execute:start', onExecStart)
            document.removeEventListener('webmcp:execute:end', onExecEnd)
            if (window.__webmcpNarrate) delete window.__webmcpNarrate
            for (const timer of timers.values()) clearTimeout(timer)
            timers.clear()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    if (typeof document === 'undefined') return null
    if (!toasts.length) return null

    const visible = toasts.slice(-MAX_VISIBLE)

    return (
        <div style={S.stack} aria-live="polite">
            {visible.map((t) => (
                <div key={t.id} style={{ ...S.toast, ...(t.ok === false ? S.toastError : {}) }}>
                    <div style={S.header}>
                        <span style={S.icon}>{iconFor(t)}</span>
                        <span style={S.label}>{labelFor(t)}</span>
                    </div>
                    <div style={S.body}>{t.text}</div>
                </div>
            ))}
        </div>
    )
}

/** Short bold label for the toast header — the tool name, or "AI" for a narrate() push. */
function labelFor(toast) {
    if (toast.source === 'narrate') return 'AI'
    return toast.name || 'webmcp'
}

const S = {
    stack: {
        position: 'fixed',
        right: 16,
        top: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 999999,
        pointerEvents: 'none',
        width: 320,
    },
    toast: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '10px 14px',
        borderRadius: 8,
        background: 'rgba(17, 24, 39, 0.92)',
        color: '#f9fafb',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        font: '13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    toastError: {
        background: 'rgba(127, 29, 29, 0.95)',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
    },
    icon: { flexShrink: 0, fontSize: 12 },
    label: {
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        color: '#9ca3af',
    },
    body: {
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
        maxHeight: 96,
        overflowY: 'auto',
        // Long results (a search_docs dump, a multi-line error) scroll
        // inside the toast instead of stretching it to cover the page —
        // this is the "content structure" fix: a short label up top always
        // stays visible, and only the body (which can be arbitrarily long)
        // is capped and scrollable.
        pointerEvents: 'auto',
    },
}

export default WebMcpToastBridge
