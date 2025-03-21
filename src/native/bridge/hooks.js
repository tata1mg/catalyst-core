import { useEffect, useState } from "react"

// TODO: also add integration for web only
export const useCamera = () => {
    const [photo, setPhoto] = useState(null)

    useEffect(() => {
        if (!window.WebBridge) {
            console.error("WebBridge not initialized!")
            return
        }

        window.WebBridge.register("ON_CAMERA_CAPTURE", (data) => {
            const { imageUrl } = JSON.parse(data)
            setPhoto(imageUrl)
        })

        return () => {
            window.WebBridge.unregister("ON_CAMERA_CAPTURE")
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
    }
}
