package io.yourname.androidproject.utils

import android.content.Context
import android.content.Intent
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import org.json.JSONObject
import org.json.JSONArray
import java.util.Properties
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.google.android.gms.tasks.OnCompleteListener
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability

/**
 * Firebase Cloud Messaging Service and Utility
 * Handles FCM callbacks, token management, topic subscription, and message processing
 */
class PushNotificationUtils(private val properties: Properties = Properties()) : FirebaseMessagingService() {

    companion object {
        private const val TAG = "PushNotificationUtils"
        private const val PREFS_NAME = "push_notifications"
        private const val KEY_PUSH_TOKEN = "push_token"
        private const val KEY_SUBSCRIBED_TOPICS = "subscribed_topics"
        private const val PROVIDER_FCM = "fcm"

        // Broadcast actions
        const val ACTION_MESSAGE_RECEIVED = "io.yourname.androidproject.PUSH_MESSAGE_RECEIVED"
        const val ACTION_TOKEN_REFRESHED = "io.yourname.androidproject.PUSH_TOKEN_REFRESHED"
        const val EXTRA_MESSAGE_DATA = "message_data"
        const val EXTRA_TOKEN = "token"
    }

    // ==================== FIREBASE MESSAGING SERVICE CALLBACKS ====================

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)

        BridgeUtils.logInfo(TAG, "FCM message received from: ${remoteMessage.from}")

        try {
            // Convert RemoteMessage to data map
            val data = mutableMapOf<String, String>()

            // Add notification data if present
            remoteMessage.notification?.let { notification ->
                notification.title?.let { data["title"] = it }
                notification.body?.let { data["body"] = it }
                notification.channelId?.let { data["channel"] = it }
            }

            // Add custom data
            data.putAll(remoteMessage.data)

            // Send broadcast to notify activity about the message
            sendMessageReceivedBroadcast(this, data)

        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error processing FCM message", e)
        }
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)

        BridgeUtils.logInfo(TAG, "FCM token refreshed: ${token.take(20)}...")

        try {
            storePushToken(this, token)
            sendTokenRefreshedBroadcast(this, token)

        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error handling token refresh", e)
        }
    }

    // ==================== UTILITY METHODS ====================

    /**
     * Initialize and get FCM token
     */
    fun initializeAndGetToken(context: Context): String {
        return try {
            val enabled = properties.getProperty("notifications.enabled", "true").toBoolean()
            if (!enabled) {
                BridgeUtils.logInfo(TAG, "Push notifications disabled")
                return ""
            }

            FirebaseMessaging.getInstance().token.addOnCompleteListener(OnCompleteListener { task ->
                if (!task.isSuccessful) {
                    BridgeUtils.logError(TAG, "Fetching FCM registration token failed", task.exception)
                    return@OnCompleteListener
                }

                val token = task.result
                storePushToken(context, token)
                BridgeUtils.logInfo(TAG, "FCM token retrieved: ${token.take(20)}...")
            })

            getPushToken(context) ?: ""
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to get FCM token", e)
            ""
        }
    }

    /**
     * Handle incoming push notification (called from broadcast receiver)
     */
    fun handleIncomingPush(webView: WebView?, context: Context, data: Map<String, String>) {
        BridgeUtils.logInfo(TAG, "Processing incoming push notification")

        try {
            val payload = data["payload"]?.let { JSONObject(it) } ?: JSONObject().apply {
                data.forEach { (key, value) -> put(key, value) }
            }

            // Parse actions from JSON string if present
            val actions = data["actions"]?.let { actionsStr ->
                try {
                    parseActionsFromJson(JSONArray(actionsStr))
                } catch (e: Exception) {
                    BridgeUtils.logError(TAG, "Failed to parse actions from FCM data", e)
                    null
                }
            } ?: payload.optJSONArray("actions")?.let { parseActionsFromJson(it) }

            // Extract custom data only from the "data" field
            val customData = mutableMapOf<String, Any>().apply {
                data["data"]?.let { dataStr ->
                    try {
                        val dataJson = JSONObject(dataStr)
                        dataJson.keys().forEach { key ->
                            put(key, dataJson.get(key))
                        }
                    } catch (e: Exception) {
                        BridgeUtils.logError(TAG, "Failed to parse custom data from FCM", e)
                        // If parsing fails, treat it as a string value
                        put("data", dataStr)
                    }
                }
            }

            // Handle badge - it might come as string from FCM
            val badge = data["badge"]?.toIntOrNull() ?: payload.optInt("badge", -1).takeIf { it >= 0 }

            val config = NotificationConfig(
                title = data["title"] ?: payload.optString("title", NotificationConstants.DEFAULT_NOTIFICATION_TITLE),
                body = data["body"] ?: payload.optString("body", NotificationConstants.DEFAULT_NOTIFICATION_BODY),
                channel = data["channel"] ?: payload.optString("channel", NotificationConstants.DEFAULT_CHANNEL_ID),
                badge = badge,
                actions = actions,
                largeImage = (data["largeImage"] ?: payload.optString("largeImage")).takeIf { it?.isNotBlank() == true },
                style = try {
                    NotificationStyle.valueOf(data["style"] ?: payload.optString("style", "BASIC"))
                } catch (e: IllegalArgumentException) {
                    NotificationStyle.BASIC
                },
                priority = data["priority"]?.toIntOrNull() ?: payload.optInt("priority", NotificationCompat.PRIORITY_DEFAULT),
                vibrate = data["vibrate"]?.toBooleanStrictOrNull() ?: payload.optBoolean("vibrate", true),
                autoCancel = data["autoCancel"]?.toBooleanStrictOrNull() ?: payload.optBoolean("autoCancel", true),
                ongoing = data["ongoing"]?.toBooleanStrictOrNull() ?: payload.optBoolean("ongoing", false),
                data = customData
            )

            NotificationUtils(context).scheduleLocalNotification(context, config)
            webView?.let { notifyWebOfReceivedPush(it, config.title, config.body, config.channel, customData) }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error handling push notification", e)
        }
    }

    /**
     * Handle token refresh (called from broadcast receiver)
     */
    fun handleTokenRefresh(webView: WebView?, newToken: String) {
        webView?.let {
            val tokenData = """{"token": "$newToken", "refreshed": true, "provider": "$PROVIDER_FCM"}"""
            BridgeUtils.notifyWeb(it, BridgeUtils.WebEvents.PUSH_NOTIFICATION_TOKEN, tokenData)
        }
    }

    /**
     * Subscribe to topic
     */
    fun subscribeToTopic(context: Context, topic: String): Boolean {
        return try {
            FirebaseMessaging.getInstance().subscribeToTopic(topic)
                .addOnCompleteListener { task ->
                    if (task.isSuccessful) {
                        BridgeUtils.logInfo(TAG, "Subscribed to Firebase topic: $topic")
                        val topics = getSubscribedTopics(context).toMutableSet()
                        topics.add(topic)
                        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                            .edit().putStringSet(KEY_SUBSCRIBED_TOPICS, topics).apply()
                    } else {
                        BridgeUtils.logError(TAG, "Failed to subscribe to topic: $topic", task.exception)
                    }
                }
            BridgeUtils.logInfo(TAG, "Subscribing to topic: $topic")
            true
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to subscribe to topic: $topic", e)
            false
        }
    }

    /**
     * Unsubscribe from topic
     */
    fun unsubscribeFromTopic(context: Context, topic: String): Boolean {
        return try {
            FirebaseMessaging.getInstance().unsubscribeFromTopic(topic)
                .addOnCompleteListener { task ->
                    if (task.isSuccessful) {
                        BridgeUtils.logInfo(TAG, "Unsubscribed from Firebase topic: $topic")
                        val topics = getSubscribedTopics(context).toMutableSet()
                        topics.remove(topic)
                        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                            .edit().putStringSet(KEY_SUBSCRIBED_TOPICS, topics).apply()
                    } else {
                        BridgeUtils.logError(TAG, "Failed to unsubscribe from topic: $topic", task.exception)
                    }
                }
            BridgeUtils.logInfo(TAG, "Unsubscribing from topic: $topic")
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
    fun deleteAllPushData(context: Context): Boolean {
        return try {
            FirebaseMessaging.getInstance().deleteToken()
                .addOnCompleteListener { task ->
                    if (task.isSuccessful) {
                        BridgeUtils.logInfo(TAG, "Firebase token deleted")
                        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().apply()
                        BridgeUtils.logInfo(TAG, "All push data deleted")
                    } else {
                        BridgeUtils.logError(TAG, "Failed to delete Firebase token", task.exception)
                    }
                }
            true
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to delete push data", e)
            false
        }
    }

    /**
     * Get current push provider
     */
    fun getPushProvider(@Suppress("UNUSED_PARAMETER") context: Context): String {
        return PROVIDER_FCM
    }

    /**
     * Check if FCM is available
     */
    fun isAvailable(context: Context): Boolean {
        return try {
            val googleApiAvailability = GoogleApiAvailability.getInstance()
            val resultCode = googleApiAvailability.isGooglePlayServicesAvailable(context)
            resultCode == ConnectionResult.SUCCESS
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error checking FCM availability", e)
            false
        }
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * Parse actions from JSONArray (for unified format)
     */
    private fun parseActionsFromJson(actionsArray: JSONArray?): List<NotificationAction>? {
        if (actionsArray == null || actionsArray.length() == 0) return null

        return try {
            val actions = mutableListOf<NotificationAction>()
            for (i in 0 until actionsArray.length()) {
                val actionObj = actionsArray.getJSONObject(i)
                val action = NotificationAction(
                    title = actionObj.optString("title", "Action ${i + 1}"),
                    actionId = actionObj.optString("action", actionObj.optString("id", "action_$i"))
                )
                actions.add(action)
            }
            actions
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to parse actions from JSONArray", e)
            null
        }
    }

    private fun storePushToken(context: Context, token: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_PUSH_TOKEN, token)
            .apply()
    }

    private fun notifyWebOfReceivedPush(webView: WebView, title: String, body: String, channel: String, customData: Map<String, Any>) {
        try {
            val messageData = JSONObject().apply {
                put("provider", PROVIDER_FCM)
                put("timestamp", System.currentTimeMillis())
                put("type", "push_notification")
                put("data", JSONObject(customData))
                put("notification", JSONObject().apply {
                    put("title", title)
                    put("body", body)
                    put("channel", channel)
                })
            }
            BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED, messageData.toString())
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to notify web", e)
        }
    }

    /**
     * Send broadcast when a message is received
     */
    private fun sendMessageReceivedBroadcast(context: Context, data: Map<String, String>) {
        val intent = Intent(ACTION_MESSAGE_RECEIVED).apply {
            putExtra(EXTRA_MESSAGE_DATA, HashMap(data))
        }
        LocalBroadcastManager.getInstance(context).sendBroadcast(intent)
        BridgeUtils.logInfo(TAG, "Broadcast sent: $ACTION_MESSAGE_RECEIVED")
    }

    /**
     * Send broadcast when token is refreshed
     */
    private fun sendTokenRefreshedBroadcast(context: Context, token: String) {
        val intent = Intent(ACTION_TOKEN_REFRESHED).apply {
            putExtra(EXTRA_TOKEN, token)
        }
        LocalBroadcastManager.getInstance(context).sendBroadcast(intent)
        BridgeUtils.logInfo(TAG, "Broadcast sent: $ACTION_TOKEN_REFRESHED")
    }

}

/**
 * Note: Firebase push notification service would be defined here when Firebase is available.
 * Since Firebase is conditionally loaded, the actual service implementation should be
 * in a separate file that's only compiled when Firebase dependencies are present.
 *
 * For now, this class provides local notification functionality only.
 */