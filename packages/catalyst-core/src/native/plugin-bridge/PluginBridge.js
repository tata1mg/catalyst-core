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

    normalizeRequiredString = (value, fieldName) => {
        if (typeof value !== "string" || !value.trim()) {
            throw new Error(`${fieldName} must be a non-empty string`)
        }
        return value.trim()
    }

    normalizeCommand = (command) => {
        if (command == null) {
            return null
        }
        return this.normalizeRequiredString(command, "command")
    }

    getHandlerKey = ({ pluginId, eventName, command = null } = {}) => {
        return JSON.stringify([
            this.normalizeRequiredString(pluginId, "pluginId"),
            this.normalizeRequiredString(eventName, "eventName"),
            this.normalizeCommand(command),
        ])
    }

    getHandlerSet = (key, create = false) => {
        let handlers = this.handlers.get(key)
        if (!handlers && create) {
            handlers = new Set()
            this.handlers.set(key, handlers)
        }
        return handlers || null
    }

    addHandler = ({ pluginId, eventName, command } = {}, handler) => {
        if (typeof handler !== "function") {
            throw new Error("handler must be a function")
        }

        this.getHandlerSet(this.getHandlerKey({ pluginId, eventName, command }), true).add(handler)
    }

    removeHandler = ({ pluginId, eventName, command } = {}, handler) => {
        const key = this.getHandlerKey({ pluginId, eventName, command })
        const handlers = this.getHandlerSet(key, false)

        if (!handlers) {
            return false
        }

        if (handler == null) {
            handlers.clear()
            this.handlers.delete(key)
            return true
        }

        const removed = handlers.delete(handler)
        if (handlers.size === 0) {
            this.handlers.delete(key)
        }
        return removed
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

    emit = ({ pluginId, command, data = null } = {}) => {
        const normalizedPluginId = this.normalizeRequiredString(pluginId, "pluginId")
        const normalizedCommand = this.normalizeRequiredString(command, "command")

        if (typeof window === "undefined") {
            throw new Error("PluginBridge is not available in this environment")
        }

        this.assertInitialized()

        const payload = {
            pluginId: normalizedPluginId,
            command: normalizedCommand,
            data,
            requestId: this.createRequestId(),
        }

        if (this.hasAndroidBridge()) {
            window.PluginBridge.emit(JSON.stringify(payload))
            return
        }

        if (this.hasIOSBridge()) {
            window.webkit.messageHandlers.PluginBridge.postMessage(payload)
            return
        }

        throw new Error("PluginBridge is not available in this environment")
    }

    register = ({ pluginId, eventName, command, handler } = {}) => {
        this.assertInitialized()
        this.addHandler({ pluginId, eventName, command }, handler)
        return () => this.removeHandler({ pluginId, eventName, command }, handler)
    }

    unregister = ({ pluginId, eventName, command, handler } = {}) => {
        if (typeof handler !== "function") {
            throw new Error("handler must be a function")
        }

        return this.removeHandler({ pluginId, eventName, command }, handler)
    }

    dispatchCallback = (pluginId, eventName, payload, requestId = null, command = null) => {
        void requestId

        const normalizedPluginId = typeof pluginId === "string" && pluginId.trim() ? pluginId.trim() : null
        const normalizedEventName =
            typeof eventName === "string" && eventName.trim() ? eventName.trim() : null

        if (normalizedPluginId == null || normalizedEventName == null) {
            return false
        }

        const normalizedCommand = typeof command === "string" && command.trim() ? command.trim() : null
        const toCall = new Set()
        const collectHandlers = (commandScope) => {
            const handlers = this.getHandlerSet(
                JSON.stringify([normalizedPluginId, normalizedEventName, commandScope]),
                false
            )
            if (!handlers) {
                return
            }
            handlers.forEach((handler) => {
                toCall.add(handler)
            })
        }

        if (normalizedCommand != null) {
            collectHandlers(normalizedCommand)
        }
        collectHandlers(null)

        if (toCall.size === 0) {
            return false
        }

        const meta = {
            pluginId: normalizedPluginId,
            eventName: normalizedEventName,
            command: normalizedCommand,
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
