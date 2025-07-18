import { useEffect, useState } from "react"

const NativeBridge = {
    interfaces: [
        "openCamera", 
        "requestCameraPermission", 
        "requestHapticFeedback",
        "openFileWithIntent",
        "pickFile"
    ],
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

export const useIntent = () => {
    if (typeof window === "undefined") {
        return {
            isLoading: false,
            openFile: () => {},
            error: null,
            success: null,
        }
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized")
    }

    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState(null)
    const [success, setSuccess] = useState(null)

    useEffect(() => {
        window.WebBridge.register("ON_INTENT_SUCCESS", (data) => {
            setIsLoading(false)
            setSuccess(data)
            setError(null)
        })

        window.WebBridge.register("ON_INTENT_ERROR", (data) => {
            setIsLoading(false)
            setError(data)
            setSuccess(null)
        })

        window.WebBridge.register("ON_INTENT_CANCELLED", (data) => {
            setIsLoading(false)
            setError(null)
            setSuccess(null)
        })

        return () => {
            window.WebBridge.unregister("ON_INTENT_SUCCESS")
            window.WebBridge.unregister("ON_INTENT_ERROR")
            window.WebBridge.unregister("ON_INTENT_CANCELLED")
        }
    }, [])

    const openFile = (fileUrl, mimeType = null) => {
        if (!fileUrl) {
            setError("File URL is required")
            return
        }

        setIsLoading(true)
        setError(null)
        setSuccess(null)

        const params = mimeType ? `${fileUrl}|${mimeType}` : fileUrl
        NativeBridge.call("openFileWithIntent", params)
    }

    return {
        isLoading,
        openFile,
        error,
        success,
    }
}

export const useFilePicker = () => {
    if (typeof window === "undefined") {
        return {
            selectedFile: null,
            pickFile: () => {},
            isLoading: false,
            error: null,
        }
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized")
    }

    const [selectedFile, setSelectedFile] = useState(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState(null)

    useEffect(() => {
        window.WebBridge.register("ON_FILE_PICKED", (data) => {
            const fileData = JSON.parse(data)
            setSelectedFile(fileData)
            setIsLoading(false)
            setError(null)
        })

        window.WebBridge.register("ON_FILE_PICK_ERROR", (data) => {
            setError(data)
            setIsLoading(false)
            setSelectedFile(null)
        })

        window.WebBridge.register("ON_FILE_PICK_CANCELLED", (data) => {
            setIsLoading(false)
            setError(null)
            // Keep selectedFile as is when cancelled
        })

        return () => {
            window.WebBridge.unregister("ON_FILE_PICKED")
            window.WebBridge.unregister("ON_FILE_PICK_ERROR")
            window.WebBridge.unregister("ON_FILE_PICK_CANCELLED")
        }
    }, [])

    const pickFile = (mimeType = null) => {
        setIsLoading(true)
        setError(null)

        const params = mimeType || "*/*"
        NativeBridge.call("pickFile", params)
    }

    return {
        selectedFile,
        pickFile,
        isLoading,
        error,
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