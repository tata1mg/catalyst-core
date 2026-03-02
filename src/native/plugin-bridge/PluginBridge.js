class PluginNativeBridge {
    constructor() {
        this.handlers = new Map()
    }

    handlerKey = (pluginId, eventName) => `${pluginId}:${eventName}`

    emit = ({ pluginId, command, data = null } = {}) => {
        if (!pluginId || typeof pluginId !== "string") {
            throw new Error("pluginId must be a non-empty string")
        }

        if (!command || typeof command !== "string") {
            throw new Error("command must be a non-empty string")
        }

        if (typeof window === "undefined" || !window.PluginBridge) {
            throw new Error("PluginBridge is not available in this environment")
        }

        const payload = JSON.stringify({ pluginId, command, data })
        window.PluginBridge.emit(payload)
    }

    register = ({ pluginId, eventName, handler } = {}) => this.callback({ pluginId, eventName, handler })

    unregister = ({ pluginId, eventName } = {}) => {
        if (!pluginId || typeof pluginId !== "string") {
            throw new Error("pluginId must be a non-empty string")
        }
        if (!eventName || typeof eventName !== "string") {
            throw new Error("eventName must be a non-empty string")
        }
        return this.handlers.delete(this.handlerKey(pluginId, eventName))
    }

    callback = ({ pluginId, eventName, handler } = {}) => {
        if (!pluginId || typeof pluginId !== "string") {
            throw new Error("pluginId must be a non-empty string")
        }
        if (!eventName || typeof eventName !== "string") {
            throw new Error("eventName must be a non-empty string")
        }
        if (typeof handler !== "function") {
            throw new Error("handler must be a function")
        }

        this.handlers.set(this.handlerKey(pluginId, eventName), handler)
        return true
    }

    dispatchCallback = (pluginId, eventName, payload) => {
        if (!pluginId || typeof pluginId !== "string") {
            return false
        }
        if (!eventName || typeof eventName !== "string") {
            return false
        }

        const handler = this.handlers.get(this.handlerKey(pluginId, eventName))
        if (!handler) {
            return false
        }

        handler(payload)
        return true
    }

    clearAll = () => {
        this.handlers.clear()
    }

    init = () => {
        if (typeof window === "undefined") {
            return this
        }

        window.PluginBridgeWeb = window.PluginBridgeWeb || {}
        window.PluginBridgeWeb.callback = this.dispatchCallback

        return this
    }
}

const pluginNativeBridge = new PluginNativeBridge()

export default pluginNativeBridge
export { PluginNativeBridge }
