import { metrics } from "@opentelemetry/api"
import { NodeSDK } from "@opentelemetry/sdk-node"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node"
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"

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
        traceUrl = "http://localhost:4318/v1/traces",
        metricUrl = "http://localhost:4318/v1/metrics",
        traceHeaders = {},
        metricHeaders = {},
        exportIntervalMillis = 10000,
        exportTimeoutMillis = 10000,
    } = config

    try {
        const otlpTraceExporter = new OTLPTraceExporter({
            url: traceUrl,
            headers: traceHeaders,
        })

        const otlpMetricExporter = new OTLPMetricExporter({
            url: metricUrl,
            headers: metricHeaders,
        })

        const sdk = new NodeSDK({
            resource: resourceFromAttributes({
                [ATTR_SERVICE_NAME]: serviceName,
                [ATTR_SERVICE_VERSION]: serviceVersion,
                [ATTR_DEPLOYMENT_ENVIRONMENT]: environment,
            }),
            spanProcessor: new BatchSpanProcessor(otlpTraceExporter, {
                exportTimeoutMillis,
                scheduledDelayMillis: exportIntervalMillis,
                maxQueueSize: 100,
                maxExportBatchSize: 10,
            }),
            metricReader: new PeriodicExportingMetricReader({
                exporter: otlpMetricExporter,
                exportIntervalMillis,
            }),
            instrumentations: [getNodeAutoInstrumentations()],
        })

        sdk.start()
        console.log("✅ OpenTelemetry started successfully")
        console.log("🔍 Service configuration:", {
            serviceName,
            serviceVersion,
            environment,
            exportIntervalMillis,
            exportTimeoutMillis,
            traceUrl,
            metricUrl,
        })

        initializeCustomMetrics(serviceName, serviceVersion)

        const gracefulShutdown = (signal) => {
            console.log(`📡 Received ${signal}, shutting down OpenTelemetry gracefully...`)
            sdk.shutdown()
                .then(() => console.log("✅ OpenTelemetry shutdown completed"))
                .catch((error) => {
                    console.error("❌ Error terminating OpenTelemetry:", error)
                })
                .finally(() => process.exit())
        }

        process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
        process.on("SIGINT", () => gracefulShutdown("SIGINT"))

        return { sdk }
    } catch (error) {
        console.error("❌ Failed to initialize OpenTelemetry:", error)
        throw error
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

    console.log("✅ Custom metrics initialized")
}

export default { init }
