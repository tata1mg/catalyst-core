import {
    NATIVE_CALLBACKS,
    ALL_CALLBACKS,
    isValidCallback,
    debugInterfaces,
} from "./constants/NativeInterfaces.js"
import nativeBridge from "./utils/NativeBridge.js"
import CameraUtils from "./utils/CameraUtils.js"
import pluginBridge from "../plugin-bridge/PluginBridge.js"
import { createError, formatError, ERROR_CODES } from "../../errors/index.js"

const DEVICE_INFO_PLUGIN = {
    pluginId: "io.catalyst.device_info",
    command: "getDeviceInfo",
    successEvent: "onSuccess",
    errorEvent: "onError",
}

const DEVICE_INFO_REQUEST_TIMEOUT_MS = 5000

const DEVICE_INFO_PLUGIN_FALLBACK_CODES = new Set([
    "PLUGIN_NOT_FOUND",
    "COMMAND_NOT_SUPPORTED",
    "PLUGIN_NOT_REGISTERED",
])

const DEVICE_INFO_PLUGIN_FALLBACK_MESSAGES = [
    "pluginbridge is not available in this environment",
    "pluginbridge is not available",
    "device info plugin request timed out",
]

const normalizeDeviceInfoPayload = (payload: any): any => {
    if (typeof payload !== "string") {
        return payload
    }

    try {
        return JSON.parse(payload)
    } catch {
        return {
            message: payload,
        }
    }
}

const createDeviceInfoError = (payload: any, fallbackMessage: string): Error => {
    const parsed = normalizeDeviceInfoPayload(payload)
    const message = parsed?.message || parsed?.error || fallbackMessage
    const error: any = new Error(message)

    if (parsed?.code) {
        error.code = parsed.code
    }

    if (parsed?.pluginId) {
        error.pluginId = parsed.pluginId
    }

    if (parsed?.command) {
        error.command = parsed.command
    }

    return error
}

class WebBridge {
    /**
     * Registered callback handlers, keyed by native interface name.
     *
     * Declared without an initializer so it erases to nothing at compile time —
     * the constructor below remains the only thing that assigns it, exactly as
     * before this file was converted.
     */
    handlers: Map<string, (data: any) => void>
    /** True once {@link WebBridge.init} has attached this instance to `window`. */
    initialized: boolean

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
            console.error(
                formatError(
                    createError(ERROR_CODES.RUNTIME_NATIVE_BRIDGE_INIT_FAILED, {
                        details: "WebBridge.init() was called outside a browser environment (no `window`).",
                    })
                )
            )
            return null
        }

        if (window.WebBridge) {
            // Not a failure — the bridge is already up and working, just return it.
            // No code here: RUNTIME-NATIVE-022 means init genuinely failed, which
            // this path is not.
            console.warn("🌉 WebBridge already initialized!")
            return window.WebBridge
        }

        const bridge = new WebBridge()
        window.WebBridge = bridge
        bridge.initialized = true

        const { platform } = nativeBridge.getEnvironmentInfo()

        if (window.__CATALYST_PROFILER_ENABLED === true) {
            import("./perf/index.js").then(({ default: WebPerfCollector }) => {
                WebPerfCollector.init(bridge)
            })
        }

        console.log("🌉 WebBridge created and attached to window")
        return { bridge, platform, getDeviceInfo: bridge.getDeviceInfo }
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
            console.error(
                formatError(
                    createError(ERROR_CODES.RUNTIME_NATIVE_BRIDGE_INVALID_CALLBACK, {
                        details: `Received "${interfaceName}", which is not in the registered NATIVE_CALLBACKS list.`,
                    })
                )
            )
            console.log("🌉 Available callbacks:", ALL_CALLBACKS)
            return
        }

        if (!this.handlers.has(interfaceName)) {
            console.warn(
                formatError(
                    createError(ERROR_CODES.RUNTIME_NATIVE_BRIDGE_HANDLER_NOT_REGISTERED, {
                        details: `No handler registered for interface "${interfaceName}".`,
                    })
                )
            )
            return
        }

        try {
            const handler = this.handlers.get(interfaceName)
            handler(data)
        } catch (error) {
            const wrapped = createError(ERROR_CODES.RUNTIME_NATIVE_BRIDGE_HANDLER_THREW, {
                details: `The handler registered for "${interfaceName}" threw.`,
                cause: error,
            })
            console.error(formatError(wrapped))

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
            console.error(
                formatError(
                    createError(ERROR_CODES.RUNTIME_NATIVE_BRIDGE_INVALID_REGISTRATION, {
                        details: `register("${interfaceName}", ...) was called with a non-function callback (got ${typeof callback}).`,
                    })
                )
            )
            return false
        }

        // Validate interface name
        if (!isValidCallback(interfaceName)) {
            console.error(
                formatError(
                    createError(ERROR_CODES.RUNTIME_NATIVE_BRIDGE_INVALID_REGISTRATION, {
                        details: `register() was called with "${interfaceName}", which is not a valid callback interface.`,
                    })
                )
            )
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

    getDeviceInfoFromLegacyBridge = (parseDeviceInfo) => {
        return new Promise((resolve, reject) => {
            let timeoutId = null
            const cleanup = () => {
                if (timeoutId != null) {
                    clearTimeout(timeoutId)
                }
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
                const dispatched = nativeBridge.device.getDeviceInfo()

                if (dispatched === false) {
                    cleanup()
                    reject(new Error("Legacy device info bridge failed to dispatch"))
                    return
                }

                timeoutId = setTimeout(() => {
                    cleanup()
                    reject(new Error("Legacy device info request timed out"))
                }, DEVICE_INFO_REQUEST_TIMEOUT_MS)
            } catch (error) {
                cleanup()
                reject(error)
            }
        })
    }

    getDeviceInfoFromPluginBridge = (parseDeviceInfo) => {
        return new Promise((resolve, reject) => {
            pluginBridge.init()

            let isSettled = false
            let timeoutId = null
            const cleanups = []
            const cleanup = () => {
                if (timeoutId != null) {
                    clearTimeout(timeoutId)
                }
                while (cleanups.length > 0) {
                    const unregister = cleanups.pop()
                    unregister()
                }
            }
            const settle = (callback) => {
                if (isSettled) {
                    return
                }

                isSettled = true
                cleanup()
                callback()
            }

            cleanups.push(
                pluginBridge.register({
                    pluginId: DEVICE_INFO_PLUGIN.pluginId,
                    eventName: DEVICE_INFO_PLUGIN.successEvent,
                    command: DEVICE_INFO_PLUGIN.command,
                    handler: (payload) => {
                        settle(() => {
                            try {
                                resolve(parseDeviceInfo(payload))
                            } catch (error) {
                                reject(error)
                            }
                        })
                    },
                })
            )

            cleanups.push(
                pluginBridge.register({
                    pluginId: DEVICE_INFO_PLUGIN.pluginId,
                    eventName: DEVICE_INFO_PLUGIN.errorEvent,
                    command: DEVICE_INFO_PLUGIN.command,
                    handler: (payload) => {
                        settle(() => {
                            reject(createDeviceInfoError(payload, "Device info plugin failed"))
                        })
                    },
                })
            )

            cleanups.push(
                pluginBridge.register({
                    pluginId: "__bridge__",
                    eventName: "PLUGIN_BRIDGE_ERROR",
                    command: DEVICE_INFO_PLUGIN.command,
                    handler: (payload) => {
                        const pluginId = normalizeDeviceInfoPayload(payload)?.pluginId

                        if (pluginId !== DEVICE_INFO_PLUGIN.pluginId) {
                            return
                        }

                        settle(() => {
                            reject(createDeviceInfoError(payload, "Device info plugin unavailable"))
                        })
                    },
                })
            )

            try {
                // `as any` only because PluginBridge is still plain JS: TypeScript
                // infers its `emit({ pluginId, command, data = null } = {})` shape
                // from the `= {}` default alone and concludes it accepts only
                // `{ data?: any }`, rejecting the two keys the body itself reads.
                // The assertion erases at compile time — the emitted call is byte
                // for byte the one this file made before the conversion.
                pluginBridge.emit({
                    pluginId: DEVICE_INFO_PLUGIN.pluginId,
                    command: DEVICE_INFO_PLUGIN.command,
                } as any)

                timeoutId = setTimeout(() => {
                    settle(() => {
                        reject(new Error("Device info plugin request timed out"))
                    })
                }, DEVICE_INFO_REQUEST_TIMEOUT_MS)
            } catch (error) {
                cleanup()
                reject(error)
            }
        })
    }

    shouldFallbackToLegacyDeviceInfo = (error) => {
        if (!error) {
            return false
        }

        if (DEVICE_INFO_PLUGIN_FALLBACK_CODES.has(error.code)) {
            return true
        }

        if (typeof error.message !== "string") {
            return false
        }

        const normalizedMessage = error.message.toLowerCase()
        return DEVICE_INFO_PLUGIN_FALLBACK_MESSAGES.some((message) => normalizedMessage.includes(message))
    }

    /**
     * Get device information
     * @returns {Promise<Object>} - Promise that resolves with device info or rejects with error
     */
    getDeviceInfo = async () => {
        const { platform, isNativeEnvironment } = nativeBridge.getEnvironmentInfo()

        // Handle web environment
        if (!isNativeEnvironment || platform === "web") {
            return {
                model: navigator.userAgent,
                manufacturer: "browser",
                platform: "web",
                screenWidth: screen.width,
                screenHeight: screen.height,
                screenDensity: window.devicePixelRatio,
            }
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

        try {
            return await this.getDeviceInfoFromPluginBridge(parseDeviceInfo)
        } catch (error) {
            if (!this.shouldFallbackToLegacyDeviceInfo(error)) {
                throw error
            }

            return this.getDeviceInfoFromLegacyBridge(parseDeviceInfo)
        }
    }
}

export default WebBridge
