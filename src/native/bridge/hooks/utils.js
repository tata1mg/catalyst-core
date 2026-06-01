/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */

export const noop = () => {}

export const createSSRUnavailable = (methodName) => async () => {
    throw new Error(`${methodName} is not available in SSR environment`)
}

export const parseNativePayload = (payload) => {
    if (payload == null) return null
    if (typeof payload !== "string") return payload
    return JSON.parse(payload)
}

export const registerNativeHandlers = (handlers) => {
    handlers.forEach(([event, handler]) => window.WebBridge.register(event, handler))
    return () => {
        handlers.forEach(([event]) => window.WebBridge.unregister(event))
    }
}
