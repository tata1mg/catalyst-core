import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Status-aware error sampling: StatusAwareSampler and PromotingSpanProcessor are
// not exported, so they are reached through init(), the way an app gets them.
// The @opentelemetry/* packages are optional and not installed here; each is a
// small fake that records what otel.js hands it.

const SAMPLED = 1
const ERROR = 2
const RECORD = 1
const RECORD_AND_SAMPLED = 2

const fake = vi.hoisted(() => {
    const state = { batches: [] as any[], parentSpanContext: undefined as any }
    class BatchSpanProcessor {
        args: unknown[]
        started: any[] = []
        ended: any[] = []
        forceFlush = vi.fn(() => Promise.resolve("flushed"))
        shutdown = vi.fn(() => Promise.resolve("shut down"))
        constructor(...args: unknown[]) {
            this.args = args
            state.batches.push(this)
        }
        onStart(span: any) {
            this.started.push(span)
        }
        onEnd(span: any) {
            this.ended.push(span)
        }
    }
    const record = (kind: string) =>
        class {
            kind = kind
            args: unknown[]
            constructor(...args: unknown[]) {
                this.args = args
            }
        }
    return { state, BatchSpanProcessor, record }
})

vi.mock("@opentelemetry/api", () => ({
    metrics: { getMeter: () => ({ createObservableGauge: () => ({ addCallback: () => {} }) }) },
    trace: { getTracer: () => ({}), getSpanContext: () => fake.state.parentSpanContext },
    context: { active: () => ({}) },
    createContextKey: (name: string) => Symbol(name),
    isSpanContextValid: (ctx: any) => Boolean(ctx?.traceId),
    TraceFlags: { NONE: 0, SAMPLED: 1 },
    SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
}))
vi.mock("@opentelemetry/sdk-node", () => ({
    NodeSDK: class {
        config: any
        shutdown = vi.fn(() => Promise.resolve())
        constructor(config: any) {
            this.config = config
        }
        start() {}
    },
}))
vi.mock("@opentelemetry/resources", () => ({ resourceFromAttributes: (attrs: object) => attrs }))
vi.mock("@opentelemetry/sdk-trace-node", () => ({
    BatchSpanProcessor: fake.BatchSpanProcessor,
    TraceIdRatioBasedSampler: fake.record("TraceIdRatioBasedSampler"),
    ParentBasedSampler: fake.record("ParentBasedSampler"),
    SamplingDecision: { NOT_RECORD: 0, RECORD: 1, RECORD_AND_SAMPLED: 2 },
}))
vi.mock("@opentelemetry/core", () => ({ setGlobalErrorHandler: vi.fn() }))
vi.mock("@opentelemetry/sdk-metrics", () => ({ PeriodicExportingMetricReader: fake.record("reader") }))
vi.mock("@opentelemetry/exporter-trace-otlp-grpc", () => ({ OTLPTraceExporter: fake.record("trace-grpc") }))
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({ OTLPTraceExporter: fake.record("trace-http") }))
vi.mock("@opentelemetry/exporter-metrics-otlp-grpc", () => ({ OTLPMetricExporter: fake.record("m-grpc") }))
vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({ OTLPMetricExporter: fake.record("m-http") }))
vi.mock("@opentelemetry/auto-instrumentations-node", () => ({ getNodeAutoInstrumentations: () => ({}) }))
vi.mock("@opentelemetry/semantic-conventions", () => ({
    default: {
        ATTR_SERVICE_NAME: "service.name",
        ATTR_SERVICE_VERSION: "service.version",
        ATTR_DEPLOYMENT_ENVIRONMENT: "deployment.environment",
    },
}))

import Otel from "../../src/otel.js"

const g = globalThis as any

// Trace ids are 32 hex chars. Chars 0-12 drive head sampling and 12-24 drive
// promotion, so "0…" always passes a rate check and "f…" never does.
const traceId = (head: "0" | "f", promote: "0" | "f", tail = "00000000") =>
    head.repeat(12) + promote.repeat(12) + tail

let nextSpan = 0
function span({
    trace = traceId("f", "0"),
    root = false,
    sampled = false,
    status,
    error = false,
    bot = false,
}: {
    trace?: string
    root?: boolean
    sampled?: boolean
    status?: number
    error?: boolean
    bot?: boolean
} = {}) {
    const ctx = { traceId: trace, traceFlags: sampled ? SAMPLED : 0 }
    const attributes: Record<string, unknown> = {}
    if (status !== undefined) attributes["http.response.status_code"] = status
    if (bot) attributes["http.response.is_bot"] = true
    return {
        id: nextSpan++,
        parentSpanId: root ? undefined : "parent",
        attributes,
        status: error ? { code: ERROR } : { code: 0 },
        spanContext: () => ctx,
    }
}

describe("otel status-aware error sampling", () => {
    let originalEnv: NodeJS.ProcessEnv
    let signalListeners: Record<string, Function[]>
    let logger: { info: any; warn: any; error: any }

    function start(errorSampling: Record<string, unknown> = {}, config: Record<string, unknown> = {}) {
        const { sdk } = Otel.init({
            samplingRate: 0.05,
            errorSampling: { ENABLED: true, ...errorSampling },
            ...config,
        }) as any
        return {
            sdk,
            sampler: sdk.config.sampler,
            processor: sdk.config.spanProcessor,
            batch: fake.state.batches[fake.state.batches.length - 1],
        }
    }

    beforeEach(() => {
        vi.useFakeTimers()
        originalEnv = process.env
        process.env = { ...process.env, OTEL_ENABLE: true as any }
        signalListeners = { SIGTERM: process.listeners("SIGTERM"), SIGINT: process.listeners("SIGINT") }
        fake.state.batches.length = 0
        fake.state.parentSpanContext = undefined
        logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        g.logger = logger
    })

    afterEach(() => {
        process.env = originalEnv
        delete g.logger
        for (const signal of ["SIGTERM", "SIGINT"] as const) {
            for (const listener of process.listeners(signal)) {
                if (!signalListeners[signal].includes(listener)) process.off(signal, listener as any)
            }
        }
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it("uses the status-aware sampler and processor only when ENABLED is true", () => {
        const { sampler, processor } = start()
        expect(String(sampler)).toBe("StatusAwareSampler{samplingRate=0.05}")
        expect(processor.config).toMatchObject({
            samplingRate: 0.05,
            rate5xx: 1.0,
            rate4xx: 0.05,
            exportFullTraceOnError: false,
            promoteHandledErrors: false,
            reportActualPromotionRate: false,
            skipPromotionCodes: [408, 504, 524, 598, 599],
            promoteBotTraffic: false,
        })

        const plain = (Otel.init({ errorSampling: { ENABLED: "true" } } as any) as any).sdk.config
        expect(plain.sampler.kind).toBe("ParentBasedSampler")
    })

    describe("sampler", () => {
        it("follows a valid parent's sampled flag", () => {
            const { sampler } = start()

            fake.state.parentSpanContext = { traceId: "abc", traceFlags: SAMPLED }
            expect(sampler.shouldSample({}, traceId("f", "f"))).toEqual({ decision: RECORD_AND_SAMPLED })

            fake.state.parentSpanContext = { traceId: "abc", traceFlags: 0 }
            expect(sampler.shouldSample({}, traceId("0", "0"))).toEqual({ decision: RECORD })
        })

        it("head-samples a root by the first 12 trace id characters, and records the rest", () => {
            const { sampler } = start()

            expect(sampler.shouldSample({}, traceId("0", "f"))).toEqual({ decision: RECORD_AND_SAMPLED })
            expect(sampler.shouldSample({}, traceId("f", "0"))).toEqual({ decision: RECORD })
            // Too short to read the bit range: never sampled.
            expect(sampler.shouldSample({}, "0000")).toEqual({ decision: RECORD })
        })

        it("samples everything at rate 1 and nothing at rate 0", () => {
            expect(start({}, { samplingRate: 1 }).sampler.shouldSample({}, traceId("f", "f"))).toEqual({
                decision: RECORD_AND_SAMPLED,
            })
            expect(start({}, { samplingRate: 0 }).sampler.shouldSample({}, traceId("0", "0"))).toEqual({
                decision: RECORD,
            })
        })
    })

    describe("processor", () => {
        it("passes head-sampled spans straight to the batch processor", () => {
            const { processor, batch } = start()
            const sampled = span({ sampled: true, root: true, status: 200 })
            const unsampled = span()

            processor.onStart(sampled, {})
            processor.onStart(unsampled, {})
            processor.onEnd(sampled)

            expect(batch.started).toEqual([sampled])
            expect(batch.ended).toEqual([sampled])
            expect(processor.buffer.size).toBe(0)
        })

        it("drops an unsampled trace whose root ended without an error", () => {
            const { processor, batch } = start()
            const trace = traceId("f", "0")

            processor.onEnd(span({ trace }))
            expect(processor.buffer.size).toBe(1)
            processor.onEnd(span({ trace, root: true, status: 200 }))

            expect(batch.ended).toEqual([])
            expect(processor.buffer.size).toBe(0)
            expect(processor.promotedTraces.size).toBe(0)
        })

        it("promotes a 5xx trace and exports the root with only its error children", () => {
            const { processor, batch } = start()
            const trace = traceId("f", "0")
            const okChild = span({ trace })
            const errorChild = span({ trace, error: true })
            const root = span({ trace, root: true, status: 503 })

            processor.onEnd(okChild)
            processor.onEnd(errorChild)
            processor.onEnd(root)

            expect(batch.ended).toEqual([root, errorChild])
            for (const exported of [root, errorChild]) {
                expect(exported.spanContext().traceFlags & SAMPLED).toBe(SAMPLED)
                expect(exported.attributes).toMatchObject({ promoted: true, sample_rate: 0.05 })
            }
            expect(okChild.attributes.promoted).toBeUndefined()
            expect(processor.buffer.size).toBe(0)
        })

        it("exports every buffered span with EXPORT_FULL_TRACE_ON_ERROR, and reports the promotion rate when asked", () => {
            const { processor, batch } = start({
                EXPORT_FULL_TRACE_ON_ERROR: true,
                REPORT_ACTUAL_PROMOTION_RATE: true,
            })
            const trace = traceId("f", "0")
            const child = span({ trace })
            const root = span({ trace, root: true, status: 500 })

            processor.onEnd(child)
            processor.onEnd(root)

            expect(batch.ended).toEqual([root, child])
            expect(root.attributes.sample_rate).toBe(1.0)
        })

        it("exports spans that end after their trace was promoted", () => {
            const { processor, batch } = start({ REPORT_ACTUAL_PROMOTION_RATE: true })
            const trace = traceId("f", "0")
            const root = span({ trace, root: true, status: 500 })
            const late = span({ trace })

            processor.onEnd(root)
            processor.onEnd(late)

            expect(batch.ended).toEqual([root, late])
            expect(late.attributes).toMatchObject({ promoted: true, sample_rate: 1.0 })
        })

        it("promotes a root with an ERROR status even without an http status", () => {
            const { processor, batch } = start()
            const root = span({ root: true, error: true })

            processor.onEnd(root)

            expect(batch.ended).toEqual([root])
        })

        it("promotes 4xx at RATE_4XX, decided by trace id characters 12-24", () => {
            const { processor, batch } = start({ RATE_4XX: 0.5 })
            const kept = span({ trace: traceId("f", "0"), root: true, status: 404 })
            const dropped = span({ trace: traceId("f", "f"), root: true, status: 404 })

            processor.onEnd(kept)
            processor.onEnd(dropped)

            expect(batch.ended).toEqual([kept])
        })

        it("never promotes the skipped status codes or bot traffic by default", () => {
            const { processor, batch } = start()

            processor.onEnd(span({ trace: traceId("f", "0", "00000001"), root: true, status: 504 }))
            processor.onEnd(
                span({ trace: traceId("f", "0", "00000002"), root: true, status: 500, bot: true })
            )

            expect(batch.ended).toEqual([])
            expect(processor.buffer.size).toBe(0)
        })

        it("promotes bot traffic with PROMOTE_BOT_TRAFFIC", () => {
            const { processor, batch } = start({ PROMOTE_BOT_TRAFFIC: true })
            const root = span({ root: true, status: 500, bot: true })

            processor.onEnd(root)

            expect(batch.ended).toEqual([root])
        })

        it("promotes a 2xx root whose child errored only with PROMOTE_HANDLED_ERRORS", () => {
            const run = (errorSampling: Record<string, unknown>) => {
                const { processor, batch } = start(errorSampling)
                const trace = traceId("f", "0")
                processor.onEnd(span({ trace, error: true }))
                processor.onEnd(span({ trace, root: true, status: 200 }))
                return batch.ended.length
            }

            expect(run({})).toBe(0)
            expect(run({ PROMOTE_HANDLED_ERRORS: true })).toBe(2)
        })

        it("evicts unresolved and promoted traces after their 60 second TTL", () => {
            const { processor } = start()
            processor.onEnd(span({ trace: traceId("f", "0", "00000001") }))
            processor.onEnd(span({ trace: traceId("f", "0", "00000002"), root: true, status: 500 }))
            expect(processor.buffer.size).toBe(1)
            expect(processor.promotedTraces.size).toBe(1)

            // The cleanup timer fires every 30s; both entries are older than 60s by the third run.
            vi.advanceTimersByTime(90_000)

            expect(processor.buffer.size).toBe(0)
            expect(processor.promotedTraces.size).toBe(0)
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("expired unresolved trace(s)"))
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("from promotedTraces"))
        })

        it("caps both buffers at 1024 traces and warns about the overflow", () => {
            const { processor } = start()
            for (let i = 0; i < 1030; i++) {
                const tail = i.toString(16).padStart(8, "0")
                processor.onEnd(span({ trace: traceId("f", "0", tail) }))
                processor.promotedTraces.set(`promoted-${i}`, { timestamp: Date.now(), promotionRate: 1 })
            }

            vi.advanceTimersByTime(30_000)

            expect(processor.buffer.size).toBe(1024)
            expect(processor.promotedTraces.size).toBe(1024)
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("buffer overflow, dropped 6"))
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining("promotedTraces overflow, dropped 6")
            )
        })

        it("delegates forceFlush, and on shutdown clears its state and shuts the batch processor down", async () => {
            const { processor, batch } = start()
            processor.onEnd(span())

            await expect(processor.forceFlush()).resolves.toBe("flushed")
            await expect(processor.shutdown()).resolves.toBe("shut down")

            expect(processor.buffer.size).toBe(0)
            expect(batch.shutdown).toHaveBeenCalledTimes(1)
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining("discarding 1 unresolved trace(s)")
            )
            // The cleanup timer is gone: nothing runs after shutdown.
            logger.info.mockClear()
            vi.advanceTimersByTime(120_000)
            expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("[OTEL Cleanup]"))
        })
    })

    describe("memory heartbeat", () => {
        it("logs memory and buffer sizes every diagnosticsIntervalMillis, and warns over a threshold", () => {
            const { processor } = start({}, { diagnosticsIntervalMillis: 1000, highMemoryRssMB: 0.001 })
            processor.onEnd(span())

            vi.advanceTimersByTime(1000)

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringMatching(/\[OTEL Heartbeat\].*Buffers: active=1, promotedCache=0/)
            )
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("[OTEL High Memory Warning]"))

            // The warning is throttled to once a minute; the heartbeat is not.
            logger.warn.mockClear()
            vi.advanceTimersByTime(1000)
            expect(logger.warn).not.toHaveBeenCalled()
        })

        it("falls back to the container limit when a threshold is not a positive number", () => {
            start({}, { diagnosticsIntervalMillis: 1000, highMemoryRssMB: -1, highMemoryHeapUsedMB: "big" })

            // Past the one-minute warning throttle left by the test above.
            vi.advanceTimersByTime(120_000)

            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("[OTEL Heartbeat]"))
        })

        it("does not run with enableMemoryDiagnostics off, or without error sampling", () => {
            start({}, { diagnosticsIntervalMillis: 1000, enableMemoryDiagnostics: false })
            Otel.init({ diagnosticsIntervalMillis: 1000 })

            vi.advanceTimersByTime(5000)

            expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("[OTEL Heartbeat]"))
        })

        it("stops on SIGTERM", async () => {
            vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
            start({}, { diagnosticsIntervalMillis: 1000 })
            const onSigterm = process
                .listeners("SIGTERM")
                .find((listener) => !signalListeners.SIGTERM.includes(listener)) as Function

            onSigterm()
            logger.info.mockClear()
            vi.advanceTimersByTime(5000)

            expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("[OTEL Heartbeat]"))
        })
    })

    it("logs through console methods when the app logger lacks one", () => {
        g.logger = {}
        vi.spyOn(console, "log").mockImplementation(() => {})
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const { processor } = start()
        for (let i = 0; i < 1030; i++) {
            processor.onEnd(span({ trace: traceId("f", "0", i.toString(16).padStart(8, "0")) }))
        }

        vi.advanceTimersByTime(30_000)

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Status Aware Error Sampling"))
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("buffer overflow"))
    })
})
