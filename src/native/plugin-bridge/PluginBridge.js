class PluginNativeBridge {
    constructor() {
        this.handlers = new Map()
        this.requestCount = 0
        this.isInitialized = false
        this.wildcardScope = Symbol("pluginBridgeWildcard")
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

    getHandlerSet = (pluginId, eventName, commandScope, requestScope, create = false) => {
        let pluginScopes = this.handlers.get(pluginId)
        if (!pluginScopes && create) {
            pluginScopes = new Map()
            this.handlers.set(pluginId, pluginScopes)
        }
        if (!pluginScopes) {
            return null
        }

        let eventScopes = pluginScopes.get(eventName)
        if (!eventScopes && create) {
            eventScopes = new Map()
            pluginScopes.set(eventName, eventScopes)
        }
        if (!eventScopes) {
            return null
        }

        let commandScopes = eventScopes.get(commandScope)
        if (!commandScopes && create) {
            commandScopes = new Map()
            eventScopes.set(commandScope, commandScopes)
        }
        if (!commandScopes) {
            return null
        }

        let requestScopes = commandScopes.get(requestScope)
        if (!requestScopes && create) {
            requestScopes = new Set()
            commandScopes.set(requestScope, requestScopes)
        }
        return requestScopes || null
    }

    pruneEmptyScopes = (pluginId, eventName, commandScope, requestScope) => {
        const pluginScopes = this.handlers.get(pluginId)
        const eventScopes = pluginScopes?.get(eventName)
        const commandScopes = eventScopes?.get(commandScope)

        if (commandScopes?.has(requestScope) && commandScopes.get(requestScope)?.size === 0) {
            commandScopes.delete(requestScope)
        }
        if (commandScopes?.size === 0) {
            eventScopes.delete(commandScope)
        }
        if (eventScopes?.size === 0) {
            pluginScopes.delete(eventName)
        }
        if (pluginScopes?.size === 0) {
            this.handlers.delete(pluginId)
        }
    }

    reportHandlerError = (error) => {
        if (typeof queueMicrotask === "function") {
            queueMicrotask(() => {
                throw error
            })
            return
        }
        setTimeout(() => {
            throw error
        }, 0)
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

        const normalizedCommand = this.normalizeCommand(command) || this.wildcardScope
        const normalizedRequestId = this.normalizeRequestId(requestId) || this.wildcardScope
        this.getHandlerSet(pluginId, eventName, normalizedCommand, normalizedRequestId, true).add(handler)
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

        const normalizedCommand = this.normalizeCommand(command) || this.wildcardScope
        const normalizedRequestId = this.normalizeRequestId(requestId) || this.wildcardScope
        const handlers = this.getHandlerSet(
            pluginId,
            eventName,
            normalizedCommand,
            normalizedRequestId,
            false
        )
        if (!handlers) {
            return false
        }

        if (handler == null) {
            handlers.clear()
            this.pruneEmptyScopes(pluginId, eventName, normalizedCommand, normalizedRequestId)
            return true
        }

        const removed = handlers.delete(handler)
        this.pruneEmptyScopes(pluginId, eventName, normalizedCommand, normalizedRequestId)
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
            const handlers = this.getHandlerSet(pluginId, eventName, commandScope, requestScope, false)
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
            collectHandlers(normalizedCommand, this.wildcardScope)
        }
        if (normalizedRequestId != null) {
            collectHandlers(this.wildcardScope, normalizedRequestId)
        }
        collectHandlers(this.wildcardScope, this.wildcardScope)

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
            try {
                handler(payload, meta)
            } catch (error) {
                this.reportHandlerError(error)
            }
        })
        return true
    }
}

const pluginNativeBridge = new PluginNativeBridge()

export default pluginNativeBridge
export { PluginNativeBridge }
