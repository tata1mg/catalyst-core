// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"
// From the synced package (npm run sync-packages), not packages/catalyst-ai/src
// directly — the synced copy resolves `react` against the example's own copy,
// avoiding a dual-React "Cannot read properties of null (reading 'useState')".
import { useNativeAI } from "catalyst-ai"

/**
 * AI hook scenarios that a developer reproduces by dropping an AI hook into a
 * plain web app — no native shell, no bridge. These run in jsdom via
 * @testing-library/react's renderHook.
 *
 * AI-005/006/007/009 are NOT here: they need a mounted-and-ready native bridge
 * to then fail mid-stream (stream-not-ready, request-failed, native-reported-
 * error, worker-crashed). Reproducing them means scripting a fake bridge
 * through several callback phases — that's testing our mock, not a dev
 * mistake. They stay in LEDGER with that reason.
 */

describe("AI hook scenarios (jsdom)", () => {
    afterEach(() => {
        delete (globalThis as Record<string, unknown>).NativeBridge
        delete (globalThis as Record<string, unknown>).WebBridge
    })

    it("AI-004: useNativeAI mounted in a web app with no native bridge", () => {
        // window.NativeBridge.initAI is absent — the exact state when a dev
        // uses useNativeAI outside the native WebView.
        const { result } = renderHook(() => useNativeAI({ enabled: true }))
        expect(result.current.error).toBeTruthy()
        expect(result.current.error.code).toBe("AI-004")
        expect(result.current.error.docUrl).toContain("AI/AI-004")
    })
})
