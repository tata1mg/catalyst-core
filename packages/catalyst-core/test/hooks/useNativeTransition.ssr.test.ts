import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { useNativeTransition } from "../../src/native/bridge/hooks/useNativeTransition"

// The node test environment has no `window`, i.e. it is a server render with no Router in scope —
// exactly the dev-SSR situation where react-router's useNavigate used to throw.
describe("useNativeTransition during server rendering", () => {
    it("renders without a Router and returns the hook shape", () => {
        expect(typeof window).toBe("undefined")
        let captured: any
        const Probe = () => {
            captured = useNativeTransition({ type: "slide", direction: "up", duration: 400 })
            return createElement("div", null, "ok")
        }

        expect(renderToString(createElement(Probe))).toContain("ok")
        expect(typeof captured.navigate).toBe("function")
        expect(captured.loading).toBe(false)
    })
})
