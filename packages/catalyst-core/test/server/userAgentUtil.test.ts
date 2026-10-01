import { describe, expect, it } from "vitest"
import {
    getUserAgentDetails,
    STATUS_CAKE_USER_AGENT_MOBILE,
} from "../../src/server/utils/userAgentUtil.js"

// Bot detection consumed by handler.jsx's _renderMarkUp to decide the
// no-JS SSR path (#348 coverage).

describe("getUserAgentDetails", () => {
    it("flags Googlebot", () => {
        const d: any = getUserAgentDetails(
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        )
        expect(d.googleBot).toBe("Googlebot")
        expect(d.aiBot).toBeNull()
        expect(d.statusCakeBot).toBeNull()
    })

    it("flags an AI crawler (ClaudeBot)", () => {
        const d: any = getUserAgentDetails("Mozilla/5.0 (compatible; ClaudeBot/1.0)")
        expect(d.aiBot).toBe("ClaudeBot")
        expect(d.googleBot).toBeNull()
    })

    it("flags the StatusCake mobile pagespeed monitor via the exported constant", () => {
        const d: any = getUserAgentDetails(`something ${STATUS_CAKE_USER_AGENT_MOBILE} else`)
        expect(d.statusCakeBot).toBe("StatusCake Pagespeed Mobile")
    })

    it("returns null bot fields and parsed UA details for a normal browser", () => {
        const d: any = getUserAgentDetails(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        )
        expect(d.googleBot).toBeNull()
        expect(d.aiBot).toBeNull()
        expect(d.statusCakeBot).toBeNull()
        // ua-parser-js fields are merged in
        expect(d.browser).toBeDefined()
        expect(d.os).toBeDefined()
    })

    it("does not throw on an empty user-agent string", () => {
        expect(() => getUserAgentDetails("")).not.toThrow()
        const d: any = getUserAgentDetails("")
        expect(d.googleBot).toBeNull()
    })
})
