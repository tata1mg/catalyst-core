package io.yourname.androidproject.utils

import android.app.Activity
import android.content.Context
import android.webkit.WebView
import java.util.Properties

/**
 * Unified notification manager providing a single interface for all notification operations
 */
class NotificationManager(
    private val context: Context,
    private val properties: Properties
) {
    
    private val TAG = "NotificationManager"
    
    // Delegate instances
    private val notificationUtils = NotificationUtils(context)
    private val pushNotificationUtils = PushNotificationUtils(properties)

    // WebView reference for push notification communication
    private var webView: WebView? = null

    /**
     * Set WebView reference for push notification communication
     * Should be called during app initialization
     */
    fun setWebViewReference(webView: WebView?) {
        this.webView = webView
        BridgeUtils.logInfo(TAG, "NotificationManager initialized with WebView reference")
    }

    /**
     * Get notification utils instance for direct access
     * Used internally for permission handling
     */
    fun getNotificationUtils(): NotificationUtils {
        return notificationUtils
    }
    
    // ==================== LOCAL NOTIFICATIONS ====================
    
    /**
     * Schedule a local notification
     * @param config Notification configuration
     * @return Notification ID for tracking/canceling
     */
    fun scheduleLocal(config: NotificationConfig): String {
        return notificationUtils.scheduleLocalNotification(context, config)
    }
    
    /**
     * Cancel a local notification
     * @param notificationId ID returned from scheduleLocal
     * @return true if successfully canceled
     */
    fun cancelLocal(notificationId: String?): Boolean {
        return notificationUtils.cancelLocalNotification(context, notificationId)
    }
    
    /**
     * Create notification channel (Android 8.0+)
     * @param config Notification configuration containing channel info
     */
    fun createChannel(config: NotificationConfig) {
        notificationUtils.createNotificationChannel(context, config)
    }
    
    
    /**
     * Request notification permission (Android 13+)
     * @param activity Current activity for permission request
     * @param callback Callback with permission result
     */
    fun requestPermission(activity: Activity, callback: (Boolean) -> Unit) {
        notificationUtils.requestNotificationPermission(activity, callback)
    }
    
    // ==================== PUSH NOTIFICATIONS ====================
    
    /**
     * Initialize push notifications and get registration token
     * @param runtimeConfig Optional runtime configuration
     * @return Push token for the device
     */
    suspend fun initializePush(): String {
        return pushNotificationUtils.initializeAndGetToken(context)
    }
    
    /**
     * Handle incoming push notification from FCM
     * @param data Push notification data payload
     */
    fun handleIncomingPush(data: Map<String, String>) {
        pushNotificationUtils.handleIncomingPush(webView, context, data)
    }

    /**
     * Handle token refresh from FCM
     * @param newToken New registration token
     */
    fun handleTokenRefresh(newToken: String) {
        pushNotificationUtils.handleTokenRefresh(webView, context, newToken)
    }
    
    /**
     * Subscribe to push notification topic
     * @param topic Topic name to subscribe to
     * @return true if successfully subscribed
     */
    suspend fun subscribeToTopic(topic: String): Boolean {
        return pushNotificationUtils.subscribeToTopic(context, topic)
    }

    /**
     * Unsubscribe from push notification topic
     * @param topic Topic name to unsubscribe from
     * @return true if successfully unsubscribed
     */
    suspend fun unsubscribeFromTopic(topic: String): Boolean {
        return pushNotificationUtils.unsubscribeFromTopic(context, topic)
    }
    
    /**
     * Get current push token
     * @return Current push token or null if not available
     */
    fun getPushToken(): String? {
        return pushNotificationUtils.getPushToken(context)
    }
    
    /**
     * Get current push provider (currently FCM only)
     * @return Current push provider name or null if not set
     */
    fun getPushProvider(): String? {
        return pushNotificationUtils.getPushProvider(context)
    }
    
    /**
     * Get list of subscribed topics
     * @return Set of subscribed topic names
     */
    fun getSubscribedTopics(): Set<String> {
        return pushNotificationUtils.getSubscribedTopics(context)
    }
    
    /**
     * Delete all push notification data
     * @return true if successfully deleted
     */
    suspend fun deletePushData(): Boolean {
        return pushNotificationUtils.deleteAllPushData(context)
    }
    
    /**
     * Check if push notifications are available
     * @return true if push notifications are supported
     */
    fun isPushAvailable(): Boolean {
        return pushNotificationUtils.isAvailable(context)
    }
}