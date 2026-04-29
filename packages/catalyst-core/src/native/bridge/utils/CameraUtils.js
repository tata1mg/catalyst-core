import {
    NATIVE_CALLBACKS,
    CAMERA_QUALITY,
    CAMERA_FORMAT,
    CAMERA_DEVICE,
    CAMERA_FLASH_MODE,
} from "../constants/NativeInterfaces.js"
import nativeBridge from "./NativeBridge.js"

/**
 * Camera Utility Module
 * Provides Promise-based camera operations with proper option validation
 */
class CameraUtils {
    /**
     * Open camera and capture image
     * @param {Object} options - Camera options
     * @param {string} options.quality - Image quality: 'high', 'medium', 'low'
     * @param {string} options.format - Image format: 'jpeg', 'png'
     * @param {string} options.cameraDevice - Camera device: 'front', 'rear'
     * @param {string} options.flashMode - Flash mode: 'auto', 'on', 'off'
     * @param {boolean} options.allowEditing - Allow image editing after capture
     * @param {Function} registerCallback - Callback registration function
     * @param {Function} unregisterCallback - Callback unregistration function
     * @returns {Promise<Object>} - Promise that resolves with camera result or rejects with error
     */
    static openCamera(options = {}, registerCallback, unregisterCallback) {
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                unregisterCallback(NATIVE_CALLBACKS.ON_CAMERA_CAPTURE)
                unregisterCallback(NATIVE_CALLBACKS.ON_CAMERA_ERROR)
            }

            // Validate and set defaults for options
            const cameraOptions = CameraUtils.validateCameraOptions(options)

            registerCallback(NATIVE_CALLBACKS.ON_CAMERA_CAPTURE, (data) => {
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

            registerCallback(NATIVE_CALLBACKS.ON_CAMERA_ERROR, (error) => {
                cleanup()
                const errorMessage =
                    typeof error === "string" ? error : error.error || error.message || "Unknown camera error"
                reject(new Error(errorMessage))
            })

            try {
                nativeBridge.camera.open(JSON.stringify(cameraOptions))
            } catch (error) {
                cleanup()
                reject(error)
            }
        })
    }

    /**
     * Request camera permission
     * @param {Object} config - Permission configuration
     * @param {boolean} config.includeDetails - Include detailed permission info in response
     * @param {Function} registerCallback - Callback registration function
     * @param {Function} unregisterCallback - Callback unregistration function
     * @returns {Promise<Object>} - Promise that resolves with permission status or rejects with error
     */
    static requestCameraPermission(config = {}, registerCallback, unregisterCallback) {
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                unregisterCallback(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS)
            }

            // Validate and set defaults for config
            const permissionConfig = {
                includeDetails: config.includeDetails || false,
                ...config,
            }

            registerCallback(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS, (data) => {
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
                nativeBridge.camera.requestPermission(JSON.stringify(permissionConfig))
            } catch (error) {
                cleanup()
                reject(error)
            }
        })
    }

    /**
     * Validate camera options and set defaults
     * @param {Object} options - Raw camera options
     * @returns {Object} - Validated camera options with defaults
     */
    static validateCameraOptions(options) {
        const validated = {}

        // Quality validation
        if (options.quality && Object.values(CAMERA_QUALITY).includes(options.quality.toLowerCase())) {
            validated.quality = options.quality.toLowerCase()
        } else {
            validated.quality = CAMERA_QUALITY.MEDIUM // Default
        }

        // Format validation
        if (options.format && Object.values(CAMERA_FORMAT).includes(options.format.toLowerCase())) {
            validated.format = options.format.toLowerCase()
        } else {
            validated.format = CAMERA_FORMAT.JPEG // Default
        }

        // Camera device validation
        if (
            options.cameraDevice &&
            Object.values(CAMERA_DEVICE).includes(options.cameraDevice.toLowerCase())
        ) {
            validated.cameraDevice = options.cameraDevice.toLowerCase()
        }

        // Flash mode validation
        if (options.flashMode && Object.values(CAMERA_FLASH_MODE).includes(options.flashMode.toLowerCase())) {
            validated.flashMode = options.flashMode.toLowerCase()
        }

        // Allow editing validation
        if (typeof options.allowEditing === "boolean") {
            validated.allowEditing = options.allowEditing
        } else {
            validated.allowEditing = false // Default
        }

        return validated
    }

    /**
     * Get default camera options
     * @returns {Object} - Default camera options
     */
    static getDefaultOptions() {
        return {
            quality: CAMERA_QUALITY.MEDIUM,
            format: CAMERA_FORMAT.JPEG,
            allowEditing: false,
        }
    }

    /**
     * Get default permission config
     * @returns {Object} - Default permission config
     */
    static getDefaultPermissionConfig() {
        return {
            includeDetails: false,
        }
    }

    /**
     * Validate camera quality
     * @param {string} quality - Quality string to validate
     * @returns {boolean} - True if valid quality
     */
    static isValidQuality(quality) {
        return quality && Object.values(CAMERA_QUALITY).includes(quality.toLowerCase())
    }

    /**
     * Validate camera format
     * @param {string} format - Format string to validate
     * @returns {boolean} - True if valid format
     */
    static isValidFormat(format) {
        return format && Object.values(CAMERA_FORMAT).includes(format.toLowerCase())
    }

    /**
     * Validate camera device
     * @param {string} device - Device string to validate
     * @returns {boolean} - True if valid device
     */
    static isValidDevice(device) {
        return device && Object.values(CAMERA_DEVICE).includes(device.toLowerCase())
    }

    /**
     * Validate flash mode
     * @param {string} flashMode - Flash mode string to validate
     * @returns {boolean} - True if valid flash mode
     */
    static isValidFlashMode(flashMode) {
        return flashMode && Object.values(CAMERA_FLASH_MODE).includes(flashMode.toLowerCase())
    }
}

export default CameraUtils
