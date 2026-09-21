/**
 * Registry-level unit tests — no browser, no React.
 *
 * These pin the two behaviours the headless E2E can only observe indirectly:
 *   - reapUnmatched() actually removes route-scoped tools whose route is gone
 *     (in the browser, React unmount cleanup usually gets there first, so the
 *     E2E can't tell which mechanism fired).
 *   - a same-name collision across two owners is rejected, not silently
 *     clobbered.
 */
import { describe, it, expect, beforeEach } from "vitest"
import {
    registerTool,
    unregisterTool,
    updateToolSpec,
    reapUnmatched,
    invokeTool,
    inspect,
    newOwnerKey,
    __resetForTests,
    __getBackendTools,
} from "./registry.js"

const spec = (name, execute = async () => `ran ${name}`) => ({
    name,
    description: `test ${name}`,
    inputSchema: { type: "object", properties: {} },
    execute,
})

describe("registry", () => {
    beforeEach(() => {
        __resetForTests()
    })

    it("reapUnmatched removes tools whose route is not in the keep-set", () => {
        const k = newOwnerKey()
        const res = registerTool(k, "/ghost/:id", spec("ghost_tool"))
        expect(res.ok).toBe(true)
        expect(inspect().tools.map((t) => t.name)).toContain("ghost_tool")

        const reaped = reapUnmatched(new Set(["/cart", "/products"]))
        expect(reaped).toEqual(["ghost_tool"])
        expect(inspect().tools.map((t) => t.name)).not.toContain("ghost_tool")
    })

    it("reapUnmatched keeps tools whose route IS still matched", () => {
        const k = newOwnerKey()
        registerTool(k, "/cart", spec("checkout"))
        const reaped = reapUnmatched(new Set(["/cart"]))
        expect(reaped).toEqual([])
        expect(inspect().tools.map((t) => t.name)).toContain("checkout")
        unregisterTool(k)
    })

    it("reapUnmatched never touches app-scoped tools (routePath '')", () => {
        const k = newOwnerKey()
        registerTool(k, "", spec("global_help"))
        reapUnmatched(new Set(["/literally-nothing"]))
        expect(inspect().tools.map((t) => t.name)).toContain("global_help")
        unregisterTool(k)
    })

    it("rejects a same-name tool from a different owner", () => {
        const a = newOwnerKey()
        const b = newOwnerKey()
        const first = registerTool(a, "/product/:id", spec("add_to_cart"))
        expect(first.ok).toBe(true)

        const second = registerTool(b, "/other/:id", spec("add_to_cart"))
        expect(second.ok).toBe(false)
        expect(second.error.code).toBe("WEBMCP_DUPLICATE_TOOL")

        // the original still works
        expect(inspect().tools.filter((t) => t.name === "add_to_cart")).toHaveLength(1)
        unregisterTool(a)
    })

    it("invokeTool runs the registered execute and surfaces arg-validation errors", async () => {
        const k = newOwnerKey()
        registerTool(k, "/product/:id", {
            name: "buy",
            description: "buy N",
            inputSchema: { type: "object", properties: { qty: { type: "number", minimum: 1 } } },
            execute: async ({ qty }) => `bought ${qty}`,
        })

        await expect(invokeTool("buy", { qty: 3 })).resolves.toBe("bought 3")
        await expect(invokeTool("buy", { qty: "lots" })).rejects.toMatchObject({
            code: "WEBMCP_INVALID_ARGS",
        })
        await expect(invokeTool("no_such_tool", {})).rejects.toMatchObject({
            code: "WEBMCP_TOOL_NOT_FOUND",
        })
        unregisterTool(k)
    })

    it("a reaped tool cannot be invoked afterwards", async () => {
        const k = newOwnerKey()
        registerTool(k, "/gone", spec("stale_tool"))
        reapUnmatched(new Set(["/elsewhere"]))
        await expect(invokeTool("stale_tool", {})).rejects.toMatchObject({
            code: "WEBMCP_TOOL_NOT_FOUND",
        })
    })

    it("updateToolSpec refreshes the AGENT-VISIBLE schema, and an in-flight call still survives", async () => {
        const k = newOwnerKey()
        let releaseCall
        const callStarted = new Promise((resolve) => {
            registerTool(k, "/product/:id", {
                name: "add_to_cart",
                description: "v1",
                inputSchema: { type: "object", properties: { qty: { type: "number", minimum: 1 } } },
                execute: async ({ qty }) => {
                    resolve()
                    await new Promise((r) => {
                        releaseCall = r
                    })
                    return `added ${qty}`
                },
            })
        })

        // Before the swap, the backend (what an agent actually sees) has the
        // v1 schema — no `size` property.
        const before = __getBackendTools().find((t) => t.name === "add_to_cart")
        expect(before.description).toBe("v1")
        expect(before.inputSchema.properties.size).toBeUndefined()

        const inFlight = invokeTool("add_to_cart", { qty: 2 })
        await callStarted

        // Simulate a deps-array change mid-call (e.g. product changed size options).
        updateToolSpec(k, {
            description: "v2",
            inputSchema: {
                type: "object",
                properties: { qty: { type: "number", minimum: 1 }, size: { type: "string" } },
            },
        })

        // Same registration (same owner, same entry) — NOT torn down. The
        // in-flight call, dispatched before the swap, still completes.
        releaseCall()
        await expect(inFlight).resolves.toBe("added 2")

        // The backend now serves the NEW schema — this is the part that
        // matters for an agent actually seeing the update.
        const after = __getBackendTools().find((t) => t.name === "add_to_cart")
        expect(after.description).toBe("v2")
        expect(after.inputSchema.properties.size).toBeDefined()

        // A call made AFTER the swap validates against the NEW schema.
        await expect(invokeTool("add_to_cart", { qty: "nope" })).rejects.toMatchObject({
            code: "WEBMCP_INVALID_ARGS",
        })

        // Still exactly one registration for this tool — the swap replaced,
        // it didn't duplicate.
        expect(inspect().tools.filter((t) => t.name === "add_to_cart")).toHaveLength(1)
        unregisterTool(k)
    })

    it("updateToolSpec is a no-op when nothing actually changed", () => {
        const k = newOwnerKey()
        const schema = { type: "object", properties: {} }
        registerTool(k, "/cart", { name: "checkout", description: "d", inputSchema: schema, execute: async () => "ok" })
        const idBefore = inspect().tools.find((t) => t.name === "checkout").receiptId

        updateToolSpec(k, { description: "d", inputSchema: schema })

        // Re-register never ran (nothing changed), so the receipt is untouched.
        const idAfter = inspect().tools.find((t) => t.name === "checkout").receiptId
        expect(idAfter).toBe(idBefore)
        unregisterTool(k)
    })
})
