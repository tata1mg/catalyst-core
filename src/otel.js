import { trace } from "@opentelemetry/api"

/**
 * Wrap a synchronous function with an OTel span.
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
 * Wrap an async function with an OTel span.
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
