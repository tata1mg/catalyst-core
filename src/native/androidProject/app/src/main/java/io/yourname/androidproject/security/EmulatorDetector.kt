package io.yourname.androidproject.security

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Build
import io.yourname.androidproject.utils.BridgeUtils

/**
 * Local emulator detection based on Build properties and hardware features.
 * No external telemetry or logging to third parties.
 */
object EmulatorDetector {
    private const val TAG = "EmulatorDetector"

    // Known emulator indicators
    private val EMULATOR_PROPERTIES = setOf(
        "sdk", "google_sdk", "sdk_gphone", "sdk_google",
        "vbox", "goldfish", "ranchu", "generic"
    )

    private val SUSPICIOUS_MANUFACTURERS = setOf(
        "Genymotion", "unknown", "Generic"
    )

    private val SUSPICIOUS_MODELS = setOf(
        "sdk", "google_sdk", "Android SDK built for x86",
        "Android SDK built for arm", "Emulator"
    )

    /**
     * Performs multiple checks to detect if running on an emulator.
     * Returns true if device shows emulator characteristics.
     */
    fun isEmulator(context: Context): Boolean {
        try {
            val buildCheck = checkBuildProperties()
            val hardwareCheck = checkHardwareFeatures(context)
            val operatorCheck = checkOperatorName()

            val checks = listOf(buildCheck, hardwareCheck, operatorCheck)

            // If ANY check indicates emulator, consider it an emulator (strict mode)
            val suspiciousCount = checks.count { it }
            val isEmulator = suspiciousCount >= 1

            BridgeUtils.logDebug(TAG, "Emulator check results: Build=$buildCheck, Hardware=$hardwareCheck, Operator=$operatorCheck")
            BridgeUtils.logDebug(TAG, "Suspicious count: $suspiciousCount/3, isEmulator=$isEmulator")
            BridgeUtils.logDebug(TAG, "Build info: FINGERPRINT=${Build.FINGERPRINT}, MODEL=${Build.MODEL}, MANUFACTURER=${Build.MANUFACTURER}, HARDWARE=${Build.HARDWARE}, DEVICE=${Build.DEVICE}, PRODUCT=${Build.PRODUCT}")

            if (isEmulator) {
                BridgeUtils.logDebug(TAG, "EMULATOR DETECTED (${suspiciousCount}/3 checks positive)")
            } else {
                BridgeUtils.logDebug(TAG, "NOT an emulator (${suspiciousCount}/3 checks positive)")
            }

            return isEmulator
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error during emulator detection: ${e.message}", e)
            return false
        }
    }

    /**
     * Check Build properties for emulator indicators
     */
    private fun checkBuildProperties(): Boolean {
        val fingerprint = Build.FINGERPRINT.lowercase()
        val model = Build.MODEL.lowercase()
        val manufacturer = Build.MANUFACTURER.lowercase()
        val brand = Build.BRAND.lowercase()
        val device = Build.DEVICE.lowercase()
        val product = Build.PRODUCT.lowercase()
        val hardware = Build.HARDWARE.lowercase()

        BridgeUtils.logDebug(TAG, "Build properties - fingerprint: $fingerprint, model: $model, manufacturer: $manufacturer")
        BridgeUtils.logDebug(TAG, "Build properties - brand: $brand, device: $device, product: $product, hardware: $hardware")

        // Check for emulator-specific strings in Build properties
        val hasEmulatorProperty = EMULATOR_PROPERTIES.any {
            val found = fingerprint.contains(it) ||
                model.contains(it) ||
                manufacturer.contains(it) ||
                brand.contains(it) ||
                device.contains(it) ||
                product.contains(it) ||
                hardware.contains(it)
            if (found) {
                BridgeUtils.logDebug(TAG, "Found emulator property: '$it'")
            }
            found
        }

        // Check suspicious manufacturer/model
        val hasSuspiciousManufacturer = SUSPICIOUS_MANUFACTURERS.any {
            val found = manufacturer.contains(it.lowercase())
            if (found) {
                BridgeUtils.logDebug(TAG, "Found suspicious manufacturer: '$it' in '$manufacturer'")
            }
            found
        }
        val hasSuspiciousModel = SUSPICIOUS_MODELS.any {
            val found = model.contains(it.lowercase())
            if (found) {
                BridgeUtils.logDebug(TAG, "Found suspicious model: '$it' in '$model'")
            }
            found
        }

        val result = hasEmulatorProperty || hasSuspiciousManufacturer || hasSuspiciousModel
        BridgeUtils.logDebug(TAG, "checkBuildProperties result: $result (emulatorProp=$hasEmulatorProperty, suspiciousManufacturer=$hasSuspiciousManufacturer, suspiciousModel=$hasSuspiciousModel)")
        return result
    }

    /**
     * Check for missing hardware sensors (common in emulators)
     */
    private fun checkHardwareFeatures(context: Context): Boolean {
        try {
            val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
                ?: return true

            // Real devices typically have these sensors
            val hasAccelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null
            val hasGyroscope = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null
            val hasProximity = sensorManager.getDefaultSensor(Sensor.TYPE_PROXIMITY) != null
            val hasLight = sensorManager.getDefaultSensor(Sensor.TYPE_LIGHT) != null

            BridgeUtils.logDebug(TAG, "Sensor check - Accelerometer: $hasAccelerometer, Gyroscope: $hasGyroscope, Proximity: $hasProximity, Light: $hasLight")

            // Count missing sensors
            val missingSensors = listOf(hasAccelerometer, hasGyroscope, hasProximity, hasLight)
                .count { !it }

            // If 2 or more critical sensors missing, likely an emulator
            val result = missingSensors >= 2
            BridgeUtils.logDebug(TAG, "checkHardwareFeatures result: $result (missing $missingSensors/4 sensors)")
            return result
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error checking hardware features", e)
            return false
        }
    }

    /**
     * Check operator name (emulators often have "Android" as operator)
     */
    private fun checkOperatorName(): Boolean {
        return try {
            val fingerprint = Build.FINGERPRINT
            val hasGeneric = fingerprint.startsWith("generic")
            val hasUnknown = fingerprint.startsWith("unknown")
            val hasTestKeys = fingerprint.lowercase().contains("test-keys")

            val result = hasGeneric || hasUnknown || hasTestKeys
            BridgeUtils.logDebug(TAG, "checkOperatorName result: $result (generic=$hasGeneric, unknown=$hasUnknown, testKeys=$hasTestKeys)")
            BridgeUtils.logDebug(TAG, "Full FINGERPRINT: $fingerprint")
            result
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error checking operator name", e)
            false
        }
    }

    /**
     * Get detailed emulator detection info for debugging
     */
    fun getEmulatorCheckDetails(context: Context): Map<String, Any> {
        return mapOf(
            "isEmulator" to isEmulator(context),
            "buildCheck" to checkBuildProperties(),
            "hardwareCheck" to checkHardwareFeatures(context),
            "operatorCheck" to checkOperatorName(),
            "fingerprint" to Build.FINGERPRINT,
            "model" to Build.MODEL,
            "manufacturer" to Build.MANUFACTURER,
            "hardware" to Build.HARDWARE
        )
    }
}
