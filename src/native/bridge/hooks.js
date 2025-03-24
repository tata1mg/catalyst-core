import { useEffect, useState } from "react"

// TODO: also add integration for web only
export const useCamera = () => {
    const [photo, setPhoto] = useState(null)
    const [error, setError] = useState(null)
    const [permission, setPermission] = useState(null)

    useEffect(() => {
        if (!window.WebBridge) {
            console.error("WebBridge not initialized!")
            return
        }

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
        if (window.NativeBridge) {
            window.NativeBridge.openCamera()
        }
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
    if (!window.WebBridge) {
        console.error("WebBridge not initialized!")
        return
    }

    return new Promise((resolve, reject) => {
        if (window.NativeBridge) {
            window.NativeBridge.requestCameraPermission()
        }

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
    const [permission, setPermission] = useState(null)

    useEffect(() => {
        if (!window.WebBridge) {
            console.error("WebBridge not initialized!")
            return
        }

        if (window.NativeBridge) {
            window.NativeBridge.requestCameraPermission()
        }

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
    if (!window.WebBridge) {
        console.error("WebBridge not initialized!")
        return
    }

    return new Promise((resolve, reject) => {
        if (window.NativeBridge) {
            window.NativeBridge.requestHapticFeedback(feedbackType)
        }

        window.WebBridge.register("HAPTIC_FEEDBACK", (data) => {
            if (data === "SUCCESS") {
                resolve(data)
            } else {
                reject(data)
            }
        })
    })
}
