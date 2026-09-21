/**
 * The framework-side WebMCP registry — the piece the discussion argues only
 * a framework (not a component-scoped library) can own.
 *
 * Responsibilities:
 *   - Single point that talks to `document.modelContext` (native, or a shim
 *     the app opted into via `catalyst-core/webmcp/shim`).
 *   - Track every live tool with its *owner* (a hook instance) and the
 *     *route path* it was registered under.
 *   - Give `WebMcpProvider` a way to abort every tool belonging to routes
 *     that are no longer matched (agent navigated away → stale tools die).
 *   - Namespacing: if two routes both want "add_to_cart", the later one is
 *     rejected loudly rather than silently clobbering.
 *
 * This module holds process-wide singleton state on purpose — there is one
 * `document.modelContext` per document, so there is one registry.
 */

import { WebMcpError, WEBMCP_ERROR_CODES, toWebMcpError } from "./errors.js"

/** ownerKey -> { name, routePath, receipt, abortController, spec } */
const live = new Map()
let _ownerSeq = 0
let _callSeq = 0

export const newOwnerKey = () => `owner_${(++_ownerSeq).toString(36)}`

/**
 * Structural equality for JSON-schema-shaped values (inputSchema,
 * annotations) — good enough here because both are always plain
 * JSON-serialisable objects (no functions, no cycles, key order doesn't
 * matter for a schema's meaning).
 */
function deepEqual(a, b) {
    if (a === b) return true
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
}

/**
 * The backend `document.modelContext` — native, or whatever the app
 * installed there itself (e.g. `catalyst-core/webmcp/shim`'s `installShim()`
 * for a browser with no native WebMCP support yet). Registry code makes no
 * distinction between the two; whoever put an object at `document.
 * modelContext` (or `navigator.modelContext`) owns that decision, not this
 * module.
 *
 * When there is NONE (SSR, unit tests with no DOM, or a browser where the
 * app chose not to install a shim), falls back to an in-memory stand-in so
 * the registry's own logic (collision detection, reap, invoke) stays
 * exercisable. The stand-in never touches globals and never persists past
 * the process — it is a safety net, not a substitute for real discovery: an
 * agent watching `document.modelContext` sees nothing while it's active. See
 * WebMcpProvider's one-time console.warn for surfacing that to a developer.
 */
function ctx() {
    const api = existingModelContext()
    if (api) return api
    if (!_fallbackApi) _fallbackApi = createFallbackBackend()
    return _fallbackApi
}

function existingModelContext() {
    if (typeof document !== "undefined" && document.modelContext) return document.modelContext
    if (typeof navigator !== "undefined" && navigator.modelContext) return navigator.modelContext
    return null
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
 * Lifecycle events for a dev panel or other observer. Emitted here
 * (framework layer) rather than inside any shim, so behaviour is identical
 * whether the backend is native or a shim.
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
        /* CustomEvent unavailable — an observer just won't live-update */
    }
}

/**
 * Whether the active backend is genuinely native — as opposed to nothing
 * (the in-memory fallback) or an app-installed shim (which self-marks with
 * `__isWebMcpShim`, the same convention `catalyst-core/webmcp/shim` uses).
 * A dev panel or other observer can use this to label what it's showing.
 */
export function isNative() {
    const api = existingModelContext()
    return !!api && !api.__isWebMcpShim
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

    // The mutable, user-facing half of the spec. updateToolSpec() swaps
    // fields on this object in place, then re-registers with the backend so
    // the agent-visible schema (what Chrome/a shim actually serialised at
    // registerTool time) reflects the change too — mutating this object
    // alone only affects our own validation, not what the agent sees.
    const userSpec = {
        description: spec.description || "",
        inputSchema: spec.inputSchema || { type: "object", properties: {} },
        annotations: spec.annotations || {},
        execute: spec.execute,
    }

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
    function buildWrappedSpec() {
        return {
            name: spec.name,
            description: userSpec.description,
            inputSchema: userSpec.inputSchema,
            annotations: userSpec.annotations,
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
                    // Read inputSchema/execute through userSpec (by reference,
                    // captured in this closure) so a call in flight when
                    // updateToolSpec() mutates it still validates + dispatches
                    // against whatever is current right now — not what was
                    // current when this particular wrapper was built.
                    const signal = current ? current.abortController.signal : abortController.signal
                    const argErr = shallowValidate(userSpec.inputSchema, args)
                    if (argErr) throw argErr
                    const result = await userSpec.execute(args, { signal })
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
    }

    const wrappedSpec = buildWrappedSpec()

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

    live.set(ownerKey, {
        name: spec.name,
        routePath: routePath || "",
        receipt,
        abortController,
        spec: wrappedSpec,
        userSpec,
        api,
        buildWrappedSpec,
    })
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

/**
 * Swap description/inputSchema/annotations on a live tool — used by
 * useTool(spec, deps) when a dep changes. Two things happen, both without
 * touching `ownerKey` or `abortController`:
 *
 *   1. `entry.userSpec` is mutated in place, so a call ALREADY in flight
 *      (dispatched through the OLD wrappedSpec.execute closure, which reads
 *      userSpec by reference) validates + resolves against the new schema
 *      the instant this runs — it never sees a torn-down registration.
 *   2. The backend registration is refreshed: the old receipt is
 *      unregistered and a fresh wrappedSpec is registered under the SAME
 *      `live` entry, so `document.modelContext` actually serves the updated
 *      description/inputSchema to the agent. Mutating `userSpec` alone (as
 *      an earlier version of this function did) only fixed our own
 *      validation — the backend had already captured the stale schema at
 *      the original `registerTool` call and never saw the update.
 *
 * This is NOT the WEBMCP_ABORTED bug from useTool's mount effect: that bug
 * was re-running `registerTool` with a FRESH ownerKey/AbortController on
 * every route recompute. Here the owner and controller are identical across
 * the swap — `live.get(ownerKey)` still resolves for an in-flight call, and
 * `current.abortController` is the same object before and after.
 *
 * `execute` itself is deliberately NOT accepted here — useTool's own
 * specRef-through-liveSpec.execute indirection already means every call
 * dispatches to the latest closure regardless of deps, so there is nothing
 * for a deps change to update on that front.
 */
export function updateToolSpec(ownerKey, { description, inputSchema, annotations } = {}) {
    const entry = live.get(ownerKey)
    if (!entry) return

    // Deep-equal, not reference-equal: callers (useTool's deps effect) pass a
    // freshly-built inputSchema/annotations object on every dep change, even
    // when a particular dep (e.g. a UI-only selection that doesn't affect the
    // schema shape) didn't actually change the CONTENT. Re-registering with
    // the backend on every such no-op call would spam unregister/register
    // (visible as spurious REGISTERED events to any observer) for no reason.
    const changed =
        (description !== undefined && description !== entry.userSpec.description) ||
        (inputSchema !== undefined && !deepEqual(inputSchema, entry.userSpec.inputSchema)) ||
        (annotations !== undefined && !deepEqual(annotations, entry.userSpec.annotations))
    if (!changed) return

    if (description !== undefined) entry.userSpec.description = description
    if (inputSchema !== undefined) entry.userSpec.inputSchema = inputSchema
    if (annotations !== undefined) entry.userSpec.annotations = annotations

    // Re-register with the backend so the agent-visible schema updates too.
    // Best-effort teardown of the old receipt (native impls vary in whether
    // unregister exists/throws); the new registerTool call is what actually
    // matters — the old entry in `live` is overwritten with the new receipt
    // and wrappedSpec, everything else (ownerKey, abortController) untouched.
    try {
        entry.receipt && entry.receipt.unregister && entry.receipt.unregister()
    } catch {
        /* best effort, same as unregisterTool */
    }
    const newWrappedSpec = entry.buildWrappedSpec()
    let rawReceipt
    try {
        rawReceipt = entry.api.registerTool(newWrappedSpec)
    } catch {
        // Backend rejected the re-register (e.g. a transient native error).
        // Leave the entry's userSpec updated (our own validation is still
        // correct) but keep the OLD receipt/spec live rather than losing the
        // registration entirely.
        return
    }
    entry.receipt = normaliseReceipt(rawReceipt, entry.name, entry.api)
    entry.spec = newWrappedSpec
    emit("webmcp:register", {
        id: entry.receipt.id,
        name: entry.name,
        routePath: entry.routePath,
        replaced: true,
    })
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
 * @returns {string[]} names of tools that were reaped (for logging / a panel)
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
 * checks). Useful to a dev panel so it works regardless of whether the
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

/**
 * Test-only: what the BACKEND (native document.modelContext, an installed
 * shim, or the in-memory fallback in unit tests) thinks the current tool
 * list/schemas are — as opposed to `inspect()`, which reports the
 * registry's own bookkeeping. Used to assert that updateToolSpec()'s
 * re-register actually reaches the agent-visible side, not just our
 * internal validation.
 */
export function __getBackendTools() {
    return ctx().getTools()
}

/** Snapshot for a dev panel or other observer. */
export function inspect() {
    return {
        isNative: isNative(),
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
 * Shallow inputSchema check — only looks at top-level `properties`,
 * `type: number|string|boolean|integer`, and `minimum`. Enough to reject
 * obviously-wrong agent args with a typed error without pulling in a full
 * JSON Schema validator.
 */
function shallowValidate(schema, args) {
    if (!schema || schema.type !== "object" || !schema.properties) return null
    for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in args) || args[key] === undefined) continue // required-ness not enforced here
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
