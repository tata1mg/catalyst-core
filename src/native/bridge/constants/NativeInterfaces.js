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

    // Device info commands
    GET_DEVICE_INFO: "getDeviceInfo",
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
    PUSH_NOTIFICATION_TOKEN: "PUSH_NOTIFICATION_TOKEN",
    NOTIFICATION_RECEIVED: "NOTIFICATION_RECEIVED",
    NOTIFICATION_ACTION_PERFORMED: "NOTIFICATION_ACTION_PERFORMED",

    // Device info callbacks
    ON_DEVICE_INFO_SUCCESS: "ON_DEVICE_INFO_SUCCESS",
    ON_DEVICE_INFO_ERROR: "ON_DEVICE_INFO_ERROR",
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
        ],
        callbacks: [
            NATIVE_CALLBACKS.NOTIFICATION_PERMISSION_STATUS,
            NATIVE_CALLBACKS.LOCAL_NOTIFICATION_SCHEDULED,
            NATIVE_CALLBACKS.PUSH_NOTIFICATION_TOKEN,
            NATIVE_CALLBACKS.NOTIFICATION_RECEIVED,
            NATIVE_CALLBACKS.NOTIFICATION_ACTION_PERFORMED,
        ],
    },
    DEVICE_INFO: {
        commands: [NATIVE_COMMANDS.GET_DEVICE_INFO],
        callbacks: [NATIVE_CALLBACKS.ON_DEVICE_INFO_SUCCESS, NATIVE_CALLBACKS.ON_DEVICE_INFO_ERROR],
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

// Haptic feedback types
export const HAPTIC_FEEDBACK_TYPES = {
    LIGHT: "light",
    MEDIUM: "medium",
    HEAVY: "heavy",
    SUCCESS: "success",
    WARNING: "warning",
    ERROR: "error",
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
    RESPONSE_STATUS,
    isValidCommand,
    isValidCallback,
    isValidInterface,
    getInterfacesByCategory,
    debugInterfaces,
}
