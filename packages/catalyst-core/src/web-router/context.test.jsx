import { describe, expect, it } from "vitest"
import { OneMgRouterContext } from "./context.jsx"

describe("OneMgRouterContext", () => {
    it("is a React context with an empty object default value", () => {
        expect(OneMgRouterContext.Provider).toBeDefined()
        expect(OneMgRouterContext.Consumer).toBeDefined()
        expect(OneMgRouterContext._currentValue).toEqual({})
    })
})
