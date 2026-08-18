import { test } from "node:test"
import assert from "node:assert/strict"
import { createApiRegistry, defineApi } from "../../src/api/registry.js"
import { dispatchLoopback } from "../../src/api/dispatch.server.js"
import { runWithRequestContext } from "../../src/server/requestContext.js"

const withRegistry = (routes, fn) => {
    const registry = createApiRegistry(routes)
    const req = { __catalystApiRegistry: registry, headers: {} }
    return runWithRequestContext({ req, res: undefined }, fn)
}

test("dispatchLoopback returns a deep independent copy, not the handler's reference", async () => {
    const handlerResult = { count: 1, nested: { tag: "a" } }
    const getThing = defineApi({
        method: "GET",
        path: "/api/thing",
        handler: () => handlerResult,
    })

    const { data } = await withRegistry([getThing], () => dispatchLoopback("GET", "/api/thing"))

    assert.deepEqual(data, { count: 1, nested: { tag: "a" } })
    assert.notEqual(data, handlerResult)
    assert.notEqual(data.nested, handlerResult.nested)

    data.nested.tag = "mutated"
    assert.equal(handlerResult.nested.tag, "a", "mutating the returned copy must not affect the handler's own object")
})

test("dispatchLoopback fails loudly (ApiError) instead of silently sharing an unclonable value", async () => {
    const getUnclonable = defineApi({
        method: "GET",
        path: "/api/unclonable",
        handler: () => ({ fn: () => "not structured-cloneable" }),
    })

    await assert.rejects(
        () => withRegistry([getUnclonable], () => dispatchLoopback("GET", "/api/unclonable")),
        (error) => {
            assert.equal(error.name, "ApiError")
            assert.equal(error.status, 500)
            return true
        }
    )
})

test("unsafeShareResult skips the clone and hands back the same reference", async () => {
    const handlerResult = { count: 1 }
    const getShared = defineApi({
        method: "GET",
        path: "/api/shared",
        handler: () => handlerResult,
        unsafeShareResult: true,
    })

    const { data } = await withRegistry([getShared], () => dispatchLoopback("GET", "/api/shared"))
    assert.equal(data, handlerResult)
})

test("dispatchLoopback reports no match for an unregistered path", async () => {
    const result = await withRegistry([], () => dispatchLoopback("GET", "/api/nope"))
    assert.equal(result.matched, false)
})
