// Session aggregation (cloud, native, web) and the cloud-equivalent estimate for on-device runs.
import { describe, expect, it } from "vitest"
import {
    aggregateNativeSessionMetrics,
    aggregateSessionMetrics,
    aggregateWebSessionMetrics,
    estimateCloudEquivalent,
} from "../src/metrics.js"

describe("estimateCloudEquivalent", () => {
    it("returns null without token counts", () => {
        expect(estimateCloudEquivalent({ inputTokens: undefined as any, outputTokens: 5 })).toBeNull()
        expect(estimateCloudEquivalent({ inputTokens: 5, outputTokens: "x" as any })).toBeNull()
    })
    it("returns null for a model with no known price", () => {
        expect(estimateCloudEquivalent({ inputTokens: 10, outputTokens: 10 }, "not-a-real-model")).toBeNull()
    })
    it("prices a known model and marks the number as an estimate", () => {
        const r = estimateCloudEquivalent({ inputTokens: 1_000_000, outputTokens: 1_000_000 })
        expect(r).not.toBeNull()
        expect(r!.estimated).toBe(true)
        expect(r!.cost).toBeGreaterThan(0)
    })
})

describe("aggregateSessionMetrics (cloud)", () => {
    it("is null for an empty or missing history", () => {
        expect(aggregateSessionMetrics([])).toBeNull()
        expect(aggregateSessionMetrics(undefined as any)).toBeNull()
    })
    it("sums cost, tokens and cache fields, averages ttft/tps and groups by provider", () => {
        const r = aggregateSessionMetrics([
            { provider: "gemini", cost: 0.01, totalTokens: 100, cachedTokens: 10, cacheSavings: 0.001, ttftMs: 100, tps: 10 },
            { provider: "gemini", cost: 0.03, totalTokens: 300, ttftMs: 300, tps: 30 },
            { cost: null, totalTokens: 50 },
        ])!
        expect(r.generationCount).toBe(3)
        expect(r.totalCost).toBeCloseTo(0.04)
        expect(r.totalTokens).toBe(450)
        expect(r.totalCachedTokens).toBe(10)
        expect(r.totalCacheSavings).toBeCloseTo(0.001)
        expect(r.avgTtftMs).toBe(200)
        expect(r.avgTps).toBe(20)
        expect(r.minTps).toBe(10)
        expect(r.maxTps).toBe(30)
        expect(r.avgCostPerGeneration).toBeCloseTo(0.04 / 3)
        expect((r.byProvider as any).gemini).toEqual({ generationCount: 2, totalCost: 0.04, totalTokens: 400, audioCostUnknown: false })
        expect((r.byProvider as any).unknown.generationCount).toBe(1)
    })
    it("says so when any generation had audio with no confirmed rate, so the total cost is known to be partial", () => {
        const r = aggregateSessionMetrics([
            { provider: "gemini", cost: 0.01, totalTokens: 10, audioTokens: 100, audioCostUnknown: true },
            { provider: "openai", cost: 0.02, totalTokens: 20, audioTokens: 50 },
        ])!
        expect(r.audioCostUnknown).toBe(true)
        expect(r.totalAudioTokens).toBe(150)
        expect((r.byProvider as any).gemini.audioCostUnknown).toBe(true)
        expect((r.byProvider as any).openai.audioCostUnknown).toBe(false)
        expect(aggregateSessionMetrics([{ provider: "openai", cost: 0, totalTokens: 1 }])!.audioCostUnknown).toBe(false)
    })

    it("leaves ttft/tps null when no generation reported them", () => {
        const r = aggregateSessionMetrics([{ provider: "openai", cost: 0, totalTokens: 1 }])!
        expect(r.avgTtftMs).toBeNull()
        expect(r.avgTps).toBeNull()
        expect(r.minTps).toBeNull()
        expect(r.maxTps).toBeNull()
    })
})

describe("aggregateNativeSessionMetrics", () => {
    it("is null when empty", () => {
        expect(aggregateNativeSessionMetrics([])).toBeNull()
        expect(aggregateNativeSessionMetrics(null as any)).toBeNull()
    })
    it("sums tokens and generation time and averages speed", () => {
        const r = aggregateNativeSessionMetrics([
            { totalTokens: 10, genMs: 100, ttftMs: 50, tps: 8 },
            { totalTokens: 20, genMs: 300, ttftMs: 150, tps: 12 },
            { totalTokens: 5 },
        ])!
        expect(r).toEqual({ generationCount: 3, totalTokens: 35, totalGenMs: 400, avgTtftMs: 100, avgTps: 10, minTps: 8, maxTps: 12 })
    })
    it("keeps ttft/tps null when none were measured", () => {
        expect(aggregateNativeSessionMetrics([{ totalTokens: 1 }])).toMatchObject({ avgTtftMs: null, avgTps: null, minTps: null, maxTps: null })
    })
})

describe("aggregateWebSessionMetrics", () => {
    it("is null when empty", () => {
        expect(aggregateWebSessionMetrics([])).toBeNull()
        expect(aggregateWebSessionMetrics(undefined as any)).toBeNull()
    })
    it("aggregates like native and takes device/dtype from the most recent generation", () => {
        const r = aggregateWebSessionMetrics([
            { device: "cpu", dtype: "q8", totalTokens: 10, genMs: 100, ttftMs: 40, tps: 5 },
            { device: "webgpu", dtype: "q4", totalTokens: 30, genMs: 200, ttftMs: 60, tps: 15 },
        ])!
        expect(r).toMatchObject({ generationCount: 2, totalTokens: 40, totalGenMs: 300, avgTtftMs: 50, avgTps: 10, minTps: 5, maxTps: 15, device: "webgpu" })
        expect(r.dtype).toBe("q4")
    })
    it("reports null device when the latest entry carries none", () => {
        expect(aggregateWebSessionMetrics([{ totalTokens: 1 }])).toMatchObject({ device: null, avgTps: null })
    })
})
