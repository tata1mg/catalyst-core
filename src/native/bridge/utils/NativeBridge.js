import { NATIVE_COMMANDS, isValidCommand } from "../constants/NativeInterfaces.js"

/**
 * NativeBridge Utility
 * Handles communication from Web to Native platforms
 * Supports both Android (window.NativeBridge) and iOS (webkit.messageHandlers)
 */
class NativeBridgeUtil {
    constructor() {
        this.isAndroid = this._detectAndroid()
        this.isIOS = this._detectIOS()
        this.isNativeEnvironment = this.isAndroid || this.isIOS

        if (typeof window !== "undefined") {
            this._logEnvironmentInfo()
        }
    }

    /**
     * Detect if running on Android WebView
     */
    _detectAndroid() {
        if (typeof window === "undefined") return false
        return !!(window.NativeBridge && typeof window.NativeBridge === "object")
    }

    /**
     * Detect if running on iOS WebView
     */
    _detectIOS() {
        if (typeof window === "undefined") return false
        return !!window.webkit?.messageHandlers?.NativeBridge
    }

    /**
     * Log environment detection info for debugging
     */
    _logEnvironmentInfo() {
        console.log("🌉 NativeBridge Environment Detection:", {
            isAndroid: this.isAndroid,
            isIOS: this.isIOS,
            isNativeEnvironment: this.isNativeEnvironment,
            hasAndroidBridge: !!window.NativeBridge,
            hasIOSBridge: !!window.webkit?.messageHandlers?.NativeBridge,
        })
    }

    /**
     * Validate command before execution
     */
    _validateCommand(command) {
        if (!command) {
            throw new Error("Command is required")
        }

        if (!isValidCommand(command)) {
            throw new Error(
                `Invalid command: ${command}. Available commands: ${Object.values(NATIVE_COMMANDS).join(", ")}`
            )
        }

        if (!this.isNativeEnvironment) {
            throw new Error(
                "Native bridge not available. Ensure you are running in a native WebView environment."
            )
        }
    }

    /**
     * Execute command on Android platform
     */
    _executeAndroidCommand(command, data) {
        try {
            if (typeof window.NativeBridge[command] === "function") {
                console.log(`🌉 Calling Android method '${command}'`, data ? { data } : "(no data)")
                // Always pass data parameter to match Kotlin method signatures
                window.NativeBridge[command](data)
                return true
            } else {
                throw new Error(`Android bridge method '${command}' not found`)
            }
        } catch (error) {
            console.error(`Error executing Android command '${command}':`, error)
            throw error
        }
    }

    /**
     * Execute command on iOS platform
     */
    _executeIOSCommand(command, data) {
        try {
            // For iOS, we always send a message object
            const message = {
                command: command,
                data: data, // This can be null/undefined, iOS bridge should handle it
            }

            console.log(`🌉 Calling iOS method '${command}'`, data ? { data } : "(no data)")
            window.webkit.messageHandlers.NativeBridge.postMessage(message)
            return true
        } catch (error) {
            console.error(`Error executing iOS command '${command}':`, error)
            throw error
        }
    }

    /**
     * Main method to call native commands
     * @param {string} command - The command to execute (from NATIVE_COMMANDS)
     * @param {any} data - Optional data to pass to the native side
     * @returns {boolean} - Success status
     */
    call(command, data = null) {
        try {
            // Validate environment and command
            this._validateCommand(command)

            console.log(`🌉 Executing native command: ${command}`, data ? { data } : "")

            // Execute on appropriate platform
            if (this.isAndroid) {
                return this._executeAndroidCommand(command, data)
            } else if (this.isIOS) {
                return this._executeIOSCommand(command, data)
            }

            return false
        } catch (error) {
            console.error(`🌉 Failed to execute command '${command}':`, error)

            // In development, we might want to show user-friendly errors
            if (process.env.NODE_ENV === "development") {
                console.warn(
                    `🌉 Development mode: Native command '${command}' failed. This is expected when running in browser.`
                )
            }

            throw error
        }
    }

    /**
     * Camera-specific methods for easier usage
     */
    camera = {
        /**
         * Open camera for photo capture
         */
        open: () => this.call(NATIVE_COMMANDS.OPEN_CAMERA),

        /**
         * Request camera permission
         */
        requestPermission: () => this.call(NATIVE_COMMANDS.REQUEST_CAMERA_PERMISSION),
    }

    /**
     * File-specific methods for easier usage
     */
    file = {
        /**
         * Open file picker
         * @param {string} mimeType - MIME type filter (e.g., 'image/*', 'application/pdf')
         */
        pick: (mimeType = "*/*") => this.call(NATIVE_COMMANDS.PICK_FILE, mimeType),

        /**
         * Open file with external app
         * @param {string} fileUrl - URL of the file to open
         * @param {string} mimeType - Optional MIME type
         */
        openWithIntent: (fileUrl, mimeType = null) => {
            const params = mimeType ? `${fileUrl}|${mimeType}` : fileUrl
            return this.call(NATIVE_COMMANDS.OPEN_FILE_WITH_INTENT, params)
        },
    }

    /**
     * Haptic feedback methods
     */
    haptic = {
        /**
         * Request haptic feedback
         * @param {string} feedbackType - Type of haptic feedback
         */
        feedback: (feedbackType = "light") =>
            this.call(NATIVE_COMMANDS.REQUEST_HAPTIC_FEEDBACK, feedbackType),
    }

    /**
     * Notification methods for local and push notifications
     */
    notification = {
        /**
         * Schedule a local notification
         * @param {Object} config - Notification configuration object
         */
        scheduleLocal: (config) =>
            this.call(NATIVE_COMMANDS.SCHEDULE_LOCAL_NOTIFICATION, JSON.stringify(config)),

        /**
         * Cancel a local notification
         * @param {string} notificationId - ID of the notification to cancel
         */
        cancelLocal: (notificationId) => this.call(NATIVE_COMMANDS.CANCEL_LOCAL_NOTIFICATION, notificationId),

        /**
         * Request notification permission
         */
        requestPermission: () => this.call(NATIVE_COMMANDS.REQUEST_NOTIFICATION_PERMISSION),

        /**
         * Register for push notifications
         */
        registerForPush: () => this.call(NATIVE_COMMANDS.REGISTER_FOR_PUSH_NOTIFICATIONS),

        /**
         * Update badge count
         * @param {number} count - Badge count number
         */
        updateBadge: (count) => this.call(NATIVE_COMMANDS.UPDATE_BADGE_COUNT, count?.toString()),
    }

    /**
     * Device info methods
     */
    device = {
        /**
         * Get device information
         * @returns {Promise} - Returns device info through callback
         */
        getDeviceInfo: () => this.call(NATIVE_COMMANDS.GET_DEVICE_INFO),
    }

    /**
     * Get environment info
     */
    getEnvironmentInfo() {
        return {
            isAndroid: this.isAndroid,
            isIOS: this.isIOS,
            isNativeEnvironment: this.isNativeEnvironment,
            platform: this.isAndroid ? "android" : this.isIOS ? "ios" : "web",
        }
    }

    /**
     * Check if native bridge is available
     */
    isAvailable() {
        return this.isNativeEnvironment
    }

    /**
     * Debug method to test native bridge connectivity
     */
    testConnection() {
        console.group("🌉 NativeBridge Connection Test")
        console.log("Environment:", this.getEnvironmentInfo())
        console.log("Available commands:", Object.values(NATIVE_COMMANDS))

        if (this.isAndroid && window.NativeBridge) {
            console.log("Android bridge methods:", Object.getOwnPropertyNames(window.NativeBridge))
        }

        if (this.isIOS && window.webkit?.messageHandlers?.NativeBridge) {
            console.log("iOS webkit bridge available")
        }

        console.groupEnd()
    }
}

// Export singleton instance
const nativeBridge = new NativeBridgeUtil()

export default nativeBridge

// Also export the class for advanced usage
export { NativeBridgeUtil }
