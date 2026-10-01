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
import { trace, context, createContextKey } from "@opentelemetry/api"

export const IS_BOT_KEY = createContextKey("catalyst.is_bot")

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
        const isBot = context.active().getValue(IS_BOT_KEY)
        return tracer.startActiveSpan(spanName, (span) => {
            if (isBot !== undefined) span.setAttribute("http.response.is_bot", isBot)
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
        const isBot = context.active().getValue(IS_BOT_KEY)
        return tracer.startActiveSpan(spanName, async (span) => {
            if (isBot !== undefined) span.setAttribute("http.response.is_bot", isBot)
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
 * Express middleware that emits two spans describing what happens to the
 * response body AFTER the app calls res.end() — the work that lives past the
 * `handler` span and makes the HTTP server span run longer:
 *
 *   • response.compress — gzip/brotli of the body. Starts when the app calls
 *     res.end() (which returns immediately, since compression is async) and
 *     ends when the compressed bytes are handed to the real socket end.
 *   • response.flush — network egress. Starts when those bytes hit the socket
 *     and ends on 'finish' (all bytes handed to the OS) or 'close' (connection
 *     torn down first).
 *
 * Implementation: the gap is bounded by the *app's* res.end() call (outer) and
 * the *real* socket end after compression (inner), so the middleware wraps
 * res.end on BOTH sides of the compression middleware. It installs an inner
 * hook before next() (which compression then wraps) to time the END of
 * compression, and after next() — once compression has synchronously patched
 * res.end — installs an outer hook on top to time the START.
 *
 * MOUNT THIS IMMEDIATELY BEFORE compression() so the post-next() outer hook
 * reliably wraps compression's patch (no async middleware in between). If
 * compression isn't present (or skips the response) only response.flush is
 * emitted. Uses startSpan (not startActiveSpan), so the spans are siblings of
 * `handler` under the same request span. No span is emitted if the app never
 * writes (e.g. the client aborts first).
 *
 * @param {string} serviceName
 * @param {string} [flushName] - egress span name
 * @param {string} [compressName] - compression span name
 * @returns {Function} Express middleware
 */
export function responseFlushMiddleware(
    serviceName,
    flushName = "response.flush",
    compressName = "response.compress"
) {
    const tracer = trace.getTracer(serviceName)

    return function (req, res, next) {
        // Captured while the request span is active; both spans parent to it.
        const parentContext = context.active()

        let compressSpan = null
        let flushSpan = null
        let finished = false

        const finalize = (endEvent) => {
            if (finished) return
            finished = true
            // Whichever span is still open when the response ends gets tagged.
            const open = flushSpan || compressSpan
            if (open) {
                open.setAttribute("http.response.end_event", endEvent) // "finish" | "close"
                open.end()
            }
            compressSpan = null
            flushSpan = null
        }

        // Inner hook: wraps the real res.end (installed before compression), so
        // it fires once compression has produced the final bytes → close the
        // compression span and open the egress span.
        const realEnd = res.end
        const innerEnd = function (...args) {
            if (!finished && !flushSpan) {
                if (compressSpan) {
                    compressSpan.end()
                    compressSpan = null
                }
                flushSpan = tracer.startSpan(
                    flushName,
                    { attributes: { "http.response.is_bot": res.locals.is_bot } },
                    parentContext
                )
            }
            return realEnd.apply(this, args)
        }
        res.end = innerEnd

        res.once("finish", () => finalize("finish"))
        res.once("close", () => finalize("close"))

        next()

        // After next(): compression has synchronously wrapped innerEnd. Install
        // an outer hook on top to catch the app's res.end() call → open the
        // compression span. Skipped if nothing wrapped innerEnd (no compression),
        // in which case innerEnd alone times the flush from the app's res.end().
        if (res.end !== innerEnd) {
            const chainEnd = res.end
            res.end = function (...args) {
                if (!finished && !compressSpan && !flushSpan) {
                    compressSpan = tracer.startSpan(
                        compressName,
                        { attributes: { "http.response.is_bot": res.locals.is_bot } },
                        parentContext
                    )
                }
                return chainEnd.apply(this, args)
            }
        }
    }
}

export default { init, withObservability, withSyncObservability, responseFlushMiddleware }
