package io.yourname.androidproject.security

import android.content.Context
import kotlinx.coroutines.*
import io.yourname.androidproject.utils.BridgeUtils
import org.json.JSONObject

/**
 * SecurityCheckScheduler is a singleton object that manages automatic security checks
 * on Android application startup. This runs automatically when the app launches from
 * MainActivity.onCreate() and performs security checks in a background thread to avoid
 * blocking the main UI thread.
 *
 * Local checks (root, emulator, Frida) run on EVERY app launch for real-time security.
 * Play Integrity API check is cached for 24 hours to optimize network calls and API quota.
 */
object SecurityCheckScheduler {

    /**
     * Callback interface for security check completion
     */
    interface SecurityCheckCallback {
        fun onSecurityCheckComplete(results: JSONObject)
    }

    /**
     * Initialize security check scheduler. This method should be called from
     * MainActivity.onCreate() to automatically schedule security checks on app startup.
     *
     * Local security checks (root, emulator, Frida) run on EVERY app launch.
     * Play Integrity API check is cached for 24 hours to reduce network overhead.
     * All checks run in a background coroutine without blocking the main thread.
     *
     * @param context The Android context used to access SharedPreferences and perform checks
     * @param scope The CoroutineScope to launch checks in (usually lifecycleScope)
     * @param callback Optional callback to receive security check results
     */
    fun initialize(context: Context, scope: CoroutineScope, callback: SecurityCheckCallback? = null) {
        try {
            BridgeUtils.logDebug("SecurityCheckScheduler", "Initializing security check scheduler")

            // Launch background coroutine to perform security checks
            // Local checks (root, emulator, Frida) always run - they're fast and critical
            // Play Integrity check is cached internally by SecurityCheckManager
            scope.launch(Dispatchers.IO) {
                try {
                    BridgeUtils.logDebug("SecurityCheckScheduler", "Starting background security checks")

                    // Perform the actual security checks
                    val results = SecurityCheckManager.performSecurityChecks(context)

                    BridgeUtils.logDebug("SecurityCheckScheduler", "Security checks completed successfully")

                    // Notify callback on main thread
                    callback?.let {
                        withContext(Dispatchers.Main) {
                            it.onSecurityCheckComplete(results)
                        }
                    }
                } catch (e: Exception) {
                    BridgeUtils.logError("SecurityCheckScheduler", "Error during security checks: ${e.message}", e)
                }
            }
        } catch (e: Exception) {
            BridgeUtils.logError("SecurityCheckScheduler", "Error initializing scheduler: ${e.message}", e)
        }
    }
}
