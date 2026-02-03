package io.yourname.androidproject.security

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.*
import org.json.JSONObject
import com.scottyab.rootbeer.RootBeer
import io.yourname.androidproject.utils.BridgeUtils
// TODO: [Play Integrity] Uncomment when Play Integrity is picked up
// import com.google.android.play.core.integrity.IntegrityManagerFactory
// import com.google.android.play.core.integrity.IntegrityTokenRequest
// import java.net.HttpURLConnection
// import java.net.URL
// import java.io.OutputStreamWriter
// import java.security.SecureRandom

object SecurityCheckManager {

    private const val PREFERENCES_NAME = "security_check_prefs"

    // TODO: [Play Integrity] Uncomment when Play Integrity is picked up
    // private const val PLAY_INTEGRITY_CACHE_KEY = "play_integrity_cache"
    // private const val PLAY_INTEGRITY_TIMESTAMP_KEY = "play_integrity_timestamp"
    // private const val PLAY_INTEGRITY_CACHE_VALIDITY_MS = 86400000L // 24 hours in milliseconds

    /**
     * Performs comprehensive security checks asynchronously using coroutines.
     *
     * Local checks (root, emulator, Frida) run on EVERY call - they're fast and critical.
     * Play Integrity API check is cached for 24 hours to optimize network calls.
     *
     * @param context Android context
     * @return JSONObject containing security check results
     */
    suspend fun performSecurityChecks(context: Context): JSONObject = withContext(Dispatchers.Default) {
        return@withContext try {
            BridgeUtils.logDebug("SecurityCheckManager", "Starting security checks")

            // Local checks ALWAYS run - they're fast and critical for real-time security
            val rootCheckDeferred = async { checkRooted(context) }
            val emulatorCheckDeferred = async { checkEmulator(context) }
            val fridaCheckDeferred = async { checkFridaDetected() }

            val isRooted = rootCheckDeferred.await()
            val isEmulator = emulatorCheckDeferred.await()
            val isFridaDetected = fridaCheckDeferred.await()

            // TODO: [Play Integrity] Uncomment when Play Integrity is picked up.
            // Pending: Issue 4 (nonce validation) and Issue 5 (connection.disconnect in finally).
            // val googleToken = getGoogleToken(context)
            // val playIntegrityResult = if (googleToken != null) {
            //     BridgeUtils.logDebug("SecurityCheckManager", "googleToken found - running Play Integrity check")
            //     getCachedPlayIntegrityResult(context)
            //         ?: performPlayIntegrityCheck(context).also { result ->
            //             if (result.isAvailable) {
            //                 cachePlayIntegrityResult(context, result)
            //             }
            //         }
            // } else {
            //     BridgeUtils.logDebug("SecurityCheckManager", "googleToken not configured - skipping Play Integrity check")
            //     PlayIntegrityResult(isAvailable = false)
            // }
            val playIntegrityResult = PlayIntegrityResult(isAvailable = false)

            // Determine if device is compromised
            // Compromised = Rooted OR Emulator OR Frida OR Play Integrity failed (any critical security risk)
            val isCompromised = isRooted || isEmulator || isFridaDetected || playIntegrityResult.failed

            // Calculate recommendation based on security status
            val recommendation = calculateRecommendation(isRooted, isEmulator, isFridaDetected, playIntegrityResult.failed)

            val timestamp = System.currentTimeMillis()

            // Build results JSONObject
            val results = JSONObject().apply {
                put("isRooted", isRooted)
                put("isEmulator", isEmulator)
                put("isFridaDetected", isFridaDetected)
                put("isCompromised", isCompromised)
                put("recommendation", recommendation)
                put("timestamp", timestamp)
                put("pending", false)

                // Add Play Integrity results if available
                if (playIntegrityResult.isAvailable) {
                    put("playIntegrity", JSONObject().apply {
                        put("isSecure", playIntegrityResult.isSecure)
                        put("verdict", playIntegrityResult.verdict)
                    })
                }
            }

            // Save the latest results for DeviceInfoUtils
            saveLatestResults(context, results)

            BridgeUtils.logDebug("SecurityCheckManager", "========================================")
            BridgeUtils.logDebug("SecurityCheckManager", "===== SECURITY CHECK SUMMARY =====")
            BridgeUtils.logDebug("SecurityCheckManager", "Root detected:          $isRooted")
            BridgeUtils.logDebug("SecurityCheckManager", "Emulator detected:      $isEmulator")
            BridgeUtils.logDebug("SecurityCheckManager", "Frida detected:         $isFridaDetected")
            BridgeUtils.logDebug("SecurityCheckManager", "Play Integrity secure:  ${playIntegrityResult.isSecure}")
            BridgeUtils.logDebug("SecurityCheckManager", "Device compromised:     $isCompromised")
            BridgeUtils.logDebug("SecurityCheckManager", "Recommendation:         $recommendation")
            BridgeUtils.logDebug("SecurityCheckManager", "===================================")
            BridgeUtils.logDebug("SecurityCheckManager", "========================================")

            results
        } catch (e: Exception) {
            BridgeUtils.logError("SecurityCheckManager", "Error during security checks: ${e.message}", e)
            createErrorResponse()
        }
    }

    // TODO: [Play Integrity] Uncomment when Play Integrity is picked up
    // private fun getCachedPlayIntegrityResult(context: Context): PlayIntegrityResult? {
    //     return try {
    //         val sharedPreferences = getSharedPreferences(context)
    //         val cachedJsonString = sharedPreferences.getString(PLAY_INTEGRITY_CACHE_KEY, null)
    //         val timestamp = sharedPreferences.getLong(PLAY_INTEGRITY_TIMESTAMP_KEY, 0L)
    //
    //         if (cachedJsonString != null && isPlayIntegrityCacheValid(timestamp)) {
    //             val json = JSONObject(cachedJsonString)
    //             BridgeUtils.logDebug("SecurityCheckManager", "Using cached Play Integrity result")
    //             PlayIntegrityResult(
    //                 isAvailable = json.optBoolean("isAvailable", false),
    //                 isSecure = json.optBoolean("isSecure", false),
    //                 failed = json.optBoolean("failed", false),
    //                 verdict = json.optString("verdict", "UNKNOWN")
    //             )
    //         } else {
    //             BridgeUtils.logDebug("SecurityCheckManager", "Play Integrity cache expired or not found")
    //             null
    //         }
    //     } catch (e: Exception) {
    //         BridgeUtils.logError("SecurityCheckManager", "Error retrieving cached Play Integrity data: ${e.message}", e)
    //         null
    //     }
    // }

    // TODO: [Play Integrity] Uncomment when Play Integrity is picked up
    // private fun cachePlayIntegrityResult(context: Context, result: PlayIntegrityResult) {
    //     try {
    //         val sharedPreferences = getSharedPreferences(context)
    //         val json = JSONObject().apply {
    //             put("isAvailable", result.isAvailable)
    //             put("isSecure", result.isSecure)
    //             put("failed", result.failed)
    //             put("verdict", result.verdict)
    //         }
    //
    //         sharedPreferences.edit()
    //             .putString(PLAY_INTEGRITY_CACHE_KEY, json.toString())
    //             .putLong(PLAY_INTEGRITY_TIMESTAMP_KEY, System.currentTimeMillis())
    //             .apply()
    //
    //         BridgeUtils.logDebug("SecurityCheckManager", "Play Integrity result cached for 24 hours")
    //     } catch (e: Exception) {
    //         BridgeUtils.logError("SecurityCheckManager", "Error caching Play Integrity result: ${e.message}", e)
    //     }
    // }

    /**
     * Checks if the device is rooted using RootBeer library.
     *
     * @param context Android context
     * @return Boolean indicating if device is rooted
     */
    private suspend fun checkRooted(context: Context): Boolean = withContext(Dispatchers.Default) {
        return@withContext try {
            val rootBeer = RootBeer(context)

            // Get detailed root check results
            val isRooted = rootBeer.isRooted

            BridgeUtils.logDebug("SecurityCheckManager", "=== ROOT CHECK DETAILS ===")
            BridgeUtils.logDebug("SecurityCheckManager", "Root detected: $isRooted")
            BridgeUtils.logDebug("SecurityCheckManager", "==========================")

            isRooted
        } catch (e: Exception) {
            BridgeUtils.logError("SecurityCheckManager", "Error checking root status: ${e.message}", e)
            false
        }
    }

    /**
     * Checks if the application is running on an emulator.
     *
     * @param context Android context
     * @return Boolean indicating if running on emulator
     */
    private suspend fun checkEmulator(context: Context): Boolean = withContext(Dispatchers.Default) {
        return@withContext try {
            val isEmulator = EmulatorDetector.isEmulator(context)
            BridgeUtils.logDebug("SecurityCheckManager", "Emulator check result: $isEmulator")
            isEmulator
        } catch (e: Exception) {
            BridgeUtils.logError("SecurityCheckManager", "Error checking emulator status: ${e.message}", e)
            false
        }
    }

    /**
     * Checks if Frida hooking framework is detected on the device.
     *
     * @return Boolean indicating if Frida is detected
     */
    private suspend fun checkFridaDetected(): Boolean = withContext(Dispatchers.Default) {
        return@withContext try {
            val isFridaDetected = FridaDetector.isFridaDetected()
            BridgeUtils.logDebug("SecurityCheckManager", "Frida detection result: $isFridaDetected")
            isFridaDetected
        } catch (e: Exception) {
            BridgeUtils.logError("SecurityCheckManager", "Error checking Frida detection: ${e.message}", e)
            false
        }
    }

    // Data class kept active — used by the hardcoded fallback above while Play Integrity is deferred
    private data class PlayIntegrityResult(
        val isAvailable: Boolean = false,
        val isSecure: Boolean = false,
        val failed: Boolean = false,
        val verdict: String = "UNKNOWN"
    )

    // TODO: [Play Integrity] Uncomment when Play Integrity is picked up.
    // Pending: Issue 4 (send nonce alongside token, validate on server) and
    //          Issue 5 (wrap HttpURLConnection in try/finally with disconnect()).
    // private suspend fun performPlayIntegrityCheck(context: Context): PlayIntegrityResult = withContext(Dispatchers.IO) {
    //     return@withContext try {
    //         val nonce = generateNonce()
    //         BridgeUtils.logDebug("SecurityCheckManager", "Requesting Play Integrity token with nonce")
    //
    //         val integrityManager = IntegrityManagerFactory.create(context)
    //         val integrityTokenRequest = IntegrityTokenRequest.builder()
    //             .setNonce(nonce)
    //             .build()
    //
    //         val tokenResponse = integrityManager.requestIntegrityToken(integrityTokenRequest)
    //
    //         val token = suspendCancellableCoroutine<String?> { continuation ->
    //             tokenResponse.addOnSuccessListener { response ->
    //                 BridgeUtils.logDebug("SecurityCheckManager", "Play Integrity token received")
    //                 continuation.resumeWith(Result.success(response.token()))
    //             }
    //             tokenResponse.addOnFailureListener { exception ->
    //                 BridgeUtils.logError("SecurityCheckManager", "Failed to get Play Integrity token: ${exception.message}", exception)
    //                 continuation.resumeWith(Result.success(null))
    //             }
    //         }
    //
    //         if (token == null) {
    //             BridgeUtils.logDebug("SecurityCheckManager", "Play Integrity token is null, skipping verification")
    //             return@withContext PlayIntegrityResult(isAvailable = false)
    //         }
    //
    //         val verificationResult = verifyIntegrityTokenWithServer(context, token, nonce)
    //
    //         if (verificationResult != null) {
    //             PlayIntegrityResult(
    //                 isAvailable = true,
    //                 isSecure = verificationResult.isSecure,
    //                 failed = !verificationResult.isSecure,
    //                 verdict = verificationResult.verdict
    //             )
    //         } else {
    //             PlayIntegrityResult(isAvailable = false)
    //         }
    //     } catch (e: Exception) {
    //         BridgeUtils.logError("SecurityCheckManager", "Error during Play Integrity check: ${e.message}", e)
    //         PlayIntegrityResult(isAvailable = false)
    //     }
    // }

    // TODO: [Play Integrity] Uncomment when Play Integrity is picked up.
    // private data class VerificationResponse(
    //     val isSecure: Boolean,
    //     val verdict: String
    // )

    // TODO: [Play Integrity] Uncomment when Play Integrity is picked up.
    // private fun generateNonce(): String {
    //     val random = SecureRandom()
    //     val bytes = ByteArray(32)
    //     random.nextBytes(bytes)
    //     return bytes.joinToString("") { "%02x".format(it) }
    // }

    // TODO: [Play Integrity] Uncomment when Play Integrity is picked up.
    // Pending: Issue 4 (send nonce in payload, validate on server) and
    //          Issue 5 (wrap connection in try/finally with connection.disconnect()).
    // private suspend fun verifyIntegrityTokenWithServer(context: Context, token: String, nonce: String): VerificationResponse? = withContext(Dispatchers.IO) {
    //     return@withContext try {
    //         val serverUrl = getServerUrl(context)
    //         BridgeUtils.logDebug("SecurityCheckManager", "Sending token to server for verification: $serverUrl")
    //
    //         val url = URL("$serverUrl/api/verify-device")
    //         val connection = url.openConnection() as HttpURLConnection
    //         try {
    //             connection.requestMethod = "POST"
    //             connection.setRequestProperty("Content-Type", "application/json")
    //             connection.doOutput = true
    //             connection.connectTimeout = 10000
    //             connection.readTimeout = 10000
    //
    //             val jsonPayload = JSONObject().apply {
    //                 put("token", token)
    //                 put("nonce", nonce)  // Issue 4: send nonce for server-side validation
    //             }
    //
    //             val writer = OutputStreamWriter(connection.outputStream)
    //             writer.write(jsonPayload.toString())
    //             writer.flush()
    //             writer.close()
    //
    //             val responseCode = connection.responseCode
    //             BridgeUtils.logDebug("SecurityCheckManager", "Server response code: $responseCode")
    //
    //             if (responseCode == HttpURLConnection.HTTP_OK) {
    //                 val response = connection.inputStream.bufferedReader().use { it.readText() }
    //                 val jsonResponse = JSONObject(response)
    //
    //                 val success = jsonResponse.optBoolean("success", false)
    //                 if (success) {
    //                     val isSecure = jsonResponse.optBoolean("isSecure", false)
    //                     val verdict = jsonResponse.optJSONObject("verdict")?.toString() ?: "UNKNOWN"
    //                     BridgeUtils.logDebug("SecurityCheckManager", "Play Integrity verification result - isSecure: $isSecure")
    //                     VerificationResponse(isSecure = isSecure, verdict = verdict)
    //                 } else {
    //                     BridgeUtils.logError("SecurityCheckManager", "Server returned success=false", null)
    //                     null
    //                 }
    //             } else {
    //                 val errorResponse = connection.errorStream?.bufferedReader()?.use { it.readText() } ?: "No error details"
    //                 BridgeUtils.logError("SecurityCheckManager", "Server verification failed with code $responseCode: $errorResponse", null)
    //                 null
    //             }
    //         } finally {
    //             connection.disconnect()  // Issue 5: guaranteed cleanup
    //         }
    //     } catch (e: Exception) {
    //         BridgeUtils.logError("SecurityCheckManager", "Error verifying token with server: ${e.message}", e)
    //         null
    //     }
    // }

    /**
     * Reads webview_config.properties once and caches it.
     */
    private fun readProperties(context: Context): java.util.Properties {
        return try {
            context.assets.open("webview_config.properties").use { stream ->
                java.util.Properties().apply { load(stream) }
            }
        } catch (e: Exception) {
            BridgeUtils.logError("SecurityCheckManager", "Error reading webview_config.properties: ${e.message}", e)
            java.util.Properties()
        }
    }

    // TODO: [Play Integrity] Uncomment when Play Integrity is picked up.
    // private fun getServerUrl(context: Context): String {
    //     val properties = readProperties(context)
    //     val url = properties.getProperty("apiBaseUrl")?.trimEnd('/')
    //
    //     if (url.isNullOrEmpty()) {
    //         BridgeUtils.logError(
    //             "SecurityCheckManager",
    //             "FATAL: apiBaseUrl not configured in webview_config.properties. Play Integrity verification cannot proceed.",
    //             null
    //         )
    //         throw IllegalStateException("apiBaseUrl must be configured in webview_config.properties for Play Integrity verification")
    //     }
    //
    //     return url
    // }

    /**
     * Reads security.mode from config. Defaults to "default" if not specified.
     */
    fun getSecurityMode(context: Context): String {
        val properties = readProperties(context)
        return properties.getProperty("android.security.mode", "default")
    }

    // TODO: [Play Integrity] Uncomment when Play Integrity is picked up.
    // fun getGoogleToken(context: Context): String? {
    //     val properties = readProperties(context)
    //     val token = properties.getProperty("android.security.googleToken", "")
    //     return token.ifEmpty { null }
    // }

    /**
     * Calculates security recommendation based on check results.
     * Returns simple string: BLOCK or ALLOW
     *
     * @param isRooted Device root status
     * @param isEmulator Emulator detection status
     * @param isFridaDetected Frida detection status
     * @param playIntegrityFailed Play Integrity check failed
     * @return Recommendation string (BLOCK/ALLOW)
     */
    private fun calculateRecommendation(
        isRooted: Boolean,
        isEmulator: Boolean,
        isFridaDetected: Boolean,
        playIntegrityFailed: Boolean = false
    ): String {
        return when {
            // Critical: Block if any major security risk detected
            isRooted || isEmulator || isFridaDetected || playIntegrityFailed -> "BLOCK"
            // Clean: Allow normal operation
            else -> "ALLOW"
        }
    }

    // TODO: [Play Integrity] Uncomment when Play Integrity is picked up.
    // private fun isPlayIntegrityCacheValid(timestamp: Long): Boolean {
    //     val currentTime = System.currentTimeMillis()
    //     val age = currentTime - timestamp
    //     val isValid = age < PLAY_INTEGRITY_CACHE_VALIDITY_MS
    //     BridgeUtils.logDebug("SecurityCheckManager", "Play Integrity cache age: ${age}ms, Valid: $isValid")
    //     return isValid
    // }

    /**
     * Gets or creates SharedPreferences instance for security checks.
     *
     * @param context Android context
     * @return SharedPreferences instance
     */
    private fun getSharedPreferences(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    }

    /**
     * Creates an error response JSONObject when security checks fail.
     * Uses fail-closed approach: BLOCK access when checks crash to prevent security bypass.
     *
     * @return JSONObject with fail-closed defaults
     */
    private fun createErrorResponse(): JSONObject {
        return JSONObject().apply {
            put("isRooted", false)
            put("isEmulator", false)
            put("isFridaDetected", false)
            put("isCompromised", true)  // Fail-closed: mark as compromised on error
            put("recommendation", "BLOCK")  // Fail-closed: BLOCK access on error
            put("timestamp", System.currentTimeMillis())
            put("pending", true)
        }
    }

    /**
     * Retrieves the most recent security check results from SharedPreferences.
     * Used by DeviceInfoUtils to return cached results to JavaScript.
     *
     * Note: This returns the last completed check results, not necessarily fresh data.
     * Security checks run automatically on app launch via SecurityCheckScheduler.
     *
     * @param context Android context
     * @return JSONObject with latest security results or null if no results available
     */
    fun getLatestSecurityResults(context: Context): JSONObject? {
        return try {
            val sharedPreferences = getSharedPreferences(context)
            val cachedJsonString = sharedPreferences.getString("latest_security_results", null)

            if (cachedJsonString != null) {
                JSONObject(cachedJsonString)
            } else {
                null
            }
        } catch (e: Exception) {
            BridgeUtils.logError("SecurityCheckManager", "Error retrieving latest security results: ${e.message}", e)
            null
        }
    }

    /**
     * Saves the latest security results to SharedPreferences for DeviceInfoUtils access.
     * Called internally after each security check completes.
     *
     * @param context Android context
     * @param results JSONObject containing security check results
     */
    private fun saveLatestResults(context: Context, results: JSONObject) {
        try {
            val sharedPreferences = getSharedPreferences(context)
            sharedPreferences.edit()
                .putString("latest_security_results", results.toString())
                .apply()
            BridgeUtils.logDebug("SecurityCheckManager", "Latest security results saved")
        } catch (e: Exception) {
            BridgeUtils.logError("SecurityCheckManager", "Error saving latest results: ${e.message}", e)
        }
    }

    // TODO: [Play Integrity] Uncomment when Play Integrity is picked up.
    // fun clearPlayIntegrityCache(context: Context) {
    //     try {
    //         val sharedPreferences = getSharedPreferences(context)
    //         val editor = sharedPreferences.edit()
    //         editor.remove(PLAY_INTEGRITY_CACHE_KEY)
    //         editor.remove(PLAY_INTEGRITY_TIMESTAMP_KEY)
    //         editor.apply()
    //         BridgeUtils.logDebug("SecurityCheckManager", "Play Integrity cache cleared")
    //     } catch (e: Exception) {
    //         BridgeUtils.logError("SecurityCheckManager", "Error clearing Play Integrity cache: ${e.message}", e)
    //     }
    // }
}
