package io.yourname.androidproject

/**
 * CatalystConstants.kt
 * Unified configuration constants for the Android native web bridge
 *
 * Mirrors the iOS-side constants to keep behavior consistent across platforms
 */
object CatalystConstants {

    // MARK: - File Transport
    object FileTransport {
        // Max size to inline over the JS bridge as Base64 (2 MB)
        const val BASE64_SIZE_LIMIT: Long = 2 * 1024 * 1024L
        const val BASE64_SIZE_LIMIT_MB: Int = 2

        // Max size supported overall via the framework server (100 MB)
        const val FRAMEWORK_SERVER_SIZE_LIMIT: Long = 100 * 1024 * 1024L
        const val FRAMEWORK_SERVER_SIZE_LIMIT_MB: Int = 100
    }

    // MARK: - Image Processing
    object ImageProcessing {
        object Quality {
            const val HIGH: Int = 90
            const val MEDIUM: Int = 70
            const val LOW: Int = 50
        }
        // Default JPEG compression quality
        const val DEFAULT_QUALITY: Int = Quality.MEDIUM
    }

    // MARK: - Network Server (Framework Server)
    object NetworkServer {
        // Port range to probe for starting the local HTTP server
        const val PORT_RANGE_START: Int = 18080
        const val PORT_RANGE_END: Int = 18110

        // Session/file timeout and cleanup cadence
        const val SESSION_TIMEOUT_MINUTES: Long = 10L // 10 minutes
        const val SESSION_TIMEOUT_MS: Long = SESSION_TIMEOUT_MINUTES * 60 * 1000L
        const val CLEANUP_INTERVAL_SECONDS: Long = 60L // 1 minute
        const val CLEANUP_INTERVAL_MS: Long = CLEANUP_INTERVAL_SECONDS * 1000L

        // Connection policies
        const val MAX_CONNECTIONS: Int = 16
        const val CONNECTION_TIMEOUT_SECONDS: Int = 30
    }

    // MARK: - Error Codes
    object ErrorCodes {
        const val BAD_REQUEST: Int = 400
        const val FILE_NOT_FOUND: Int = 404
        const val INTERNAL_SERVER_ERROR: Int = 500
    }

    // MARK: - Bridge Limits / Validation
    object Bridge {
        // Safety limit for inbound JS message size (128 KB)
        const val MAX_MESSAGE_SIZE: Int = 128 * 1024

        // Command execution timeout window
        const val COMMAND_TIMEOUT_SECONDS: Int = 30

        // Whitelisted commands the bridge will accept
        val VALID_COMMANDS: Set<String> = setOf(
            "openCamera",
            "requestCameraPermission",
            "getDeviceInfo",
            "logger",
            "pickFile",
            "openFileWithIntent",
            "requestHapticFeedback"
        )
    }

    // MARK: - Caching
    object Cache {
        // Fresh/stale windows for SWR behavior
        const val FRESH_WINDOW_SECONDS: Long = 60L // seconds
        const val STALE_WINDOW_SECONDS: Long = 5 * 60L // seconds

        // URLCache capacities (bytes)
        const val MEMORY_CAPACITY: Long = 10 * 1024 * 1024L // 10 MB
        const val DISK_CAPACITY: Long = 50 * 1024 * 1024L // 50 MB
    }

    // MARK: - File Provider
    object FileProvider {
        const val AUTHORITY: String = "io.yourname.androidproject.fileprovider"
    }

    // MARK: - Logging Configuration
    object Logging {
        object Categories {
            const val NATIVE_BRIDGE = "NativeBridge"
            const val BRIDGE_UTILS = "BridgeUtils"
            const val MESSAGE_VALIDATOR = "BridgeMessageValidator"
            const val FILE_UTILS = "FileUtils"
            const val INTENT_UTILS = "IntentUtils"
            const val CAMERA_UTILS = "CameraUtils"
            const val DOWNLOAD_UTILS = "DownloadUtils"
            const val FRAMEWORK_SERVER_UTILS = "FrameworkServerUtils"
        }
    }
}
