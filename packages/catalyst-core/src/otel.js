// OpenTelemetry is an OPT-IN feature. Nothing from "@opentelemetry/*" is
// imported at module-eval time on purpose: the packages are declared as
// (optional) peerDependencies and may not be installed in the consuming app.
//
// All OTel packages are loaded lazily via dynamic import() inside init(), and
// only when OTEL_ENABLE === "true". Consequences:
//   - Apps that keep OTEL disabled don't need the packages installed.
//   - Bundlers don't pull the packages into the static import graph, so
//     `import "catalyst-core/otel"` no longer forces them to resolve
//     "@opentelemetry/exporter-trace-otlp-http" & friends at build time.
//     (Pair this with marking "@opentelemetry/*" external in the bundler so the
//     dynamic import() chunk isn't resolved at build time either — see the SSR
//     webpack configs under src/webpack.)

// Set once by init() (when enabled) to the loaded "@opentelemetry/api" module.
// The wrappers below read it lazily so they never need a static OTel import.
let _otelApi = null

const isOtelEnabled = () => process.env.OTEL_ENABLE === "true"

async function init(config = {}) {
    if (!isOtelEnabled()) {
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
        // Lazy-load every OpenTelemetry package. These dynamic imports run only
        // when OTEL_ENABLE=true, so the packages are required at runtime solely
        // for opted-in deployments.
        const [
            otelApi,
            { NodeSDK },
            { resourceFromAttributes },
            { BatchSpanProcessor, TraceIdRatioBasedSampler, ParentBasedSampler },
            { PeriodicExportingMetricReader },
            { OTLPTraceExporter },
            { OTLPMetricExporter },
            { getNodeAutoInstrumentations },
            { OTLPTraceExporter: OTLPTraceExporterHTTP },
            { OTLPMetricExporter: OTLPMetricExporterHTTP },
            { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT },
        ] = await Promise.all([
            import("@opentelemetry/api"),
            import("@opentelemetry/sdk-node"),
            import("@opentelemetry/resources"),
            import("@opentelemetry/sdk-trace-node"),
            import("@opentelemetry/sdk-metrics"),
            import("@opentelemetry/exporter-trace-otlp-grpc"),
            import("@opentelemetry/exporter-metrics-otlp-grpc"),
            import("@opentelemetry/auto-instrumentations-node"),
            import("@opentelemetry/exporter-trace-otlp-http"),
            import("@opentelemetry/exporter-metrics-otlp-http"),
            import("@opentelemetry/semantic-conventions"),
        ])

        // Enables the withObservability / withSyncObservability wrappers.
        _otelApi = otelApi

        const traceExporters = { OTLPTraceExporter, OTLPTraceExporterHTTP }
        const metricExporters = { OTLPMetricExporter, OTLPMetricExporterHTTP }

        const otlpTraceExporter = createTraceExporter(
            traceExporters,
            traceProtocol,
            traceUrl,
            traceHeaders,
            grpcCredentials
        )

        // Create metric exporter only if metricProtocol is specified
        let metricReader = null
        if (metricProtocol) {
            const otlpMetricExporter = createMetricExporter(
                metricExporters,
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
            meter = initializeCustomMetrics(otelApi, serviceName, serviceVersion)
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
 * @param {object} exporters - Lazily-loaded exporter constructors { OTLPTraceExporter, OTLPTraceExporterHTTP }
 * @param {string} protocol - "grpc" or "http"
 * @param {string} url - Exporter endpoint URL
 * @param {object} headers - Headers to include in requests
 * @param {Function} [grpcCredentials] - gRPC Credentials (optional)
 * @returns {object} Configured trace exporter
 */
function createTraceExporter(exporters, protocol, url, headers = {}, grpcCredentials) {
    const { OTLPTraceExporter, OTLPTraceExporterHTTP } = exporters
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
 * @param {object} exporters - Lazily-loaded exporter constructors { OTLPMetricExporter, OTLPMetricExporterHTTP }
 * @param {string} protocol - "grpc" or "http"
 * @param {string} url - Exporter endpoint URL
 * @param {object} headers - Headers to include in requests
 * @param {Function} [grpcCredentials] - gRPC Credentials (optional)
 * @returns {object} Configured metric exporter
 */
function createMetricExporter(exporters, protocol, url, headers = {}, grpcCredentials) {
    const { OTLPMetricExporter, OTLPMetricExporterHTTP } = exporters
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

/**
 * @param {object} otelApi - The loaded "@opentelemetry/api" module
 */
function initializeCustomMetrics(otelApi, serviceName, serviceVersion) {
    let customMetrics = {}
    const meter = otelApi.metrics.getMeter(serviceName, serviceVersion)

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
 * When OTEL is disabled the original function is returned unchanged, so there is
 * zero overhead and no dependency on any @opentelemetry/* package.
 *
 * @param {string} serviceName - The name of the service
 * @param {Function} fn - The synchronous function to wrap
 * @param {string} name - Span name (optional)
 * @returns {Function} Wrapped function (still synchronous)
 */
export function withSyncObservability(serviceName, fn, name) {
    if (!isOtelEnabled()) return fn

    const spanName = name || fn.name || "anonymousFunction"

    return function (...args) {
        // init() may not have populated the API yet — run untraced rather than throw.
        const api = _otelApi
        if (!api) return fn(...args)

        const tracer = api.trace.getTracer(serviceName)
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
 * When OTEL is disabled the original function is returned unchanged, so there is
 * zero overhead and no dependency on any @opentelemetry/* package.
 *
 * @param {string} serviceName - The name of the service
 * @param {Function} fn - The function to wrap
 * @param {string} name - Span name (optional)
 * @returns {Function} Wrapped function
 */
export function withObservability(serviceName, fn, name) {
    if (!isOtelEnabled()) return fn

    const spanName = name || fn.name || "anonymousFunction"

    return async function (...args) {
        // init() may not have populated the API yet — run untraced rather than throw.
        const api = _otelApi
        if (!api) return fn(...args)

        const tracer = api.trace.getTracer(serviceName)
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

export default { init, withObservability, withSyncObservability }
