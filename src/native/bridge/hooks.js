import { useEffect, useState } from "react"

const NativeBridge = {
    interfaces: ["openCamera", "requestCameraPermission", "requestHapticFeedback"],
    call: (interfaceName, data) => {
        if (!NativeBridge.interfaces.includes(interfaceName)) {
            console.error("Invalid native interface called!")
            return
        }

        if (window.NativeBridge) {
            window.NativeBridge[interfaceName](data)
            return
        }

        if (window.webkit.messageHandlers.NativeBridge) {
            window.webkit.messageHandlers.NativeBridge.postMessage({
                command: interfaceName,
                data: data,
            })
            return
        }

        console.error("NativeBridge not found!")
    },
}

export const useCamera = () => {
    if (typeof window === "undefined") {
        return {
            photo: null,
            takePhoto: () => {},
            error: null,
            permission: null,
        }
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized")
    }

    const [photo, setPhoto] = useState(null)
    const [error, setError] = useState(null)
    const [permission, setPermission] = useState(null)

    useEffect(() => {
        window.WebBridge.register("ON_CAMERA_CAPTURE", (data) => {
            const { imageUrl } = JSON.parse(data)
            setPhoto(imageUrl)
            setError(null)
        })

        window.WebBridge.register("CAMERA_PERMISSION_STATUS", (data) => {
            setPermission(data)
        })

        window.WebBridge.register("ON_CAMERA_ERROR", (data) => {
            setError(data)
        })

        return () => {
            window.WebBridge.unregister("CAMERA_PERMISSION_STATUS")
            window.WebBridge.unregister("ON_CAMERA_CAPTURE")
            window.WebBridge.unregister("ON_CAMERA_ERROR")
        }
    }, [])

    const takePhoto = () => {
        NativeBridge.call("openCamera")
    }

    return {
        photo,
        takePhoto,
        error,
        permission,
    }
}

// TODO: add condition for already registered interface
export const requestCameraPermission = () => {
    if (typeof window === "undefined") {
        return Promise.resolve(null)
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized")
    }

    return new Promise((resolve, reject) => {
        NativeBridge.call("requestCameraPermission")

        window.WebBridge.register("CAMERA_PERMISSION_STATUS", (data) => {
            if (data === "GRANTED") {
                resolve(data)
            } else {
                reject(data)
            }
        })
    })
}

export const cameraPermissionHook = () => {
    if (typeof window === "undefined") {
        return { permission: null }
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized")
    }

    const [permission, setPermission] = useState(null)

    useEffect(() => {
        NativeBridge.call("requestCameraPermission")

        window.WebBridge.register("CAMERA_PERMISSION_STATUS", (data) => {
            setPermission(data)
        })

        return () => {
            window.WebBridge.unregister("CAMERA_PERMISSION_STATUS")
        }
    }, [])

    return { permission }
}

// TODO: add condition for already registered interface
export const requestHapticFeedback = (feedbackType = "") => {
    if (typeof window === "undefined") {
        return Promise.resolve(null)
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized")
    }

    return new Promise((resolve, reject) => {
        NativeBridge.call("requestHapticFeedback", feedbackType)

        window.WebBridge.register("HAPTIC_FEEDBACK", (data) => {
            if (data === "SUCCESS") {
                resolve(data)
            } else {
                reject(data)
            }
        })
    })
}
