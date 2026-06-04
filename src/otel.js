import { metrics } from "@opentelemetry/api"
import { NodeSDK } from "@opentelemetry/sdk-node"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node"
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import { TraceIdRatioBasedSampler, ParentBasedSampler } from "@opentelemetry/sdk-trace-node"
import { OTLPTraceExporter as OTLPTraceExporterHTTP } from "@opentelemetry/exporter-trace-otlp-http"
import { OTLPMetricExporter as OTLPMetricExporterHTTP } from "@opentelemetry/exporter-metrics-otlp-http"
import { trace, context } from "@opentelemetry/api"

import semanticConventions from "@opentelemetry/semantic-conventions"
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT } = semanticConventions

function init(config = {}) {
    // OpenTelemetry is opt-in — bail out unless explicitly enabled. Mirrors the
    // OTEL_ENABLE guard in server/expressServer.js and server/renderer/handler.jsx
    // so the SDK, exporters, instrumentations and signal handlers are never set
    // up when tracing is off. Returns the same shape so callers can destructure.
    if (process.env.OTEL_ENABLE !== true) {
        return { sdk: null, meter: null }
    }

    const {
        serviceName = "catalyst-server",
        serviceVersion = "1.0.0",
        environment = "development",
        traceUrl = "http://localhost:4317",
        metricUrl = "http://localhost:4317",
        traceProtocol = "grpc", // "grpc" or "http"
        metricProtocol, // "grpc" or "http" - if not provided, metrics will be disabled
        traceHeaders = {},
        metricHeaders = {},
        batchProcessorConfig = {},
        exportIntervalMillis = 10000,
        instrumentations,
        samplingRate = 1.0,
        grpcCredentials,
    } = config

    try {
        const otlpTraceExporter = createTraceExporter(traceProtocol, traceUrl, traceHeaders, grpcCredentials)

        // Create metric exporter only if metricProtocol is specified
        let otlpMetricExporter = null
        let metricReader = null
        if (metricProtocol) {
            otlpMetricExporter = createMetricExporter(
                metricProtocol,
                metricUrl,
                metricHeaders,
                grpcCredentials
            )
            metricReader = new PeriodicExportingMetricReader({
                exporter: otlpMetricExporter,
                exportIntervalMillis,
            })
        }

        const sampler = new ParentBasedSampler({
            root: new TraceIdRatioBasedSampler(samplingRate),
        })

        const sdkConfig = {
            resource: resourceFromAttributes({
                [ATTR_SERVICE_NAME]: serviceName,
                [ATTR_SERVICE_VERSION]: serviceVersion,
                [ATTR_DEPLOYMENT_ENVIRONMENT]: environment,
            }),
            spanProcessor: new BatchSpanProcessor(otlpTraceExporter, batchProcessorConfig),
            instrumentations: instrumentations ?? [getNodeAutoInstrumentations()],
            sampler,
        }

        // Add metric reader only if metrics are enabled
        if (metricReader) {
            sdkConfig.metricReader = metricReader
        }

        const sdk = new NodeSDK(sdkConfig)

        sdk.start()
        logger.info("✅ OpenTelemetry started successfully")

        // Initialize custom metrics only if metrics are enabled
        let meter = null
        if (metricProtocol) {
            meter = initializeCustomMetrics(serviceName, serviceVersion)
        }

        const gracefulShutdown = (signal) => {
            logger.info(`📡 Received ${signal}, shutting down OpenTelemetry gracefully...`)
            sdk.shutdown()
                .then(() => logger.info("✅ OpenTelemetry shutdown completed"))
                .catch((error) => {
                    logger.error("❌ Error terminating OpenTelemetry:", error)
                })
                .finally(() => process.exit())
        }

        process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
        process.on("SIGINT", () => gracefulShutdown("SIGINT"))

        return { sdk, meter }
    } catch (error) {
        logger.error("❌ Failed to initialize OpenTelemetry:", error)
        throw error
    }
}

/**
 * Creates a trace exporter based on the specified protocol
 * @param {string} protocol - "grpc" or "http"
 * @param {string} url - Exporter endpoint URL
 * @param {object} headers - Headers to include in requests
 * @param {Function} [grpcCredentials] - gRPC Credentials (optional)
 * @returns {OTLPTraceExporter|OTLPTraceExporterHTTP} Configured trace exporter
 */
function createTraceExporter(protocol, url, headers = {}, grpcCredentials) {
    if (protocol.toLowerCase() === "http") {
        logger.info(`📡 Creating HTTP trace exporter for URL: ${url}`)
        return new OTLPTraceExporterHTTP({
            url: url,
            headers: headers,
        })
    } else if (protocol.toLowerCase() === "grpc") {
        logger.info(`📡 Creating gRPC trace exporter for URL: ${url}`)
        return new OTLPTraceExporter({
            url: url,
            headers: headers,
            credentials: grpcCredentials,
        })
    } else {
        throw new Error(
            `❌ Unsupported trace protocol: ${protocol}. Supported protocols are "grpc" and "http"`
        )
    }
}

/**
 * Creates a metric exporter based on the specified protocol
 * @param {string} protocol - "grpc" or "http"
 * @param {string} url - Exporter endpoint URL
 * @param {object} headers - Headers to include in requests
 * @param {Function} [grpcCredentials] - gRPC Credentials (optional)
 * @returns {OTLPMetricExporter|OTLPMetricExporterHTTP} Configured metric exporter
 */
function createMetricExporter(protocol, url, headers = {}, grpcCredentials) {
    if (protocol.toLowerCase() === "http") {
        logger.info(`📊 Creating HTTP metric exporter for URL: ${url}`)
        return new OTLPMetricExporterHTTP({
            url: url,
            headers: headers,
        })
    } else if (protocol.toLowerCase() === "grpc") {
        logger.info(`📊 Creating gRPC metric exporter for URL: ${url}`)
        return new OTLPMetricExporter({
            url: url,
            headers: headers,
            credentials: grpcCredentials,
        })
    } else {
        throw new Error(
            `❌ Unsupported metric protocol: ${protocol}. Supported protocols are "grpc" and "http"`
        )
    }
}

function initializeCustomMetrics(serviceName, serviceVersion) {
    let customMetrics = {}
    const meter = metrics.getMeter(serviceName, serviceVersion)

    // CPU usage gauge
    customMetrics.cpuUsage = meter.createObservableGauge("process_cpu_usage_percent", {
        description: "Current CPU usage percentage",
    })

    // Memory usage gauges
    customMetrics.memoryUsage = meter.createObservableGauge("process_memory_usage_bytes", {
        description: "Current memory usage in bytes",
        unit: "bytes",
    })

    customMetrics.memoryHeapUsed = meter.createObservableGauge("process_memory_heap_used_bytes", {
        description: "Current heap memory used in bytes",
        unit: "bytes",
    })

    customMetrics.memoryHeapTotal = meter.createObservableGauge("process_memory_heap_total_bytes", {
        description: "Current heap memory total in bytes",
        unit: "bytes",
    })

    let lastCpuUsage = process.cpuUsage()
    let lastMeasureTime = process.hrtime.bigint()

    customMetrics.cpuUsage.addCallback((result) => {
        const currentCpuUsage = process.cpuUsage(lastCpuUsage)
        const currentTime = process.hrtime.bigint()
        const timeDiff = Number(currentTime - lastMeasureTime) / 1000000 // Convert to milliseconds

        const cpuPercent = ((currentCpuUsage.user + currentCpuUsage.system) / 1000 / timeDiff) * 100

        result.observe(cpuPercent)

        lastCpuUsage = process.cpuUsage()
        lastMeasureTime = currentTime
    })

    customMetrics.memoryUsage.addCallback((result) => {
        const memUsage = process.memoryUsage()
        result.observe(memUsage.rss, { type: "rss" })
        result.observe(memUsage.external, { type: "external" })
        result.observe(memUsage.arrayBuffers, { type: "arrayBuffers" })
    })

    customMetrics.memoryHeapUsed.addCallback((result) => {
        const memUsage = process.memoryUsage()
        result.observe(memUsage.heapUsed)
    })

    customMetrics.memoryHeapTotal.addCallback((result) => {
        const memUsage = process.memoryUsage()
        result.observe(memUsage.heapTotal)
    })

    return meter
}

/**
 * Wraps a synchronous function and measures total execution time.
 * Creates a single OpenTelemetry span per function call.
 * Use this instead of withObservability when the wrapped function is synchronous,
 * so the return type and call sites remain unchanged.
 *
 * @param {string} serviceName - The name of the service
 * @param {Function} fn - The synchronous function to wrap
 * @param {string} name - Span name (optional)
 * @returns {Function} Wrapped function (still synchronous)
 */
export function withSyncObservability(serviceName, fn, name) {
    const tracer = trace.getTracer(serviceName)
    const spanName = name || fn.name || "anonymousFunction"

    return function (...args) {
        return tracer.startActiveSpan(spanName, (span) => {
            try {
                return fn(...args)
            } catch (err) {
                span.recordException(err)
                span.setStatus({ code: 2, message: err.message })
                throw err
            } finally {
                span.end()
            }
        })
    }
}

/**
 * Wraps a function (sync or async) and measures total execution time.
 * Creates a single OpenTelemetry span per function call.
 *
 * @param {string} serviceName - The name of the service
 * @param {Function} fn - The function to wrap
 * @param {string} name - Span name (optional)
 * @returns {Function} Wrapped function
 */
export function withObservability(serviceName, fn, name) {
    const tracer = trace.getTracer(serviceName)
    const spanName = name || fn.name || "anonymousFunction"

    return async function (...args) {
        return tracer.startActiveSpan(spanName, async (span) => {
            try {
                const result = await fn(...args)
                return result
            } catch (err) {
                span.recordException(err)
                span.setStatus({ code: 2, message: err.message })
                throw err
            } finally {
                span.end()
            }
        })
    }
}

/**
 * Express middleware that emits a span measuring the response body
 * flush/egress window: it STARTS when the app calls res.end() (the moment the
 * app stops writing) and ENDS on the response 'finish' event (all bytes handed
 * to the OS) or 'close' (connection torn down first).
 *
 * The span's duration is therefore pure egress / TCP backpressure time — the
 * reason the HTTP server span runs longer than `handler` for large fully-SSR'd
 * bot responses (res.end() returns long before the bytes actually drain).
 *
 * Register this BEFORE the SSR handler. It uses startSpan (not startActiveSpan),
 * so it becomes a sibling of `handler` under the same request span rather than
 * a parent of it. The 'finish'/'close' listeners are attached up front (so an
 * event is never missed), but the span itself is created only when res.end()
 * fires — if the app never writes (e.g. client aborts first), no span is emitted.
 *
 * @param {string} serviceName
 * @param {string} [name] - Span name
 * @returns {Function} Express middleware
 */
export function responseFlushMiddleware(serviceName, name = "response.flush") {
    const tracer = trace.getTracer(serviceName)

    return function (req, res, next) {
        // Capture the active (request) context now, while it's guaranteed to be
        // the in-flight request span. The span is created later — when res.end()
        // is called — so it must be parented to this captured context.
        const parentContext = context.active()

        let span = null
        let ended = false

        const finalize = (endEvent) => {
            if (ended) return
            ended = true
            if (span) {
                span.setAttribute("http.response.end_event", endEvent) // "finish" | "close"
                span.end()
            }
        }

        // Start the span the moment the app finishes writing. Preserve all
        // res.end call signatures. The `!ended` guard avoids creating a span
        // after the response already closed (e.g. client aborted before end).
        const originalEnd = res.end
        res.end = function (...args) {
            if (!span && !ended) {
                span = tracer.startSpan(name, undefined, parentContext)
            }
            return originalEnd.apply(this, args)
        }

        res.once("finish", () => finalize("finish"))
        res.once("close", () => finalize("close"))

        next()
    }
}

export default { init, withObservability, withSyncObservability, responseFlushMiddleware }
