import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// otel.js logs through the app-wide `logger`, which only exists once the app
// calls configureLogger() from catalyst-core/logger. Apps that never did hit
// `ReferenceError: logger is not defined` inside init(), so the SDK never
// started and no traces were exported. These tests pin the console fallback.
//
// The @opentelemetry/* packages are optional and not installed in this
// package, so each import otel.js makes is replaced with a minimal fake.
// That is enough for init() to run its real control flow end to end.

vi.mock("@opentelemetry/api", () => ({
    metrics: { getMeter: () => ({ createObservableGauge: () => ({ addCallback: () => {} }) }) },
    trace: { getTracer: () => ({}) },
    context: { active: () => ({ getValue: () => undefined }) },
    createContextKey: (name: string) => Symbol(name),
}))
vi.mock("@opentelemetry/sdk-node", () => ({
    NodeSDK: class {
        start() {}
        shutdown() {
            return Promise.resolve()
        }
    },
}))
vi.mock("@opentelemetry/resources", () => ({ resourceFromAttributes: (attrs: object) => attrs }))
vi.mock("@opentelemetry/sdk-trace-node", () => ({
    BatchSpanProcessor: class {},
    TraceIdRatioBasedSampler: class {},
    ParentBasedSampler: class {},
}))
vi.mock("@opentelemetry/sdk-metrics", () => ({ PeriodicExportingMetricReader: class {} }))
vi.mock("@opentelemetry/exporter-trace-otlp-grpc", () => ({ OTLPTraceExporter: class {} }))
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({ OTLPTraceExporter: class {} }))
vi.mock("@opentelemetry/exporter-metrics-otlp-grpc", () => ({ OTLPMetricExporter: class {} }))
vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({ OTLPMetricExporter: class {} }))
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

describe("otel init() logger fallback", () => {
    let originalEnv: NodeJS.ProcessEnv
    let signalListeners: Record<string, Function[]>

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
