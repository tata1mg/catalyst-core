package io.yourname.androidproject.utils

import android.content.Context
import android.webkit.WebView
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.util.Properties

/**
 * Minimal FCM push notification utility
 * Handles token management, topic subscription, and message processing
 */
class PushNotificationUtils(private val properties: Properties) {

    companion object {
        private const val TAG = "PushNotificationUtils"
        private const val PREFS_NAME = "push_notifications"
        private const val KEY_PUSH_TOKEN = "push_token"
        private const val KEY_SUBSCRIBED_TOPICS = "subscribed_topics"
    }

    /**
     * Initialize and get FCM token
     */
    suspend fun initializeAndGetToken(context: Context): String {
        return try {
            val enabled = properties.getProperty("notifications.enabled", "true").toBoolean()
            if (!enabled) {
                BridgeUtils.logInfo(TAG, "Push notifications disabled")
                return ""
            }

            val token = FirebaseMessaging.getInstance().token.await()
            storePushToken(context, token)
            BridgeUtils.logInfo(TAG, "FCM token retrieved: $token")
            token
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to get FCM token", e)
            ""
        }
    }

    /**
     * Handle token refresh
     */
    fun handleTokenRefresh(webView: WebView?, context: Context, newToken: String) {
        BridgeUtils.logInfo(TAG, "FCM token refreshed: $newToken")
        storePushToken(context, newToken)

        webView?.let {
            val tokenData = """{"token": "$newToken", "refreshed": true, "provider": "fcm"}"""
            BridgeUtils.notifyWeb(it, BridgeUtils.WebEvents.PUSH_NOTIFICATION_TOKEN, tokenData)
        }
    }

    /**
     * Handle incoming push notification
     */
    fun handleIncomingPush(webView: WebView?, context: Context, data: Map<String, String>) {
        BridgeUtils.logInfo(TAG, "Processing incoming push notification")

        try {
            // Show local notification
            val config = NotificationConfig(
                title = data["title"] ?: "Notification",
                body = data["body"] ?: "You have a new message",
                channel = data["channel"] ?: "default_notifications",
                data = data
            )
            NotificationUtils(context).scheduleLocalNotification(context, config)

            // Notify web layer
            webView?.let { notifyWebOfReceivedPush(it, data) }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error handling push", e)
        }
    }

    /**
     * Subscribe to topic
     */
    suspend fun subscribeToTopic(context: Context, topic: String): Boolean {
        return try {
            FirebaseMessaging.getInstance().subscribeToTopic(topic).await()

            // Store locally
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val topics = getSubscribedTopics(context).toMutableSet()
            topics.add(topic)
            prefs.edit().putStringSet(KEY_SUBSCRIBED_TOPICS, topics).apply()

            BridgeUtils.logInfo(TAG, "Subscribed to topic: $topic")
            true
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to subscribe to topic: $topic", e)
            false
        }
    }

    /**
     * Unsubscribe from topic
     */
    suspend fun unsubscribeFromTopic(context: Context, topic: String): Boolean {
        return try {
            FirebaseMessaging.getInstance().unsubscribeFromTopic(topic).await()

            // Remove from local storage
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val topics = getSubscribedTopics(context).toMutableSet()
            topics.remove(topic)
            prefs.edit().putStringSet(KEY_SUBSCRIBED_TOPICS, topics).apply()

            BridgeUtils.logInfo(TAG, "Unsubscribed from topic: $topic")
            true
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to unsubscribe from topic: $topic", e)
            false
        }
    }

    /**
     * Get current push token
     */
    fun getPushToken(context: Context): String? {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_PUSH_TOKEN, null)
    }

    /**
     * Get subscribed topics
     */
    fun getSubscribedTopics(context: Context): Set<String> {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getStringSet(KEY_SUBSCRIBED_TOPICS, emptySet()) ?: emptySet()
    }

    /**
     * Delete all push data
     */
    suspend fun deleteAllPushData(context: Context): Boolean {
        return try {
            FirebaseMessaging.getInstance().deleteToken().await()
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().apply()
            BridgeUtils.logInfo(TAG, "All push data deleted")
            true
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to delete push data", e)
            false
        }
    }

    /**
     * Check if FCM is available
     */
    fun isAvailable(context: Context): Boolean {
        return try {
            FirebaseMessaging.getInstance()
            true
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "FCM not available", e)
            false
        }
    }

    // ==================== PRIVATE HELPERS ====================

    private fun storePushToken(context: Context, token: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_PUSH_TOKEN, token)
            .apply()
    }

    private fun notifyWebOfReceivedPush(webView: WebView, data: Map<String, String>) {
        try {
            val messageData = JSONObject().apply {
                put("provider", "fcm")
                put("timestamp", System.currentTimeMillis())
                put("type", "push_notification")
                put("data", JSONObject(data))
                put("notification", JSONObject().apply {
                    put("title", data["title"] ?: "")
                    put("body", data["body"] ?: "")
                    put("channel", data["channel"] ?: "")
                })
            }
            BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED, messageData.toString())
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to notify web", e)
        }
    }
}

/**
 * Push notification service to handle incoming messages
 * This is a separate top-level class to be properly accessible by Android
 */
class PushNotificationService : com.google.firebase.messaging.FirebaseMessagingService() {

    private val TAG = "PushNotificationService"

    override fun onMessageReceived(remoteMessage: com.google.firebase.messaging.RemoteMessage) {
        super.onMessageReceived(remoteMessage)

        BridgeUtils.logInfo(TAG, "Received FCM message from: ${remoteMessage.from}")

        try {
            // Get the current application context
            val context = applicationContext

            // Load properties to access configuration
            val properties = java.util.Properties()
            try {
                val inputStream = context.assets.open("webview_config.properties")
                properties.load(inputStream)
                inputStream.close()
            } catch (e: Exception) {
                BridgeUtils.logError(TAG, "Failed to load webview config properties", e)
                // Continue with empty properties
            }

            // Create PushNotificationUtils instance
            val pushUtils = PushNotificationUtils(properties)

            // Convert RemoteMessage data to Map<String, String>
            val data = mutableMapOf<String, String>()

            // Add notification data if present
            remoteMessage.notification?.let { notification ->
                notification.title?.let { data["title"] = it }
                notification.body?.let { data["body"] = it }
                notification.channelId?.let { data["channel"] = it }
            }

            // Add custom data payload
            data.putAll(remoteMessage.data)

            // Add message metadata
            data["messageId"] = remoteMessage.messageId ?: ""
            data["from"] = remoteMessage.from ?: ""
            data["to"] = remoteMessage.to ?: ""
            data["messageType"] = remoteMessage.messageType ?: ""
            data["collapseKey"] = remoteMessage.collapseKey ?: ""
            data["ttl"] = remoteMessage.ttl.toString()
            data["sentTime"] = remoteMessage.sentTime.toString()

            BridgeUtils.logInfo(TAG, "Processing message with ${data.size} data fields")

            // Handle the incoming push notification
            // Note: WebView reference not available in service, so passing null
            pushUtils.handleIncomingPush(null, context, data)

        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error processing FCM message", e)
        }
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)

        BridgeUtils.logInfo(TAG, "FCM token refreshed: $token")

        try {
            // Get the current application context
            val context = applicationContext

            // Load properties to access configuration
            val properties = java.util.Properties()
            try {
                val inputStream = context.assets.open("webview_config.properties")
                properties.load(inputStream)
                inputStream.close()
            } catch (e: Exception) {
                BridgeUtils.logError(TAG, "Failed to load webview config properties", e)
                // Continue with empty properties
            }

            // Create PushNotificationUtils instance
            val pushUtils = PushNotificationUtils(properties)

            // Handle the token refresh
            // Note: WebView reference not available in service, so passing null
            pushUtils.handleTokenRefresh(null, context, token)

        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error handling token refresh", e)
        }
    }

    override fun onDeletedMessages() {
        super.onDeletedMessages()
        BridgeUtils.logInfo(TAG, "FCM messages were deleted on the server")
    }

    override fun onMessageSent(msgId: String) {
        super.onMessageSent(msgId)
        BridgeUtils.logInfo(TAG, "FCM message sent successfully: $msgId")
    }

    override fun onSendError(msgId: String, exception: Exception) {
        super.onSendError(msgId, exception)
        BridgeUtils.logError(TAG, "FCM message send error for $msgId", exception)
    }
}