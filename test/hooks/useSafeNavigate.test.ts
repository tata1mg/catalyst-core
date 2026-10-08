import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { useSafeNavigate } from "../../src/native/bridge/hooks/useSafeNavigate"

// The node test environment has no `window`, i.e. it is a server render with no Router in scope —
// exactly the dev-SSR situation where react-router's useNavigate used to throw.
describe("useSafeNavigate during server rendering", () => {
    it("renders without a Router and returns a callable navigate", () => {
        expect(typeof window).toBe("undefined")
        let navigate: any
        const Probe = () => {
            navigate = useSafeNavigate()
            return createElement("div", null, "ok")
        }

        expect(renderToString(createElement(Probe))).toContain("ok")
        expect(typeof navigate).toBe("function")
        expect(() => navigate("/somewhere")).not.toThrow()
    })
})
