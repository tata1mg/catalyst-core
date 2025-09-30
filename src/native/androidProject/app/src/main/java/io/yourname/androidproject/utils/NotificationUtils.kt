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
import java.util.concurrent.Executors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Utility class for handling notifications (local and push)
 * Supports all notification styles defined in the implementation plan
 */
class NotificationUtils(private val context: Context) {

    private val TAG = "NotificationUtils"
    private val REQUEST_CODE_PERMISSION = 100

    // Callback for permission request result
    private var permissionCallback: ((Boolean) -> Unit)? = null

    // Thread pool for image loading
    private val imageLoadExecutor = Executors.newFixedThreadPool(3)

    // Coroutine scope for notification operations
    private val notificationScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    
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

        // If there's a remote image URL, load it asynchronously
        if (!config.largeImage.isNullOrBlank()) {
            notificationScope.launch {
                var bitmap: Bitmap? = null
                try {
                    bitmap = withContext(Dispatchers.IO) {
                        loadImageFromUrl(config.largeImage)
                    }
                    showNotification(context, config, notificationId, bitmap)
                    bitmap?.recycle()
                } catch (e: Exception) {
                    BridgeUtils.logError(TAG, "Error loading image: ${config.largeImage}", e)
                    showNotification(context, config, notificationId, null)
                    bitmap?.recycle()
                }
            }
        } else {
            // No remote image, show immediately
            notificationScope.launch {
                showNotification(context, config, notificationId, null)
            }
        }

        return notificationId
    }

    /**
     * Show notification with optional pre-loaded bitmap
     */
    private suspend fun showNotification(context: Context, config: NotificationConfig, notificationId: String, preloadedBitmap: Bitmap?) {
        val notification = buildNotification(context, config, preloadedBitmap)
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
    suspend fun buildNotification(context: Context, config: NotificationConfig, preloadedBitmap: Bitmap? = null): NotificationCompat.Builder {
        val intent = Intent(context, MainActivity::class.java).apply {
            // Ultra-simple approach: just pass notification data
            putExtra(NotificationConstants.EXTRA_IS_NOTIFICATION, true)
            config.data?.let { data ->
                putExtra(NotificationConstants.EXTRA_NOTIFICATION_DATA, org.json.JSONObject(data).toString())
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

        // Set large icon only if style is not BASIC
        if (config.style != NotificationStyle.BASIC) {
            val largeBitmap = preloadedBitmap ?: getLargeIconBitmapLocal(context)
            largeBitmap?.let {
                builder.setLargeIcon(it)
            }
        } else {
            BridgeUtils.logInfo(TAG, "Skipping large icon for BASIC style")
        }
        
        
        // Set vibration
        if (config.vibrate) {
            builder.setVibrate(longArrayOf(0, 250, 250, 250))
        }
        
        // Apply notification style
        applyNotificationStyle(builder, config, preloadedBitmap)
        
        // Add action buttons only for non-BASIC styles
        if (config.style != NotificationStyle.BASIC) {
            config.actions?.forEach { action ->
                addActionButton(builder, context, action, config)
            }
        } else if (!config.actions.isNullOrEmpty()) {
            BridgeUtils.logWarning(TAG, "BASIC style ignoring ${config.actions.size} action buttons. Use ACTION_BUTTONS style if you need actions.")
        }
        
        return builder
    }



    /**
     * Apply notification style based on configuration
     */
    private suspend fun applyNotificationStyle(builder: NotificationCompat.Builder, config: NotificationConfig, preloadedBitmap: Bitmap? = null) {
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
                // Use preloaded bitmap if available, otherwise try local large icon
                val bitmap = preloadedBitmap ?: getLargeIconBitmapLocal(context)
                if (bitmap != null) {
                    val bigPictureStyle = NotificationCompat.BigPictureStyle()
                        .bigPicture(bitmap)
                        .setBigContentTitle(config.title)
                        .bigLargeIcon(null as Bitmap?) // Hide large icon when expanded per Android standards
                    builder.setStyle(bigPictureStyle)
                }
            }
            NotificationStyle.ACTION_BUTTONS -> {
                // Action buttons are added separately, no specific style needed
            }
        }
    }


    /**
     * Add action button to notification
     */
    private fun addActionButton(builder: NotificationCompat.Builder, context: Context, action: NotificationAction, config: NotificationConfig) {
        val intent = Intent(context, MainActivity::class.java).apply {
            putExtra(NotificationConstants.EXTRA_IS_NOTIFICATION, true)
            putExtra(NotificationConstants.EXTRA_ACTION, action.actionId)
            config.data?.let { data ->
                putExtra(NotificationConstants.EXTRA_NOTIFICATION_DATA, org.json.JSONObject(data).toString())
            }
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            action.actionId.hashCode(),
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
     * Get channel configuration based on channel ID using properties
     */
    private fun getChannelConfig(channelId: String): NotificationChannelConfig {
        val channelName = properties.getProperty("notifications.channels.$channelId.name",
            when (channelId) {
                NotificationConstants.DEFAULT_CHANNEL_ID -> NotificationConstants.DEFAULT_CHANNEL_NAME
                NotificationConstants.URGENT_CHANNEL_ID -> NotificationConstants.URGENT_CHANNEL_NAME
                else -> NotificationConstants.DEFAULT_CHANNEL_NAME
            })

        val channelDescription = properties.getProperty("notifications.channels.$channelId.description",
            when (channelId) {
                NotificationConstants.DEFAULT_CHANNEL_ID -> NotificationConstants.DEFAULT_CHANNEL_DESCRIPTION
                NotificationConstants.URGENT_CHANNEL_ID -> NotificationConstants.URGENT_CHANNEL_DESCRIPTION
                else -> NotificationConstants.DEFAULT_CHANNEL_DESCRIPTION
            })

        val importance = if (channelId == NotificationConstants.URGENT_CHANNEL_ID) {
            NotificationManager.IMPORTANCE_HIGH
        } else {
            NotificationManager.IMPORTANCE_DEFAULT
        }

        // Configure sound based on channel type with fallbacks
        val soundUri = when (channelId) {
            NotificationConstants.DEFAULT_CHANNEL_ID -> {
                // Try custom default sound first, fallback to system default
                getSoundResource(context, "notification_sound_default")
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            }
            NotificationConstants.URGENT_CHANNEL_ID -> {
                // Try custom urgent sound first, fallback to system alarm
                getSoundResource(context, "notification_sound_urgent")
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            }
            else -> {
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            }
        }

        return NotificationChannelConfig(
            id = channelId,
            name = channelName,
            description = channelDescription,
            importance = importance,
            sound = soundUri
        )
    }
    
    /**
     * Get sound URI from sound name (build assets only)
     */
    private fun getSoundUri(context: Context, soundName: String?): Uri? {
        val effectiveSoundName = soundName ?: NotificationConstants.DEFAULT_CHANNEL_ID
        return when (effectiveSoundName) {
            NotificationConstants.DEFAULT_CHANNEL_ID -> {
                // Try custom default sound first, fallback to system
                val customResource = getSoundResource(context, "notification_sound_default")
                customResource ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            }
            NotificationConstants.URGENT_CHANNEL_ID -> {
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
     * Get small icon resource (fallback chain: notification icon -> app icon -> system default)
     * Note: Small icons are required for Android notifications, so we always return a valid resource
     */
    private fun getSmallIconResource(context: Context): Int {
        // Try to find build-time notification icon first
        val notificationIconId = context.resources.getIdentifier(
            "ic_notification",
            "drawable",
            context.packageName
        )
        if (notificationIconId != 0) {
            return notificationIconId
        }

        // Try to use app icon as fallback
        val appIconId = context.resources.getIdentifier(
            "ic_launcher",
            "mipmap",
            context.packageName
        )
        if (appIconId != 0) {
            return appIconId
        }

        // Final fallback to system default (required for notifications to work)
        return android.R.drawable.ic_dialog_info
    }


    /**
     * Get large icon bitmap from local resources only (no network calls)
     * Fallback chain: notification large icon -> app icon
     * Uses coroutine to offload bitmap decoding to worker thread
     */
    private suspend fun getLargeIconBitmapLocal(context: Context): Bitmap? = withContext(Dispatchers.IO) {
        // Try to find build-time large notification icon
        val notificationLargeIconId = context.resources.getIdentifier(
            "ic_notification_large",
            "drawable",
            context.packageName
        )
        if (notificationLargeIconId != 0) {
            return@withContext try {
                val bitmap = BitmapFactory.decodeResource(context.resources, notificationLargeIconId)
                bitmap
            } catch (e: Exception) {
                BridgeUtils.logError(TAG, "Failed to load local large notification icon", e)
                null
            }
        }

        // Finally, fallback to app icon
        return@withContext try {
            val appIconId = context.resources.getIdentifier(
                "ic_launcher",
                "mipmap",
                context.packageName
            )
            if (appIconId != 0) {
                val bitmap = BitmapFactory.decodeResource(context.resources, appIconId)
                bitmap
            } else {
                null
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to load app icon as large icon fallback", e)
            null
        }
    }

    /**
     * Load image from HTTP/HTTPS URL
     */
    private fun loadImageFromUrl(imageUrl: String): Bitmap? {
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

    /**
     * Generate unique notification ID
     */
    private fun generateNotificationId(): String {
        return "notification_${System.currentTimeMillis()}_${Random().nextInt(1000)}"
    }
}

/**
 * Simple notification action with display title and action ID
 */
data class NotificationAction(
    val title: String,      // What user sees: "Reply", "Mark as Read"
    val actionId: String    // What developer uses: "reply", "mark_read"
)

/**
 * Simplified notification configuration
 */
data class NotificationConfig(
    // Display fields
    val title: String,
    val body: String,
    val channel: String = NotificationConstants.DEFAULT_CHANNEL_ID,

    // Optional display settings
    val badge: Int? = null,
    val largeImage: String? = null,
    val style: NotificationStyle = NotificationStyle.BASIC,
    val priority: Int = NotificationCompat.PRIORITY_DEFAULT,
    val vibrate: Boolean = true,
    val autoCancel: Boolean = true,
    val ongoing: Boolean = false,

    // Simple data and actions
    val data: Map<String, Any>? = null,
    val actions: List<NotificationAction>? = null
)

/**
 * Enum representing different notification styles
 *
 * Style behaviors:
 * - BASIC: Minimal notification (title, text, small icon only). Ignores large icons and action buttons.
 * - BIG_TEXT: Expanded text view with large text area
 * - BIG_IMAGE: Large image display with expanded view
 * - ACTION_BUTTONS: Basic notification with action buttons enabled
 */
enum class NotificationStyle {
    BASIC,
    BIG_TEXT,
    BIG_IMAGE,
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