import { metrics } from "@opentelemetry/api"
import { performance } from "perf_hooks"
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
import { trace } from "@opentelemetry/api"

import {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
    ATTR_DEPLOYMENT_ENVIRONMENT,
} from "@opentelemetry/semantic-conventions"

function init(config = {}) {
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
            otlpMetricExporter = createMetricExporter(metricProtocol, metricUrl, metricHeaders, grpcCredentials)
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

// function initializeCustomMetrics(serviceName, serviceVersion) {
//     let customMetrics = {}
//     const meter = metrics.getMeter(serviceName, serviceVersion)

//     // CPU usage gauge
//     customMetrics.cpuUsage = meter.createObservableGauge("process_cpu_usage_percent", {
//         description: "Current CPU usage percentage",
//     })

//     // Memory usage gauges
//     customMetrics.memoryUsage = meter.createObservableGauge("process_memory_usage_bytes", {
//         description: "Current memory usage in bytes",
//         unit: "bytes",
//     })

//     customMetrics.memoryHeapUsed = meter.createObservableGauge("process_memory_heap_used_bytes", {
//         description: "Current heap memory used in bytes",
//         unit: "bytes",
//     })

//     customMetrics.memoryHeapTotal = meter.createObservableGauge("process_memory_heap_total_bytes", {
//         description: "Current heap memory total in bytes",
//         unit: "bytes",
//     })

//     let lastCpuUsage = process.cpuUsage()
//     let lastMeasureTime = process.hrtime.bigint()

//     customMetrics.cpuUsage.addCallback((result) => {
//         const currentCpuUsage = process.cpuUsage(lastCpuUsage)
//         const currentTime = process.hrtime.bigint()
//         const timeDiff = Number(currentTime - lastMeasureTime) / 1000000 // Convert to milliseconds

//         const cpuPercent = ((currentCpuUsage.user + currentCpuUsage.system) / 1000 / timeDiff) * 100

//         result.observe(cpuPercent)

//         lastCpuUsage = process.cpuUsage()
//         lastMeasureTime = currentTime
//     })

//     customMetrics.memoryUsage.addCallback((result) => {
//         const memUsage = process.memoryUsage()
//         result.observe(memUsage.rss, { type: "rss" })
//         result.observe(memUsage.external, { type: "external" })
//         result.observe(memUsage.arrayBuffers, { type: "arrayBuffers" })
//     })

//     customMetrics.memoryHeapUsed.addCallback((result) => {
//         const memUsage = process.memoryUsage()
//         result.observe(memUsage.heapUsed)
//     })

//     customMetrics.memoryHeapTotal.addCallback((result) => {
//         const memUsage = process.memoryUsage()
//         result.observe(memUsage.heapTotal)
//     })

//     return meter
// }

function initializeCustomMetrics(serviceName, serviceVersion) {
    let customMetrics = {}
    const meter = metrics.getMeter(serviceName, serviceVersion)

    // ==================== Existing CPU Metrics ====================
    
    customMetrics.cpuUsage = meter.createObservableGauge("process_cpu_usage_percent", {
        description: "Current CPU usage percentage",
    })

    let lastCpuUsage = process.cpuUsage()
    let lastMeasureTime = process.hrtime.bigint()

    customMetrics.cpuUsage.addCallback((result) => {
        const currentCpuUsage = process.cpuUsage(lastCpuUsage)
        const currentTime = process.hrtime.bigint()
        const timeDiff = Number(currentTime - lastMeasureTime) / 1000000

        const cpuPercent = ((currentCpuUsage.user + currentCpuUsage.system) / 1000 / timeDiff) * 100

        result.observe(cpuPercent)

        lastCpuUsage = process.cpuUsage()
        lastMeasureTime = currentTime
    })

    // ==================== Existing Memory Metrics ====================
    
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

    // ==================== NEW: Event Loop Lag Metric ====================
    
    customMetrics.eventLoopLag = meter.createObservableGauge("process_event_loop_lag_ms", {
        description: "Event loop lag in milliseconds",
        unit: "ms",
    })

    let eventLoopLag = 0
    let lastCheck = performance.now()
    const checkInterval = 1000 // Check every 1 second

    const lagInterval = setInterval(() => {
        const now = performance.now()
        const lag = now - lastCheck - checkInterval
        eventLoopLag = Math.max(0, lag)
        lastCheck = now
    }, checkInterval)

    lagInterval.unref() // Don't keep process alive

    customMetrics.eventLoopLag.addCallback((result) => {
        result.observe(eventLoopLag)
    })

    // ==================== NEW: Event Loop Utilization ====================
    
    if (performance.eventLoopUtilization) {
        customMetrics.eventLoopUtilization = meter.createObservableGauge("process_event_loop_utilization", {
            description: "Event loop utilization (0-1, where 1 = 100% busy)",
        })

        let lastELU = performance.eventLoopUtilization()

        customMetrics.eventLoopUtilization.addCallback((result) => {
            const elu = performance.eventLoopUtilization(lastELU)
            result.observe(elu.utilization)
            lastELU = performance.eventLoopUtilization()
        })
    }

    // ==================== NEW: CPU Time by Process Type ====================
    
    customMetrics.cpuTimeUser = meter.createObservableGauge("process_cpu_time_user_ms", {
        description: "User CPU time in milliseconds",
        unit: "ms",
    })

    customMetrics.cpuTimeSystem = meter.createObservableGauge("process_cpu_time_system_ms", {
        description: "System CPU time in milliseconds",
        unit: "ms",
    })

    customMetrics.cpuTimeUser.addCallback((result) => {
        const cpuUsage = process.cpuUsage()
        result.observe(cpuUsage.user / 1000) // Convert to ms
    })

    customMetrics.cpuTimeSystem.addCallback((result) => {
        const cpuUsage = process.cpuUsage()
        result.observe(cpuUsage.system / 1000) // Convert to ms
    })

    // ==================== NEW: Active Handles & Requests ====================
    
    if (process._getActiveHandles && process._getActiveRequests) {
        customMetrics.activeHandles = meter.createObservableGauge("process_active_handles", {
            description: "Number of active handles",
        })

        customMetrics.activeRequests = meter.createObservableGauge("process_active_requests", {
            description: "Number of active requests",
        })

        customMetrics.activeHandles.addCallback((result) => {
            result.observe(process._getActiveHandles().length)
        })

        customMetrics.activeRequests.addCallback((result) => {
            result.observe(process._getActiveRequests().length)
        })
    }

    // ==================== NEW: GC Metrics (if available) ====================
    
    if (global.gc) {
        const { PerformanceObserver } = require('perf_hooks')
        
        customMetrics.gcDuration = meter.createHistogram("process_gc_duration_ms", {
            description: "Garbage collection pause duration",
            unit: "ms",
        })

        customMetrics.gcCount = meter.createCounter("process_gc_count", {
            description: "Number of garbage collection cycles",
        })

        try {
            const gcTypes = {
                1: 'scavenge',
                2: 'mark_sweep_compact',
                4: 'incremental_marking',
                8: 'weak_processing',
                15: 'all'
            }

            const obs = new PerformanceObserver((list) => {
                const entries = list.getEntries()
                entries.forEach((entry) => {
                    if (entry.entryType === 'gc') {
                        const gcType = gcTypes[entry.kind] || 'unknown'
                        
                        customMetrics.gcDuration.record(entry.duration, {
                            gc_type: gcType
                        })
                        
                        customMetrics.gcCount.add(1, {
                            gc_type: gcType
                        })
                    }
                })
            })
            
            obs.observe({ entryTypes: ['gc'] })
        } catch (err) {
            // GC observation not available
            console.warn('GC metrics not available:', err.message)
        }
    }

    return meter
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

export default { init, withObservability }
