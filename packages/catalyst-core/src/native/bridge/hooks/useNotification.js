/* eslint-disable react-compiler/react-compiler, react-hooks/exhaustive-deps */
import { useEffect, useState } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS, PERMISSION_STATUS } from "../constants/NativeInterfaces.js"
import { ERROR_CODES, createStandardError } from "../errors.js"
import { useBaseHook } from "../useBaseHook.js"

// Shared callback system — allows hook + requestNotificationPermission to share one WebBridge listener
const permissionStatusListeners = new Set()
let isPermissionCallbackRegistered = false

const registerPermissionStatusListener = (callback) => {
    permissionStatusListeners.add(callback)

    if (!isPermissionCallbackRegistered && typeof window !== "undefined" && window.WebBridge) {
        isPermissionCallbackRegistered = true
        window.WebBridge.register(NATIVE_CALLBACKS.NOTIFICATION_PERMISSION_STATUS, (data) => {
            permissionStatusListeners.forEach((listener) => {
                try {
                    listener(data)
                } catch (error) {
                    console.error("Error in permission status listener:", error)
                }
            })
        })
    }

    return () => {
        permissionStatusListeners.delete(callback)
    }
}

const unregisterPermissionStatusListener = (callback) => {
    permissionStatusListeners.delete(callback)
}

export const requestNotificationPermission = () => {
    if (typeof window === "undefined") {
        return Promise.resolve(null)
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.")
    }

    return new Promise((resolve, reject) => {
        try {
            if (!nativeBridge.isAvailable()) {
                reject(new Error("Native bridge not available"))
                return
            }

            const handlePermissionStatus = (data) => {
                unregisterPermissionStatusListener(handlePermissionStatus)
                if (data === PERMISSION_STATUS.GRANTED) {
                    resolve(data)
                } else {
                    reject(new Error(`Notification permission ${data.toLowerCase()}`))
                }
            }

            registerPermissionStatusListener(handlePermissionStatus)
            nativeBridge.notification.requestPermission()
        } catch (error) {
            reject(error)
        }
    })
}

export const useNotificationPermission = () => {
    const [permission, setPermission] = useState(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState(null)
    const isWeb = typeof window === "undefined" ? true : !nativeBridge.isAvailable()

    useEffect(() => {
        const requestPermission = async () => {
            try {
                if (!nativeBridge.isAvailable()) {
                    setPermission(PERMISSION_STATUS.NOT_DETERMINED)
                    setIsLoading(false)
                    return
                }

                window.WebBridge.register(NATIVE_CALLBACKS.NOTIFICATION_PERMISSION_STATUS, (data) => {
                    setPermission(data)
                    setIsLoading(false)
                    console.log("🔔 Notification permission status updated:", data)
                })

                nativeBridge.notification.requestPermission()
            } catch (err) {
                console.error("🔔 Error requesting notification permission:", err)
                setPermission(PERMISSION_STATUS.DENIED)
                setError(
                    createStandardError(ERROR_CODES.PERMISSION_DENIED, "Notification permission denied", err)
                )
                setIsLoading(false)
            }
        }

        requestPermission()

        return () => {
            window.WebBridge.unregister(NATIVE_CALLBACKS.NOTIFICATION_PERMISSION_STATUS)
        }
    }, [])

    if (typeof window === "undefined") {
        return {
            permission: null,
            isLoading: false,
            loading: false,
            data: null,
            error: null,
            isNative: false,
            isWeb: true,
        }
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.")
    }

    return {
        permission,
        isLoading,
        loading: isLoading,
        data: permission,
        error,
        isNative: !isWeb,
        isWeb,
    }
}

export const useNotification = () => {
    const base = useBaseHook("useNotification")
    const [permissionStatus, setPermissionStatus] = useState(null)
    const [pushToken, setPushToken] = useState(null)
    const [badges, setBadges] = useState(0)
    const [lastNotification, setLastNotification] = useState(null)
    const [subscribedTopics, setSubscribedTopics] = useState([])

    useEffect(() => {
        const unregister = registerPermissionStatusListener((data) => {
            setPermissionStatus(data)
        })

        if (nativeBridge.isAvailable()) {
            try {
                if (nativeBridge.isAndroid && window.NativeBridge?.checkNotificationPermissionStatus) {
                    window.NativeBridge.checkNotificationPermissionStatus(null)
                } else if (nativeBridge.isIOS && window.webkit?.messageHandlers?.NativeBridge) {
                    window.webkit.messageHandlers.NativeBridge.postMessage({
                        command: "checkNotificationPermissionStatus",
                        data: null,
                    })
                }
            } catch (error) {
                console.error("🔔 Error checking notification permission status:", error)
            }
        }

        window.WebBridge.register(NATIVE_CALLBACKS.LOCAL_NOTIFICATION_SCHEDULED, (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                if (result?.success === false || result?.error) {
                    base.handleNativeError(result.error || result)
                    return
                }
                base.setDataAndComplete(result)
            } catch (error) {
                base.handleNativeError(error)
            }
        })

        window.WebBridge.register(NATIVE_CALLBACKS.LOCAL_NOTIFICATION_CANCELLED, (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                if (result?.success === false || result?.error) {
                    base.handleNativeError(result.error || result)
                    return
                }
                base.setDataAndComplete(result)
            } catch (error) {
                base.handleNativeError(error)
            }
        })

        window.WebBridge.register(NATIVE_CALLBACKS.PUSH_NOTIFICATION_TOKEN, (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                if (result?.error) {
                    base.handleNativeError(result.error)
                    return
                }
                setPushToken(result.token)
                base.setDataAndComplete(result)
            } catch (error) {
                base.handleNativeError(error)
            }
        })

        window.WebBridge.register(NATIVE_CALLBACKS.NOTIFICATION_RECEIVED, (data) => {
            const notification = typeof data === "string" ? JSON.parse(data) : data
            setLastNotification(notification)
        })

        window.WebBridge.register(NATIVE_CALLBACKS.NOTIFICATION_TAPPED, (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                base.setDataAndComplete(result)
            } catch (error) {
                base.handleNativeError(error)
            }
        })

        window.WebBridge.register(NATIVE_CALLBACKS.NOTIFICATION_ACTION_PERFORMED, (data) => {
            const action = typeof data === "string" ? JSON.parse(data) : data
            base.setDataAndComplete(action)
        })

        window.WebBridge.register(NATIVE_CALLBACKS.TOPIC_SUBSCRIPTION_RESULT, (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                if (result?.error) {
                    base.handleNativeError(result.error)
                    return
                }
                if (result?.success === false) {
                    base.handleNativeError(result)
                    return
                }
                base.setDataAndComplete(result)
            } catch (error) {
                base.handleNativeError(error)
            }
        })

        window.WebBridge.register(NATIVE_CALLBACKS.SUBSCRIBED_TOPICS_RESULT, (data) => {
            try {
                const result = typeof data === "string" ? JSON.parse(data) : data
                if (result?.error) {
                    base.handleNativeError(result.error)
                    return
                }
                if (result?.success === false) {
                    base.handleNativeError(result)
                    return
                }
                setSubscribedTopics(result.topics || [])
                base.setDataAndComplete(result)
            } catch (error) {
                base.handleNativeError(error)
            }
        })

        return () => {
            unregister()
            window.WebBridge.unregister(NATIVE_CALLBACKS.LOCAL_NOTIFICATION_SCHEDULED)
            window.WebBridge.unregister(NATIVE_CALLBACKS.LOCAL_NOTIFICATION_CANCELLED)
            window.WebBridge.unregister(NATIVE_CALLBACKS.PUSH_NOTIFICATION_TOKEN)
            window.WebBridge.unregister(NATIVE_CALLBACKS.NOTIFICATION_RECEIVED)
            window.WebBridge.unregister(NATIVE_CALLBACKS.NOTIFICATION_TAPPED)
            window.WebBridge.unregister(NATIVE_CALLBACKS.NOTIFICATION_ACTION_PERFORMED)
            window.WebBridge.unregister(NATIVE_CALLBACKS.TOPIC_SUBSCRIPTION_RESULT)
            window.WebBridge.unregister(NATIVE_CALLBACKS.SUBSCRIBED_TOPICS_RESULT)
        }
    }, [])

    if (typeof window === "undefined") {
        return {
            data: null,
            loading: false,
            progress: {
                state: "idle",
                percentage: null,
                message: null,
                phase: null,
                transport: null,
                bytesLoaded: null,
                bytesTotal: null,
            },
            error: null,
            execute: () => {},
            clear: () => {},
            clearError: () => {},
            isNative: false,
            isWeb: true,
            permissionStatus: null,
            pushToken: null,
            badges: 0,
            lastNotification: null,
            subscribedTopics: [],
            scheduleLocal: () => {},
            cancelLocal: () => {},
            registerForPush: () => {},
            updateBadge: () => {},
            subscribeToTopic: () => {},
            unsubscribeFromTopic: () => {},
            getSubscribedTopics: () => {},
            schedule: () => {},
            requestPermission: () => {},
        }
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.")
    }

    const requestPermission = () => {
        requestNotificationPermission().catch((err) => base.handleNativeError(err))
    }

    const scheduleLocal = (config) => {
        base.executeOperation(() => {
            nativeBridge.notification.scheduleLocal(config)
        }, "schedule local notification")
    }

    const cancelLocal = (notificationId) => {
        base.executeOperation(() => {
            nativeBridge.notification.cancelLocal(notificationId)
        }, "cancel notification")
    }

    const registerForPush = () => {
        base.executeOperation(() => {
            nativeBridge.notification.registerForPush()
        }, "register for push")
    }

    const updateBadge = (count) => {
        base.callNative(() => nativeBridge.notification.updateBadge(count))
        setBadges(count)
    }

    const subscribeToTopic = (topic) => {
        base.executeOperation(() => {
            nativeBridge.notification.subscribeToTopic(topic)
        }, "subscribe to topic")
    }

    const unsubscribeFromTopic = (topic) => {
        base.executeOperation(() => {
            nativeBridge.notification.unsubscribeFromTopic(topic)
        }, "unsubscribe from topic")
    }

    const getSubscribedTopics = () => {
        base.executeOperation(() => {
            nativeBridge.notification.getSubscribedTopics()
        }, "get subscribed topics")
    }

    return {
        data: base.data,
        loading: base.loading,
        progress: base.progress,
        error: base.error,
        execute: scheduleLocal,
        clear: base.clear,
        clearError: base.clearError,
        isNative: base.isNative,
        isWeb: base.isWeb,
        permissionStatus,
        pushToken,
        badges,
        lastNotification,
        subscribedTopics,
        scheduleLocal,
        cancelLocal,
        registerForPush,
        updateBadge,
        subscribeToTopic,
        unsubscribeFromTopic,
        getSubscribedTopics,
        schedule: scheduleLocal,
        requestPermission,
    }
}
