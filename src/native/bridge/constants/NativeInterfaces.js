// Native Bridge Interface Constants
// Centralized definitions for all native interface communications

// Command Interfaces: Web → Native (outgoing commands)
export const NATIVE_COMMANDS = {
    // Camera commands
    OPEN_CAMERA: "openCamera",
    REQUEST_CAMERA_PERMISSION: "requestCameraPermission",

    // File commands
    PICK_FILE: "pickFile",
    OPEN_FILE_WITH_INTENT: "openFileWithIntent",

    // Haptic feedback commands
    REQUEST_HAPTIC_FEEDBACK: "requestHapticFeedback",

    // Notification commands
    SCHEDULE_LOCAL_NOTIFICATION: "scheduleLocalNotification",
    CANCEL_LOCAL_NOTIFICATION: "cancelLocalNotification",
    REQUEST_NOTIFICATION_PERMISSION: "requestNotificationPermission",
    REGISTER_FOR_PUSH_NOTIFICATIONS: "registerForPushNotifications",
    UPDATE_BADGE_COUNT: "updateBadgeCount",
    SUBSCRIBE_TO_TOPIC: "subscribeToTopic",
    UNSUBSCRIBE_FROM_TOPIC: "unsubscribeFromTopic",
    GET_SUBSCRIBED_TOPICS: "getSubscribedTopics",

    // Device info commands
    GET_DEVICE_INFO: "getDeviceInfo",

    // Network commands
    GET_NETWORK_STATUS: "getNetworkStatus",
}

// Callback Interfaces: Native → Web (incoming events/callbacks)
export const NATIVE_CALLBACKS = {
    // Camera callbacks
    CAMERA_PERMISSION_STATUS: "CAMERA_PERMISSION_STATUS",
    ON_CAMERA_CAPTURE: "ON_CAMERA_CAPTURE",
    ON_CAMERA_ERROR: "ON_CAMERA_ERROR",

    // File picker callbacks
    ON_FILE_PICKED: "ON_FILE_PICKED",
    ON_FILE_PICK_ERROR: "ON_FILE_PICK_ERROR",
    ON_FILE_PICK_CANCELLED: "ON_FILE_PICK_CANCELLED",
    ON_FILE_PICK_STATE_UPDATE: "ON_FILE_PICK_STATE_UPDATE",

    // Intent callbacks
    ON_INTENT_SUCCESS: "ON_INTENT_SUCCESS",
    ON_INTENT_ERROR: "ON_INTENT_ERROR",
    ON_INTENT_CANCELLED: "ON_INTENT_CANCELLED",

    // Haptic feedback callbacks
    HAPTIC_FEEDBACK: "HAPTIC_FEEDBACK",

    // Notification callbacks
    NOTIFICATION_PERMISSION_STATUS: "NOTIFICATION_PERMISSION_STATUS",
    LOCAL_NOTIFICATION_SCHEDULED: "LOCAL_NOTIFICATION_SCHEDULED",
    LOCAL_NOTIFICATION_CANCELLED: "LOCAL_NOTIFICATION_CANCELLED",
    PUSH_NOTIFICATION_TOKEN: "PUSH_NOTIFICATION_TOKEN",
    NOTIFICATION_RECEIVED: "NOTIFICATION_RECEIVED",
    NOTIFICATION_ACTION_PERFORMED: "NOTIFICATION_ACTION_PERFORMED",
    NOTIFICATION_TAPPED: "NOTIFICATION_TAPPED",
    TOPIC_SUBSCRIPTION_RESULT: "TOPIC_SUBSCRIPTION_RESULT",
    SUBSCRIBED_TOPICS_RESULT: "SUBSCRIBED_TOPICS_RESULT",

    // Device info callbacks
    ON_DEVICE_INFO_SUCCESS: "ON_DEVICE_INFO_SUCCESS",
    ON_DEVICE_INFO_ERROR: "ON_DEVICE_INFO_ERROR",

    // Auth callbacks
    ON_GOOGLE_SIGN_IN_SUCCESS: "ON_GOOGLE_SIGN_IN_SUCCESS",
    ON_GOOGLE_SIGN_IN_ERROR: "ON_GOOGLE_SIGN_IN_ERROR",
    ON_GOOGLE_SIGN_IN_CANCELLED: "ON_GOOGLE_SIGN_IN_CANCELLED",

    // Network callbacks
    NETWORK_STATUS_CHANGED: "NETWORK_STATUS_CHANGED",
}

// Interface Categories for easier management
export const INTERFACE_CATEGORIES = {
    CAMERA: {
        commands: [NATIVE_COMMANDS.OPEN_CAMERA, NATIVE_COMMANDS.REQUEST_CAMERA_PERMISSION],
        callbacks: [
            NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS,
            NATIVE_CALLBACKS.ON_CAMERA_CAPTURE,
            NATIVE_CALLBACKS.ON_CAMERA_ERROR,
        ],
    },
    FILE: {
        commands: [NATIVE_COMMANDS.PICK_FILE, NATIVE_COMMANDS.OPEN_FILE_WITH_INTENT],
        callbacks: [
            NATIVE_CALLBACKS.ON_FILE_PICKED,
            NATIVE_CALLBACKS.ON_FILE_PICK_ERROR,
            NATIVE_CALLBACKS.ON_FILE_PICK_CANCELLED,
            NATIVE_CALLBACKS.ON_FILE_PICK_STATE_UPDATE,
        ],
    },
    INTENT: {
        commands: [NATIVE_COMMANDS.OPEN_FILE_WITH_INTENT],
        callbacks: [
            NATIVE_CALLBACKS.ON_INTENT_SUCCESS,
            NATIVE_CALLBACKS.ON_INTENT_ERROR,
            NATIVE_CALLBACKS.ON_INTENT_CANCELLED,
        ],
    },
    HAPTIC: {
        commands: [NATIVE_COMMANDS.REQUEST_HAPTIC_FEEDBACK],
        callbacks: [NATIVE_CALLBACKS.HAPTIC_FEEDBACK],
    },
    NOTIFICATION: {
        commands: [
            NATIVE_COMMANDS.SCHEDULE_LOCAL_NOTIFICATION,
            NATIVE_COMMANDS.CANCEL_LOCAL_NOTIFICATION,
            NATIVE_COMMANDS.REQUEST_NOTIFICATION_PERMISSION,
            NATIVE_COMMANDS.REGISTER_FOR_PUSH_NOTIFICATIONS,
            NATIVE_COMMANDS.UPDATE_BADGE_COUNT,
            NATIVE_COMMANDS.SUBSCRIBE_TO_TOPIC,
            NATIVE_COMMANDS.UNSUBSCRIBE_FROM_TOPIC,
            NATIVE_COMMANDS.GET_SUBSCRIBED_TOPICS,
        ],
        callbacks: [
            NATIVE_CALLBACKS.NOTIFICATION_PERMISSION_STATUS,
            NATIVE_CALLBACKS.LOCAL_NOTIFICATION_SCHEDULED,
            NATIVE_CALLBACKS.LOCAL_NOTIFICATION_CANCELLED,
            NATIVE_CALLBACKS.PUSH_NOTIFICATION_TOKEN,
            NATIVE_CALLBACKS.NOTIFICATION_RECEIVED,
            NATIVE_CALLBACKS.NOTIFICATION_ACTION_PERFORMED,
            NATIVE_CALLBACKS.NOTIFICATION_TAPPED,
            NATIVE_CALLBACKS.TOPIC_SUBSCRIPTION_RESULT,
            NATIVE_CALLBACKS.SUBSCRIBED_TOPICS_RESULT,
        ],
    },
    DEVICE_INFO: {
        commands: [NATIVE_COMMANDS.GET_DEVICE_INFO],
        callbacks: [NATIVE_CALLBACKS.ON_DEVICE_INFO_SUCCESS, NATIVE_CALLBACKS.ON_DEVICE_INFO_ERROR],
    },
    AUTH: {
        commands: [NATIVE_COMMANDS.GOOGLE_SIGN_IN],
        callbacks: [
            NATIVE_CALLBACKS.ON_GOOGLE_SIGN_IN_SUCCESS,
            NATIVE_CALLBACKS.ON_GOOGLE_SIGN_IN_ERROR,
            NATIVE_CALLBACKS.ON_GOOGLE_SIGN_IN_CANCELLED,
        ],
    },
    NETWORK: {
        commands: [NATIVE_COMMANDS.GET_NETWORK_STATUS],
        callbacks: [NATIVE_CALLBACKS.NETWORK_STATUS_CHANGED],
    },
}

// All available interfaces (for validation)
export const ALL_COMMANDS = Object.values(NATIVE_COMMANDS)
export const ALL_CALLBACKS = Object.values(NATIVE_CALLBACKS)
export const ALL_INTERFACES = [...ALL_COMMANDS, ...ALL_CALLBACKS]

// Permission status constants
export const PERMISSION_STATUS = {
    GRANTED: "GRANTED",
    DENIED: "DENIED",
    NOT_DETERMINED: "NOT_DETERMINED",
    RESTRICTED: "RESTRICTED",
}

// Haptic feedback types (matching Android implementation)
export const HAPTIC_FEEDBACK_TYPES = {
    VIRTUAL_KEY: "VIRTUAL_KEY",
    LONG_PRESS: "LONG_PRESS",
    DEFAULT: "DEFAULT",
    // Legacy types for backward compatibility
    LIGHT: "VIRTUAL_KEY",
    MEDIUM: "DEFAULT",
    HEAVY: "LONG_PRESS",
}

// File picker state constants
export const FILE_PICKER_STATES = {
    OPENING: "opening",
    PROCESSING: "processing",
    IDLE: null,
}

// Intent processing states
export const INTENT_STATES = {
    PROCESSING: "processing",
    DOWNLOADING: "downloading",
    OPENING: "opening",
    IDLE: null,
}

// Camera quality constants
export const CAMERA_QUALITY = {
    HIGH: "high",
    MEDIUM: "medium",
    LOW: "low",
}

// Camera format constants
export const CAMERA_FORMAT = {
    JPEG: "jpeg",
    PNG: "png",
}

// Camera device constants
export const CAMERA_DEVICE = {
    FRONT: "front",
    REAR: "rear",
    BACK: "rear", // Alias for rear
}

// Camera flash mode constants
export const CAMERA_FLASH_MODE = {
    AUTO: "auto",
    ON: "on",
    OFF: "off",
}

// Transport type constants (matching native implementation)
export const TRANSPORT_TYPES = {
    BASE64: "BASE64",
    FILE_URL: "FILE_URL",
    FRAMEWORK_SERVER: "FRAMEWORK_SERVER",
}

// Camera source constants
export const CAMERA_SOURCE = {
    CAMERA: "camera",
    FILE_PICKER: "file_picker",
}

// Response status constants
export const RESPONSE_STATUS = {
    SUCCESS: "SUCCESS",
    ERROR: "ERROR",
    CANCELLED: "CANCELLED",
}

// Utility functions for interface validation
export const isValidCommand = (command) => ALL_COMMANDS.includes(command)
export const isValidCallback = (callback) => ALL_CALLBACKS.includes(callback)
export const isValidInterface = (interfaceName) => ALL_INTERFACES.includes(interfaceName)

// Get interfaces by category
export const getInterfacesByCategory = (category) => {
    const categoryData = INTERFACE_CATEGORIES[category.toUpperCase()]
    if (!categoryData) {
        throw new Error(`Invalid category: ${category}`)
    }
    return categoryData
}

// Debug helper to list all interfaces
export const debugInterfaces = () => {
    console.group("🌉 Native Bridge Interfaces")
    console.log("Commands:", ALL_COMMANDS)
    console.log("Callbacks:", ALL_CALLBACKS)
    console.log("Categories:", Object.keys(INTERFACE_CATEGORIES))
    console.groupEnd()
}

export default {
    NATIVE_COMMANDS,
    NATIVE_CALLBACKS,
    INTERFACE_CATEGORIES,
    ALL_COMMANDS,
    ALL_CALLBACKS,
    ALL_INTERFACES,
    PERMISSION_STATUS,
    HAPTIC_FEEDBACK_TYPES,
    FILE_PICKER_STATES,
    INTENT_STATES,
    CAMERA_QUALITY,
    CAMERA_FORMAT,
    CAMERA_DEVICE,
    CAMERA_FLASH_MODE,
    TRANSPORT_TYPES,
    CAMERA_SOURCE,
    RESPONSE_STATUS,
    isValidCommand,
    isValidCallback,
    isValidInterface,
    getInterfacesByCategory,
    debugInterfaces,
}
