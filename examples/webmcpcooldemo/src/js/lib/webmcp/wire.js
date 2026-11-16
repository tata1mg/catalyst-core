/**
 * wire.js — one client-side store for everything the WebMCP registry emits.
 *
 * catalyst-core/webmcp dispatches `webmcp:register`, `webmcp:unregister`,
 * `webmcp:execute:start` and `webmcp:execute:end` on `document`. This module
 * subscribes ONCE (lazily, on first use in the browser) and keeps:
 *
 *   - `tools`  — current snapshot from inspect() (+ schemas from the backend)
 *   - `events` — a rolling log for the "wire" view
 *   - `firing` — names of tools executing right now (for glow effects)
 *
 * Exposed via useSyncExternalStore so every consumer (nav counter, agent dock,
 * inspector, tool cards) sees the same state without prop drilling, and the
 * log survives route changes + dock tab switches.
 */
import { useSyncExternalStore } from "react"
import { inspect } from "catalyst-core/webmcp"

const MAX_EVENTS = 120

let state = { tools: [], isNative: false, events: [], firing: [] }
const listeners = new Set()
let started = false
let seq = 0
let refreshQueued = false

function set(patch) {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
}

function readBackendSchemas() {
    // Native document.modelContext may not expose getTools (or may make it
    // async) — schemas are a nice-to-have for the inspector, never required.
    const api =
        (typeof document !== "undefined" && document.modelContext) ||
        (typeof navigator !== "undefined" && navigator.modelContext)
    if (!api || typeof api.getTools !== "function") return {}
    try {
        const raw = api.getTools()
        const list = Array.isArray(raw) ? raw : Array.isArray(raw && raw.tools) ? raw.tools : []
        const out = {}
        for (const t of list) out[t.name] = t
        return out
    } catch {
        return {}
    }
}

function refreshTools() {
    // Coalesce bursts (a route change unregisters + registers many at once).
    if (refreshQueued) return
    refreshQueued = true
    queueMicrotask(() => {
        refreshQueued = false
        const snap = inspect()
        const schemas = readBackendSchemas()
        const tools = snap.tools
            .map((t) => {
                const s = schemas[t.name] || {}
                return {
                    ...t,
                    description: s.description || "",
                    inputSchema: s.inputSchema || null,
                    annotations: s.annotations || {},
                }
            })
            .sort((a, b) => Number(!!a.routePath) - Number(!!b.routePath) || a.name.localeCompare(b.name))
        set({ tools, isNative: snap.isNative })
    })
}

function log(kind, detail) {
    const entry = { id: ++seq, at: Date.now(), kind, ...detail }
    set({ events: [entry, ...state.events].slice(0, MAX_EVENTS) })
}

function start() {
    if (started || typeof document === "undefined") return
    started = true

    document.addEventListener("webmcp:register", (e) => {
        log("register", { name: e.detail.name, routePath: e.detail.routePath, replaced: e.detail.replaced })
        refreshTools()
    })
    document.addEventListener("webmcp:unregister", (e) => {
        log("unregister", { name: e.detail.name })
        refreshTools()
    })
    document.addEventListener("webmcp:execute:start", (e) => {
        log("call", { name: e.detail.name, args: e.detail.args, callId: e.detail.callId })
        set({ firing: [...state.firing, e.detail.name] })
    })
    document.addEventListener("webmcp:execute:end", (e) => {
        log(e.detail.ok ? "result" : "error", {
            name: e.detail.name,
            callId: e.detail.callId,
            result: e.detail.result,
            error: e.detail.error,
        })
        // Keep the glow on a beat longer than the call so it's visible.
        setTimeout(() => {
            const idx = state.firing.indexOf(e.detail.name)
            if (idx === -1) return
            const firing = state.firing.slice()
            firing.splice(idx, 1)
            set({ firing })
        }, 650)
    })

    refreshTools()
}

function subscribe(listener) {
    start()
    listeners.add(listener)
    return () => listeners.delete(listener)
}

const getSnapshot = () => state
const SERVER_SNAPSHOT = { tools: [], isNative: false, events: [], firing: [] }
const getServerSnapshot = () => SERVER_SNAPSHOT

export function useWire() {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Is a tool with this name currently executing? */
export function useIsFiring(name) {
    const { firing } = useWire()
    return firing.includes(name)
}

export function clearWireLog() {
    set({ events: [] })
}

/** Resolve once a tool with `name` is live (or reject after `timeout` ms). */
export function waitForTool(name, timeout = 2500) {
    return new Promise((resolve, reject) => {
        if (inspect().tools.some((t) => t.name === name)) return resolve()
        const t0 = Date.now()
        const tick = () => {
            if (inspect().tools.some((t) => t.name === name)) return resolve()
            if (Date.now() - t0 > timeout) return reject(new Error(`Tool "${name}" never appeared`))
            setTimeout(tick, 60)
        }
        tick()
    })
}
