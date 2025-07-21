import { useEffect, useState } from "react";
import nativeBridge from './utils/NativeBridge.js';
import { 
    NATIVE_CALLBACKS, 
    PERMISSION_STATUS, 
    RESPONSE_STATUS,
    FILE_PICKER_STATES,
    INTENT_STATES 
} from './constants/NativeInterfaces.js';

/**
 * React hook for camera functionality
 * Handles camera permissions, photo capture, and error states
 */
export const useCamera = () => {
    // Server-side rendering safety
    if (typeof window === "undefined") {
        return {
            photo: null,
            takePhoto: () => {},
            error: null,
            permission: null,
            isLoading: false,
        };
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.");
    }

    const [photo, setPhoto] = useState(null);
    const [error, setError] = useState(null);
    const [permission, setPermission] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        // Register callback handlers
        window.WebBridge.register(NATIVE_CALLBACKS.ON_CAMERA_CAPTURE, (data) => {
            try {
                const result = typeof data === 'string' ? JSON.parse(data) : data;
                const { imageUrl } = result;
                setPhoto(imageUrl);
                setError(null);
                setIsLoading(false);
                console.log("📷 Photo captured successfully");
            } catch (parseError) {
                console.error("📷 Error parsing camera capture data:", parseError);
                setError("Failed to process captured photo");
                setIsLoading(false);
            }
        });

        window.WebBridge.register(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS, (data) => {
            setPermission(data);
            console.log("📷 Camera permission status:", data);
        });

        window.WebBridge.register(NATIVE_CALLBACKS.ON_CAMERA_ERROR, (data) => {
            setError(data);
            setIsLoading(false);
            console.error("📷 Camera error:", data);
        });

        return () => {
            // Cleanup: unregister all handlers
            window.WebBridge.unregister(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS);
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_CAMERA_CAPTURE);
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_CAMERA_ERROR);
        };
    }, []);

    const takePhoto = () => {
        try {
            if (!nativeBridge.isAvailable()) {
                throw new Error("Native bridge not available");
            }
            
            setIsLoading(true);
            setError(null);
            nativeBridge.camera.open();
            console.log("📷 Camera open requested");
        } catch (err) {
            setError(err.message);
            setIsLoading(false);
            console.error("📷 Failed to open camera:", err);
        }
    };

    const clearPhoto = () => {
        setPhoto(null);
        setError(null);
    };

    return {
        photo,
        takePhoto,
        clearPhoto,
        error,
        permission,
        isLoading,
    };
};

/**
 * React hook for intent handling (opening files with external apps)
 * Manages file opening operations and their states
 */
export const useIntent = () => {
    // Server-side rendering safety
    if (typeof window === "undefined") {
        return {
            isLoading: false,
            processingState: null,
            openFile: () => {},
            error: null,
            success: null,
        };
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.");
    }

    const [isLoading, setIsLoading] = useState(false);
    const [processingState, setProcessingState] = useState(null);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    useEffect(() => {
        // Register callback handlers
        window.WebBridge.register(NATIVE_CALLBACKS.ON_INTENT_SUCCESS, (data) => {
            setIsLoading(false);
            setProcessingState(null);
            setSuccess(data);
            setError(null);
            console.log("📄 Intent completed successfully:", data);
        });

        window.WebBridge.register(NATIVE_CALLBACKS.ON_INTENT_ERROR, (data) => {
            setIsLoading(false);
            setProcessingState(null);
            setError(data);
            setSuccess(null);
            console.error("📄 Intent error:", data);
        });

        window.WebBridge.register(NATIVE_CALLBACKS.ON_INTENT_CANCELLED, (data) => {
            setIsLoading(false);
            setProcessingState(null);
            setError(null);
            setSuccess(null);
            console.log("📄 Intent cancelled:", data);
        });

        return () => {
            // Cleanup: unregister all handlers
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_INTENT_SUCCESS);
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_INTENT_ERROR);
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_INTENT_CANCELLED);
        };
    }, []);

    const openFile = (fileUrl, mimeType = null) => {
        if (!fileUrl) {
            setError("File URL is required");
            return;
        }

        try {
            if (!nativeBridge.isAvailable()) {
                throw new Error("Native bridge not available");
            }

            setIsLoading(true);
            setProcessingState(INTENT_STATES.PROCESSING);
            setError(null);
            setSuccess(null);

            nativeBridge.file.openWithIntent(fileUrl, mimeType);
            console.log("📄 File open with intent requested:", { fileUrl, mimeType });
        } catch (err) {
            setIsLoading(false);
            setProcessingState(null);
            setError(err.message);
            console.error("📄 Failed to open file with intent:", err);
        }
    };

    const reset = () => {
        setIsLoading(false);
        setProcessingState(null);
        setError(null);
        setSuccess(null);
    };

    return {
        isLoading,
        processingState, // Values from INTENT_STATES
        openFile,
        error,
        success,
        reset,
    };
};

/**
 * React hook for file picker functionality
 * Manages file selection operations and their states
 */
export const useFilePicker = () => {
    // Server-side rendering safety
    if (typeof window === "undefined") {
        return {
            selectedFile: null,
            pickFile: () => {},
            isLoading: false,
            processingState: null,
            error: null,
            clearFile: () => {},
            clearError: () => {},
        };
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.");
    }

    const [selectedFile, setSelectedFile] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [processingState, setProcessingState] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        // Register callback handlers
        window.WebBridge.register(NATIVE_CALLBACKS.ON_FILE_PICKED, (data) => {
            try {
                const fileData = typeof data === 'string' ? JSON.parse(data) : data;
                console.log("📁 File picked:", fileData);
                setSelectedFile(fileData);
                setIsLoading(false);
                setProcessingState(null);
                setError(null);
            } catch (parseError) {
                console.error("📁 Error parsing file data:", parseError);
                setError("Error processing selected file");
                setIsLoading(false);
                setProcessingState(null);
            }
        });

        window.WebBridge.register(NATIVE_CALLBACKS.ON_FILE_PICK_ERROR, (data) => {
            console.error("📁 File pick error:", data);
            setError(data);
            setIsLoading(false);
            setProcessingState(null);
            setSelectedFile(null);
        });

        window.WebBridge.register(NATIVE_CALLBACKS.ON_FILE_PICK_CANCELLED, (data) => {
            console.log("📁 File pick cancelled:", data);
            setIsLoading(false);
            setProcessingState(null);
            setError(null);
            // Keep selectedFile as is when cancelled
        });

        // File picker state updates
        window.WebBridge.register(NATIVE_CALLBACKS.ON_FILE_PICK_STATE_UPDATE, (data) => {
            try {
                const stateData = typeof data === 'string' ? JSON.parse(data) : data;
                console.log("📁 File picker state:", stateData.state);
                setProcessingState(stateData.state);
                if (stateData.state) {
                    setIsLoading(true);
                }
            } catch (parseError) {
                console.error("📁 Error parsing state data:", parseError);
            }
        });

        return () => {
            // Cleanup: unregister all handlers
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_FILE_PICKED);
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_FILE_PICK_ERROR);
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_FILE_PICK_CANCELLED);
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_FILE_PICK_STATE_UPDATE);
        };
    }, []);

    const pickFile = (mimeType = null) => {
        try {
            if (!nativeBridge.isAvailable()) {
                throw new Error("Native bridge not available");
            }

            const finalMimeType = mimeType || "*/*";
            console.log("📁 Picking file with MIME type:", finalMimeType);
            
            setIsLoading(true);
            setProcessingState(FILE_PICKER_STATES.OPENING);
            setError(null);

            nativeBridge.file.pick(finalMimeType);
        } catch (err) {
            setIsLoading(false);
            setProcessingState(null);
            setError(err.message);
            console.error("📁 Failed to pick file:", err);
        }
    };

    const clearFile = () => {
        setSelectedFile(null);
        setError(null);
    };

    const clearError = () => {
        setError(null);
    };

    const reset = () => {
        setSelectedFile(null);
        setIsLoading(false);
        setProcessingState(null);
        setError(null);
    };

    return {
        selectedFile,
        pickFile,
        isLoading,
        processingState, // Values from FILE_PICKER_STATES
        error,
        clearFile,
        clearError,
        reset,
    };
};

/**
 * Promise-based camera permission request
 * @returns {Promise<string>} Promise that resolves with permission status
 */
export const requestCameraPermission = () => {
    if (typeof window === "undefined") {
        return Promise.resolve(null);
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.");
    }

    return new Promise((resolve, reject) => {
        try {
            if (!nativeBridge.isAvailable()) {
                reject(new Error("Native bridge not available"));
                return;
            }

            // Set up one-time listener
            const handlePermissionStatus = (data) => {
                window.WebBridge.unregister(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS);
                
                if (data === PERMISSION_STATUS.GRANTED) {
                    resolve(data);
                } else {
                    reject(new Error(`Camera permission ${data.toLowerCase()}`));
                }
            };

            window.WebBridge.register(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS, handlePermissionStatus);
            nativeBridge.camera.requestPermission();

            console.log("📷 Camera permission requested");
        } catch (error) {
            reject(error);
        }
    });
};

/**
 * React hook for camera permission status
 * Automatically requests permission on mount
 */
export const useCameraPermission = () => {
    if (typeof window === "undefined") {
        return { permission: null, isLoading: false };
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.");
    }

    const [permission, setPermission] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const requestPermission = async () => {
            try {
                if (!nativeBridge.isAvailable()) {
                    setPermission(PERMISSION_STATUS.NOT_DETERMINED);
                    setIsLoading(false);
                    return;
                }

                window.WebBridge.register(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS, (data) => {
                    setPermission(data);
                    setIsLoading(false);
                    console.log("📷 Camera permission status updated:", data);
                });

                nativeBridge.camera.requestPermission();
            } catch (error) {
                console.error("📷 Error requesting camera permission:", error);
                setPermission(PERMISSION_STATUS.DENIED);
                setIsLoading(false);
            }
        };

        requestPermission();

        return () => {
            window.WebBridge.unregister(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS);
        };
    }, []);

    return { permission, isLoading };
};

/**
 * Promise-based haptic feedback request
 * @param {string} feedbackType - Type of haptic feedback (from HAPTIC_FEEDBACK_TYPES)
 * @returns {Promise<string>} Promise that resolves with success status
 */
export const requestHapticFeedback = (feedbackType = "light") => {
    if (typeof window === "undefined") {
        return Promise.resolve(null);
    }

    if (!window.WebBridge) {
        throw new Error("WebBridge is not initialized. Call WebBridge.init() first.");
    }

    return new Promise((resolve, reject) => {
        try {
            if (!nativeBridge.isAvailable()) {
                reject(new Error("Native bridge not available"));
                return;
            }

            // Set up one-time listener
            const handleHapticResponse = (data) => {
                window.WebBridge.unregister(NATIVE_CALLBACKS.HAPTIC_FEEDBACK);
                
                if (data === RESPONSE_STATUS.SUCCESS) {
                    resolve(data);
                } else {
                    reject(new Error(`Haptic feedback failed: ${data}`));
                }
            };

            window.WebBridge.register(NATIVE_CALLBACKS.HAPTIC_FEEDBACK, handleHapticResponse);
            nativeBridge.haptic.feedback(feedbackType);

            console.log("📳 Haptic feedback requested:", feedbackType);
        } catch (error) {
            reject(error);
        }
    });
};

/**
 * React hook for haptic feedback
 * Provides a function to trigger haptic feedback
 */
export const useHapticFeedback = () => {
    if (typeof window === "undefined") {
        return {
            triggerHaptic: () => Promise.resolve(null),
            isAvailable: false,
        };
    }

    const isAvailable = nativeBridge.isAvailable();

    const triggerHaptic = async (feedbackType = "light") => {
        try {
            await requestHapticFeedback(feedbackType);
            return true;
        } catch (error) {
            console.error("📳 Haptic feedback failed:", error);
            return false;
        }
    };

    return {
        triggerHaptic,
        isAvailable,
    };
};