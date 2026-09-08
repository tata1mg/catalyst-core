import { describe, it, expect } from "vitest"
import { createStandardError } from "../../packages/catalyst-core/src/native/bridge/errors.js"
import WebBridge from "../../packages/catalyst-core/src/native/bridge/WebBridge.js"
import { clientScenarios } from "../scenarios/client.js"

if (typeof globalThis.window === "undefined") {
    globalThis.window = globalThis
}

describe("Client Scenarios (Kind E)", () => {
    it("RUNTIME-NATIVE-013: Native bridge feature unavailable", () => {
        const err = createStandardError("RUNTIME-NATIVE-013")
        expect(err.code).toBe("RUNTIME-NATIVE-013")
        expect(err.docUrl).toContain("RUNTIME-NATIVE/RUNTIME-NATIVE-013")
    })

    it("RUNTIME-NATIVE-014: Feature not supported on platform", () => {
        const err = createStandardError("RUNTIME-NATIVE-014")
        expect(err.code).toBe("RUNTIME-NATIVE-014")
        expect(err.docUrl).toContain("RUNTIME-NATIVE/RUNTIME-NATIVE-014")
    })

    it("RUNTIME-NATIVE-018: WebBridge.callback with invalid interface name", () => {
        WebBridge.init()
        let logs = ""
        const origErr = console.error
        console.error = (msg) => { logs += String(msg) }
        try {
            window.WebBridge.callback("InvalidInterfaceName", {})
        } finally {
            console.error = origErr
        }
        expect(logs).toContain("RUNTIME-NATIVE-018")
        expect(logs).toContain("RUNTIME-NATIVE/RUNTIME-NATIVE-018")
    })

    it("RUNTIME-NATIVE-019: WebBridge.callback received before handler registered", () => {
        WebBridge.init()
        let logs = ""
        const origWarn = console.warn
        console.warn = (msg) => { logs += String(msg) }
        try {
            window.WebBridge.callback("ON_AI_READY", {})
        } finally {
            console.warn = origWarn
        }
        expect(logs).toContain("RUNTIME-NATIVE-019")
        expect(logs).toContain("RUNTIME-NATIVE/RUNTIME-NATIVE-019")
    })

    it("RUNTIME-NATIVE-020: Registered WebBridge handler throws", () => {
        WebBridge.init()
        let logs = ""
        const origErr = console.error
        console.error = (msg) => { logs += String(msg) }
        try {
            window.WebBridge.register("ON_AI_READY", () => { throw new Error("handler boom") })
            window.WebBridge.callback("ON_AI_READY", {})
        } finally {
            console.error = origErr
        }
        expect(logs).toContain("RUNTIME-NATIVE-020")
        expect(logs).toContain("RUNTIME-NATIVE/RUNTIME-NATIVE-020")
    })

    it("RUNTIME-NATIVE-021: WebBridge.register called with bad args", () => {
        WebBridge.init()
        let logs = ""
        const origErr = console.error
        console.error = (msg) => { logs += String(msg) }
        try {
            window.WebBridge.register("ON_AI_READY", "not a function")
        } finally {
            console.error = origErr
        }
        expect(logs).toContain("RUNTIME-NATIVE-021")
        expect(logs).toContain("RUNTIME-NATIVE/RUNTIME-NATIVE-021")
    })

    it("RUNTIME-NATIVE-022: WebBridge.init called without window", () => {
        let logs = ""
        const origErr = console.error
        console.error = (msg) => { logs += String(msg) }
        const winBackup = global.window
        delete global.window
        try {
            WebBridge.init()
        } finally {
            global.window = winBackup
            console.error = origErr
        }
        expect(logs).toContain("RUNTIME-NATIVE-022")
        expect(logs).toContain("RUNTIME-NATIVE/RUNTIME-NATIVE-022")
    })
})
