/**
 * document.modelContext shim — published as the opt-in `catalyst-core/webmcp/shim`
 * subpath, never imported by WebMcpProvider or the core `./webmcp` entry
 * point itself.
 *
 * WebMCP's real entry point (Chrome origin trial, unstable) hangs a
 * `modelContext` object off `navigator` and/or `document` with `registerTool`,
 * `getTools`, and an agent-side `executeTool`. This shim provides the same
 * surface so an app runs in any browser, not just one with native WebMCP.
 *
 * Import-time side-effect-free: nothing happens until an app calls
 * `installShim()` itself (typically once, before WebMcpProvider mounts).
 * Core ships provider/hooks/framework-tools only (no shim, no dev panel) —
 * an app that wants WebMCP to work in a browser without native support opts
 * into this subpath explicitly.
 *
 * Design choices:
 *   - Installs only when there is no native implementation — unless forced
 *     via `?webmcp=shim` or `localStorage.webmcp=shim` (useful for demoing/
 *     testing the shim path even on a browser that does have native support).
 *   - `registerTool(spec)` returns a *registration receipt* — `{ id, name,
 *     registeredAt, unregister() }` — deliberately distinct from the value
 *     `executeTool` resolves to: discovery/registration is distinguishable
 *     from successful execution.
 *   - Lifecycle *events* are emitted by registry.js, not here, so a dev
 *     panel or other observer behaves the same whether the backend is this
 *     shim or a native implementation.
 */

import { nativeModelContext } from "./native.js"

let _seq = 0
const nextId = () => `tool_${Date.now().toString(36)}_${(++_seq).toString(36)}`

/** True when ?webmcp=shim (or localStorage webmcp=shim) forces the shim even if native exists. */
function shimForced() {
    if (typeof window === "undefined") return false
    try {
        const q = new URLSearchParams(window.location.search)
        if (q.get("webmcp") === "shim") return true
        if (window.localStorage && window.localStorage.getItem("webmcp") === "shim") return true
    } catch {
        /* ignore */
    }
    return false
}

function createShim() {
    /** name -> { spec, id, registeredAt } */
    const tools = new Map()

    const api = {
        __isWebMcpShim: true,

        registerTool(spec) {
            if (!spec || typeof spec.name !== "string" || !spec.name) {
                throw new Error("registerTool: spec.name is required")
            }
            if (typeof spec.execute !== "function") {
                throw new Error(`registerTool("${spec.name}"): spec.execute must be a function`)
            }
            // Last-registration-wins at this layer; the framework layer decides
            // whether a same-name collision across owners is an error.
            const replaced = tools.has(spec.name)
            const id = nextId()
            const registeredAt = Date.now()
            tools.set(spec.name, { spec, id, registeredAt })

            return {
                id,
                name: spec.name,
                registeredAt,
                replaced,
                unregister: () => {
                    const cur = tools.get(spec.name)
                    if (cur && cur.id === id) {
                        tools.delete(spec.name)
                        return true
                    }
                    return false
                },
            }
        },

        /** Discovery: the shape an agent sees. No execute fn, JSON-serialisable. */
        getTools() {
            return Array.from(tools.values()).map(({ spec, id, registeredAt }) => ({
                id,
                name: spec.name,
                description: spec.description || "",
                inputSchema: spec.inputSchema || { type: "object", properties: {} },
                annotations: spec.annotations || {},
                registeredAt,
            }))
        },

        /** Agent-side call. Returns whatever the tool's execute() resolves to. */
        async executeTool(name, args = {}) {
            const entry = tools.get(name)
            if (!entry) {
                const err = new Error(`executeTool: no tool named "${name}"`)
                err.code = "TOOL_NOT_FOUND"
                throw err
            }
            return entry.spec.execute(args)
        },

        _debug: { tools },
    }

    return api
}

let _installed = null // { api, isNative }

/**
 * Ensure a modelContext implementation is available, installing the shim
 * onto `document.modelContext` if there is no native one (or the shim is
 * forced). Idempotent — safe to call more than once. Call this once, before
 * WebMcpProvider mounts, in any app that wants WebMCP to work on a browser
 * without native support.
 *
 * @returns {{ api: object|null, isNative: boolean }}
 */
export function installShim() {
    if (_installed) return _installed

    if (typeof document === "undefined") {
        // SSR — no-op stand-in so imports don't explode. Never registers.
        return { api: null, isNative: false }
    }

    const native = nativeModelContext()
    if (native && !shimForced()) {
        _installed = { api: native, isNative: true }
        return _installed
    }

    // Reuse an already-installed shim if present (e.g. from a prior call).
    if (document.modelContext && document.modelContext.__isWebMcpShim) {
        _installed = { api: document.modelContext, isNative: false }
        return _installed
    }

    const api = createShim()
    document.modelContext = api
    _installed = { api, isNative: false }
    return _installed
}
