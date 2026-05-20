package io.yourname.androidproject.utils

import android.content.Context
import android.webkit.WebView
import java.util.Properties

/**
 * No-op stub for Push Notification Utils when Firebase is disabled
 * This provides empty implementations so the app compiles without Firebase dependencies
 */
class PushNotificationUtils(private val properties: Properties = Properties()) {

    companion object {
        private const val TAG = "PushNotificationUtils"
        const val ACTION_MESSAGE_RECEIVED = "io.yourname.androidproject.PUSH_MESSAGE_RECEIVED"
        const val ACTION_TOKEN_REFRESHED = "io.yourname.androidproject.PUSH_TOKEN_REFRESHED"
        const val EXTRA_MESSAGE_DATA = "message_data"
        const val EXTRA_TOKEN = "token"
    }

    /**
     * Initialize and get FCM token (no-op)
     */
    fun initializeAndGetToken(context: Context): String {
        BridgeUtils.logInfo(TAG, "Push notifications not available (noFcm flavor)")
        return ""
    }

    /**
     * Handle incoming push notification (no-op)
     */
    fun handleIncomingPush(webView: WebView?, context: Context, data: Map<String, String>) {
        BridgeUtils.logWarning(TAG, "Push notifications not available (noFcm flavor)")
    }

    /**
     * Handle token refresh (no-op)
     */
    fun handleTokenRefresh(webView: WebView?, newToken: String) {
        BridgeUtils.logWarning(TAG, "Push notifications not available (noFcm flavor)")
    }

    /**
     * Subscribe to topic (no-op)
     */
    fun subscribeToTopic(context: Context, topic: String): Boolean {
        BridgeUtils.logWarning(TAG, "Push notifications not available (noFcm flavor)")
        return false
    }

    /**
     * Unsubscribe from topic (no-op)
     */
    fun unsubscribeFromTopic(context: Context, topic: String): Boolean {
        BridgeUtils.logWarning(TAG, "Push notifications not available (noFcm flavor)")
        return false
    }

    /**
     * Get current push token (no-op)
     */
    fun getPushToken(context: Context): String? {
        return null
    }

    /**
     * Get subscribed topics (no-op)
     */
    fun getSubscribedTopics(context: Context): Set<String> {
        return emptySet()
    }

    /**
     * Delete all push data (no-op)
     */
    fun deleteAllPushData(context: Context): Boolean {
        BridgeUtils.logWarning(TAG, "Push notifications not available (noFcm flavor)")
        return false
    }

    /**
     * Get current push provider (no-op)
     */
    fun getPushProvider(context: Context): String {
        return "none"
    }

    /**
     * Check if FCM is available (always false for noFcm flavor)
     */
    fun isAvailable(context: Context): Boolean {
        return false
    }
}
