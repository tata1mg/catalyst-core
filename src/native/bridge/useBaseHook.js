import { useState, useCallback } from 'react';
import nativeBridge from './utils/NativeBridge.js';
import { translateError, isDevelopment } from './errors';

/**
 * Base hook utility that provides standardized interface for all Catalyst hooks
 * Handles environment detection, error standardization, and common state management
 * 
 * @param {string} hookName - Name of the hook for debugging purposes
 * @param {Object} options - Configuration options
 * @returns {Object} Base hook interface with common functionality
 */
export const useBaseHook = (hookName, options = {}) => {
    // Environment detection
    const isNative = useCallback(() => {
        // Server-side rendering safety
        if (typeof window === "undefined") return false;
        
        // Check for WebBridge and verify it's functional
        return !!(window.WebBridge && nativeBridge.isAvailable());
    }, []);

    const isWeb = useCallback(() => {
        return !isNative();
    }, [isNative]);

    // Common state management
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [progress, setProgress] = useState({
        state: 'idle',      // 'idle' | 'opening' | 'processing' | 'routing' | 'complete' | 'error'
        percentage: null,   // 0-100 or null
        message: null,      // Human readable message or null
        phase: null,        // Operation specific phase or null
        transport: null,    // Transport method being used
        bytesLoaded: null,  // Bytes processed
        bytesTotal: null    // Total bytes
    });

    // Progress management utilities
    const updateProgress = useCallback((updates) => {
        setProgress(prev => ({
            ...prev,
            ...updates
        }));
    }, []);

    const resetProgress = useCallback(() => {
        setProgress({
            state: 'idle',
            percentage: null,
            message: null,
            phase: null,
            transport: null,
            bytesLoaded: null,
            bytesTotal: null
        });
    }, []);

    const startProgress = useCallback((phase = null, message = null) => {
        updateProgress({
            state: 'active',
            phase,
            message,
            percentage: null
        });
    }, [updateProgress]);

    const completeProgress = useCallback(() => {
        updateProgress({
            state: 'complete',
            percentage: 100
        });
    }, [updateProgress]);

    const errorProgress = useCallback(() => {
        updateProgress({
            state: 'error'
        });
    }, [updateProgress]);

    // Error handling utilities
    const handleNativeError = useCallback((nativeError) => {
        const standardError = translateError(nativeError);
        setError(standardError);
        setLoading(false);
        errorProgress();

        // Development logging
        if (isDevelopment()) {
            console.group(`🚨 ${hookName} Error`);
            console.log('Standard Error:', standardError);
            console.log('Native Error:', nativeError);
            console.groupEnd();
        }

        return standardError;
    }, [hookName, errorProgress]);

    const clearError = useCallback(() => {
        setError(null);
        if (progress.state === 'error') {
            resetProgress();
        }
    }, [progress.state, resetProgress]);

    // Data management utilities
    const setDataAndComplete = useCallback((newData) => {
        setData(newData);
        setLoading(false);
        completeProgress();
        setError(null);
        
        if (isDevelopment()) {
            console.log(`✅ ${hookName} Success:`, newData);
        }
    }, [hookName, completeProgress]);

    const clear = useCallback(() => {
        setData(null);
        setError(null);
        resetProgress();
        
        if (isDevelopment()) {
            console.log(`🗑️ ${hookName} Cleared`);
        }
    }, [hookName, resetProgress]);

    // Operation wrapper that handles common patterns
    const executeOperation = useCallback((operationCallback, operationName = 'operation') => {
        try {
            if (isWeb()) {
                console.warn(`${hookName} requires web fallback implementation (isWeb: true)`);
                return;
            }

            if (!nativeBridge.isAvailable()) {
                throw new Error("Native bridge not available");
            }

            setLoading(true);
            setError(null);
            startProgress('starting', `Starting ${operationName}...`);

            if (isDevelopment()) {
                console.log(`🚀 ${hookName} ${operationName} started`);
            }

            // Execute the actual operation
            operationCallback();

        } catch (err) {
            handleNativeError(err);
            console.error(`❌ ${hookName} ${operationName} failed:`, err);
        }
    }, [hookName, isWeb, startProgress, handleNativeError]);

    // Environment flags (computed values, not functions)
    const environmentFlags = {
        isWeb: isWeb(),
        isNative: isNative()
    };

    // Return standardized interface
    return {
        // Data state
        data,
        
        // Loading states
        loading,
        progress,
        
        // Error handling
        error,
        
        // Environment detection
        ...environmentFlags,
        
        // Actions
        clear,
        clearError,
        
        // Internal utilities for specific hooks
        setData,
        setLoading,
        setError,
        setProgress,
        updateProgress,
        resetProgress,
        startProgress,
        completeProgress,
        errorProgress,
        setDataAndComplete,
        handleNativeError,
        executeOperation
    };
};

/**
 * Hook for development debugging and testing
 * @param {string} hookName 
 * @returns {Object} Environment information and utilities
 */
export const useEnvironmentInfo = (hookName) => {
    const isNativeAvailable = () => {
        if (typeof window === "undefined") return false;
        return !!(window.WebBridge && nativeBridge.isAvailable());
    };

    const getEnvironmentDetails = () => {
        const details = {
            hasWindow: typeof window !== "undefined",
            hasWebBridge: typeof window !== "undefined" && !!window.WebBridge,
            nativeBridgeAvailable: false,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : 'SSR',
            timestamp: new Date().toISOString()
        };

        if (details.hasWebBridge) {
            details.nativeBridgeAvailable = nativeBridge.isAvailable();
        }

        return details;
    };

    if (isDevelopment()) {
        console.log(`🔍 ${hookName} Environment:`, getEnvironmentDetails());
    }

    return {
        isNative: isNativeAvailable(),
        isWeb: !isNativeAvailable(),
        environmentDetails: getEnvironmentDetails()
    };
};

/**
 * Progress state constants for consistency across hooks
 */
export const PROGRESS_STATES = {
    // Common states
    IDLE: 'idle',
    STARTING: 'starting',
    COMPLETE: 'complete',
    ERROR: 'error',
    
    // File Picker states
    OPENING: 'opening',
    PROCESSING: 'processing',
    ROUTING: 'routing',
    
    // Camera states
    REQUESTING: 'requesting',
    CAPTURING: 'capturing',
    
    // Intent states
    DOWNLOADING: 'downloading',
    OPENING_FILE: 'opening_file',
    
    // Server states
    CONNECTING: 'connecting',
    UPLOADING: 'uploading',
    SERVING: 'serving'
};