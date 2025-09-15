package io.yourname.androidproject.utils

import android.content.Context
import android.webkit.WebView
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import java.util.Properties
import kotlin.coroutines.resume

class PushNotificationUtils(private val properties: Properties) {

    companion object {
        private const val TAG = "PushNotificationUtils"
        private const val PREFS_NAME = "push_notifications"
        private const val KEY_PUSH_TOKEN = "push_token"
        private const val KEY_PROVIDER = "push_provider"
        private const val KEY_SUBSCRIBED_TOPICS = "subscribed_topics"

        const val PROVIDER_FCM = "fcm"
    }

    // ==================== INITIALIZATION ====================

    /**
     * Initialize push notifications and get registration token
     */
    suspend fun initializeAndGetToken(context: Context): String {
        BridgeUtils.logInfo(TAG, "Initializing push notifications")

        try {
            val enabled = properties.getProperty("notifications.enabled", "true").toBoolean()
            if (!enabled) {
                BridgeUtils.logInfo(TAG, "Push notifications disabled in configuration")
                return ""
            }

            val token = getOrCreateToken(context)
            if (token.isNotEmpty()) {
                storePushToken(context, token, PROVIDER_FCM)
                BridgeUtils.logInfo(TAG, "FCM push token retrieved: $token")
            }
            return token

        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to initialize push notifications", e)
            return generateMockToken(context)
        }
    }

    /**
     * Handle token refresh from FCM
     */
    fun handleTokenRefresh(webView: WebView?, context: Context, newToken: String, providerName: String = PROVIDER_FCM) {
        BridgeUtils.logInfo(TAG, "Push token refreshed: $newToken")

        try {
            // Store token locally
            storePushToken(context, newToken, providerName)

            // Notify web layer if webview is available
            webView?.let {
                val tokenData = """{"token": "$newToken", "refreshed": true, "provider": "$providerName"}"""
                BridgeUtils.notifyWeb(it, BridgeUtils.WebEvents.PUSH_NOTIFICATION_TOKEN, tokenData)
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to handle token refresh", e)
        }
    }

    /**
     * Handle incoming push notification from FCM
     */
    fun handleIncomingPush(webView: WebView?, context: Context, data: Map<String, String>, providerName: String = PROVIDER_FCM) {
        BridgeUtils.logInfo(TAG, "Handling incoming push from $providerName")

        try {
            // Create local notification
            val config = createNotificationConfigFromPushData(data)
            val notificationUtils = NotificationUtils(context)
            notificationUtils.scheduleLocalNotification(context, config)

            // Notify web layer if webview is available
            webView?.let {
                notifyWebOfReceivedPush(it, data, providerName)
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error handling incoming push", e)
        }
    }

    // ==================== TOPIC MANAGEMENT ====================

    /**
     * Subscribe to topic
     */
    suspend fun subscribeToTopic(context: Context, topic: String): Boolean {
        return try {
            val success = if (isFCMAvailable()) {
                subscribeToFCMTopic(topic)
            } else {
                BridgeUtils.logInfo(TAG, "FCM not available, topic subscription simulated")
                true
            }

            if (success) {
                // Store locally
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val topics = getSubscribedTopics(context).toMutableSet()
                topics.add(topic)
                prefs.edit().putStringSet(KEY_SUBSCRIBED_TOPICS, topics).apply()

                BridgeUtils.logInfo(TAG, "Subscribed to topic: $topic")
            }

            success
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
            val success = if (isFCMAvailable()) {
                unsubscribeFromFCMTopic(topic)
            } else {
                BridgeUtils.logInfo(TAG, "FCM not available, topic unsubscription simulated")
                true
            }

            if (success) {
                // Remove from local storage
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val topics = getSubscribedTopics(context).toMutableSet()
                topics.remove(topic)
                prefs.edit().putStringSet(KEY_SUBSCRIBED_TOPICS, topics).apply()

                BridgeUtils.logInfo(TAG, "Unsubscribed from topic: $topic")
            }

            success
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to unsubscribe from topic: $topic", e)
            false
        }
    }

    // ==================== DATA MANAGEMENT ====================

    /**
     * Get current push token
     */
    fun getPushToken(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_PUSH_TOKEN, null)
    }

    /**
     * Get current provider
     */
    fun getPushProvider(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_PROVIDER, null)
    }

    /**
     * Get subscribed topics
     */
    fun getSubscribedTopics(context: Context): Set<String> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getStringSet(KEY_SUBSCRIBED_TOPICS, emptySet()) ?: emptySet()
    }

    /**
     * Delete all push data
     */
    suspend fun deleteAllPushData(context: Context): Boolean {
        return try {
            // Delete FCM token if available
            if (isFCMAvailable()) {
                deleteFCMToken()
            } else {
                BridgeUtils.logInfo(TAG, "FCM not available, token deletion simulated")
            }

            // Clear local data
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().clear().apply()

            BridgeUtils.logInfo(TAG, "All push data deleted")
            true

        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to delete push data", e)
            false
        }
    }

    /**
     * Check if push notifications are available
     */
    fun isAvailable(context: Context): Boolean {
        return isFCMAvailable()
    }

    // ==================== FCM PROVIDER IMPLEMENTATION ====================

    /**
     * Get or create FCM push token with fallback
     */
    private suspend fun getOrCreateToken(context: Context): String {
        return if (isFCMAvailable()) {
            getFCMToken()
        } else {
            BridgeUtils.logWarning(TAG, "FCM not available, using mock token for development")
            generateMockToken(context)
        }
    }

    // ==================== FCM IMPLEMENTATION ====================

    private fun isFCMAvailable(): Boolean {
        return try {
            Class.forName("com.google.firebase.messaging.FirebaseMessaging")
            Class.forName("com.google.firebase.FirebaseApp")
            true
        } catch (e: ClassNotFoundException) {
            false
        }
    }

    private suspend fun getFCMToken(): String {
        return if (isFCMAvailable()) {
            try {
                suspendCancellableCoroutine { continuation ->
                    try {
                        val firebaseMessaging = Class.forName("com.google.firebase.messaging.FirebaseMessaging")
                        val getInstance = firebaseMessaging.getMethod("getInstance")
                        val messaging = getInstance.invoke(null)

                        val getToken = firebaseMessaging.getMethod("getToken")
                        val task = getToken.invoke(messaging)

                        // Handle Task result using reflection
                        val taskClass = Class.forName("com.google.android.gms.tasks.Task")
                        val addOnCompleteListener = taskClass.getMethod("addOnCompleteListener",
                            Class.forName("com.google.android.gms.tasks.OnCompleteListener"))

                        val listener = java.lang.reflect.Proxy.newProxyInstance(
                            Class.forName("com.google.android.gms.tasks.OnCompleteListener").classLoader,
                            arrayOf(Class.forName("com.google.android.gms.tasks.OnCompleteListener"))
                        ) { _, _, args ->
                            val completedTask = args[0]
                            val isSuccessful = taskClass.getMethod("isSuccessful").invoke(completedTask) as Boolean

                            if (isSuccessful) {
                                val result = taskClass.getMethod("getResult").invoke(completedTask) as? String
                                continuation.resume(result ?: "")
                            } else {
                                val exception = taskClass.getMethod("getException").invoke(completedTask) as? Exception
                                BridgeUtils.logError(TAG, "FCM token failed", exception)
                                continuation.resume("")
                            }
                            null
                        }

                        addOnCompleteListener.invoke(task, listener)

                    } catch (e: Exception) {
                        BridgeUtils.logError(TAG, "Error getting FCM token", e)
                        continuation.resume("")
                    }
                }
            } catch (e: Exception) {
                BridgeUtils.logError(TAG, "Failed to get FCM token", e)
                ""
            }
        } else {
            ""
        }
    }

    private suspend fun subscribeToFCMTopic(topic: String): Boolean {
        return if (isFCMAvailable()) {
            try {
                suspendCancellableCoroutine { continuation ->
                    try {
                        val firebaseMessaging = Class.forName("com.google.firebase.messaging.FirebaseMessaging")
                        val getInstance = firebaseMessaging.getMethod("getInstance")
                        val messaging = getInstance.invoke(null)

                        val subscribeToTopic = firebaseMessaging.getMethod("subscribeToTopic", String::class.java)
                        val task = subscribeToTopic.invoke(messaging, topic)

                        val taskClass = Class.forName("com.google.android.gms.tasks.Task")
                        val addOnCompleteListener = taskClass.getMethod("addOnCompleteListener",
                            Class.forName("com.google.android.gms.tasks.OnCompleteListener"))

                        val listener = java.lang.reflect.Proxy.newProxyInstance(
                            Class.forName("com.google.android.gms.tasks.OnCompleteListener").classLoader,
                            arrayOf(Class.forName("com.google.android.gms.tasks.OnCompleteListener"))
                        ) { _, _, args ->
                            val completedTask = args[0]
                            val isSuccessful = taskClass.getMethod("isSuccessful").invoke(completedTask) as Boolean
                            continuation.resume(isSuccessful)
                            null
                        }

                        addOnCompleteListener.invoke(task, listener)

                    } catch (e: Exception) {
                        BridgeUtils.logError(TAG, "Error subscribing to FCM topic", e)
                        continuation.resume(false)
                    }
                }
            } catch (e: Exception) {
                BridgeUtils.logError(TAG, "Failed to subscribe to FCM topic", e)
                false
            }
        } else {
            false
        }
    }

    private suspend fun unsubscribeFromFCMTopic(topic: String): Boolean {
        return if (isFCMAvailable()) {
            try {
                suspendCancellableCoroutine { continuation ->
                    try {
                        val firebaseMessaging = Class.forName("com.google.firebase.messaging.FirebaseMessaging")
                        val getInstance = firebaseMessaging.getMethod("getInstance")
                        val messaging = getInstance.invoke(null)

                        val unsubscribeFromTopic = firebaseMessaging.getMethod("unsubscribeFromTopic", String::class.java)
                        val task = unsubscribeFromTopic.invoke(messaging, topic)

                        val taskClass = Class.forName("com.google.android.gms.tasks.Task")
                        val addOnCompleteListener = taskClass.getMethod("addOnCompleteListener",
                            Class.forName("com.google.android.gms.tasks.OnCompleteListener"))

                        val listener = java.lang.reflect.Proxy.newProxyInstance(
                            Class.forName("com.google.android.gms.tasks.OnCompleteListener").classLoader,
                            arrayOf(Class.forName("com.google.android.gms.tasks.OnCompleteListener"))
                        ) { _, _, args ->
                            val completedTask = args[0]
                            val isSuccessful = taskClass.getMethod("isSuccessful").invoke(completedTask) as Boolean
                            continuation.resume(isSuccessful)
                            null
                        }

                        addOnCompleteListener.invoke(task, listener)

                    } catch (e: Exception) {
                        BridgeUtils.logError(TAG, "Error unsubscribing from FCM topic", e)
                        continuation.resume(false)
                    }
                }
            } catch (e: Exception) {
                BridgeUtils.logError(TAG, "Failed to unsubscribe from FCM topic", e)
                false
            }
        } else {
            false
        }
    }

    private suspend fun deleteFCMToken(): Boolean {
        return if (isFCMAvailable()) {
            try {
                suspendCancellableCoroutine { continuation ->
                    try {
                        val firebaseMessaging = Class.forName("com.google.firebase.messaging.FirebaseMessaging")
                        val getInstance = firebaseMessaging.getMethod("getInstance")
                        val messaging = getInstance.invoke(null)

                        val deleteToken = firebaseMessaging.getMethod("deleteToken")
                        val task = deleteToken.invoke(messaging)

                        val taskClass = Class.forName("com.google.android.gms.tasks.Task")
                        val addOnCompleteListener = taskClass.getMethod("addOnCompleteListener",
                            Class.forName("com.google.android.gms.tasks.OnCompleteListener"))

                        val listener = java.lang.reflect.Proxy.newProxyInstance(
                            Class.forName("com.google.android.gms.tasks.OnCompleteListener").classLoader,
                            arrayOf(Class.forName("com.google.android.gms.tasks.OnCompleteListener"))
                        ) { _, _, args ->
                            val completedTask = args[0]
                            val isSuccessful = taskClass.getMethod("isSuccessful").invoke(completedTask) as Boolean
                            continuation.resume(isSuccessful)
                            null
                        }

                        addOnCompleteListener.invoke(task, listener)

                    } catch (e: Exception) {
                        BridgeUtils.logError(TAG, "Error deleting FCM token", e)
                        continuation.resume(false)
                    }
                }
            } catch (e: Exception) {
                BridgeUtils.logError(TAG, "Failed to delete FCM token", e)
                false
            }
        } else {
            false
        }
    }

    // ==================== HELPER METHODS ====================

    private fun storePushToken(context: Context, token: String, provider: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_PUSH_TOKEN, token)
            .putString(KEY_PROVIDER, provider)
            .apply()
    }

    private fun createNotificationConfigFromPushData(data: Map<String, String>): NotificationConfig {
        val title = data["title"] ?: data["notification_title"] ?: "Notification"
        val body = data["body"] ?: data["message"] ?: data["notification_body"] ?: "You have a new message"
        val channel = data["channel"] ?: "default_notifications"

        return NotificationConfig(
            title = title,
            body = body,
            channel = channel,
            data = data
        )
    }

    private fun notifyWebOfReceivedPush(webView: WebView, data: Map<String, String>, providerName: String) {
        try {
            val messageData = JSONObject().apply {
                put("provider", providerName)
                put("timestamp", System.currentTimeMillis())
                put("type", "push_notification")
                put("data", JSONObject(data))
                put("notification", JSONObject().apply {
                    put("title", data["title"] ?: data["notification_title"] ?: "")
                    put("body", data["body"] ?: data["message"] ?: data["notification_body"] ?: "")
                    put("channel", data["channel"] ?: "")
                })
            }

            BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED, messageData.toString())

        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to notify web of received push", e)
        }
    }

    private fun generateMockToken(context: Context): String {
        val deviceId = android.provider.Settings.Secure.getString(
            context.contentResolver,
            android.provider.Settings.Secure.ANDROID_ID
        )
        return "mock_fcm_token_${System.currentTimeMillis()}_${deviceId.hashCode()}"
    }
}