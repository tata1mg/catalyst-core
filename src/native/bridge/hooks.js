import { useEffect, useState } from "react"

// TODO: also add integration for web only
export const useCamera = () => {
    const [photo, setPhoto] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        if (!window.WebBridge) {
            console.error("WebBridge not initialized!")
            return
        }

        window.WebBridge.register("ON_CAMERA_CAPTURE", (data) => {
            const { imageUrl } = JSON.parse(data)
            setPhoto(imageUrl)
        })

        window.WebBridge.register("CAMERA_PERMISSION_STATUS", (data) => {
            setError(data)
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
    }
}

export const requestCameraPermission = () => {
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
