import { createRequire } from "module"
import { describe, expect, it } from "vitest"

// setupServer.js is plain CJS with only built-in requires, so it loads with require.
const require = createRequire(import.meta.url)
const { getLocalIPAddress, shouldEnsureDevServer } = require("../../src/native/setupServer.js")

const v4 = (address: string, internal = false) => ({ family: "IPv4", address, internal })

describe("getLocalIPAddress", () => {
    it("prefers en0 over tunnels and VM bridges listed first", () => {
        expect(
            getLocalIPAddress({
                lo0: [v4("127.0.0.1", true)],
                utun3: [v4("10.8.0.2")],
                bridge100: [v4("192.168.64.1")],
                en0: [{ family: "IPv6", address: "fe80::1", internal: false }, v4("192.168.1.23")],
            })
        ).toBe("192.168.1.23")
    })

    it("takes a Wi-Fi or Ethernet interface on Linux", () => {
        expect(getLocalIPAddress({ docker0: [v4("172.17.0.1")], wlp2s0: [v4("10.0.0.7")] })).toBe("10.0.0.7")
        expect(getLocalIPAddress({ eth0: [{ family: 4, address: "10.0.0.9", internal: false }] })).toBe(
            "10.0.0.9"
        )
    })

    it("falls back to localhost with only loopback", () => {
        expect(getLocalIPAddress({ lo: [v4("127.0.0.1", true)] })).toBe("localhost")
    })
})

describe("shouldEnsureDevServer", () => {
    it("is on for debug builds of a configured platform with a port", () => {
        expect(shouldEnsureDevServer("android", { port: 3005, android: {} })).toBe(true)
        expect(shouldEnsureDevServer("ios", { port: 3005, ios: { buildType: "Debug" } })).toBe(true)
    })

    it("is off for release, without a port, or without the platform block", () => {
        expect(shouldEnsureDevServer("android", { port: 3005, android: {} }, { release: true })).toBe(false)
        expect(shouldEnsureDevServer("android", { port: 3005, android: { buildType: "release" } })).toBe(
            false
        )
        expect(shouldEnsureDevServer("ios", { ios: {} })).toBe(false)
        expect(shouldEnsureDevServer("android", undefined)).toBe(false)
    })
})
