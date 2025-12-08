package io.yourname.androidproject.utils

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.webkit.WebView
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import java.util.Properties

/**
 * Unified notification manager providing a single interface for all notification operations
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

    // Broadcast receiver for push notifications
    private val pushNotificationReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                PushNotificationUtils.ACTION_MESSAGE_RECEIVED -> {
                    @Suppress("UNCHECKED_CAST", "DEPRECATION")
                    val data = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                        intent.getSerializableExtra(PushNotificationUtils.EXTRA_MESSAGE_DATA, HashMap::class.java) as? HashMap<String, String>
                    } else {
                        intent.getSerializableExtra(PushNotificationUtils.EXTRA_MESSAGE_DATA) as? HashMap<String, String>
                    }
                    data?.let { handleIncomingPush(it) }
                }
                PushNotificationUtils.ACTION_TOKEN_REFRESHED -> {
                    val token = intent.getStringExtra(PushNotificationUtils.EXTRA_TOKEN)
                    token?.let { handleTokenRefresh(it) }
                }
            }
        }
    }

    /**
     * Initialize notification manager and register broadcast receivers
     * Should be called during app initialization
     */
    fun initialize() {
        val filter = IntentFilter().apply {
            addAction(PushNotificationUtils.ACTION_MESSAGE_RECEIVED)
            addAction(PushNotificationUtils.ACTION_TOKEN_REFRESHED)
        }
        LocalBroadcastManager.getInstance(context).registerReceiver(pushNotificationReceiver, filter)
        BridgeUtils.logInfo(TAG, "AppNotificationManager initialized and broadcast receiver registered")
    }

    /**
     * Set WebView reference for push notification communication
     * Should be called during app initialization
     */
    fun setWebViewReference(webView: WebView?) {
        this.webView = webView
        BridgeUtils.logInfo(TAG, "WebView reference set")
    }

    /**
     * Cleanup and unregister broadcast receivers
     * Should be called when the activity is destroyed
     */
    fun cleanup() {
        LocalBroadcastManager.getInstance(context).unregisterReceiver(pushNotificationReceiver)
        BridgeUtils.logInfo(TAG, "AppNotificationManager cleanup completed")
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
     * @return Push token for the device (empty string if not available)
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
        pushNotificationUtils.handleTokenRefresh(webView, newToken)
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
        return try {
            pushNotificationUtils.isAvailable(context)
        } catch (e: Exception) {
            BridgeUtils.logWarning(TAG, "Push notifications not available")
            false
        }
    }
}
