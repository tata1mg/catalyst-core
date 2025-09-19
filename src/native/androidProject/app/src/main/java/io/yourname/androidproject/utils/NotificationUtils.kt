package io.yourname.androidproject.utils

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.yourname.androidproject.MainActivity
import org.json.JSONObject
import java.util.*
import java.net.URL
import java.io.InputStream

/**
 * Utility class for handling notifications (local and push)
 * Supports all notification styles defined in the implementation plan
 */
class NotificationUtils(private val context: Context) {

    private val TAG = "NotificationUtils"
    private val DEFAULT_CHANNEL_ID = "default_notifications"
    private val REQUEST_CODE_PERMISSION = 100

    // Callback for permission request result
    private var permissionCallback: ((Boolean) -> Unit)? = null
    
    private val properties: Properties = Properties().apply {
        try {
            context.assets.open("webview_config.properties").use {
                load(it)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load properties: ${e.message}")
            // Fall back to default properties if the file doesn't exist
            setProperty("buildType", "release")
            setProperty("buildOptimisation", "true")
        }
    }
    
    
/**
     * Schedule a local notification
     */
    fun scheduleLocalNotification(context: Context, config: NotificationConfig): String {
        val notificationId = generateNotificationId()
        
        // Check if notifications are enabled
        if (!areNotificationsEnabled(context)) {
            BridgeUtils.logWarning(TAG, "Notifications are disabled by user")
            return notificationId
        }
        
        // Create or update notification channel
        createNotificationChannel(context, config)
        
        // Build and show notification
        val notification = buildNotification(context, config)
        val notificationManager = NotificationManagerCompat.from(context)
        
        try {
            if (ActivityCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            ) {
                notificationManager.notify(notificationId.hashCode(), notification.build())
                BridgeUtils.logInfo(TAG, "Local notification scheduled with ID: $notificationId")
            } else {
                BridgeUtils.logWarning(TAG, "POST_NOTIFICATIONS permission not granted")
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to schedule notification", e)
        }
        
        // Update badge count if specified
        config.badge?.let { badge ->
            updateBadgeCount(context, badge)
        }
        
        return notificationId
    }
    
    /**
     * Cancel a local notification
     */
    fun cancelLocalNotification(context: Context, notificationId: String?): Boolean {
        if (notificationId.isNullOrBlank()) {
            BridgeUtils.logWarning(TAG, "Cannot cancel notification: ID is null or empty")
            return false
        }
        
        return try {
            val notificationManager = NotificationManagerCompat.from(context)
            notificationManager.cancel(notificationId.hashCode())
            BridgeUtils.logInfo(TAG, "Notification cancelled: $notificationId")
            true
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to cancel notification", e)
            false
        }
    }
    
    /**
     * Create or update notification channel for Android 8.0+
     */
    fun createNotificationChannel(context: Context, config: NotificationConfig) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channelConfig = getChannelConfig(config.channel)
            
            val channel = NotificationChannel(
                config.channel,
                channelConfig.name,
                channelConfig.importance
            ).apply {
                description = channelConfig.description
                enableLights(channelConfig.enableLights)
                lightColor = channelConfig.lightColor
                enableVibration(channelConfig.enableVibration)
                channelConfig.vibrationPattern?.let { vibrationPattern = it }
                channelConfig.sound?.let { setSound(it, null) }
            }
            
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
            
            BridgeUtils.logDebug(TAG, "Notification channel created/updated: ${config.channel}")
        }
    }
    
    /**
     * Update badge count on app icon using native Android notification badges
     * Note: Badge display depends on launcher support (API 26+ with notification badges)
     */
    fun updateBadgeCount(context: Context, count: Int): Boolean {
        return try {
            // Modern Android handles badges through notifications automatically
            // The badge count is set via notification.setNumber() and setBadgeIconType()
            // which is already implemented in buildNotification()
            BridgeUtils.logInfo(TAG, "Badge count will be updated to: $count via notification badges")
            true
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to update badge count", e)
            false
        }
    }
    
    /**
     * Request notification permission (Android 13+)
     */
    fun requestNotificationPermission(activity: Activity, callback: (Boolean) -> Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    activity,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED
            ) {
                callback(true)
            } else {
                // Request permission from the user
                ActivityCompat.requestPermissions(
                    activity,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    REQUEST_CODE_PERMISSION
                )
                // Store callback for later use in permission result
                permissionCallback = callback
            }
        } else {
            // For older versions, check if notifications are enabled at system level
            callback(areNotificationsEnabled(activity))
        }
    }

    /**
     * Handle permission request result
     * Should be called from the activity's onRequestPermissionsResult
     */
    fun handlePermissionResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        if (requestCode == REQUEST_CODE_PERMISSION &&
            permissions.isNotEmpty() &&
            permissions[0] == Manifest.permission.POST_NOTIFICATIONS) {

            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            permissionCallback?.invoke(granted)
            permissionCallback = null

            BridgeUtils.logInfo(TAG, "Notification permission result: ${if (granted) "GRANTED" else "DENIED"}")
        }
    }
    
    /**
     * Build notification based on style
     */
    fun buildNotification(context: Context, config: NotificationConfig): NotificationCompat.Builder {
        val intent = Intent(context, MainActivity::class.java).apply {
            // Add deep link data from notification config for push notification deep linking
            config.data?.let { data ->
                data["route"]?.let { putExtra("deeplink_route", it) }
                data["params"]?.let { putExtra("deeplink_params", it) }
            }
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            System.currentTimeMillis().toInt(), // Use unique request code to ensure deep links work
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        val builder = NotificationCompat.Builder(context, config.channel)
            .setContentTitle(config.title)
            .setContentText(config.body)
            .setContentIntent(pendingIntent)
            .setAutoCancel(config.autoCancel)
            .setOngoing(config.ongoing)
            .setPriority(config.priority)
        
        // Set badge number on notification (Android 8.0+)
        config.badge?.let { badge ->
            builder.setNumber(badge)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                builder.setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            }
        }
        
        // Set small icon (status bar icon - must be drawable resource)
        val systemSmallIcon = getSmallIconResource(context)
        builder.setSmallIcon(systemSmallIcon)

        // Set large icon from URL if provided
        config.largeImage?.let { imageUrl ->
            val largeBitmap = loadImageFromUrl(context, imageUrl)
            largeBitmap?.let { builder.setLargeIcon(it) }
        }
        
        // Set sound
        if (config.sound != null) {
            val soundUri = getSoundUri(context, config.sound)
            builder.setSound(soundUri)
        } else {
            builder.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
        }
        
        // Set vibration
        if (config.vibrate) {
            builder.setVibrate(longArrayOf(0, 250, 250, 250))
        }
        
        // Apply notification style
        applyNotificationStyle(builder, config)
        
        // Add action buttons
        config.actions?.forEach { action ->
            addActionButton(builder, context, action)
        }
        
        return builder
    }
    
    /**
     * Apply notification style based on configuration
     */
    private fun applyNotificationStyle(builder: NotificationCompat.Builder, config: NotificationConfig) {
        when (config.style) {
            NotificationStyle.BASIC -> {
                // Basic style is default, no additional styling needed
            }
            NotificationStyle.BIG_TEXT -> {
                val bigTextStyle = NotificationCompat.BigTextStyle()
                    .bigText(config.body)
                    .setBigContentTitle(config.title)
                builder.setStyle(bigTextStyle)
            }
            NotificationStyle.BIG_IMAGE -> {
                config.largeImage?.let { imageUrl ->
                    val largeBitmap = loadImageFromUrl(context, imageUrl)
                    largeBitmap?.let {
                        val bigPictureStyle = NotificationCompat.BigPictureStyle()
                            .bigPicture(it)
                            .setBigContentTitle(config.title)
                        builder.setStyle(bigPictureStyle)
                    }
                }
            }
            NotificationStyle.CHAT_MESSAGE -> {
                val messagingStyle = NotificationCompat.MessagingStyle("You")
                    .addMessage(config.body, System.currentTimeMillis(), "Sender")
                builder.setStyle(messagingStyle)
            }
            NotificationStyle.PROGRESS -> {
                builder.setProgress(100, 0, true) // Indeterminate progress
            }
            NotificationStyle.ACTION_BUTTONS -> {
                // Action buttons are added separately, no specific style needed
            }
        }
    }
    
    /**
     * Add action button to notification
     */
    private fun addActionButton(builder: NotificationCompat.Builder, context: Context, action: NotificationAction) {
        val intent = Intent(context, MainActivity::class.java).apply {
            putExtra("notification_action", action.action)
            // Add deep link support for action buttons with route
            action.route?.let { route ->
                putExtra("deeplink_route", route)
            }
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            action.action.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val icon = android.R.drawable.ic_menu_view // Default icon
        builder.addAction(icon, action.title, pendingIntent)
    }
    
    /**
     * Check if notifications are enabled for the app
     */
    private fun areNotificationsEnabled(context: Context): Boolean {
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }
    
    /**
     * Generate unique notification ID
     */
    private fun generateNotificationId(): String {
        return "notification_${System.currentTimeMillis()}_${Random().nextInt(1000)}"
    }
    
    /**
     * Get channel configuration based on channel ID using properties
     */
    private fun getChannelConfig(channelId: String): NotificationChannelConfig {
        val channelName = properties.getProperty("notifications.channels.$channelId.name", 
            when (channelId) {
                "messages" -> "Messages"
                "updates" -> "App Updates"
                else -> "Notifications"
            })
        
        val channelDescription = properties.getProperty("notifications.channels.$channelId.description",
            when (channelId) {
                "messages" -> "Chat messages and communications"
                "updates" -> "Application updates and news"
                else -> "General notifications"
            })
            
        val importance = when (properties.getProperty("notifications.channels.$channelId.importance", "DEFAULT")) {
            "MIN" -> NotificationManager.IMPORTANCE_MIN
            "LOW" -> NotificationManager.IMPORTANCE_LOW
            "HIGH" -> NotificationManager.IMPORTANCE_HIGH
            "MAX" -> NotificationManager.IMPORTANCE_MAX
            else -> NotificationManager.IMPORTANCE_DEFAULT
        }
        
        return NotificationChannelConfig(
            id = channelId,
            name = channelName,
            description = channelDescription,
            importance = importance
        )
    }
    
    /**
     * Get sound URI from sound name (build assets only)
     */
    private fun getSoundUri(context: Context, soundName: String?): Uri? {
        val effectiveSoundName = soundName ?: "default"
        return when (effectiveSoundName) {
            "default" -> {
                // Try custom default sound first, fallback to system
                val customResource = getSoundResource(context, "notification_sound_default")
                customResource ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            }
            "urgent" -> {
                // Try custom urgent sound first, fallback to system
                val customResource = getSoundResource(context, "notification_sound_urgent")
                customResource ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            }
            else -> {
                // Try to find custom sound from build assets
                getSoundResource(context, "notification_sound_$effectiveSoundName")
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            }
        }
    }

    /**
     * Get sound resource URI from raw folder
     */
    private fun getSoundResource(context: Context, resourceName: String): Uri? {
        val resourceId = context.resources.getIdentifier(
            resourceName,
            "raw",
            context.packageName
        )
        return if (resourceId != 0) {
            Uri.parse("android.resource://${context.packageName}/raw/$resourceName")
        } else {
            null
        }
    }
    
    /**
     * Get small icon resource (fallback chain: build asset -> default)
     */
    private fun getSmallIconResource(context: Context): Int {
        // Try to find build-time notification icon first
        val resourceId = context.resources.getIdentifier(
            "ic_notification",
            "drawable",
            context.packageName
        )
        return if (resourceId != 0) {
            resourceId
        } else {
            // Fallback to default Android icon
            android.R.drawable.ic_dialog_info
        }
    }

    /**
     * Load image from HTTP/HTTPS URL
     */
    private fun loadImageFromUrl(context: Context, imageUrl: String): Bitmap? {
        return try {
            if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
                // Download from URL (synchronous - runs on background thread)
                val url = java.net.URL(imageUrl)
                val connection = url.openConnection()
                connection.doInput = true
                connection.connect()
                val inputStream = connection.getInputStream()
                BitmapFactory.decodeStream(inputStream)
            } else {
                BridgeUtils.logWarning(TAG, "Only HTTP/HTTPS URLs are supported for images: $imageUrl")
                null
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to load image from URL: $imageUrl", e)
            null
        }
    }
}

/**
 * Data class representing notification configuration
 */
data class NotificationAction(
    val title: String,
    val action: String,
    val route: String? = null
)

data class NotificationConfig(
    val title: String,
    val body: String,
    val channel: String = "default_notifications",
    val badge: Int? = null,
    val actions: List<NotificationAction>? = null,
    val largeImage: String? = null, // Large image URL (optional)
    val style: NotificationStyle = NotificationStyle.BASIC,
    val priority: Int = NotificationCompat.PRIORITY_DEFAULT,
    val sound: String? = null,
    val vibrate: Boolean = true,
    val autoCancel: Boolean = true,
    val ongoing: Boolean = false,
    val data: Map<String, String>? = null // Extra data
)

/**
 * Enum representing different notification styles
 */
enum class NotificationStyle {
    BASIC,
    BIG_TEXT,
    BIG_IMAGE,
    CHAT_MESSAGE,
    PROGRESS,
    ACTION_BUTTONS
}

/**
 * Data class representing notification channel configuration
 */
data class NotificationChannelConfig(
    val id: String,
    val name: String,
    val description: String,
    val importance: Int = NotificationManager.IMPORTANCE_DEFAULT,
    val enableLights: Boolean = true,
    val lightColor: Int = Color.BLUE,
    val enableVibration: Boolean = true,
    val vibrationPattern: LongArray? = null,
    val sound: Uri? = null
)