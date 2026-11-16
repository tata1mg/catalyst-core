import React, { useCallback, useEffect, useRef, useState } from "react"
import { plan } from "./planner.js"
import { runPlan } from "./runner.js"
import { useWire, clearWireLog } from "../webmcp/wire.js"
import css from "./AgentDock.scss"

const SUGGESTIONS = [
    "I'm tired, let's make camp and rest",
    "let's play under the stars",
    "walk to crossroads",
    "approach monolith",
    "make it night",
    "roll new character",
    "surprise me",
    "go to inspector",
]

const short = (v, n = 140) => {
    if (v === undefined) return ""
    let s
    try {
        s = JSON.stringify(v)
    } catch {
        s = String(v)
    }
    return s.length > n ? s.slice(0, n) + "…" : s
}

const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" })

function ToolCall({ call }) {
    const [open, setOpen] = useState(false)
    const { step, status, result, error } = call
    return (
        <li className={css.call} data-status={status}>
            <button className={css.callHead} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                <span className={css.callIcon} aria-hidden="true">
                    {status === "running" ? <span className={css.spinner} /> : status === "ok" ? "✓" : "✕"}
                </span>
                <code className={css.callName}>{step.tool}</code>
                <code className={css.callArgs}>{short(step.args, 60)}</code>
                {step.auto && <span className={css.autoTag}>auto-hop</span>}
            </button>
            {open && (
                <pre className={css.callBody}>
                    {status === "error"
                        ? `✕ ${error.code || "ERROR"}\n${error.message}`
                        : status === "ok"
                          ? JSON.stringify(result, null, 2)
                          : "…"}
                </pre>
            )}
        </li>
    )
}

function ChatView({ messages, busy, onSend, inputRef }) {
    const [text, setText] = useState("")
    const listRef = useRef(null)

    useEffect(() => {
        const el = listRef.current
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    }, [messages])

    const submit = (e) => {
        e.preventDefault()
        if (!text.trim() || busy) return
        onSend(text)
        setText("")
    }

    return (
        <>
            <ol className={css.messages} ref={listRef} aria-live="polite">
                {messages.map((m) => (
                    <li key={m.id} className={css.msg} data-role={m.role}>
                        {m.text && <p className={css.bubble}>{m.text}</p>}
                        {m.calls && m.calls.length > 0 && (
                            <ul className={css.calls}>
                                {m.calls.map((c) => (
                                    <ToolCall key={c.index} call={c} />
                                ))}
                            </ul>
                        )}
                    </li>
                ))}
            </ol>
            <div className={css.suggestions} role="list" aria-label="Example commands">
                {SUGGESTIONS.map((sug) => (
                    <button
                        key={sug}
                        role="listitem"
                        className={css.suggestion}
                        disabled={busy}
                        onClick={() => onSend(sug)}
                    >
                        {sug}
                    </button>
                ))}
            </div>
            <form className={css.composer} onSubmit={submit}>
                <label htmlFor="agent-input" className="sr-only">
                    Tell the agent what to do
                </label>
                <input
                    id="agent-input"
                    ref={inputRef}
                    className={css.input}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={busy ? "Agent is working…" : "Tell the agent what to do…"}
                    autoComplete="off"
                    enterKeyHint="send"
                />
                <button id="agent-send" className={css.send} disabled={busy || !text.trim()} aria-label="Send">
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path d="M4 12h14M12 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            </form>
        </>
    )
}

function WireView() {
    const { events } = useWire()
    return (
        <div className={css.wire}>
            <div className={css.wireBar}>
                <span className="eyebrow">document · webmcp:* events</span>
                <button className={css.wireClear} onClick={clearWireLog}>
                    clear
                </button>
            </div>
            <ol className={css.wireList}>
                {events.length === 0 && <li className={css.wireEmpty}>Waiting for traffic… navigate or run a command.</li>}
                {events.map((e) => (
                    <li key={e.id} className={css.wireRow} data-kind={e.kind}>
                        <time className={css.wireTime}>{fmtTime(e.at)}</time>
                        <span className={css.wireKind}>{e.kind}</span>
                        <code className={css.wireName}>{e.name}</code>
                        <code className={css.wireDetail}>
                            {e.kind === "register" && (e.routePath ? `route ${e.routePath}` : "app-wide")}
                            {e.kind === "call" && short(e.args, 80)}
                            {e.kind === "result" && short(e.result, 80)}
                            {e.kind === "error" && `${e.error && e.error.code}: ${e.error && e.error.message}`}
                        </code>
                    </li>
                ))}
            </ol>
        </div>
    )
}

let msgSeq = 0
const INTRO = {
    id: ++msgSeq,
    role: "agent",
    text:
        "Hi, I'm a pretend in-browser agent. I can't see pixels or click buttons. I can only call the " +
        "WebMCP tools this page registers on document.modelContext. Ask me to reshape the 3D sculpture, " +
        "make knockout stickers, or move between pages.",
}

export default function AgentDock({ open, onClose }) {
    const [tab, setTab] = useState("chat")
    const [messages, setMessages] = useState([INTRO])
    const [busy, setBusy] = useState(false)
    const inputRef = useRef(null)
    const sheetRef = useRef(null)

    // Esc closes on any viewport; focus the composer when opened.
    useEffect(() => {
        if (!open) return undefined
        const onKey = (e) => e.key === "Escape" && onClose()
        window.addEventListener("keydown", onKey)
        const isDesktop = window.matchMedia("(min-width: 1100px)").matches
        if (!isDesktop) setTimeout(() => inputRef.current && inputRef.current.focus({ preventScroll: true }), 300)
        return () => window.removeEventListener("keydown", onKey)
    }, [open, onClose])

    const send = useCallback(async (text) => {
        setTab("chat")
        const userMsg = { id: ++msgSeq, role: "user", text }
        const { steps, reply } = plan(text)
        if (!steps.length) {
            setMessages((m) => [...m, userMsg, { id: ++msgSeq, role: "agent", text: reply }])
            return
        }
        const agentId = ++msgSeq
        const lead = steps[0].say || `On it. ${steps.length} tool call${steps.length > 1 ? "s" : ""} planned.`
        setMessages((m) => [...m, userMsg, { id: agentId, role: "agent", text: lead, calls: [] }])
        setBusy(true)
        let failed = false
        await runPlan(steps, (ev) => {
            if (ev.status === "error") failed = true
            setMessages((list) =>
                list.map((msg) => {
                    if (msg.id !== agentId) return msg
                    const calls = msg.calls.slice()
                    const at = calls.findIndex((c) => c.index === ev.index)
                    const call = { index: ev.index, step: ev.step, status: ev.status, result: ev.result, error: ev.error }
                    if (at === -1) calls.push(call)
                    else calls[at] = call
                    return { ...msg, calls }
                })
            )
        })
        setBusy(false)
        setMessages((m) => [
            ...m,
            {
                id: ++msgSeq,
                role: "agent",
                text: failed
                    ? "A tool refused that. WebMCP errors are typed, so expand the red call to see the code."
                    : "Done. Every change above was made through a tool call, with no DOM poking.",
            },
        ])
    }, [])

    return (
        <>
            <div className={css.scrim} data-open={open} onClick={onClose} aria-hidden="true" />
            <aside
                id="agent-dock"
                ref={sheetRef}
                className={css.dock}
                data-open={open}
                aria-label="Agent console"
                aria-hidden={!open}
                inert={!open}
            >
                <div className={css.grab} aria-hidden="true" />
                <header className={css.head}>
                    <div className={css.who}>
                        <span className={css.avatar} data-busy={busy} aria-hidden="true">
                            <span />
                        </span>
                        <div>
                            <h2 className={css.title}>Agent</h2>
                            <p className={css.sub}>{busy ? "calling tools…" : "simulated · local · no API key"}</p>
                        </div>
                    </div>
                    <div className={css.tabs} role="tablist">
                        <button role="tab" aria-selected={tab === "chat"} className={css.tab} onClick={() => setTab("chat")}>
                            Chat
                        </button>
                        <button role="tab" aria-selected={tab === "wire"} className={css.tab} onClick={() => setTab("wire")}>
                            Wire
                        </button>
                    </div>
                    <button className={css.close} onClick={onClose} aria-label="Close agent">
                        ✕
                    </button>
                </header>
                {tab === "chat" ? (
                    <ChatView messages={messages} busy={busy} onSend={send} inputRef={inputRef} />
                ) : (
                    <WireView />
                )}
            </aside>
        </>
    )
}
