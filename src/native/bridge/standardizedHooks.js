import { useEffect, useState } from "react";
import { useBaseHook } from './useBaseHook';
import nativeBridge from './utils/NativeBridge.js';
import { NATIVE_CALLBACKS } from './constants/NativeInterfaces';
import { ERROR_CODES, createStandardError } from './errors';

/**
 * Standardized Camera Superhook
 * Comprehensive camera functionality with integrated permission management
 * Follows standardized interface with execute as primary function
 * 
 * @param {Object} options - Configuration options
 * @returns {Object} Standardized camera superhook interface
 */
export const useCamera = (options = {}) => {
    const base = useBaseHook('useCamera', options);
    const [permission, setPermission] = useState({
        status: 'not_determined',
        canRequest: true,
        lastChecked: null
    });

    // Camera operations
    const CAMERA_OPERATIONS = {
        TAKE_PHOTO: 'takePhoto',
        REQUEST_PERMISSION: 'requestPermission',
        CHECK_PERMISSION: 'checkPermission'
    };

    // Camera-specific progress phases
    const CAMERA_PHASES = {
        REQUESTING_PERMISSION: 'requesting_permission',
        CHECKING_PERMISSION: 'checking_permission',
        OPENING_CAMERA: 'opening_camera',
        CAPTURING: 'capturing',
        PROCESSING: 'processing',
        COMPLETE: 'complete'
    };

    useEffect(() => {
        // Server-side rendering safety
        if (typeof window === "undefined") return;

        if (!window.WebBridge) {
            console.warn("WebBridge not initialized. Camera functionality unavailable.");
            return;
        }

        // Camera capture success handler
        const handleCameraCapture = (data) => {
            try {
                const result = typeof data === 'string' ? JSON.parse(data) : data;
                
                base.updateProgress({
                    phase: CAMERA_PHASES.PROCESSING,
                    message: 'Processing captured photo...'
                });

                // Handle new tri-transport format or legacy format
                const photoData = result.fileSrc ? {
                    // New tri-transport format
                    fileSrc: result.fileSrc,
                    fileName: result.fileName,
                    size: result.size,
                    mimeType: result.mimeType,
                    transport: result.transport,
                    source: result.source,
                    filePath: result.filePath
                } : {
                    // Legacy format (fallback)
                    fileSrc: result.imageUrl,
                    fileName: result.fileName || 'camera_photo.jpg',
                    size: result.size || 0,
                    mimeType: result.mimeType || 'image/jpeg',
                    transport: 'LEGACY',
                    source: 'camera',
                    filePath: result.filePath || null
                };

                // Create comprehensive data object with photo and permission info
                const cameraData = {
                    ...photoData,
                    permission: permission,
                    lastOperation: CAMERA_OPERATIONS.TAKE_PHOTO,
                    operationSuccess: true,
                    timestamp: new Date().toISOString()
                };

                base.setDataAndComplete(cameraData);
                console.log("📷 Photo captured successfully via transport:", photoData.transport);
                
            } catch (parseError) {
                console.error("📷 Error parsing camera capture data:", parseError);
                const error = createStandardError(
                    ERROR_CODES.INTERNAL_ERROR,
                    "Failed to process captured photo",
                    parseError
                );
                base.handleNativeError(error);
            }
        };

        // Camera permission status handler
        const handlePermissionStatus = (data) => {
            const permissionStatus = typeof data === 'string' ? data : data.status || data;
            const newPermission = {
                status: permissionStatus.toLowerCase(),
                canRequest: permissionStatus !== 'permanently_denied',
                lastChecked: new Date().toISOString()
            };
            
            setPermission(newPermission);
            console.log("📷 Camera permission status:", newPermission);
            
            // Update data with permission info
            const permissionData = {
                permission: newPermission,
                lastOperation: CAMERA_OPERATIONS.REQUEST_PERMISSION,
                operationSuccess: permissionStatus === 'GRANTED',
                timestamp: new Date().toISOString()
            };
            
            if (permissionStatus === 'GRANTED') {
                base.updateProgress({
                    phase: CAMERA_PHASES.OPENING_CAMERA,
                    message: 'Camera permission granted, ready to capture...'
                });
                base.setDataAndComplete(permissionData);
            } else if (permissionStatus === 'DENIED') {
                const error = createStandardError(
                    ERROR_CODES.PERMISSION_DENIED,
                    "Camera permission denied",
                    null,
                    "Camera permission is required to take photos"
                );
                base.handleNativeError(error);
            }
        };

        // Camera error handler
        const handleCameraError = (data) => {
            console.error("📷 Camera error:", data);
            base.handleNativeError(data);
        };

        // Register event listeners
        window.WebBridge.register(NATIVE_CALLBACKS.ON_CAMERA_CAPTURE, handleCameraCapture);
        window.WebBridge.register(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS, handlePermissionStatus);
        window.WebBridge.register(NATIVE_CALLBACKS.ON_CAMERA_ERROR, handleCameraError);

        // Cleanup function
        return () => {
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_CAMERA_CAPTURE);
            window.WebBridge.unregister(NATIVE_CALLBACKS.CAMERA_PERMISSION_STATUS);
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_CAMERA_ERROR);
        };
    }, [base]);

    // Main execute function for camera superhook
    const executeCamera = (operation, ...args) => {
        if (base.isWeb) {
            console.warn(`Camera ${operation} requires web fallback implementation (isWeb: true)`);
            return;
        }

        switch (operation) {
            case CAMERA_OPERATIONS.TAKE_PHOTO:
                return handleTakePhoto(args[0] || {});
            case CAMERA_OPERATIONS.REQUEST_PERMISSION:
                return handleRequestPermission();
            case CAMERA_OPERATIONS.CHECK_PERMISSION:
                return handleCheckPermission();
            default:
                const error = createStandardError(
                    ERROR_CODES.INVALID_PARAMETERS,
                    `Unknown camera operation: ${operation}`,
                    null,
                    `Valid operations: ${Object.values(CAMERA_OPERATIONS).join(', ')}`
                );
                base.handleNativeError(error);
        }
    };

    // Camera operation handlers
    const handleTakePhoto = (cameraOptions = {}) => {
        base.executeOperation(() => {
            base.updateProgress({
                phase: CAMERA_PHASES.REQUESTING_PERMISSION,
                message: 'Requesting camera permission...'
            });

            nativeBridge.camera.open(cameraOptions);
            console.log("📷 Camera open requested with options:", cameraOptions);
        }, 'photo capture');
    };

    const handleRequestPermission = () => {
        base.executeOperation(() => {
            base.updateProgress({
                phase: CAMERA_PHASES.REQUESTING_PERMISSION,
                message: 'Requesting camera permission...'
            });

            if (nativeBridge.camera.requestPermission) {
                nativeBridge.camera.requestPermission();
            } else {
                // Fallback method
                nativeBridge.camera.checkPermission();
            }
            
            console.log("📷 Camera permission requested");
        }, 'permission request');
    };

    const handleCheckPermission = () => {
        base.executeOperation(() => {
            base.updateProgress({
                phase: CAMERA_PHASES.CHECKING_PERMISSION,
                message: 'Checking camera permission...'
            });

            nativeBridge.camera.checkPermission();
            console.log("📷 Camera permission check requested");
        }, 'permission check');
    };

    // Return standardized superhook interface
    return {
        // Standard interface (from useBaseHook)
        data: base.data,
        loading: base.loading,
        progress: base.progress,
        error: base.error,
        isWeb: base.isWeb,
        isNative: base.isNative,
        clear: base.clear,
        clearError: base.clearError,
        
        // Main execute function
        execute: executeCamera,
        
        // Semantic aliases for execute
        takePhoto: (options) => executeCamera(CAMERA_OPERATIONS.TAKE_PHOTO, options),
        requestPermission: () => executeCamera(CAMERA_OPERATIONS.REQUEST_PERMISSION),
        checkPermission: () => executeCamera(CAMERA_OPERATIONS.CHECK_PERMISSION),
        
        // Current state info
        permission: permission,
        
        // Legacy compatibility
        photo: base.data,    
        clearPhoto: base.clear
    };
};

/**
 * Standardized File Picker Hook
 * Provides consistent interface with error standardization and environment detection
 * 
 * @param {Object} options - Configuration options
 * @returns {Object} Standardized file picker interface
 */
export const useFilePicker = (options = {}) => {
    const base = useBaseHook('useFilePicker', options);
    
    // File picker specific progress phases
    const FILE_PICKER_PHASES = {
        OPENING: 'opening',
        PROCESSING: 'processing', 
        ROUTING: 'routing',
        COMPLETE: 'complete'
    };

    useEffect(() => {
        // Server-side rendering safety
        if (typeof window === "undefined") return;

        if (!window.WebBridge) {
            console.warn("WebBridge not initialized. File picker functionality unavailable.");
            return;
        }

        // File picked success handler
        const handleFilePicked = (data) => {
            try {
                const result = typeof data === 'string' ? JSON.parse(data) : data;
                console.log("📁 File picked result:", result);
                
                base.updateProgress({
                    phase: FILE_PICKER_PHASES.PROCESSING,
                    message: 'Processing selected file...'
                });

                // Handle tri-transport format
                const fileData = {
                    fileSrc: result.fileSrc,
                    fileName: result.fileName,
                    size: result.size,
                    mimeType: result.mimeType,
                    transport: result.transport,
                    filePath: result.filePath
                };

                base.setDataAndComplete(fileData);
                console.log("📁 File processed successfully via transport:", fileData.transport);
                
            } catch (parseError) {
                console.error("📁 Error parsing file picker data:", parseError);
                const error = createStandardError(
                    ERROR_CODES.INTERNAL_ERROR,
                    "Failed to process selected file",
                    parseError
                );
                base.handleNativeError(error);
            }
        };

        // File pick error handler
        const handleFilePickError = (data) => {
            console.error("📁 File pick error:", data);
            base.handleNativeError(data);
        };

        // File pick cancelled handler
        const handleFilePickCancelled = (data) => {
            console.log("📁 File pick cancelled:", data);
            const error = createStandardError(
                ERROR_CODES.OPERATION_CANCELLED,
                "File selection was cancelled",
                data
            );
            base.handleNativeError(error);
        };

        // File picker state updates
        const handleFilePickStateUpdate = (data) => {
            try {
                const stateData = typeof data === 'string' ? JSON.parse(data) : data;
                console.log("📁 File picker state:", stateData.state);
                
                let phase = FILE_PICKER_PHASES.PROCESSING;
                let message = 'Processing...';
                
                switch(stateData.state) {
                    case 'opening':
                        phase = FILE_PICKER_PHASES.OPENING;
                        message = 'Opening file picker...';
                        break;
                    case 'processing':
                        phase = FILE_PICKER_PHASES.PROCESSING;
                        message = 'Processing selected file...';
                        break;
                    case 'routing':
                        phase = FILE_PICKER_PHASES.ROUTING;
                        message = 'Determining transport method...';
                        break;
                    default:
                        message = stateData.state;
                }
                
                base.updateProgress({
                    phase,
                    message
                });
                
            } catch (parseError) {
                console.error("📁 Error parsing file picker state:", parseError);
            }
        };

        // Register event listeners
        window.WebBridge.register(NATIVE_CALLBACKS.ON_FILE_PICKED, handleFilePicked);
        window.WebBridge.register(NATIVE_CALLBACKS.ON_FILE_PICK_ERROR, handleFilePickError);
        window.WebBridge.register(NATIVE_CALLBACKS.ON_FILE_PICK_CANCELLED, handleFilePickCancelled);
        window.WebBridge.register(NATIVE_CALLBACKS.ON_FILE_PICK_STATE_UPDATE, handleFilePickStateUpdate);

        // Cleanup function
        return () => {
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_FILE_PICKED);
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_FILE_PICK_ERROR);
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_FILE_PICK_CANCELLED);
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_FILE_PICK_STATE_UPDATE);
        };
    }, [base]);

    // Pick file function
    const pickFile = (mimeType = null) => {
        base.executeOperation(() => {
            const finalMimeType = mimeType || "*/*";
            
            base.updateProgress({
                phase: FILE_PICKER_PHASES.OPENING,
                message: `Opening file picker${mimeType ? ` for ${mimeType}` : ''}...`
            });

            nativeBridge.file.pick(finalMimeType);
            console.log("📁 File picker opened with MIME type:", finalMimeType);
        }, 'file selection');
    };

    // Return standardized interface
    return {
        // Standard interface
        data: base.data,
        loading: base.loading,
        progress: base.progress,
        error: base.error,
        isWeb: base.isWeb,
        isNative: base.isNative,
        
        // Actions
        execute: pickFile,       // Standard execute function
        pickFile,               // Semantic alias
        clear: base.clear,
        clearError: base.clearError,
        
        // Legacy compatibility (for gradual migration)
        selectedFile: base.data,    // Legacy alias
        isLoading: base.loading,    // Legacy alias
        processingState: base.progress?.phase, // Legacy alias
        clearFile: base.clear       // Legacy alias
    };
};

/**
 * Standardized Intent Hook
 * Provides consistent interface with error standardization and environment detection
 * 
 * @param {Object} options - Configuration options
 * @returns {Object} Standardized intent interface
 */
export const useIntent = (options = {}) => {
    const base = useBaseHook('useIntent', options);
    
    // Intent specific progress phases
    const INTENT_PHASES = {
        PREPARING: 'preparing',
        DOWNLOADING: 'downloading',
        OPENING: 'opening',
        COMPLETE: 'complete'
    };

    useEffect(() => {
        // Server-side rendering safety
        if (typeof window === "undefined") return;

        if (!window.WebBridge) {
            console.warn("WebBridge not initialized. Intent functionality unavailable.");
            return;
        }

        // Intent success handler
        const handleIntentSuccess = (data) => {
            try {
                const result = typeof data === 'string' ? JSON.parse(data) : data;
                console.log("🔗 Intent success result:", result);
                
                const intentData = {
                    url: result.url,
                    mimeType: result.mimeType,
                    success: result.success || true,
                    message: result.message || 'File opened successfully'
                };

                base.setDataAndComplete(intentData);
                console.log("🔗 Intent completed successfully");
                
            } catch (parseError) {
                console.error("🔗 Error parsing intent result:", parseError);
                const error = createStandardError(
                    ERROR_CODES.INTERNAL_ERROR,
                    "Failed to process intent result",
                    parseError
                );
                base.handleNativeError(error);
            }
        };

        // Intent error handler
        const handleIntentError = (data) => {
            console.error("🔗 Intent error:", data);
            base.handleNativeError(data);
        };

        // Intent state updates (if available)
        const handleIntentStateUpdate = (data) => {
            try {
                const stateData = typeof data === 'string' ? JSON.parse(data) : data;
                console.log("🔗 Intent state:", stateData.state);
                
                let phase = INTENT_PHASES.PREPARING;
                let message = 'Processing...';
                
                switch(stateData.state) {
                    case 'preparing':
                        phase = INTENT_PHASES.PREPARING;
                        message = 'Preparing to open file...';
                        break;
                    case 'downloading':
                        phase = INTENT_PHASES.DOWNLOADING;
                        message = 'Downloading file...';
                        break;
                    case 'opening':
                        phase = INTENT_PHASES.OPENING;
                        message = 'Opening with external app...';
                        break;
                    default:
                        message = stateData.state;
                }
                
                base.updateProgress({
                    phase,
                    message,
                    percentage: stateData.percentage || null
                });
                
            } catch (parseError) {
                console.error("🔗 Error parsing intent state:", parseError);
            }
        };

        // Register event listeners (some callbacks might not exist in legacy intent)
        window.WebBridge.register(NATIVE_CALLBACKS.ON_INTENT_SUCCESS || 'ON_INTENT_SUCCESS', handleIntentSuccess);
        window.WebBridge.register(NATIVE_CALLBACKS.ON_INTENT_ERROR || 'ON_INTENT_ERROR', handleIntentError);
        
        // Optional state updates (might not be implemented in current intent system)
        if (NATIVE_CALLBACKS.ON_INTENT_STATE_UPDATE) {
            window.WebBridge.register(NATIVE_CALLBACKS.ON_INTENT_STATE_UPDATE, handleIntentStateUpdate);
        }

        // Cleanup function
        return () => {
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_INTENT_SUCCESS || 'ON_INTENT_SUCCESS');
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_INTENT_ERROR || 'ON_INTENT_ERROR');
            if (NATIVE_CALLBACKS.ON_INTENT_STATE_UPDATE) {
                window.WebBridge.unregister(NATIVE_CALLBACKS.ON_INTENT_STATE_UPDATE);
            }
        };
    }, [base]);

    // Open file function
    const openFile = (url, mimeType = null) => {
        if (!url) {
            const error = createStandardError(
                ERROR_CODES.INVALID_PARAMETERS,
                "URL is required for opening files",
                null,
                "Please provide a valid URL to open"
            );
            base.handleNativeError(error);
            return;
        }

        base.executeOperation(() => {
            const finalMimeType = mimeType || "*/*";
            
            base.updateProgress({
                phase: INTENT_PHASES.PREPARING,
                message: `Preparing to open ${url}...`
            });

            // Check if intent system has specific methods
            if (nativeBridge.intent && nativeBridge.intent.openFile) {
                nativeBridge.intent.openFile(url, finalMimeType);
            } else {
                // Fallback to generic method if available
                nativeBridge.openFile(url, finalMimeType);
            }
            
            console.log("🔗 Intent to open file:", url, "with MIME type:", finalMimeType);
        }, 'file opening');
    };

    // Return standardized interface
    return {
        // Standard interface
        data: base.data,
        loading: base.loading,
        progress: base.progress,
        error: base.error,
        isWeb: base.isWeb,
        isNative: base.isNative,
        
        // Actions
        execute: openFile,      // Standard execute function
        openFile,              // Semantic alias
        clear: base.clear,
        clearError: base.clearError,
        
        // Legacy compatibility (for gradual migration)
        result: base.data,     // Legacy alias if needed
    };
};