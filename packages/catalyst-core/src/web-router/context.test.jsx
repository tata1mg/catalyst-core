import { describe, expect, it, vi } from "vitest"
import { OneMgRouterContext } from "./context.jsx"

describe("OneMgRouterContext", () => {
    it("is a React context with an empty object default value", () => {
        expect(OneMgRouterContext.Provider).toBeDefined()
        expect(OneMgRouterContext.Consumer).toBeDefined()
        expect(OneMgRouterContext._currentValue).toEqual({})
    })

    // Regression for #550: a production build can load this module twice (the
    // app's server bundle inlines it, catalyst-core/webmcp loads it from
    // disk). A per-module createContext() gave each copy its own context, so
    // useRouterState() threw on every page under `catalyst serve`.
    it("is the same context object across separate module instances", async () => {
        const first = (await import("./context.jsx")).OneMgRouterContext
        vi.resetModules()
        const second = (await import("./context.jsx")).OneMgRouterContext
        expect(second).toBe(first)
    })
})
