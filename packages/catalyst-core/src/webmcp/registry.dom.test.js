// @vitest-environment jsdom
/**
 * Registry behaviour that needs a DOM: lifecycle events and the native /
 * shim `document.modelContext` backend contract (receipt shapes, spec
 * re-registration, argument validation).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
    registerTool,
    unregisterTool,
    updateToolRoute,
    updateToolSpec,
    invokeTool,
    inspect,
    isNative,
    newOwnerKey,
    __resetForTests,
} from "./registry.js"

const makeSpec = (over = {}) => ({
    name: "t",
    description: "d",
    inputSchema: { type: "object", properties: {} },
    execute: async () => "ok",
    ...over,
})

function listen(type) {
    const events = []
    const h = (e) => events.push(e.detail)
    document.addEventListener(type, h)
    return { events, off: () => document.removeEventListener(type, h) }
}

describe("registry with a DOM", () => {
    beforeEach(() => __resetForTests())
    afterEach(() => {
        delete document.modelContext
        __resetForTests()
    })

    it("emits register / execute / unregister events", async () => {
        const reg = listen("webmcp:register")
        const start = listen("webmcp:execute:start")
        const end = listen("webmcp:execute:end")
        const unreg = listen("webmcp:unregister")
        const k = newOwnerKey()
        registerTool(k, "/r", makeSpec())
        await invokeTool("t", { x: 1 })
        unregisterTool(k)
        expect(reg.events[0]).toMatchObject({ name: "t", routePath: "/r", replaced: false })
        expect(start.events[0]).toMatchObject({ name: "t", args: { x: 1 } })
        expect(end.events[0]).toMatchObject({ name: "t", ok: true, result: "ok" })
        expect(unreg.events[0]).toMatchObject({ name: "t" })
        ;[reg, start, end, unreg].forEach((l) => l.off())
    })

    it("reports a failed execute and an unknown tool as ok:false end events", async () => {
        const end = listen("webmcp:execute:end")
        registerTool(newOwnerKey(), "", makeSpec({ execute: async () => { throw new Error("bad") } }))
        await expect(invokeTool("t")).rejects.toMatchObject({ code: "WEBMCP_EXECUTE_FAILED" })
        await expect(invokeTool("missing")).rejects.toMatchObject({ code: "WEBMCP_TOOL_NOT_FOUND" })
        expect(end.events.map((e) => e.ok)).toEqual([false, false])
        end.off()
    })

    it("rejects invalid arguments before executing", async () => {
        const execute = vi.fn(async () => "ran")
        registerTool(
            newOwnerKey(),
            "",
            makeSpec({
                inputSchema: {
                    type: "object",
                    properties: {
                        n: { type: "number", minimum: 2 },
                        i: { type: "integer" },
                        s: { type: "string" },
                        b: { type: "boolean" },
                    },
                },
                execute,
            })
        )
        for (const args of [{ n: "x" }, { n: 1 }, { i: 1.5 }, { s: 3 }, { b: "no" }]) {
            await expect(invokeTool("t", args)).rejects.toMatchObject({ code: "WEBMCP_INVALID_ARGS" })
        }
        await invokeTool("t", { n: 2, i: 3, s: "a", b: true })
        expect(execute).toHaveBeenCalledTimes(1)
    })

    it("uses an installed document.modelContext and normalises its receipts", () => {
        const registered = []
        document.modelContext = {
            registerTool: (s) => (registered.push(s), "string-id"),
            unregisterTool: () => {},
            getTools: () => [],
        }
        expect(isNative()).toBe(true)
        const k = newOwnerKey()
        const res = registerTool(k, "/p", makeSpec())
        expect(res.receipt.id).toBe("string-id")
        updateToolRoute(k, "/q")
        expect(inspect().tools[0].routePath).toBe("/q")
        // the string receipt falls back to api.unregisterTool(name)
        expect(res.receipt.unregister()).toBe(true)
        expect(registered).toHaveLength(1)
    })

    it("treats a shim-marked backend as non-native and handles object receipts", () => {
        document.modelContext = {
            __isWebMcpShim: true,
            registerTool: () => ({ id: "obj", unregister() { return true } }),
            getTools: () => [],
        }
        expect(isNative()).toBe(false)
        const res = registerTool(newOwnerKey(), "", makeSpec())
        expect(res.receipt.id).toBe("obj")
    })

    it("surfaces a backend registerTool failure as ok:false", () => {
        document.modelContext = {
            registerTool: () => { throw new Error("backend down") },
            getTools: () => [],
        }
        const res = registerTool(newOwnerKey(), "", makeSpec())
        expect(res.ok).toBe(false)
        expect(res.error.message).toBe("backend down")
    })

    it("updateToolSpec re-registers only on a real change", () => {
        const calls = []
        document.modelContext = {
            registerTool: (s) => (calls.push(s), { id: `r${calls.length}`, unregister() {} }),
            getTools: () => [],
        }
        const reg = listen("webmcp:register")
        const k = newOwnerKey()
        registerTool(k, "/p", makeSpec())
        updateToolSpec(k, { description: "d", inputSchema: { type: "object", properties: {} }, annotations: {} })
        expect(calls).toHaveLength(1)
        updateToolSpec(k, { description: "new", annotations: { readOnlyHint: true } })
        expect(calls).toHaveLength(2)
        expect(calls[1].description).toBe("new")
        expect(reg.events.at(-1).replaced).toBe(true)
        updateToolSpec("unknown-owner", { description: "x" })
        reg.off()
    })

    it("aborts in-flight tool signals on unregister", async () => {
        let signal
        const k = newOwnerKey()
        registerTool(k, "", makeSpec({ execute: async (_a, ctx) => { signal = ctx.signal } }))
        await invokeTool("t")
        unregisterTool(k)
        expect(signal.aborted).toBe(true)
        expect(() => unregisterTool(k)).not.toThrow()
    })
})
