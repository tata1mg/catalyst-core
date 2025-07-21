const Interfaces = [
    "CAMERA_PERMISSION_STATUS", 
    "ON_CAMERA_CAPTURE", 
    "ON_CAMERA_ERROR", 
    "HAPTIC_FEEDBACK", 
    "ON_INTENT_SUCCESS", 
    "ON_INTENT_ERROR", 
    "ON_INTENT_CANCELLED",
    "ON_FILE_PICK_STATE_UPDATE", 
    "ON_FILE_PICKED", 
    "ON_FILE_PICK_ERROR",
    "ON_FILE_PICK_CANCELLED"
]

class WebBridge {
    constructor() {
        this.handlers = new Map()
        console.log("🌉 WebBridge initialized with interfaces:", Interfaces)
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
        console.log("🌉 WebBridge created and attached to window")
    }

    callback = (interfaceName, data) => {
        console.log(`🌉 WebBridge callback: ${interfaceName}`, data)
        
        if (!this.handlers.has(interfaceName)) {
            console.error(`Interface ${interfaceName} not registered!`)
            return
        }

        try {
            this.handlers.get(interfaceName)(data)
        } catch (error) {
            console.error(`Error executing callback for ${interfaceName}:`, error)
        }
    }

    // Only a single callback can be registered per interface
    register = (interfaceName, callback) => {
        if (typeof callback !== "function") {
            console.error("Callback must be a function!")
            return
        }

        if (!Interfaces.includes(interfaceName)) {
            console.error(`Interface ${interfaceName} is not a valid interface!`)
            console.log("Available interfaces:", Interfaces)
            return
        }

        if (this.handlers.has(interfaceName)) {
            console.log(`Interface ${interfaceName} already registered! Overriding!`)
        }

        console.log(`🌉 Registering interface: ${interfaceName}`)
        this.handlers.set(interfaceName, callback)
    }

    unregister = (interfaceName) => {
        if (!this.handlers.has(interfaceName)) {
            console.error(`Interface ${interfaceName} not registered!`)
            return
        }

        console.log(`🌉 Unregistering interface: ${interfaceName}`)
        this.handlers.delete(interfaceName)
    }

    // Utility method to check if an interface is registered
    isRegistered = (interfaceName) => {
        return this.handlers.has(interfaceName)
    }

    // Utility method to get all registered interfaces
    getRegisteredInterfaces = () => {
        return Array.from(this.handlers.keys())
    }

    // Debug method to log current state
    debug = () => {
        console.log("🌉 WebBridge Debug Info:")
        console.log("Available interfaces:", Interfaces)
        console.log("Registered interfaces:", this.getRegisteredInterfaces())
        console.log("Handlers map:", this.handlers)
    }
}

export default WebBridge