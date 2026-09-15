// Stub for packages referenced by the compiled Catalyst bundle but never installed
// (OpenTelemetry / gRPC). Those code paths are guarded by `process.env.OTEL_ENABLE`
// and never execute on the Worker (OTEL_ENABLE is never set in the Worker's vars),
// but catalyst-core/dist/otel.js still statically imports named exports from every
// @opentelemetry/* package it supports at the top of the file, so esbuild needs each
// name to exist on whichever package this stub is aliased to, even though none of
// them ever run. One generic no-op stands in for all of them.
function noop() {}
class Noop {
    constructor() {}
}

export const metrics = {}
export const trace = {}
export const context = { active: noop, with: noop }
export const createContextKey = noop
export const NodeSDK = Noop
export const resourceFromAttributes = noop
export const BatchSpanProcessor = Noop
export const PeriodicExportingMetricReader = Noop
export const OTLPTraceExporter = Noop
export const OTLPMetricExporter = Noop
export const getNodeAutoInstrumentations = noop
export const TraceIdRatioBasedSampler = Noop
export const ParentBasedSampler = Noop

export default {}
