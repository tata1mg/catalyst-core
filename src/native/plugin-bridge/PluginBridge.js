class PluginNativeBridge {
    constructor() {
        this.handlers = new Map()
        this.requestCount = 0
        this.isInitialized = false
    }

    createRequestId = () => {
        this.requestCount += 1
        return `plugin_${Date.now()}_${this.requestCount}`
    }

    normalizeRequestId = (requestId) => {
        if (requestId == null) {
            return null
        }
        if (typeof requestId !== "string" || !requestId.trim()) {
            throw new Error("requestId must be a non-empty string")
        }
        return requestId.trim()
    }

    normalizeCommand = (command) => {
        if (command == null) {
            return null
        }
        if (typeof command !== "string" || !command.trim()) {
            throw new Error("command must be a non-empty string when provided")
        }
        return command.trim()
    }

    ensureInitialized = () => {
        if (typeof window === "undefined" || this.isInitialized) {
            return this
        }

        window.PluginBridgeWeb = window.PluginBridgeWeb || {}
        window.PluginBridgeWeb.callback = this.dispatchCallback
        window.PluginBridgeWeb.dispatch = (message) => {
            let parsed = message

            if (typeof parsed === "string") {
                try {
                    parsed = JSON.parse(parsed)
                } catch {
                    return false
                }
            }

            if (!parsed || typeof parsed !== "object") {
                return false
            }

            const payload = Object.prototype.hasOwnProperty.call(parsed, "payload") ? parsed.payload : null

            return this.dispatchCallback(
                parsed.pluginId,
                parsed.eventName,
                payload,
                parsed.requestId ?? null,
                parsed.command ?? null
            )
        }
        this.isInitialized = true
        return this
    }

    hasAndroidBridge = () => typeof window !== "undefined" && !!window.PluginBridge

    hasIOSBridge = () => typeof window !== "undefined" && !!window.webkit?.messageHandlers?.PluginBridge

    init = () => this.ensureInitialized()

    assertInitialized = () => {
        if (!this.isInitialized) {
            throw new Error("PluginBridge.init() must be called before using emit() or register()")
        }
    }

    handlerKey = (pluginId, eventName, command = "*", requestId = "*") =>
        `${pluginId}:${eventName}:${command}:${requestId}`

    getHandlers = (pluginId, eventName, command = "*", requestId = "*") => {
        const key = this.handlerKey(pluginId, eventName, command, requestId)
        const existing = this.handlers.get(key)
        if (existing) {
            return existing
        }

        const next = new Set()
        this.handlers.set(key, next)
        return next
    }

    emit = ({ pluginId, command, data = null, requestId } = {}) => {
        if (!pluginId || typeof pluginId !== "string") {
            throw new Error("pluginId must be a non-empty string")
        }

        if (!command || typeof command !== "string") {
            throw new Error("command must be a non-empty string")
        }

        if (typeof window === "undefined") {
            throw new Error("PluginBridge is not available in this environment")
        }

        this.assertInitialized()

        const resolvedRequestId = this.normalizeRequestId(requestId) || this.createRequestId()
        const payload = { pluginId, command, data, requestId: resolvedRequestId }

        if (this.hasAndroidBridge()) {
            window.PluginBridge.emit(JSON.stringify(payload))
        } else if (this.hasIOSBridge()) {
            window.webkit.messageHandlers.PluginBridge.postMessage(payload)
        } else {
            throw new Error("PluginBridge is not available in this environment")
        }

        return resolvedRequestId
    }

    register = ({ pluginId, eventName, command, handler, requestId } = {}) => {
        if (!pluginId || typeof pluginId !== "string") {
            throw new Error("pluginId must be a non-empty string")
        }
        if (!eventName || typeof eventName !== "string") {
            throw new Error("eventName must be a non-empty string")
        }
        if (typeof handler !== "function") {
            throw new Error("handler must be a function")
        }

        this.assertInitialized()

        const normalizedCommand = this.normalizeCommand(command) || "*"
        const normalizedRequestId = this.normalizeRequestId(requestId) || "*"
        this.getHandlers(pluginId, eventName, normalizedCommand, normalizedRequestId).add(handler)
    }

    unregister = ({ pluginId, eventName, command, handler, requestId } = {}) => {
        if (!pluginId || typeof pluginId !== "string") {
            throw new Error("pluginId must be a non-empty string")
        }
        if (!eventName || typeof eventName !== "string") {
            throw new Error("eventName must be a non-empty string")
        }
        if (handler != null && typeof handler !== "function") {
            throw new Error("handler must be a function when provided")
        }

        const normalizedCommand = this.normalizeCommand(command) || "*"
        const normalizedRequestId = this.normalizeRequestId(requestId) || "*"
        const key = this.handlerKey(pluginId, eventName, normalizedCommand, normalizedRequestId)
        const handlers = this.handlers.get(key)
        if (!handlers) {
            return false
        }

        if (handler == null) {
            this.handlers.delete(key)
            return true
        }

        const removed = handlers.delete(handler)
        if (handlers.size === 0) {
            this.handlers.delete(key)
        }
        return removed
    }

    dispatchCallback = (pluginId, eventName, payload, requestId = null, command = null) => {
        if (!pluginId || typeof pluginId !== "string") {
            return false
        }
        if (!eventName || typeof eventName !== "string") {
            return false
        }

        const normalizedRequestId =
            typeof requestId === "string" && requestId.trim() ? requestId.trim() : null
        const normalizedCommand = typeof command === "string" && command.trim() ? command.trim() : null
        const toCall = new Set()
        const collectHandlers = (commandScope, requestScope) => {
            const handlers = this.handlers.get(
                this.handlerKey(pluginId, eventName, commandScope, requestScope)
            )
            if (!handlers) {
                return
            }
            handlers.forEach((handler) => {
                toCall.add(handler)
            })
        }

        if (normalizedCommand != null && normalizedRequestId != null) {
            collectHandlers(normalizedCommand, normalizedRequestId)
        }
        if (normalizedCommand != null) {
            collectHandlers(normalizedCommand, "*")
        }
        if (normalizedRequestId != null) {
            collectHandlers("*", normalizedRequestId)
        }
        collectHandlers("*", "*")

        if (toCall.size === 0) {
            return false
        }

        const meta = {
            pluginId,
            eventName,
            command: normalizedCommand,
            requestId: normalizedRequestId,
        }
        toCall.forEach((handler) => {
            handler(payload, meta)
        })
        return true
    }
}

const pluginNativeBridge = new PluginNativeBridge()

export default pluginNativeBridge
export { PluginNativeBridge }
