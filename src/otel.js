import { NodeSDK } from "@opentelemetry/sdk-node"
import { resourceFromAttributes } from "@opentelemetry/resources"
import {
    metrics,
    trace,
    TraceFlags,
    SpanStatusCode,
    context,
    createContextKey,
    isSpanContextValid,
} from "@opentelemetry/api"
import {
    BatchSpanProcessor,
    TraceIdRatioBasedSampler,
    ParentBasedSampler,
    SamplingDecision,
} from "@opentelemetry/sdk-trace-node"
import { setGlobalErrorHandler } from "@opentelemetry/core"
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import { OTLPTraceExporter as OTLPTraceExporterHTTP } from "@opentelemetry/exporter-trace-otlp-http"
import { OTLPMetricExporter as OTLPMetricExporterHTTP } from "@opentelemetry/exporter-metrics-otlp-http"
import fs from "fs"
import os from "os"

export const IS_BOT_KEY = createContextKey("catalyst.is_bot")

import semanticConventions from "@opentelemetry/semantic-conventions"
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT } = semanticConventions

const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(1)

function getLogger() {
    const l =
        (typeof logger !== "undefined" && logger) ||
        (typeof global !== "undefined" && global.logger) ||
        console
    return {
        info: (msg, ...meta) => (l.info ? l.info(msg, ...meta) : console.log(msg, ...meta)),
        warn: (msg, ...meta) =>
            l.warn ? l.warn(msg, ...meta) : l.info ? l.info(msg, ...meta) : console.warn(msg, ...meta),
        error: (msg, ...meta) => (l.error ? l.error(msg, ...meta) : console.error(msg, ...meta)),
        debug: (msg, ...meta) => (l.debug ? l.debug(msg, ...meta) : console.debug(msg, ...meta)),
    }
}

// undefined if the file is absent, or (for a limit) unbounded.
function readCgroupBytesFile(path) {
    try {
        const raw = fs.readFileSync(path, "utf8").trim()
        const bytes = raw === "max" ? NaN : Number(raw)
        return Number.isFinite(bytes) && bytes > 0 && bytes < Number.MAX_SAFE_INTEGER ? bytes : undefined
    } catch {
        return undefined
    }
}

// os.totalmem() reports the node's memory, not the pod's limit — read the
// cgroup directly instead. Cached: fixed for the process's lifetime.
let memoryLimitBytes
function getMemoryLimitBytes() {
    return (memoryLimitBytes ??=
        readCgroupBytesFile("/sys/fs/cgroup/memory.max") ??
        readCgroupBytesFile("/sys/fs/cgroup/memory/memory.limit_in_bytes") ??
        os.totalmem())
}

// Whole-cgroup usage, not just this process's RSS — differs if anything else
// shares the container. Changes constantly, so never cached (unlike the limit).
function getCgroupCurrentBytes() {
    return (
        readCgroupBytesFile("/sys/fs/cgroup/memory.current") ??
        readCgroupBytesFile("/sys/fs/cgroup/memory/memory.usage_in_bytes")
    )
}

// 85% of the memory limit — leaves headroom before an OOM kill.
function highMemoryRssMB() {
    return Math.round((getMemoryLimitBytes() * 0.85) / 1024 / 1024)
}

// 0.4 = 50% of the limit as heap budget (common container guidance) × 80% warning point.
function highMemoryHeapUsedMB() {
    return Math.round((getMemoryLimitBytes() * 0.4) / 1024 / 1024)
}

let lastHighMemoryAlertTime = 0
function checkHighMemoryAlert(mem = process.memoryUsage(), contextStr = "", thresholds = {}) {
    // Overrides are mainly for testing (e.g. forcing a low staging threshold).
    // Validated so a bad value falls back instead of misfiring every check.
    const isValidThreshold = (v) => typeof v === "number" && v > 0
    const rssLimitMB = isValidThreshold(thresholds.rssMB) ? thresholds.rssMB : highMemoryRssMB()
    const heapLimitMB = isValidThreshold(thresholds.heapUsedMB) ? thresholds.heapUsedMB : highMemoryHeapUsedMB()

    const now = Date.now()
    // Throttle alert to at most once per 60 seconds
    if (now - lastHighMemoryAlertTime < 60000) return

    const rssMB = mem.rss / 1024 / 1024
    const heapUsedMB = mem.heapUsed / 1024 / 1024

    if (rssMB > rssLimitMB || heapUsedMB > heapLimitMB) {
        lastHighMemoryAlertTime = now
        const ratio = (mem.rss / (mem.heapUsed || 1)).toFixed(2)
        getLogger().warn(
            `⚠️ [OTEL High Memory Warning] RSS=${formatMB(mem.rss)}MB, HeapUsed=${formatMB(mem.heapUsed)}MB, HeapTotal=${formatMB(mem.heapTotal)}MB, External=${formatMB(mem.external)}MB (RSS/Heap ratio: ${ratio}) ${contextStr ? `| Context: ${contextStr}` : ""}`
        )
    }
}

// Bit-range sampling decision helper
function getDecisionForBits(traceId, start, end, rate) {
    if (rate >= 1.0) return true
    if (rate <= 0.0) return false
    if (!traceId || traceId.length < end) return false
    const hexPart = traceId.substring(start, end)
    const value = parseInt(hexPart, 16)
    const maxValue = Math.pow(16, end - start) - 1
    return value / maxValue < rate
}

// Custom Status Aware Sampler
class StatusAwareSampler {
    constructor(samplingRate) {
        this.samplingRate = samplingRate
    }

    shouldSample(context, traceId) {
        const parentSpanContext = trace.getSpanContext(context)

        if (parentSpanContext && isSpanContextValid(parentSpanContext)) {
            if (parentSpanContext.traceFlags & TraceFlags.SAMPLED) {
                return { decision: SamplingDecision.RECORD_AND_SAMPLED }
            } else {
                return { decision: SamplingDecision.RECORD }
            }
        }

        // Head sampling using characters 0-12
        const isHeadSampled = getDecisionForBits(traceId, 0, 12, this.samplingRate)
        if (isHeadSampled) {
            return { decision: SamplingDecision.RECORD_AND_SAMPLED }
        } else {
            return { decision: SamplingDecision.RECORD }
        }
    }

    toString() {
        return `StatusAwareSampler{samplingRate=${this.samplingRate}}`
    }
}

// Custom Span Processor for Status Aware Error Sampling
class PromotingSpanProcessor {
    constructor(exporter, config) {
        this.exporter = exporter
        this.config = config
        this.buffer = new Map()
        this.promotedTraces = new Map()

        // Delegating BatchSpanProcessor for head-sampled spans
        this.batchProcessor = new BatchSpanProcessor(exporter, config.batchProcessorConfig)

        this.cleanupInterval = setInterval(() => {
            this._cleanupBuffers()
        }, 30000)

        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref()
        }
    }

    onStart(span, parentContext) {
        const isSampled = (span.spanContext().traceFlags & TraceFlags.SAMPLED) !== 0
        if (isSampled) {
            this.batchProcessor.onStart(span, parentContext)
        }
    }

    onEnd(span) {
        const traceId = span.spanContext().traceId
        const isSampled = (span.spanContext().traceFlags & TraceFlags.SAMPLED) !== 0

        if (this.promotedTraces.has(traceId)) {
            const promotionRate = this.promotedTraces.get(traceId).promotionRate
            this._exportSpanImmediately(span, promotionRate)
            return
        }

        if (isSampled) {
            this.batchProcessor.onEnd(span)
            return
        }

        // Buffer the RECORD_ONLY span
        let record = this.buffer.get(traceId)
        if (!record) {
            record = {
                spans: [],
                rootSpan: null,
                hasChildError: false,
                timestamp: Date.now(),
            }
            this.buffer.set(traceId, record)
        }

        const isRoot = !span.parentSpanId
        if (isRoot) {
            record.rootSpan = span
        } else {
            record.spans.push(span)
        }

        if (!isRoot && span.status && span.status.code === SpanStatusCode.ERROR) {
            record.hasChildError = true
        }

        if (isRoot) {
            this._evaluateAndProcessPromotion(traceId, record)
        }
    }

    _evaluateAndProcessPromotion(traceId, record) {
        const rootSpan = record.rootSpan
        if (!rootSpan) return

        const isBot = rootSpan.attributes["http.response.is_bot"] === true
        if (isBot && !this.config.promoteBotTraffic) {
            this.buffer.delete(traceId)
            return
        }

        const statusCode = Number(
            rootSpan.attributes["http.status_code"] || rootSpan.attributes["http.response.status_code"] || 0
        )

        const is5xx = statusCode >= 500 && statusCode < 600
        const is4xx = statusCode >= 400 && statusCode < 500
        const isRootError = rootSpan.status && rootSpan.status.code === SpanStatusCode.ERROR && !is4xx
        const isSkipped = this.config.skipPromotionCodes.includes(statusCode)

        let shouldPromote = false
        let promotionRate = this.config.samplingRate

        if ((is5xx || isRootError) && !isSkipped) {
            shouldPromote = getDecisionForBits(traceId, 12, 24, this.config.rate5xx)
            promotionRate = this.config.rate5xx
        } else if (is4xx && !isSkipped) {
            shouldPromote = getDecisionForBits(traceId, 12, 24, this.config.rate4xx)
            promotionRate = this.config.rate4xx
        } else if (
            this.config.promoteHandledErrors &&
            record.hasChildError &&
            statusCode >= 200 &&
            statusCode < 300 &&
            !isSkipped
        ) {
            shouldPromote = getDecisionForBits(traceId, 12, 24, this.config.rate5xx)
            promotionRate = this.config.rate5xx
        }

        if (shouldPromote) {
            this.promotedTraces.set(traceId, {
                timestamp: Date.now(),
                promotionRate,
            })

            let spansToExport = []
            if (this.config.exportFullTraceOnError) {
                spansToExport = [rootSpan, ...record.spans]
            } else {
                spansToExport = [rootSpan]
                for (const s of record.spans) {
                    if (s.status && s.status.code === SpanStatusCode.ERROR) {
                        spansToExport.push(s)
                    }
                }
            }

            const finalSampleRate = this.config.reportActualPromotionRate
                ? promotionRate
                : this.config.samplingRate
            for (const s of spansToExport) {
                // Required: batchProcessor.onEnd() drops spans without SAMPLED.
                s.spanContext().traceFlags |= TraceFlags.SAMPLED
                s.attributes["promoted"] = true
                s.attributes["sample_rate"] = finalSampleRate
            }

            this._export(spansToExport)
        }

        this.buffer.delete(traceId)
    }

    _exportSpanImmediately(span, promotionRate) {
        const finalSampleRate = this.config.reportActualPromotionRate
            ? promotionRate
            : this.config.samplingRate
        // Required: batchProcessor.onEnd() drops spans without SAMPLED.
        span.spanContext().traceFlags |= TraceFlags.SAMPLED
        span.attributes["promoted"] = true
        span.attributes["sample_rate"] = finalSampleRate

        this._export([span])
    }

    // Routes promoted spans through the same BatchSpanProcessor as normal
    // traffic, for its queueing/backpressure. Trade-off: they export on the
    // next batch flush, not instantly. Skipping onStart() is safe — it's a no-op.
    _export(spans) {
        for (const s of spans) {
            this.batchProcessor.onEnd(s)
        }
    }

    _cleanupBuffers() {
        const now = Date.now()
        // Trade-off: short TTL bounds memory but drops buffered child spans (and
        // hasChildError) for traces whose root outlives it — clock starts at the
        // first span seen for that trace, not request start. The root itself is
        // still evaluated fresh when it ends, so a late error can still promote,
        // just without children. Revisit if this proves too aggressive.
        const BUFFER_TTL = 60 * 1000 // 60 seconds TTL for unresolved buffer
        const PROMOTED_TTL = 60 * 1000 // 60 seconds TTL for promoted trace cache
        const mem = process.memoryUsage()

        let expiredBuffer = 0
        for (const [traceId, record] of this.buffer.entries()) {
            if (now - record.timestamp > BUFFER_TTL) {
                this.buffer.delete(traceId)
                expiredBuffer++
            } else {
                break
            }
        }

        if (expiredBuffer > 0) {
            getLogger().info(
                `🧹 [OTEL Cleanup] PromotingSpanProcessor: evicted ${expiredBuffer} expired unresolved trace(s) from buffer (remaining size=${this.buffer.size})`
            )
        }

        let bufferOverflowEvicted = 0
        if (this.buffer.size > 1024) {
            const toDelete = this.buffer.size - 1024
            for (const traceId of this.buffer.keys()) {
                this.buffer.delete(traceId)
                bufferOverflowEvicted++
                if (bufferOverflowEvicted >= toDelete) break
            }
            // Buffer filling faster than roots resolve — traces dropped pre-promotion.
            getLogger().warn(
                `⚠️ [OTEL Buffer Overflow] PromotingSpanProcessor: buffer overflow, dropped ${bufferOverflowEvicted} unresolved trace(s) (buffer size=${this.buffer.size}, rss=${formatMB(mem.rss)}MB, heapUsed=${formatMB(mem.heapUsed)}MB)`
            )
        }

        let expiredPromoted = 0
        for (const [traceId, data] of this.promotedTraces.entries()) {
            if (now - data.timestamp > PROMOTED_TTL) {
                this.promotedTraces.delete(traceId)
                expiredPromoted++
            } else {
                break
            }
        }

        if (expiredPromoted > 0) {
            getLogger().info(
                `🧹 [OTEL Cleanup] PromotingSpanProcessor: evicted ${expiredPromoted} expired trace(s) from promotedTraces (remaining size=${this.promotedTraces.size})`
            )
        }

        let promotedOverflowEvicted = 0
        if (this.promotedTraces.size > 1024) {
            const toDelete = this.promotedTraces.size - 1024
            for (const traceId of this.promotedTraces.keys()) {
                this.promotedTraces.delete(traceId)
                promotedOverflowEvicted++
                if (promotedOverflowEvicted >= toDelete) break
            }
            getLogger().warn(
                `⚠️ [OTEL Buffer Overflow] PromotingSpanProcessor: promotedTraces overflow, dropped ${promotedOverflowEvicted} cache entry(s) (promotedTraces size=${this.promotedTraces.size}, rss=${formatMB(mem.rss)}MB, heapUsed=${formatMB(mem.heapUsed)}MB)`
            )
        }
    }

    forceFlush() {
        return this.batchProcessor.forceFlush()
    }

    shutdown() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval)
        }
        const mem = process.memoryUsage()
        getLogger().info(
            `📡 [OTEL Shutdown] PromotingSpanProcessor: shutting down, discarding ${this.buffer.size} unresolved trace(s) and ${this.promotedTraces.size} promoted-trace record(s) | Memory at exit: RSS=${formatMB(mem.rss)}MB, HeapUsed=${formatMB(mem.heapUsed)}MB`
        )
        this.buffer.clear()
        this.promotedTraces.clear()
        return this.batchProcessor.shutdown()
    }
}

/**
 * Initializes the OpenTelemetry Node SDK — traces, optional metrics, and (when
 * errorSampling.ENABLED is set) status-aware error sampling. No-op unless
 * OTEL_ENABLE is set (see server/expressServer.js and server/renderer/handler.jsx
 * for the same guard on the call sites that import this module).
 *
 * @param {object} [config]
 * @param {string} [config.serviceName="catalyst-server"]
 * @param {string} [config.serviceVersion="1.0.0"]
 * @param {string} [config.environment="development"]
 * @param {string} [config.traceUrl="http://localhost:4317"] - OTLP trace collector endpoint
 * @param {string} [config.metricUrl="http://localhost:4317"] - OTLP metric collector endpoint
 * @param {string} [config.traceProtocol="grpc"] - "grpc" or "http"
 * @param {string} [config.metricProtocol] - "grpc" or "http"; metrics stay disabled if omitted
 * @param {object} [config.traceHeaders]
 * @param {object} [config.metricHeaders]
 * @param {object} [config.batchProcessorConfig] - passed to BatchSpanProcessor (maxQueueSize, scheduledDelayMillis, ...)
 * @param {number} [config.exportIntervalMillis=10000]
 * @param {number} [config.diagnosticsIntervalMillis=60000] - memory heartbeat interval, ms; requires errorSampling.ENABLED
 * @param {boolean} [config.enableMemoryDiagnostics=true] - memory heartbeat + high-memory warnings; requires errorSampling.ENABLED
 * @param {number} [config.highMemoryRssMB] - overrides the auto-detected RSS warning threshold; for testing; requires errorSampling.ENABLED
 * @param {number} [config.highMemoryHeapUsedMB] - overrides the auto-detected heapUsed warning threshold; for testing; requires errorSampling.ENABLED
 * @param {Array} [config.instrumentations] - defaults to getNodeAutoInstrumentations()
 * @param {number} [config.samplingRate=1.0] - head-sampling rate in [0, 1] for non-error traffic
 * @param {Function} [config.grpcCredentials]
 * @param {object} [config.errorSampling] - status-aware error sampling, off by default
 * @param {boolean} [config.errorSampling.ENABLED=false] - turns on StatusAwareSampler + PromotingSpanProcessor
 * @param {number} [config.errorSampling.RATE_5XX=1.0] - promotion rate for 5xx roots (and non-4xx roots with OTEL ERROR status)
 * @param {number} [config.errorSampling.RATE_4XX=samplingRate] - promotion rate for 4xx roots
 * @param {boolean} [config.errorSampling.EXPORT_FULL_TRACE_ON_ERROR=false] - export every buffered span on promotion, not just root + error spans
 * @param {boolean} [config.errorSampling.PROMOTE_HANDLED_ERRORS=false] - promote 2xx roots (at RATE_5XX) if any child span recorded an error
 * @param {boolean} [config.errorSampling.REPORT_ACTUAL_PROMOTION_RATE=false] - report the real promotion rate in the exported sample_rate attribute instead of samplingRate
 * @param {number[]} [config.errorSampling.SKIP_PROMOTION_CODES=[408,504,524,598,599]] - status codes excluded from promotion regardless of 4xx/5xx
 * @param {boolean} [config.errorSampling.PROMOTE_BOT_TRAFFIC=false] - allow bot-attributed traces (http.response.is_bot) to be promoted
 * @returns {{sdk: NodeSDK|null, meter: object|null}}
 */
function init(config = {}) {
    // Opt-in — mirrors the same OTEL_ENABLE guard in expressServer.js and
    // handler.jsx. Returns the same shape either way so callers can destructure.
    if (process.env.OTEL_ENABLE !== true && process.env.OTEL_ENABLE !== "true") {
        return { sdk: null, meter: null }
    }

    // Routes export failures to the app logger instead of OTEL's silent default.
    setGlobalErrorHandler((err) => getLogger().error("❌ OpenTelemetry export error:", err))

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
        diagnosticsIntervalMillis = 60000,
        enableMemoryDiagnostics = true,
        highMemoryRssMB,
        highMemoryHeapUsedMB,
        instrumentations,
        samplingRate = 1.0,
        grpcCredentials,
        errorSampling = {},
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

        let sampler
        let spanProcessor

        const isErrorSamplingEnabled = errorSampling && errorSampling.ENABLED === true

        if (isErrorSamplingEnabled) {
            getLogger().info("⚙️ OpenTelemetry initializing with Status Aware Error Sampling")
            sampler = new StatusAwareSampler(samplingRate)

            const errorSamplingConfig = {
                samplingRate,
                rate5xx: typeof errorSampling.RATE_5XX === "number" ? errorSampling.RATE_5XX : 1.0,
                rate4xx: typeof errorSampling.RATE_4XX === "number" ? errorSampling.RATE_4XX : samplingRate,
                exportFullTraceOnError: errorSampling.EXPORT_FULL_TRACE_ON_ERROR === true,
                promoteHandledErrors: errorSampling.PROMOTE_HANDLED_ERRORS === true,
                reportActualPromotionRate: errorSampling.REPORT_ACTUAL_PROMOTION_RATE === true,
                skipPromotionCodes: Array.isArray(errorSampling.SKIP_PROMOTION_CODES)
                    ? errorSampling.SKIP_PROMOTION_CODES
                    : [408, 504, 524, 598, 599],
                promoteBotTraffic: errorSampling.PROMOTE_BOT_TRAFFIC === true,
                batchProcessorConfig,
            }

            spanProcessor = new PromotingSpanProcessor(otlpTraceExporter, errorSamplingConfig)
        } else {
            sampler = new ParentBasedSampler({
                root: new TraceIdRatioBasedSampler(samplingRate),
            })
            spanProcessor = new BatchSpanProcessor(otlpTraceExporter, batchProcessorConfig)
        }

        const sdkConfig = {
            resource: resourceFromAttributes({
                [ATTR_SERVICE_NAME]: serviceName,
                [ATTR_SERVICE_VERSION]: serviceVersion,
                [ATTR_DEPLOYMENT_ENVIRONMENT]: environment,
            }),
            spanProcessor,
            instrumentations: instrumentations ?? [getNodeAutoInstrumentations()],
            sampler,
        }

        // Add metric reader only if metrics are enabled
        if (metricReader) {
            sdkConfig.metricReader = metricReader
        }

        const sdk = new NodeSDK(sdkConfig)

        sdk.start()
        getLogger().info("✅ OpenTelemetry started successfully")

        // Only under status-aware sampling: that's the only path with unbounded
        // buffer growth to watch. Plain BatchSpanProcessor's queue is already bounded.
        let heartbeatInterval = null
        if (isErrorSamplingEnabled && enableMemoryDiagnostics) {
            const memoryThresholds = { rssMB: highMemoryRssMB, heapUsedMB: highMemoryHeapUsedMB }
            heartbeatInterval = setInterval(() => {
                const mem = process.memoryUsage()
                const ratio = (mem.rss / (mem.heapUsed || 1)).toFixed(2)
                const bufferInfo = ` | Buffers: active=${spanProcessor.buffer.size}, promotedCache=${spanProcessor.promotedTraces.size}`
                // Not ratioed against memory.request — no cgroup file exposes it.
                const cgroupCurrentBytes = getCgroupCurrentBytes()
                const cgroupInfo =
                    cgroupCurrentBytes !== undefined ? ` | CgroupCurrent=${formatMB(cgroupCurrentBytes)}MB` : ""
                getLogger().info(
                    `📊 [OTEL Heartbeat] Memory: RSS=${formatMB(mem.rss)}MB, HeapUsed=${formatMB(mem.heapUsed)}MB, HeapTotal=${formatMB(mem.heapTotal)}MB, External=${formatMB(mem.external)}MB (RSS/Heap: ${ratio})${cgroupInfo}${bufferInfo} | Uptime: ${process.uptime().toFixed(0)}s`
                )
                checkHighMemoryAlert(mem, "heartbeat", memoryThresholds)
            }, diagnosticsIntervalMillis)

            if (heartbeatInterval.unref) {
                heartbeatInterval.unref()
            }
        }

        // Initialize custom metrics only if metrics are enabled
        let meter = null
        if (metricProtocol) {
            meter = initializeCustomMetrics(serviceName, serviceVersion)
        }

        const gracefulShutdown = (signal) => {
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval)
            }
            const mem = process.memoryUsage()
            const uptime = process.uptime().toFixed(1)
            getLogger().info(
                `📡 [OTEL Shutdown] Received ${signal}, shutting down OpenTelemetry gracefully... [Uptime: ${uptime}s, Memory at exit: RSS=${formatMB(mem.rss)}MB, HeapUsed=${formatMB(mem.heapUsed)}MB, HeapTotal=${formatMB(mem.heapTotal)}MB, External=${formatMB(mem.external)}MB]`
            )
            sdk.shutdown()
                .then(() => getLogger().info("✅ OpenTelemetry shutdown completed"))
                .catch((error) => {
                    getLogger().error("❌ Error terminating OpenTelemetry:", error)
                })
                .finally(() => process.exit())
        }

        process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
        process.on("SIGINT", () => gracefulShutdown("SIGINT"))

        return { sdk, meter }
    } catch (error) {
        getLogger().error("❌ Failed to initialize OpenTelemetry:", error)
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
        getLogger().info(`📡 Creating HTTP trace exporter for URL: ${url}`)
        return new OTLPTraceExporterHTTP({
            url: url,
            headers: headers,
        })
    } else if (protocol.toLowerCase() === "grpc") {
        getLogger().info(`📡 Creating gRPC trace exporter for URL: ${url}`)
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
        getLogger().info(`📊 Creating HTTP metric exporter for URL: ${url}`)
        return new OTLPMetricExporterHTTP({
            url: url,
            headers: headers,
        })
    } else if (protocol.toLowerCase() === "grpc") {
        getLogger().info(`📊 Creating gRPC metric exporter for URL: ${url}`)
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
