package io.yourname.androidproject.security

import android.app.Activity
import android.util.Log
import android.view.View
import io.yourname.androidproject.MainActivity
import io.yourname.androidproject.R
import org.json.JSONObject

/**
 * SecurityAlertHandler handles the display of security alerts when device compromise is detected.
 * Uses a Material Design BottomSheet with smooth animations.
 * This utility class keeps MainActivity clean and focused on its primary responsibilities.
 */
object SecurityAlertHandler {

    private const val TAG = "SecurityAlertHandler"
    private var currentBottomSheet: SecurityBottomSheet? = null

    /**
     * Handle security check results and show alert if device is compromised.
     * This method parses the security check results and displays a bottom sheet alert
     * if any threats are detected.
     *
     * @param activity The activity context to display the alert
     * @param results JSONObject containing security check results
     */
    fun handleSecurityCheckResults(activity: Activity, results: JSONObject) {
        try {
            val securityMode = SecurityCheckManager.getSecurityMode(activity)
            val isCompromised = results.optBoolean("isCompromised", false)

            Log.d(TAG, "Security mode: $securityMode, isCompromised: $isCompromised")

            // custom mode: no UI, data is already saved via SecurityCheckManager for getDeviceInfo()
            if (securityMode == "custom") {
                Log.d(TAG, "Security mode is custom - skipping bottom sheet, data available via getDeviceInfo()")
                return
            }

            // default mode: show bottom sheet if compromised
            if (isCompromised) {
                val isRooted = results.optBoolean("isRooted", false)
                val isEmulator = results.optBoolean("isEmulator", false)
                val isFridaDetected = results.optBoolean("isFridaDetected", false)

                val threats = mutableListOf<String>()
                if (isRooted) threats.add("Root access detected")
                if (isEmulator) threats.add("Running on emulator")
                if (isFridaDetected) threats.add("Frida framework detected")

                activity.runOnUiThread {
                    showSecurityBottomSheet(activity, threats)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error handling security check results: ${e.message}", e)
        }
    }

    /**
     * Show security alert as a bottom sheet when device is compromised.
     * The bottom sheet slides up from the bottom with animation and hides the WebView.
     *
     * @param activity The activity context to display the alert
     * @param threats List of detected security threats
     */
    private fun showSecurityBottomSheet(activity: Activity, threats: List<String>) {
        if (activity.isFinishing || activity.isDestroyed) {
            Log.w(TAG, "Cannot show security alert - activity is finishing or destroyed")
            return
        }

        // Dismiss any existing bottom sheet
        currentBottomSheet?.dismiss()

        // Hide WebView if this is MainActivity
        hideWebView(activity)

        // Create the UI view for the bottom sheet
        val alertView = SecurityAlertUI.createSecurityAlertView(
            context = activity,
            threats = threats,
            onExitClick = {
                currentBottomSheet?.dismiss()
                activity.finish()
            }
        )

        // Create and show the bottom sheet
        currentBottomSheet = SecurityBottomSheet(
            activity = activity,
            customView = alertView,
            onDismiss = {
                // Clean up reference when dismissed
                currentBottomSheet = null
            }
        )

        currentBottomSheet?.show(animated = true)

        Log.d(TAG, "Security bottom sheet displayed with ${threats.size} threats")
    }

    /**
     * Hide the WebView with smooth fade-out animation when security alert is shown.
     * Uses Material Design animation timing for professional transitions.
     *
     * @param activity The activity context
     */
    private fun hideWebView(activity: Activity) {
        if (activity is MainActivity) {
            try {
                val webViewContainer = activity.findViewById<View>(R.id.webview)
                if (webViewContainer != null && webViewContainer.visibility == View.VISIBLE) {
                    // Fade out animation (300ms - Material Design standard)
                    webViewContainer.animate()
                        .alpha(0f)
                        .setDuration(300L)
                        .withEndAction {
                            webViewContainer.visibility = View.GONE
                            Log.d(TAG, "WebView hidden with fade animation")
                        }
                        .start()
                } else {
                    Log.w(TAG, "WebView container not found or already hidden")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error hiding WebView: ${e.message}", e)
            }
        }
    }

    /**
     * Show the WebView with smooth fade-in animation.
     * Can be used to restore WebView if security alert is dismissed (though typically we exit app).
     *
     * @param activity The activity context
     */
    fun showWebView(activity: Activity) {
        if (activity is MainActivity) {
            try {
                val webViewContainer = activity.findViewById<View>(R.id.webview)
                if (webViewContainer != null && webViewContainer.visibility != View.VISIBLE) {
                    webViewContainer.visibility = View.VISIBLE
                    webViewContainer.alpha = 0f
                    // Fade in animation (300ms - Material Design standard)
                    webViewContainer.animate()
                        .alpha(1f)
                        .setDuration(300L)
                        .withEndAction {
                            Log.d(TAG, "WebView shown with fade animation")
                        }
                        .start()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error showing WebView: ${e.message}", e)
            }
        }
    }

    /**
     * Dismiss the current security bottom sheet if showing.
     */
    fun dismissCurrentBottomSheet() {
        currentBottomSheet?.dismiss()
        currentBottomSheet = null
    }
}

