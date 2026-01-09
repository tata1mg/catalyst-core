package io.yourname.androidproject.utils

import android.app.Activity
import android.content.Context
import android.webkit.WebView
import java.util.Properties

/**
 * Unified notification manager providing a single interface for all notification operations
 * No-op stub version when Firebase is disabled
 */
class AppNotificationManager(
    private val context: Context,
    private val properties: Properties
) {

    private val TAG = "AppNotificationManager"

    // Delegate instances
    private val notificationUtils = NotificationUtils(context)
    private val pushNotificationUtils = PushNotificationUtils(properties)

    // WebView reference for push notification communication
    private var webView: WebView? = null

    /**
     * Initialize notification manager (no-op for noFcm)
     */
    fun initialize() {
        BridgeUtils.logInfo(TAG, "AppNotificationManager initialized (noFcm flavor)")
    }

    /**
     * Set WebView reference for push notification communication
     */
    fun setWebViewReference(webView: WebView?) {
        this.webView = webView
        BridgeUtils.logInfo(TAG, "WebView reference set")
    }

    /**
     * Cleanup (no-op for noFcm)
     */
    fun cleanup() {
        BridgeUtils.logInfo(TAG, "AppNotificationManager cleanup completed")
    }

    /**
     * Get notification utils instance for direct access
     */
    fun getNotificationUtils(): NotificationUtils {
        return notificationUtils
    }

    // ==================== LOCAL NOTIFICATIONS ====================

    /**
     * Schedule a local notification
     */
    fun scheduleLocal(config: NotificationConfig): String {
        return notificationUtils.scheduleLocalNotification(context, config)
    }

    /**
     * Cancel a local notification
     */
    fun cancelLocal(notificationId: String?): Boolean {
        return notificationUtils.cancelLocalNotification(context, notificationId)
    }

    /**
     * Create notification channel (Android 8.0+)
     */
    fun createChannel(config: NotificationConfig) {
        notificationUtils.createNotificationChannel(context, config)
    }


    /**
     * Request notification permission (Android 13+)
     */
    fun requestPermission(activity: Activity, callback: (Boolean) -> Unit) {
        notificationUtils.requestNotificationPermission(activity, callback)
    }

    // ==================== PUSH NOTIFICATIONS ====================

    /**
     * Initialize push notifications (no-op)
     */
    suspend fun initializePush(): String {
        BridgeUtils.logInfo(TAG, "Push notifications not available (noFcm flavor)")
        return ""
    }

    /**
     * Handle incoming push notification (no-op)
     */
    fun handleIncomingPush(data: Map<String, String>) {
        BridgeUtils.logWarning(TAG, "Push notifications not available (noFcm flavor)")
    }

    /**
     * Handle token refresh (no-op)
     */
    fun handleTokenRefresh(newToken: String) {
        BridgeUtils.logWarning(TAG, "Push notifications not available (noFcm flavor)")
    }

    /**
     * Subscribe to push notification topic (no-op)
     */
    suspend fun subscribeToTopic(topic: String): Boolean {
        return pushNotificationUtils.subscribeToTopic(context, topic)
    }

    /**
     * Unsubscribe from push notification topic (no-op)
     */
    suspend fun unsubscribeFromTopic(topic: String): Boolean {
        return pushNotificationUtils.unsubscribeFromTopic(context, topic)
    }

    /**
     * Get current push token (always null)
     */
    fun getPushToken(): String? {
        return pushNotificationUtils.getPushToken(context)
    }

    /**
     * Get current push provider (returns "none")
     */
    fun getPushProvider(): String? {
        return pushNotificationUtils.getPushProvider(context)
    }

    /**
     * Get list of subscribed topics (always empty)
     */
    fun getSubscribedTopics(): Set<String> {
        return pushNotificationUtils.getSubscribedTopics(context)
    }

    /**
     * Delete all push notification data (no-op)
     */
    suspend fun deletePushData(): Boolean {
        return pushNotificationUtils.deleteAllPushData(context)
    }

    /**
     * Check if push notifications are available (always false)
     */
    fun isPushAvailable(): Boolean {
        return false
    }
}
