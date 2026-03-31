import {
    NATIVE_CALLBACKS,
    ALL_CALLBACKS,
    isValidCallback,
    debugInterfaces,
} from "./constants/NativeInterfaces.js"
import nativeBridge from "./utils/NativeBridge.js"
import CameraUtils from "./utils/CameraUtils.js"

class WebBridge {
    constructor() {
        this.handlers = new Map()
        this.initialized = false
        this._logInitialization()
    }

    /**
     * Log initialization info
     */
    _logInitialization() {
        console.log("🌉 WebBridge initialized")
        console.log("🌉 Available callback interfaces:", ALL_CALLBACKS.length)

        if (process.env.NODE_ENV === "development") {
            debugInterfaces()
        }
    }

    /**
     * Static method to initialize WebBridge on window object
     */
    static init = () => {
        if (typeof window === "undefined") {
            console.error("🌉 WebBridge cannot be initialized outside the browser!")
            return null
        }

        if (window.WebBridge) {
            console.warn("🌉 WebBridge already initialized!")
            return window.WebBridge
        }

        const bridge = new WebBridge()
        window.WebBridge = bridge
        bridge.initialized = true

        const { platform } = nativeBridge.getEnvironmentInfo()

        console.log("🌉 WebBridge created and attached to window")
        return { bridge, platform, getDeviceInfo: bridge.getDeviceInfo, setAndroidWebViewSettings: bridge.setAndroidWebViewSettings }
    }

    /**
     * Main callback handler called by native platforms
     * @param {string} interfaceName - The callback interface name
     * @param {any} data - Data from native platform
     */
    callback = (interfaceName, data) => {
        console.log(`🌉 WebBridge callback: ${interfaceName}`, data ? { data } : "")

        // Validate interface
        if (!isValidCallback(interfaceName)) {
            console.error(`🌉 Invalid callback interface: ${interfaceName}`)
            console.log("🌉 Available callbacks:", ALL_CALLBACKS)
            return
        }

        if (!this.handlers.has(interfaceName)) {
            console.warn(`🌉 No handler registered for interface: ${interfaceName}`)
            return
        }

        try {
            const handler = this.handlers.get(interfaceName)
            handler(data)
        } catch (error) {
            console.error(`🌉 Error executing callback for ${interfaceName}:`, error)

            // In development, provide more helpful error info
            if (process.env.NODE_ENV === "development") {
                console.error("🌉 Handler details:", {
                    interfaceName,
                    data,
                    handlerType: typeof this.handlers.get(interfaceName),
                })
            }
        }
    }

    /**
     * Register a callback handler for a native interface
     * @param {string} interfaceName - The callback interface name (from NATIVE_CALLBACKS)
     * @param {function} callback - The callback function to execute
     * @returns {boolean} - Success status
     */
    register = (interfaceName, callback) => {
        // Validate callback function
        if (typeof callback !== "function") {
            console.error("🌉 Callback must be a function!")
            return false
        }

        // Validate interface name
        if (!isValidCallback(interfaceName)) {
            console.error(`🌉 Invalid callback interface: ${interfaceName}`)
            console.log("🌉 Available callback interfaces:", ALL_CALLBACKS)
            return false
        }

        // Warn if overriding existing handler
        if (this.handlers.has(interfaceName)) {
            console.warn(`🌉 Interface ${interfaceName} already registered! Overriding existing handler.`)
        }

        console.log(`🌉 Registering callback interface: ${interfaceName}`)
        this.handlers.set(interfaceName, callback)
        return true
    }

    /**
     * Unregister a callback handler
     * @param {string} interfaceName - The callback interface name to unregister
     * @returns {boolean} - Success status
     */
    unregister = (interfaceName) => {
        if (!this.handlers.has(interfaceName)) {
            console.warn(`🌉 Interface ${interfaceName} not registered, nothing to unregister.`)
            return false
        }

        console.log(`🌉 Unregistering callback interface: ${interfaceName}`)
        this.handlers.delete(interfaceName)
        return true
    }

    /**
     * Check if a callback interface is registered
     * @param {string} interfaceName - The callback interface name
     * @returns {boolean} - Registration status
     */
    isRegistered = (interfaceName) => {
        return this.handlers.has(interfaceName)
    }

    /**
     * Get all registered callback interfaces
     * @returns {string[]} - Array of registered interface names
     */
    getRegisteredInterfaces = () => {
        return Array.from(this.handlers.keys())
    }

    /**
     * Get handler for a specific interface (for debugging)
     * @param {string} interfaceName - The callback interface name
     * @returns {function|null} - The registered handler or null
     */
    getHandler = (interfaceName) => {
        return this.handlers.get(interfaceName) || null
    }

    /**
     * Clear all registered handlers
     */
    clearAll = () => {
        const count = this.handlers.size
        this.handlers.clear()
        console.log(`🌉 Cleared ${count} registered callback handlers`)
    }

    /**
     * Debug method to log current state
     */
    debug = () => {
        console.group("🌉 WebBridge Debug Info")
        console.log("Initialized:", this.initialized)
        console.log("Available callback interfaces:", ALL_CALLBACKS)
        console.log("Registered interfaces:", this.getRegisteredInterfaces())
        console.log("Total handlers:", this.handlers.size)

        if (this.handlers.size > 0) {
            console.log("Handler details:")
            this.handlers.forEach((handler, interfaceName) => {
                console.log(`  ${interfaceName}:`, typeof handler)
            })
        }

        console.groupEnd()
    }

    /**
     * Test callback functionality (for debugging)
     * @param {string} interfaceName - The callback interface to test
     * @param {any} testData - Test data to pass
     */
    testCallback = (interfaceName, testData = "test") => {
        if (process.env.NODE_ENV !== "development") {
            console.warn("🌉 testCallback is only available in development mode")
            return
        }

        console.log(`🌉 Testing callback: ${interfaceName}`)
        this.callback(interfaceName, testData)
    }

    /**
     * Request haptic feedback
     * @param {string} feedbackType - Type of haptic feedback (VIRTUAL_KEY, LONG_PRESS, DEFAULT)
     * @returns {Promise<Object>} - Promise that resolves with haptic feedback result or rejects with error
     */
    requestHapticFeedback = (feedbackType = "VIRTUAL_KEY") => {
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                this.unregister(NATIVE_CALLBACKS.HAPTIC_FEEDBACK)
            }

            this.register(NATIVE_CALLBACKS.HAPTIC_FEEDBACK, (data) => {
                cleanup()
                try {
                    const result = typeof data === "string" ? JSON.parse(data) : data
                    if (result.error) {
                        reject(new Error(result.error))
                    } else {
                        resolve(result)
                    }
                } catch (error) {
                    reject(error)
                }
            })

            try {
                nativeBridge.haptic.feedback(feedbackType)
            } catch (error) {
                cleanup()
                reject(error)
            }
        })
    }

    /**
     * Open camera and capture image
     * @param {Object} options - Camera options (quality, format, cameraDevice, flashMode, allowEditing)
     * @returns {Promise<Object>} - Promise that resolves with camera result or rejects with error
     */
    openCamera = (options = {}) => {
        return CameraUtils.openCamera(options, this.register, this.unregister)
    }

    /**
     * Request camera permission
     * @param {Object} config - Permission configuration (includeDetails)
     * @returns {Promise<Object>} - Promise that resolves with permission status or rejects with error
     */
    requestCameraPermission = (config = {}) => {
        return CameraUtils.requestCameraPermission(config, this.register, this.unregister)
    }

    /**
     * Get device information
     * @returns {Promise<Object>} - Promise that resolves with device info or rejects with error
     */
    getDeviceInfo = () => {
        const { platform, isNativeEnvironment } = nativeBridge.getEnvironmentInfo()

        // Handle web environment
        if (!isNativeEnvironment || platform === "web") {
            return new Promise((resolve) => {
                const webDeviceInfo = {
                    model: navigator.userAgent,
                    manufacturer: "browser",
                    platform: "web",
                    screenWidth: screen.width,
                    screenHeight: screen.height,
                    screenDensity: window.devicePixelRatio,
                }
                resolve(webDeviceInfo)
            })
        }

        // Key mapping from native to web keys
        const DEVICE_INFO_KEY_MAP = {
            android: {
                model: "model",
                manufacturer: "manufacturer",
                platform: "platform",
                screenWidth: "screenWidth",
                screenHeight: "screenHeight",
                screenDensity: "screenDensity",
                appInfo: "appInfo",
            },
            ios: {
                model: "model",
                manufacturer: "manufacturer",
                platform: "platform",
                screenWidth: "screenWidth",
                screenHeight: "screenHeight",
                screenDensity: "screenDensity",
                appInfo: "appInfo",
            },
        }

        const parseDeviceInfo = (data) => {
            const rawDeviceInfo = typeof data === "string" ? JSON.parse(data) : data
            const platformMapping = DEVICE_INFO_KEY_MAP[platform] || {}

            return Object.fromEntries(
                Object.entries(rawDeviceInfo).map(([key, value]) => [platformMapping[key] || key, value])
            )
        }

        return new Promise((resolve, reject) => {
            const cleanup = () => {
                this.unregister(NATIVE_CALLBACKS.ON_DEVICE_INFO_SUCCESS)
                this.unregister(NATIVE_CALLBACKS.ON_DEVICE_INFO_ERROR)
            }

            this.register(NATIVE_CALLBACKS.ON_DEVICE_INFO_SUCCESS, (data) => {
                cleanup()
                resolve(parseDeviceInfo(data))
            })

            this.register(NATIVE_CALLBACKS.ON_DEVICE_INFO_ERROR, (error) => {
                cleanup()
                reject(new Error(error))
            })

            try {
                nativeBridge.device.getDeviceInfo()
            } catch (error) {
                cleanup()
                reject(error)
            }
        })
    }

    /**
     * Update Android WebView settings dynamically (Android only, no-op on other platforms)
     * @param {Object} settings
     * @param {boolean} [settings.supportZoom] - Enable pinch-to-zoom on the page
     * @param {boolean} [settings.builtInZoomControls] - Enable built-in zoom controls
     * @param {boolean} [settings.displayZoomControls] - Show/hide zoom control buttons
     */
    setAndroidWebViewSettings = (settings) => {
        const { isAndroid } = nativeBridge.getEnvironmentInfo()
        if (!isAndroid) return
        try {
            nativeBridge.android.setWebViewSettings(settings)
        } catch (err) {
            console.warn("setAndroidWebViewSettings failed silently:", err)
        }
    }

}

export default WebBridge
