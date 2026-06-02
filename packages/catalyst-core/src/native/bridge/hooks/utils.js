/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */

export const noop = () => {}

export const createSSRUnavailable = (methodName) => async () => {
    throw new Error(`${methodName} is not available in SSR environment`)
}

export const parseNativePayload = (payload) => {
    if (payload == null) return null
    if (typeof payload !== "string") return payload
    try {
        return JSON.parse(payload)
    } catch (_) {
        return null
    }
}

export const registerNativeHandlers = (handlers) => {
    if (typeof window === "undefined" || !window.WebBridge?.register) return () => {}
    handlers.forEach(([event, handler]) => window.WebBridge.register(event, handler))
    return () => {
        if (typeof window === "undefined" || !window.WebBridge?.unregister) return
        handlers.forEach(([event]) => window.WebBridge.unregister(event))
    }
}
