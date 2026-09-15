/**
 * The framework-side WebMCP registry — the piece the discussion argues only
 * a framework (not a component-scoped library) can own.
 *
 * Responsibilities:
 *   - Single point that talks to `document.modelContext` (native or shim).
 *   - Track every live tool with its *owner* (a hook instance) and the
 *     *route path* it was registered under.
 *   - Give `WebMcpProvider` a way to abort every tool belonging to routes
 *     that are no longer matched (agent navigated away → stale tools die).
 *   - Namespacing: if two routes both want "add_to_cart", the later one is
 *     rejected loudly rather than silently clobbering (shim's last-wins).
 *
 * This module holds process-wide singleton state on purpose — there is one
 * `document.modelContext` per document, so there is one registry.
 */

import { ensureModelContext, hasNative } from "./shim.js"
import { WebMcpError, WEBMCP_ERROR_CODES, toWebMcpError } from "./errors.js"

/** ownerKey -> { name, routePath, receipt, abortController, spec } */
const live = new Map()
let _ownerSeq = 0
let _callSeq = 0

export const newOwnerKey = () => `owner_${(++_ownerSeq).toString(36)}`

/**
 * The backend `document.modelContext` — or, when there is none (SSR, unit
 * tests with no DOM), an in-memory stand-in so the registry's own logic
 * (collision detection, reap, invoke) stays exercisable. The stand-in never
 * touches globals and never persists past the process.
 */
function ctx() {
    const { api } = ensureModelContext()
    if (api) return api
    if (!_fallbackApi) _fallbackApi = createFallbackBackend()
    return _fallbackApi
}

let _fallbackApi = null
function createFallbackBackend() {
    const map = new Map()
    let seq = 0
    return {
        __isFallback: true,
        registerTool(spec) {
            const id = `fb_${(++seq).toString(36)}`
            const replaced = map.has(spec.name)
            map.set(spec.name, spec)
            return {
                id,
                name: spec.name,
                registeredAt: Date.now(),
                replaced,
                unregister: () => map.delete(spec.name),
            }
        },
        getTools() {
            return Array.from(map.values()).map((s) => ({
                name: s.name,
                description: s.description || "",
                inputSchema: s.inputSchema || { type: "object", properties: {} },
            }))
        },
        executeTool(name, args) {
            const s = map.get(name)
            if (!s) {
                const e = new Error(`no tool "${name}"`)
                e.code = "TOOL_NOT_FOUND"
                throw e
            }
            return s.execute(args)
        },
    }
}

/**
 * Lifecycle events for the dev panel. Emitted here (framework layer) rather
 * than inside the shim, so the panel behaves identically on a native backend.
 *   webmcp:register    { id, name, routePath, replaced }
 *   webmcp:unregister  { id, name }
 *   webmcp:execute:start { callId, name, args }
 *   webmcp:execute:end   { callId, name, ok, result?, error? }
 */
function emit(type, detail) {
    if (typeof document === "undefined") return
    try {
        document.dispatchEvent(new CustomEvent(type, { detail }))
    } catch {
        /* CustomEvent unavailable — panel just won't live-update */
    }
}

export function isNative() {
    return hasNative()
}

/**
 * Register a tool on behalf of a hook instance.
 *
 * @param {string} ownerKey        stable id for the calling useTool() instance
 * @param {string} routePath       the route pattern this tool lives under ("" if unknown)
 * @param {object} spec            { name, description, inputSchema, annotations, execute }
 * @returns {{ ok: true, receipt: object } | { ok: false, error: WebMcpError }}
 */
export function registerTool(ownerKey, routePath, spec) {
    const api = ctx()

    // Same owner re-registering (StrictMode remount, fast refresh): tear the
    // old one down first so we don't trip our own collision check.
    if (live.has(ownerKey)) {
        unregisterTool(ownerKey)
    }

    // Collision check across *other* owners — a genuine "two components want the
    // same tool name right now" clash.
    for (const [key, entry] of live) {
        if (key !== ownerKey && entry.name === spec.name) {
            return {
                ok: false,
                error: new WebMcpError(WEBMCP_ERROR_CODES.DUPLICATE_TOOL, {
                    message: `Tool "${spec.name}" is already registered by route "${entry.routePath || "?"}".`,
                    details: "Two components asked for the same tool name at the same time. Rename one, or scope it per route.",
                }),
            }
        }
    }

    const abortController = new AbortController()

    // Wrap execute so: (a) the AbortSignal is passed through to the tool,
    // (b) a call that arrives after this owner is genuinely gone from the
    // registry is rejected, (c) thrown errors become WebMcpError.
    //
    // Note: we check `live` membership, NOT `abortController.signal.aborted`.
    // A native `document.modelContext` keeps its own reference to this wrapped
    // execute; if the hook re-registers (StrictMode double-invoke, a transient
    // re-render) the old controller is aborted but the tool is still very much
    // usable under a fresh entry. Only a real unmount / route-reap removes the
    // owner from `live`, and that is the true "no longer active" signal.
    const wrappedSpec = {
        name: spec.name,
        description: spec.description || "",
        inputSchema: spec.inputSchema || { type: "object", properties: {} },
        annotations: spec.annotations || {},
        execute: async (args = {}) => {
            const callId = `call_${(++_callSeq).toString(36)}`
            emit("webmcp:execute:start", { callId, name: spec.name, args })
            try {
                const current = live.get(ownerKey)
                const stillActive =
                    !!current || Array.from(live.values()).some((e) => e.name === spec.name)
                if (!stillActive) {
                    throw new WebMcpError(WEBMCP_ERROR_CODES.ABORTED, {
                        message: `Tool "${spec.name}" is no longer active (its component unmounted or its route was left).`,
                    })
                }
                // Prefer the currently-live entry's signal if this exact wrapper
                // was superseded by a re-register.
                const signal = current ? current.abortController.signal : abortController.signal
                const argErr = shallowValidate(spec.inputSchema, args)
                if (argErr) throw argErr
                const result = await spec.execute(args, { signal })
                emit("webmcp:execute:end", { callId, name: spec.name, ok: true, result })
                return result
            } catch (err) {
                const wrapped = toWebMcpError(err)
                emit("webmcp:execute:end", {
                    callId,
                    name: spec.name,
                    ok: false,
                    error: { message: wrapped.message, code: wrapped.code },
                })
                throw wrapped
            }
        },
    }

    let rawReceipt
    try {
        rawReceipt = api.registerTool(wrappedSpec)
    } catch (err) {
        return { ok: false, error: toWebMcpError(err) }
    }

    // Normalise: native `registerTool` shapes vary. It may return nothing, a
    // bare id string, a Promise, or an object without `unregister`. We always
    // hand back a receipt with a stable shape; teardown falls back to a
    // best-effort `api.unregisterTool(name)` when the receipt can't do it.
    const receipt = normaliseReceipt(rawReceipt, spec.name, api)

    live.set(ownerKey, { name: spec.name, routePath: routePath || "", receipt, abortController, spec: wrappedSpec })
    emit("webmcp:register", {
        id: receipt.id,
        name: spec.name,
        routePath: routePath || "",
        replaced: !!receipt.replaced,
    })
    return { ok: true, receipt }
}

/**
 * Update a live tool's route scope in place, without a re-register. Called when
 * the component stays mounted but its matched route changes (transient re-match
 * during navigation, nested-route shuffle). Keeps the same AbortController, so
 * an agent call already in flight is unaffected.
 */
export function updateToolRoute(ownerKey, routePath) {
    const entry = live.get(ownerKey)
    if (entry) entry.routePath = routePath || ""
}

/** Unregister one owner's tool (hook unmount). Idempotent. */
export function unregisterTool(ownerKey) {
    const entry = live.get(ownerKey)
    if (!entry) return
    entry.abortController.abort()
    try {
        entry.receipt && entry.receipt.unregister && entry.receipt.unregister()
    } catch {
        /* native impl may not expose unregister on the receipt — best effort */
    }
    live.delete(ownerKey)
    emit("webmcp:unregister", { id: entry.receipt && entry.receipt.id, name: entry.name })
}

/**
 * Called by WebMcpProvider after every navigation with the set of still-matched
 * route paths. Any tool whose routePath is not in that set is aborted +
 * unregistered. Tools with routePath "" (not route-scoped) are left alone.
 *
 * @param {Set<string>} matchedPaths
 * @returns {string[]} names of tools that were reaped (for logging / the panel)
 */
export function reapUnmatched(matchedPaths) {
    const reaped = []
    for (const [key, entry] of live) {
        if (!entry.routePath) continue
        if (!matchedPaths.has(entry.routePath)) {
            reaped.push(entry.name)
            unregisterTool(key)
        }
    }
    return reaped
}

/**
 * Invoke a tool by name through the registry's own wrapped execute (which
 * emits the execute:start/end events and applies arg validation + abort
 * checks). Used by the dev panel so it works regardless of whether the
 * backend exposes a page-side executeTool().
 */
export async function invokeTool(name, args = {}) {
    for (const entry of live.values()) {
        if (entry.name === name) return entry.spec.execute(args)
    }
    const err = new WebMcpError(WEBMCP_ERROR_CODES.TOOL_NOT_FOUND, {
        message: `No tool named "${name}" is registered.`,
    })
    emit("webmcp:execute:end", { callId: `call_${(++_callSeq).toString(36)}`, name, ok: false, error: { message: err.message, code: err.code } })
    throw err
}

let _receiptSeq = 0
function normaliseReceipt(raw, name, api) {
    // Object receipt with an unregister fn — use as-is, fill missing fields.
    if (raw && typeof raw === "object" && typeof raw.unregister === "function") {
        return {
            id: raw.id || `r_${(++_receiptSeq).toString(36)}`,
            name: raw.name || name,
            registeredAt: raw.registeredAt || Date.now(),
            replaced: !!raw.replaced,
            unregister: raw.unregister.bind(raw),
        }
    }
    // Anything else (undefined, string id, plain object, Promise): synthesise.
    const id =
        typeof raw === "string"
            ? raw
            : raw && typeof raw === "object" && raw.id
              ? raw.id
              : `r_${(++_receiptSeq).toString(36)}`
    return {
        id,
        name,
        registeredAt: Date.now(),
        replaced: false,
        unregister: () => {
            if (api && typeof api.unregisterTool === "function") {
                try {
                    api.unregisterTool(name)
                    return true
                } catch {
                    return false
                }
            }
            return false
        },
    }
}

/** Test-only: drop all live tools and the fallback backend. */
export function __resetForTests() {
    for (const key of Array.from(live.keys())) unregisterTool(key)
    live.clear()
    _fallbackApi = null
}

/** Snapshot for the dev panel. */
export function inspect() {
    return {
        isNative: hasNative(),
        tools: Array.from(live.values()).map((e) => ({
            name: e.name,
            routePath: e.routePath,
            receiptId: e.receipt && e.receipt.id,
            registeredAt: e.receipt && e.receipt.registeredAt,
            aborted: e.abortController.signal.aborted,
        })),
    }
}

/**
 * Very shallow inputSchema check — POC-grade. Only looks at top-level
 * `properties`, `type: number|string|boolean|integer`, and `minimum`.
 * Enough to demonstrate "the agent sent a bad arg and got a typed error"
 * without pulling in a JSON Schema validator.
 */
function shallowValidate(schema, args) {
    if (!schema || schema.type !== "object" || !schema.properties) return null
    for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in args) || args[key] === undefined) continue // required-ness not enforced in POC
        const val = args[key]
        const t = propSchema.type
        if (t === "number" || t === "integer") {
            if (typeof val !== "number" || Number.isNaN(val)) {
                return new WebMcpError(WEBMCP_ERROR_CODES.INVALID_ARGS, {
                    message: `Argument "${key}" must be a number.`,
                    details: `Received ${JSON.stringify(val)} (${typeof val}).`,
                })
            }
            if (t === "integer" && !Number.isInteger(val)) {
                return new WebMcpError(WEBMCP_ERROR_CODES.INVALID_ARGS, {
                    message: `Argument "${key}" must be an integer.`,
                })
            }
            if (typeof propSchema.minimum === "number" && val < propSchema.minimum) {
                return new WebMcpError(WEBMCP_ERROR_CODES.INVALID_ARGS, {
                    message: `Argument "${key}" must be >= ${propSchema.minimum}.`,
                    details: `Received ${val}.`,
                })
            }
        } else if (t === "string" && typeof val !== "string") {
            return new WebMcpError(WEBMCP_ERROR_CODES.INVALID_ARGS, {
                message: `Argument "${key}" must be a string.`,
            })
        } else if (t === "boolean" && typeof val !== "boolean") {
            return new WebMcpError(WEBMCP_ERROR_CODES.INVALID_ARGS, {
                message: `Argument "${key}" must be a boolean.`,
            })
        }
    }
    return null
}
