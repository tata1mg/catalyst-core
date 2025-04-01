const Interfaces = ["CAMERA_PERMISSION_STATUS", "ON_CAMERA_CAPTURE", "ON_CAMERA_ERROR", "HAPTIC_FEEDBACK"]

class WebBridge {
    constructor() {
        this.handlers = new Map()
    }

    static init = () => {
        if (!window) {
            console.error("WebBridge cannot be initialized outside the browser!")
            return
        }

        if (window.WebBridge) {
            console.error("WebBridge already initialized!")
            return
        }

        window.WebBridge = new WebBridge()
    }

    callback = (interfaceName, data) => {
        if (!this.handlers.has(interfaceName)) {
            console.error(`Interface ${interfaceName} not registered!`)
            return
        }

        this.handlers.get(interfaceName)(data)
    }

    // Only a single callback can be registered
    register = (interfaceName, callback) => {
        if (typeof callback !== "function") {
            console.error("Callback must be a function!")
            return
        }

        if (!Interfaces.includes(interfaceName)) {
            console.error(`Interface ${interfaceName} is not a valid interface!`)
            return
        }

        if (this.handlers.has(interfaceName)) {
            console.log(`Interface ${interfaceName} already registered! Overriding!`)
        }

        this.handlers.set(interfaceName, callback)
    }

    unregister = (interfaceName) => {
        if (!this.handlers.has(interfaceName)) {
            console.error(`Interface ${interfaceName} not registered!`)
            return
        }

        this.handlers.delete(interfaceName)
    }
}

export default WebBridge
