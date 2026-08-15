import { test } from "node:test"
import assert from "node:assert/strict"
import { warmPrefetch } from "../../../src/web-router/components/PrefetchLink.jsx"

test("warmPrefetch calls component.load() to warm the route chunk", () => {
    let loadCalls = 0
    const component = { load: () => (loadCalls++, Promise.resolve()) }

    warmPrefetch({ to: "/breed/labrador", component })

    assert.equal(loadCalls, 1)
})

test("warmPrefetch runs the loader and warms its result into the cache", async () => {
    let loaderCalls = 0
    const loader = async ({ params }) => {
        loaderCalls++
        return { breed: params.breed }
    }

    const result = warmPrefetch({ to: "/breed/labrador", loader, params: { breed: "labrador" } })

    assert.equal(loaderCalls, 1)
    assert.deepEqual(await result, { breed: "labrador" })
})

test("warmPrefetch warms both the chunk and the loader when both are given", () => {
    let loadCalls = 0
    let loaderCalls = 0
    const component = { load: () => (loadCalls++, Promise.resolve()) }
    const loader = async () => {
        loaderCalls++
        return {}
    }

    warmPrefetch({ to: "/breed/labrador", component, loader })

    assert.equal(loadCalls, 1)
    assert.equal(loaderCalls, 1)
})

test("warmPrefetch is a no-op (doesn't throw) when neither component nor loader is given", () => {
    assert.doesNotThrow(() => warmPrefetch({ to: "/somewhere" }))
})

test("warmPrefetch keys the loader warm-up by both `to` and `params`, so different targets don't collide", async () => {
    const calls = []
    const loader = async ({ params }) => {
        calls.push(params.breed)
        return { breed: params.breed }
    }

    await warmPrefetch({ to: "/breed/labrador", loader, params: { breed: "labrador" } })
    await warmPrefetch({ to: "/breed/poodle", loader, params: { breed: "poodle" } })

    assert.deepEqual(calls, ["labrador", "poodle"])
})
