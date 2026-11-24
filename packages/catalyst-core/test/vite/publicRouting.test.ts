import { describe, expect, it } from "vitest"
import { publicRouting } from "../../src/vite/publicRouting.js"

describe("publicRouting (what AI_CONFIG.routing may ship to the browser)", () => {
    const full = {
        policy: {
            objective: "cost", order: ["onDevice", "cost"], cloud: "ask", cloudMedia: "deny", autoDownload: true,
            expectedInputTokens: 400, expectedOutputTokens: 200,
            weights: { cost: 2, latency: 1, tps: 1 }, constraints: { maxLatencyMs: 9000, minTps: 5, maxCostUsd: 0.01 },
        },
        platformSpeech: false,
        onDevice: {
            ios: [{ id: "gemma", engine: "litert", model: "m", modelPath: "/models/m", modalities: ["text", "audio"], tasks: ["speech.transcribe"], ttftMs: 900, tps: 25, loadMs: 3000 }],
            web: [{ id: "web", model: "onnx-community/x", modalities: ["text"] }],
        },
        cloud: [{ id: "g", provider: "gemini", model: "gemini-3.5-flash", modalities: ["text"], price: { input: 1, output: 2 } }],
    }

    it("keeps every field the router reads", () => {
        expect(publicRouting(full)).toEqual(full)
    })

    it("drops anything else, at every level, so a secret placed in routing never ships", () => {
        const dirty = JSON.parse(JSON.stringify(full))
        dirty.apiKey = "sk-top-level"
        dirty.policy.headers = { Authorization: "Bearer policy-secret" }
        dirty.onDevice.ios[0].token = "ios-secret"
        dirty.cloud[0].price = { input: 1, output: 2, billingAccount: "acct-9" }
        dirty.onDevice.secretPlatform = [{ id: "x", modalities: ["text"], token: "nope" }]
        dirty.cloud[0].endpoint = "https://internal.corp/v1"
        dirty.cloud[0].headers = { "x-api-key": "cloud-secret" }
        const shipped = JSON.stringify(publicRouting(dirty))
        for (const leak of ["sk-top-level", "policy-secret", "ios-secret", "acct-9", "secretPlatform", "internal.corp", "cloud-secret", "x-api-key"]) {
            expect(shipped).not.toContain(leak)
        }
        expect(publicRouting(dirty)).toEqual(full)
    })

    it("drops values of the wrong type instead of passing them through", () => {
        const out = publicRouting({ policy: { objective: { nested: "secret" }, order: ["a", 5, { x: 1 }], cloud: 7, autoDownload: "yes", constraints: { maxLatencyMs: "9" } }, platformSpeech: "no", cloud: [{ id: "g", provider: ["x"], ttftMs: Infinity, price: { input: "1", output: 2 } }] })
        expect(out).toEqual({ policy: { order: ["a"], constraints: {} }, cloud: [{ id: "g" }] })
    })

    it("ignores non-objects and non-list members", () => {
        expect(publicRouting(undefined)).toBeUndefined()
        expect(publicRouting("secret")).toBeUndefined()
        expect(publicRouting([1])).toBeUndefined()
        expect(publicRouting({ onDevice: { ios: "no", android: [null, 5, { id: "a" }] }, cloud: "no" })).toEqual({ onDevice: { android: [{ id: "a" }] } })
    })
})
