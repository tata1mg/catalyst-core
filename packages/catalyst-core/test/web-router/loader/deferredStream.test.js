import { test } from "node:test"
import assert from "node:assert/strict"
import { encodeDeferredScript } from "../../../src/web-router/loader/deferredStream.server.js"
import { decodeLoaderData } from "../../../src/web-router/loader/deferredStream.client.js"

const extractScriptAssignment = (scriptTag) => {
    const match = scriptTag.match(/window\.__CATALYST_LOADER_DATA__=(".*")<\/script>$/)
    assert.ok(match, `expected a window.__CATALYST_LOADER_DATA__ assignment, got: ${scriptTag}`)
    return JSON.parse(match[1])
}

const withFakeWindow = async (encodedValue, fn) => {
    const previousWindow = globalThis.window
    globalThis.window = { __CATALYST_LOADER_DATA__: encodedValue }
    try {
        return await fn()
    } finally {
        if (previousWindow === undefined) delete globalThis.window
        else globalThis.window = previousWindow
    }
}

test("round-trips a resolved loader map through encode -> decode, values wrapped as promises", async () => {
    const loaderPromiseMap = {
        home: Promise.resolve({ greeting: "hello", count: 3 }),
        breed: Promise.resolve({ name: "labrador" }),
    }

    const script = await encodeDeferredScript(loaderPromiseMap)
    const encoded = extractScriptAssignment(script)

    const decoded = await withFakeWindow(encoded, () => decodeLoaderData())

    assert.deepEqual(Object.keys(decoded).sort(), ["breed", "home"])
    assert.deepEqual(await decoded.home, { greeting: "hello", count: 3 })
    assert.deepEqual(await decoded.breed, { name: "labrador" })
})

test("preserves rich types (Date) that JSON.stringify cannot", async () => {
    const when = new Date("2026-01-15T00:00:00.000Z")
    const loaderPromiseMap = { home: Promise.resolve({ when }) }

    const script = await encodeDeferredScript(loaderPromiseMap)
    const encoded = extractScriptAssignment(script)
    const decoded = await withFakeWindow(encoded, () => decodeLoaderData())

    const value = await decoded.home
    assert.ok(value.when instanceof Date, "Date must survive the round trip as a real Date instance")
    assert.equal(value.when.getTime(), when.getTime())
})

test("encodeDeferredScript returns an empty string for an empty map", async () => {
    const script = await encodeDeferredScript({})
    assert.equal(script, "")
})

test("the embedded base64 payload contains no characters that would break out of the <script> tag", async () => {
    const loaderPromiseMap = {
        home: Promise.resolve({ html: "</script><script>alert(1)</script>", quote: `"'` }),
    }
    const script = await encodeDeferredScript(loaderPromiseMap)

    // Only one real </script> in the whole tag - the one that legitimately closes it.
    assert.equal((script.match(/<\/script>/g) || []).length, 1)

    const encoded = extractScriptAssignment(script)
    const decoded = await withFakeWindow(encoded, () => decodeLoaderData())
    const value = await decoded.home
    assert.equal(value.html, "</script><script>alert(1)</script>")
})

test("decodeLoaderData returns an empty object outside a browser environment", async () => {
    assert.equal(typeof window, "undefined", "this test must run in a non-browser environment to be meaningful")
    const decoded = await decodeLoaderData()
    assert.deepEqual(decoded, {})
})

test("decodeLoaderData returns an empty object when nothing was serialized", async () => {
    const decoded = await withFakeWindow(undefined, () => decodeLoaderData())
    assert.deepEqual(decoded, {})
})
