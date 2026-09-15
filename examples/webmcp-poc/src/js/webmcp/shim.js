/**
 * document.modelContext shim.
 *
 * WebMCP's real entry point (Chrome origin trial, unstable) hangs a
 * `modelContext` object off `navigator` and/or `document` with `registerTool`,
 * `getTools`, and an agent-side `executeTool`. This shim provides the same
 * surface so the POC runs in any browser.
 *
 * Design choices for the POC:
 *   - Install only when there is no native implementation — unless the shim is
 *     forced via `?webmcp=shim` or `localStorage.webmcp=shim` (demo escape
 *     hatch, since the native shape is unstable).
 *   - `registerTool(spec)` returns a *registration receipt* — `{ id, name,
 *     registeredAt, unregister() }` — deliberately distinct from the value
 *     `executeTool` resolves to. (Per @jo32's note on the discussion:
 *     "discovery and successful registration should be distinguishable from
 *     successful execution.")
 *   - Lifecycle *events* are emitted by the framework layer (registry.js), not
 *     here, so the dev panel works the same whether the backend is this shim
 *     or a native implementation.
 */

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

/** Locate a native modelContext, checking both documented mount points. */
function nativeModelContext() {
    if (typeof document !== "undefined" && document.modelContext && !document.modelContext.__isWebMcpShim) {
        return document.modelContext
    }
    if (typeof navigator !== "undefined" && navigator.modelContext && !navigator.modelContext.__isWebMcpShim) {
        return navigator.modelContext
    }
    return null
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
 * Ensure a modelContext implementation is available. Idempotent.
 * @returns {{ api: object|null, isNative: boolean }}
 */
export function ensureModelContext() {
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

/** Whether the active backend is a real (non-shim) implementation. */
export function hasNative() {
    return ensureModelContext().isNative
}
