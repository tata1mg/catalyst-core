import { EventEmitter } from "events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// otel.js logs through the app-wide `logger`, which only exists once the app
// calls configureLogger() from catalyst-core/logger. Apps that never did hit
// `ReferenceError: logger is not defined` inside init(), so the SDK never
// started and no traces were exported. These tests pin the console fallback.
//
// The @opentelemetry/* packages are optional and not installed in this
// package, so each import otel.js makes is replaced with a minimal fake.
// That is enough for init() to run its real control flow end to end. The
// fakes record what they were constructed with, so the tests can assert on
// the SDK configuration and the spans otel.js produces.

const fake = vi.hoisted(() => {
    type Span = {
        name: string
        options?: any
        parent?: any
        attributes: Record<string, unknown>
        exceptions: unknown[]
        status?: { code: number; message: string }
        ended: number
        setAttribute: (key: string, value: unknown) => void
        recordException: (error: unknown) => void
        setStatus: (status: { code: number; message: string }) => void
        end: () => void
    }
    const state = {
        spans: [] as Span[],
        tracerNames: [] as string[],
        isBot: undefined as unknown,
        activeContext: { id: "request-context" } as any,
        gauges: [] as { name: string; options: any; callbacks: Function[] }[],
        meterArgs: [] as unknown[][],
    }
    const makeSpan = (name: string, options?: any, parent?: any): Span => {
        const span: Span = {
            name,
            options,
            parent,
            attributes: {},
            exceptions: [],
            ended: 0,
            setAttribute: (key, value) => {
                span.attributes[key] = value
            },
            recordException: (error) => {
                span.exceptions.push(error)
            },
            setStatus: (status) => {
                span.status = status
            },
            end: () => {
                span.ended += 1
            },
        }
        state.spans.push(span)
        return span
    }
    const record = (kind: string) =>
        class {
            kind = kind
            args: unknown[]
            constructor(...args: unknown[]) {
                this.args = args
            }
        }
    return { state, makeSpan, record }
})

vi.mock("@opentelemetry/api", () => ({
    metrics: {
        getMeter: (...args: unknown[]) => {
            fake.state.meterArgs.push(args)
            return {
                createObservableGauge: (name: string, options: any) => {
                    const gauge = { name, options, callbacks: [] as Function[] }
                    fake.state.gauges.push(gauge)
                    return { addCallback: (cb: Function) => gauge.callbacks.push(cb) }
                },
            }
        },
    },
    trace: {
        getTracer: (name: string) => {
            fake.state.tracerNames.push(name)
            return {
                startActiveSpan: (spanName: string, fn: (span: unknown) => unknown) =>
                    fn(fake.makeSpan(spanName)),
                startSpan: (spanName: string, options: unknown, parent: unknown) =>
                    fake.makeSpan(spanName, options, parent),
            }
        },
    },
    context: {
        active: () => ({
            ...fake.state.activeContext,
            getValue: (key: symbol) => (key.description === "catalyst.is_bot" ? fake.state.isBot : undefined),
        }),
    },
    createContextKey: (name: string) => Symbol(name),
}))
vi.mock("@opentelemetry/sdk-node", () => ({
    NodeSDK: class {
        config: any
        started = false
        shutdown = vi.fn(() => Promise.resolve())
        constructor(config: any) {
            this.config = config
        }
        start() {
            this.started = true
        }
    },
}))
vi.mock("@opentelemetry/resources", () => ({ resourceFromAttributes: (attrs: object) => attrs }))
vi.mock("@opentelemetry/sdk-trace-node", () => ({
    BatchSpanProcessor: fake.record("BatchSpanProcessor"),
    TraceIdRatioBasedSampler: fake.record("TraceIdRatioBasedSampler"),
    ParentBasedSampler: fake.record("ParentBasedSampler"),
}))
vi.mock("@opentelemetry/sdk-metrics", () => ({
    PeriodicExportingMetricReader: fake.record("PeriodicExportingMetricReader"),
}))
vi.mock("@opentelemetry/exporter-trace-otlp-grpc", () => ({ OTLPTraceExporter: fake.record("trace-grpc") }))
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({ OTLPTraceExporter: fake.record("trace-http") }))
vi.mock("@opentelemetry/exporter-metrics-otlp-grpc", () => ({
    OTLPMetricExporter: fake.record("metric-grpc"),
}))
vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({
    OTLPMetricExporter: fake.record("metric-http"),
}))
vi.mock("@opentelemetry/auto-instrumentations-node", () => ({
    getNodeAutoInstrumentations: () => ({ auto: true }),
}))
vi.mock("@opentelemetry/semantic-conventions", () => ({
    default: {
        ATTR_SERVICE_NAME: "service.name",
        ATTR_SERVICE_VERSION: "service.version",
        ATTR_DEPLOYMENT_ENVIRONMENT: "deployment.environment",
    },
}))

import Otel, {
    IS_BOT_KEY,
    responseFlushMiddleware,
    withObservability,
    withSyncObservability,
} from "../../src/otel.js"

const g = globalThis as any

beforeEach(() => {
    fake.state.spans.length = 0
    fake.state.tracerNames.length = 0
    fake.state.gauges.length = 0
    fake.state.meterArgs.length = 0
    fake.state.isBot = undefined
})

describe("otel init()", () => {
    let originalEnv: NodeJS.ProcessEnv
    let signalListeners: Record<string, Function[]>

    // The SIGTERM/SIGINT handlers init() registered in this test.
    const addedListener = (signal: "SIGTERM" | "SIGINT") =>
        process.listeners(signal).find((listener) => !signalListeners[signal].includes(listener)) as Function

    beforeEach(() => {
        originalEnv = process.env
        // Catalyst keeps config.json's real boolean here; assigning through the
        // process.env setter would coerce it to the string "true".
        process.env = { ...process.env, OTEL_ENABLE: true as any }
        signalListeners = { SIGTERM: process.listeners("SIGTERM"), SIGINT: process.listeners("SIGINT") }
        delete g.logger
        vi.spyOn(console, "info").mockImplementation(() => {})
        vi.spyOn(console, "error").mockImplementation(() => {})
    })

    afterEach(() => {
        process.env = originalEnv
        delete g.logger
        // init() registers SIGTERM/SIGINT shutdown handlers; drop the ones it added.
        for (const signal of ["SIGTERM", "SIGINT"] as const) {
            for (const listener of process.listeners(signal)) {
                if (!signalListeners[signal].includes(listener)) process.off(signal, listener as any)
            }
        }
        vi.restoreAllMocks()
    })

    describe("logger fallback", () => {
        it("starts and logs to console when the app never configured a logger", () => {
            expect(g.logger).toBeUndefined()

            const { sdk } = Otel.init()

            expect(sdk).not.toBeNull()
            expect(console.info).toHaveBeenCalledWith("✅ OpenTelemetry started successfully")
        })

        it("logs through the app logger when one is configured", () => {
            g.logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() }

            Otel.init()

            expect(g.logger.info).toHaveBeenCalledWith("✅ OpenTelemetry started successfully")
            expect(console.info).not.toHaveBeenCalled()
        })

        it("still throws the original error, not a ReferenceError, when init fails", () => {
            expect(() => Otel.init({ traceProtocol: "udp" })).toThrow(/Unsupported trace protocol: udp/)
            expect(console.error).toHaveBeenCalledWith(
                "❌ Failed to initialize OpenTelemetry:",
                expect.any(Error)
            )
        })
    })

    it("does nothing unless OTEL_ENABLE is the boolean true", () => {
        const before = process.listeners("SIGTERM").length
        for (const value of [undefined, "true", false]) {
            process.env = { ...originalEnv, OTEL_ENABLE: value as any }
            expect(Otel.init()).toEqual({ sdk: null, meter: null })
        }
        expect(process.listeners("SIGTERM")).toHaveLength(before)
        expect(console.info).not.toHaveBeenCalled()
    })

    it("defaults to a gRPC trace exporter on localhost with metrics off", () => {
        const { sdk, meter } = Otel.init() as any

        expect(sdk.started).toBe(true)
        expect(meter).toBeNull()
        expect(sdk.config.resource).toEqual({
            "service.name": "catalyst-server",
            "service.version": "1.0.0",
            "deployment.environment": "development",
        })
        const [exporter, batchConfig] = sdk.config.spanProcessor.args
        expect(exporter.kind).toBe("trace-grpc")
        expect(exporter.args[0]).toEqual({
            url: "http://localhost:4317",
            headers: {},
            credentials: undefined,
        })
        expect(batchConfig).toEqual({})
        expect(sdk.config.instrumentations).toEqual([{ auto: true }])
        expect(sdk.config.sampler.args[0].root.args).toEqual([1.0])
        expect(sdk.config).not.toHaveProperty("metricReader")
        expect(fake.state.gauges).toHaveLength(0)
        expect(console.info).toHaveBeenCalledWith(
            "📡 Creating gRPC trace exporter for URL: http://localhost:4317"
        )
    })

    it("passes service identity, HTTP exporter options, sampling and instrumentations through", () => {
        const instrumentations = [{ custom: true }]
        const { sdk } = Otel.init({
            serviceName: "pharmacy-web",
            serviceVersion: "4.2.0",
            environment: "production",
            traceUrl: "https://collector/v1/traces",
            traceProtocol: "HTTP",
            traceHeaders: { authorization: "token" },
            batchProcessorConfig: { maxQueueSize: 10 },
            samplingRate: 0.25,
            instrumentations,
        }) as any

        expect(sdk.config.resource["service.name"]).toBe("pharmacy-web")
        expect(sdk.config.resource["service.version"]).toBe("4.2.0")
        expect(sdk.config.resource["deployment.environment"]).toBe("production")
        const [exporter, batchConfig] = sdk.config.spanProcessor.args
        expect(exporter.kind).toBe("trace-http")
        expect(exporter.args[0]).toEqual({
            url: "https://collector/v1/traces",
            headers: { authorization: "token" },
        })
        expect(batchConfig).toEqual({ maxQueueSize: 10 })
        expect(sdk.config.sampler.args[0].root.args).toEqual([0.25])
        expect(sdk.config.instrumentations).toBe(instrumentations)
    })

    it.each([
        ["http", "metric-http", { url: "https://collector/v1/metrics", headers: { k: "v" } }],
        [
            "grpc",
            "metric-grpc",
            { url: "https://collector/v1/metrics", headers: { k: "v" }, credentials: "creds" },
        ],
    ])("enables %s metrics with a periodic reader and process gauges", (protocol, kind, options) => {
        const { sdk, meter } = Otel.init({
            serviceName: "svc",
            serviceVersion: "2.0.0",
            metricProtocol: protocol,
            metricUrl: "https://collector/v1/metrics",
            metricHeaders: { k: "v" },
            exportIntervalMillis: 5000,
            grpcCredentials: "creds",
        }) as any

        const readerOptions = sdk.config.metricReader.args[0]
        expect(readerOptions.exportIntervalMillis).toBe(5000)
        expect(readerOptions.exporter.kind).toBe(kind)
        expect(readerOptions.exporter.args[0]).toEqual(options)
        expect(meter).not.toBeNull()
        expect(fake.state.meterArgs).toEqual([["svc", "2.0.0"]])
        expect(fake.state.gauges.map((gauge) => gauge.name)).toEqual([
            "process_cpu_usage_percent",
            "process_memory_usage_bytes",
            "process_memory_heap_used_bytes",
            "process_memory_heap_total_bytes",
        ])
    })

    it("reports CPU and memory from the gauge callbacks", () => {
        Otel.init({ metricProtocol: "grpc" })
        const observe = (name: string) => {
            const result = { observe: vi.fn() }
            const gauge = fake.state.gauges.find((entry) => entry.name === name)
            gauge.callbacks.forEach((callback) => callback(result))
            return result.observe.mock.calls
        }

        const cpu = observe("process_cpu_usage_percent")
        expect(cpu).toHaveLength(1)
        expect(typeof cpu[0][0]).toBe("number")

        const memory = observe("process_memory_usage_bytes")
        expect(memory.map((call) => call[1])).toEqual([
            { type: "rss" },
            { type: "external" },
            { type: "arrayBuffers" },
        ])
        expect(memory[0][0]).toBeGreaterThan(0)

        expect(observe("process_memory_heap_used_bytes")[0][0]).toBeGreaterThan(0)
        expect(observe("process_memory_heap_total_bytes")[0][0]).toBeGreaterThan(0)
    })

    it("rejects an unsupported metric protocol", () => {
        expect(() => Otel.init({ metricProtocol: "statsd" })).toThrow(/Unsupported metric protocol: statsd/)
    })

    it("shuts the SDK down and exits on SIGTERM and SIGINT", async () => {
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as any)
        const { sdk } = Otel.init() as any

        addedListener("SIGTERM")()
        expect(console.info).toHaveBeenCalledWith(
            "📡 Received SIGTERM, shutting down OpenTelemetry gracefully..."
        )
        await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1))
        expect(sdk.shutdown).toHaveBeenCalledTimes(1)
        expect(console.info).toHaveBeenCalledWith("✅ OpenTelemetry shutdown completed")

        addedListener("SIGINT")()
        expect(console.info).toHaveBeenCalledWith(
            "📡 Received SIGINT, shutting down OpenTelemetry gracefully..."
        )
        await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(2))
    })

    it("logs a failed shutdown and still exits", async () => {
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as any)
        const { sdk } = Otel.init() as any
        const failure = new Error("exporter unreachable")
        sdk.shutdown.mockReturnValueOnce(Promise.reject(failure))

        addedListener("SIGTERM")()

        await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1))
        expect(console.error).toHaveBeenCalledWith("❌ Error terminating OpenTelemetry:", failure)
    })
})

describe("withSyncObservability", () => {
    it("returns the result synchronously inside one span named after the function", () => {
        function priceFor(id: string, qty: number) {
            return `${id}x${qty}`
        }
        const wrapped = withSyncObservability("svc", priceFor, undefined)

        expect(wrapped("sku", 2)).toBe("skux2")
        expect(fake.state.tracerNames).toEqual(["svc"])
        expect(fake.state.spans).toHaveLength(1)
        expect(fake.state.spans[0]).toMatchObject({ name: "priceFor", ended: 1, attributes: {} })
    })

    it("prefers an explicit name and falls back to anonymousFunction", () => {
        withSyncObservability("svc", () => 1, "custom.span")()
        withSyncObservability("svc", [() => 1][0], undefined)()
        expect(fake.state.spans.map((span) => span.name)).toEqual(["custom.span", "anonymousFunction"])
    })

    it("tags the span with the request's bot flag when it is known", () => {
        fake.state.isBot = false
        withSyncObservability("svc", () => 1, "render")()
        expect(fake.state.spans[0].attributes).toEqual({ "http.response.is_bot": false })
        expect(IS_BOT_KEY.description).toBe("catalyst.is_bot")
    })

    it("records the exception, marks the span as an error, and rethrows", () => {
        const failure = new Error("render failed")
        const wrapped = withSyncObservability(
            "svc",
            () => {
                throw failure
            },
            undefined
        )

        expect(() => wrapped()).toThrow(failure)
        const [span] = fake.state.spans
        expect(span.exceptions).toEqual([failure])
        expect(span.status).toEqual({ code: 2, message: "render failed" })
        expect(span.ended).toBe(1)
    })
})

describe("withObservability", () => {
    it("awaits the wrapped function and ends the span after it settles", async () => {
        fake.state.isBot = true
        let resolve: (value: string) => void
        const pending = new Promise<string>((r) => (resolve = r))
        const wrapped = withObservability(
            "svc",
            async function fetchProducts(page: number) {
                return `${await pending}:${page}`
            },
            undefined
        )

        const call = wrapped(3)
        expect(fake.state.spans[0].ended).toBe(0)
        resolve("products")

        await expect(call).resolves.toBe("products:3")
        expect(fake.state.spans[0]).toMatchObject({
            name: "fetchProducts",
            ended: 1,
            attributes: { "http.response.is_bot": true },
        })
    })

    it("records a rejection and rethrows it", async () => {
        const failure = new Error("upstream 503")
        const wrapped = withObservability(
            "svc",
            async () => {
                throw failure
            },
            "serverFetcher"
        )

        await expect(wrapped()).rejects.toBe(failure)
        const [span] = fake.state.spans
        expect(span.name).toBe("serverFetcher")
        expect(span.exceptions).toEqual([failure])
        expect(span.status).toEqual({ code: 2, message: "upstream 503" })
        expect(span.ended).toBe(1)
    })
})

describe("responseFlushMiddleware", () => {
    const makeRes = (isBot = false) => {
        const res = new EventEmitter() as any
        res.locals = { is_bot: isBot }
        res.realEnd = vi.fn(function () {
            return res
        })
        res.end = res.realEnd
        return res
    }
    // Stands in for compression(): wraps res.end synchronously and calls the
    // underlying end later, once the body has been compressed.
    const compressionNext = (res: any) => () => {
        const underlying = res.end
        res.end = (...args: unknown[]) => {
            res.flushCompressed = () => underlying.apply(res, args)
            return res
        }
    }

    it("without compression, times only the flush from res.end() to finish", () => {
        const res = makeRes(true)
        const next = vi.fn()
        responseFlushMiddleware("svc")({}, res, next)
        expect(next).toHaveBeenCalledTimes(1)

        res.end("body")
        expect(res.realEnd).toHaveBeenCalledWith("body")
        expect(fake.state.spans).toHaveLength(1)
        const [flush] = fake.state.spans
        expect(flush.name).toBe("response.flush")
        expect(flush.options).toEqual({ attributes: { "http.response.is_bot": true } })
        expect(flush.parent).toMatchObject({ id: "request-context" })

        res.emit("finish")
        res.emit("close")
        expect(flush.attributes).toEqual({ "http.response.end_event": "finish" })
        expect(flush.ended).toBe(1)
    })

    it("with compression, times compression then egress as sibling spans", () => {
        const res = makeRes()
        responseFlushMiddleware("svc", "egress", "gzip")({}, res, compressionNext(res))

        res.end("body")
        expect(fake.state.spans.map((span) => span.name)).toEqual(["gzip"])
        const [compress] = fake.state.spans
        expect(compress.ended).toBe(0)
        expect(res.realEnd).not.toHaveBeenCalled()

        res.flushCompressed()
        expect(compress.ended).toBe(1)
        expect(res.realEnd).toHaveBeenCalledWith("body")
        const flush = fake.state.spans[1]
        expect(flush.name).toBe("egress")
        expect(flush.parent).toBe(compress.parent)

        res.emit("close")
        expect(flush.attributes).toEqual({ "http.response.end_event": "close" })
        expect(flush.ended).toBe(1)
        expect(compress.attributes).toEqual({})
    })

    it("tags the compression span when the connection closes mid-compression", () => {
        const res = makeRes()
        responseFlushMiddleware("svc")({}, res, compressionNext(res))

        res.end("body")
        res.emit("close")
        const [compress] = fake.state.spans
        expect(compress.attributes).toEqual({ "http.response.end_event": "close" })
        expect(compress.ended).toBe(1)

        // Bytes arriving after the response ended open no further spans.
        res.flushCompressed()
        expect(fake.state.spans).toHaveLength(1)
    })

    it("emits no span when the client aborts before anything is written", () => {
        const res = makeRes()
        responseFlushMiddleware("svc")({}, res, compressionNext(res))

        res.emit("close")
        res.end()
        res.flushCompressed()

        expect(fake.state.spans).toHaveLength(0)
        expect(res.realEnd).toHaveBeenCalledTimes(1)
    })
})
