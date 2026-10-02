// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest"
import { nativeModelContext, hasNative } from "./native.js"
import { RouteContext } from "./routeContext.js"

describe("native modelContext detection", () => {
    afterEach(() => {
        delete document.modelContext
        delete navigator.modelContext
    })

    it("finds nothing when no modelContext is installed", () => {
        expect(nativeModelContext()).toBeNull()
        expect(hasNative()).toBe(false)
    })

    it("finds a native document.modelContext", () => {
        const api = { registerTool() {} }
        document.modelContext = api
        expect(nativeModelContext()).toBe(api)
        expect(hasNative()).toBe(true)
    })

    it("falls back to navigator.modelContext", () => {
        const api = { registerTool() {} }
        navigator.modelContext = api
        expect(nativeModelContext()).toBe(api)
    })

    it("does not count a shim as native, on either mount point", () => {
        document.modelContext = { __isWebMcpShim: true }
        navigator.modelContext = { __isWebMcpShim: true }
        expect(nativeModelContext()).toBeNull()
    })
})

describe("RouteContext", () => {
    it("defaults to the empty (app-lifetime) route path", () => {
        expect(RouteContext._currentValue).toBe("")
    })
})
