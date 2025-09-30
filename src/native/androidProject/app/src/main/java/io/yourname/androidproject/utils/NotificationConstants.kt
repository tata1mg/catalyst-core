package io.yourname.androidproject.utils

/**
 * Constants for notification channels
 */
object NotificationConstants {
    // Channel IDs
    const val DEFAULT_CHANNEL_ID = "default"
    const val URGENT_CHANNEL_ID = "urgent"

    // Channel names
    const val DEFAULT_CHANNEL_NAME = "Notifications"
    const val URGENT_CHANNEL_NAME = "Urgent Notifications"

    // Channel descriptions
    const val DEFAULT_CHANNEL_DESCRIPTION = "General notifications"
    const val URGENT_CHANNEL_DESCRIPTION = "Urgent notifications that require immediate attention"

    // Default notification messages
    const val DEFAULT_NOTIFICATION_TITLE = "Notification"
    const val DEFAULT_NOTIFICATION_BODY = "You have a new message"

    // Intent extras
    const val EXTRA_IS_NOTIFICATION = "is_notification"
    const val EXTRA_ACTION = "action"
    const val EXTRA_NOTIFICATION_DATA = "notification_data"
}