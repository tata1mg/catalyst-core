import React, { useState, useEffect } from 'react'
import clsx from 'clsx'
import Highlight, { defaultProps } from 'prism-react-renderer'
import styles from './styles.module.css'

const hooksList = [
    {
        key: 'useCamera',
        label: 'useCamera()',
        desc: 'Complete camera functionality with photo capture and state management',
    },
    {
        key: 'useCameraPermission',
        label: 'useCameraPermission()',
        desc: 'Automatically requests and manages camera permission status',
    },
    {
        key: 'requestCameraPermission',
        label: 'requestCameraPermission()',
        desc: 'Promise-based function for explicit permission requests',
    },
]

const useCameraProps = [
    // Standard Common Interface Properties
    {
        name: 'data',
        type: 'Object | null',
        description:
            'Captured photo data object containing fileSrc (base64/path), fileName, size, mimeType, transport method, and metadata.',
        required: true,
        isStandard: true,
    },
    {
        name: 'loading',
        type: 'boolean',
        description:
            'Operation in progress state, true during photo capture, permission requests, or processing.',
        required: true,
        isStandard: true,
    },
    {
        name: 'error',
        type: 'Object | null',
        description:
            'Standardized error object with code, category, message, details, recoverable flag, and suggested action.',
        required: false,
        isStandard: true,
    },
    {
        name: 'progress',
        type: 'Object',
        description:
            'Detailed progress tracking with state, phase, message, percentage, transport method, and byte counts.',
        required: false,
        isStandard: true,
    },
    {
        name: 'isWeb',
        type: 'boolean',
        description:
            'Environment detection flag, true when running in web browser context.',
        required: false,
        isStandard: true,
    },
    {
        name: 'isNative',
        type: 'boolean',
        description:
            'Environment detection flag, true when running in native app (iOS/Android) context.',
        required: false,
        isStandard: true,
    },
    {
        name: 'execute',
        type: '(operation?: string, options?: Object) => void',
        description:
            'Primary function to trigger operations: execute("takePhoto"), execute("requestPermission"), or execute("checkPermission").',
        required: true,
        isStandard: true,
    },
    {
        name: 'clear',
        type: '() => void',
        description:
            'Clear data and reset all state (data, error, progress) to initial values.',
        required: false,
        isStandard: true,
    },
    {
        name: 'clearError',
        type: '() => void',
        description:
            'Clear only the error state while preserving data and other states.',
        required: false,
        isStandard: true,
    },

    // Camera-Specific Properties
    {
        name: 'permission',
        type: 'Object',
        description:
            'Camera permission status object with status, canRequest flag, and lastChecked timestamp.',
        required: false,
        isStandard: false,
    },

    // Legacy Compatibility Aliases
    {
        name: 'photo',
        type: 'string | null',
        description:
            'Legacy alias for data - Base64 encoded image data (backward compatibility).',
        required: false,
        isLegacy: true,
    },
    {
        name: 'takePhoto',
        type: '() => void',
        description:
            'Legacy alias for execute("takePhoto") - Function to trigger camera capture (backward compatibility).',
        required: false,
        isLegacy: true,
    },
    {
        name: 'clearPhoto',
        type: '() => void',
        description:
            'Legacy alias for clear() - Function to clear photo state (backward compatibility).',
        required: false,
        isLegacy: true,
    },
]

const useCameraPermissionProps = [
    {
        name: 'permission',
        type: 'string | null',
        description:
            'Current camera permission status: GRANTED, DENIED, NOT_DETERMINED, RESTRICTED. Updates automatically when permissions change.',
        required: true,
    },
]

const requestCameraPermissionProps = [
    {
        name: 'Parameters',
        type: 'void',
        description:
            'No parameters required. Function automatically requests camera permission from the system.',
    },
    {
        name: 'Returns',
        type: 'Promise<string>',
        description:
            'Promise that resolves with permission status (GRANTED) or rejects with error message if permission denied/failed.',
    },
]

const platformBehavior = [
    {
        platform: '🤖 Android Emulator',
        status: '✅ Supported',
        behavior:
            'Camera works with virtual camera. Photos captured from emulator camera interface.',
        notes: 'Uses Android Virtual Device camera simulation',
    },
    {
        platform: '🤖 Android Physical',
        status: '✅ Supported',
        behavior:
            'Full camera functionality with device hardware camera. High-quality photo capture.',
        notes: 'Requires camera permission. Works with front/back cameras.',
    },
    {
        platform: '🍎 iOS Simulator',
        status: '✅ Supported',
        behavior:
            'Camera works with simulated camera interface. Stock photos available for testing.',
        notes: 'Uses iOS Simulator camera simulation with sample images',
    },
    {
        platform: '🍎 iOS Physical',
        status: '⏳ Coming Soon',
        behavior: 'Physical device camera support currently in development.',
        notes: 'Will support device hardware camera when implemented',
    },
    {
        platform: '🌐 Web Browser',
        status: '🔄 Fallback',
        behavior:
            'Returns safe defaults. Camera functions available but no actual camera access.',
        notes: 'Graceful degradation for web platform compatibility',
    },
]

export default function CameraAPIDemo() {
    // Accordion state
    const [accordionState, setAccordionState] = useState({
        essential: true, // expanded by default
        stateManagement: false,
        permissions: false,
    })
    const [selectedHooks, setSelectedHooks] = useState({
        useCamera: true,
        useCameraPermission: false,
        requestCameraPermission: false,
    })
    // Property selection state - aligned with actual useCamera implementation
    const [selectedProperties, setSelectedProperties] = useState({
        // Standard Interface Properties (primary)
        data: true,
        loading: false,
        error: false,
        progress: false,
        isWeb: false,
        isNative: false,
        execute: true,
        clear: false,
        clearError: false,
        // Camera-specific
        permission: false,
        // Legacy aliases (for backward compatibility)
        photo: false,
        takePhoto: false,
        clearPhoto: false,
    })
    // Removed redundant selectedProps state - using selectedProperties only
    const [selectedPermissionProps, setSelectedPermissionProps] = useState({
        permission: true,
    })
    const [copied, setCopied] = useState('')

    // Debug effect to track state changes
    useEffect(() => {
        console.log('selectedProperties changed:', selectedProperties)
    }, [selectedProperties])

    // Accordion toggle function
    const toggleAccordion = (section) => {
        setAccordionState((prev) => ({
            ...prev,
            [section]: !prev[section],
        }))
    }

    // Property toggle function
    const toggleProperty = (property) => {
        // Don't allow toggling core required properties
        if (property === 'data' || property === 'execute') {
            return
        }
        setSelectedProperties((prev) => {
            const newState = {
                ...prev,
                [property]: !prev[property],
            }
            console.log(
                `Toggled ${property}:`,
                newState[property],
                'New state:',
                newState
            )
            return newState
        })
    }

    const toggleHook = (hook) => {
        setSelectedHooks((prev) => ({ ...prev, [hook]: !prev[hook] }))
    }

    const togglePermissionProp = (prop) => {
        setSelectedPermissionProps((prev) => ({ ...prev, [prop]: !prev[prop] }))
    }

    const generateUseCameraCode = () => {
        return `import React from 'react';
import { useCamera } from "catalyst-core/hooks";

function CameraComponent() {
  const { 
    // Standard Interface (recommended)
    data,            // Object | null - Photo data object
    loading,         // boolean - Operation in progress
    error,           // Object | null - Standardized error
    progress,        // Object - Progress tracking
    isWeb,           // boolean - Web environment flag
    isNative,        // boolean - Native environment flag
    execute,         // function - Primary operation function
    clear,           // function - Clear data and state
    clearError,      // function - Clear error only
    
    // Camera-specific
    permission,      // Object - Permission status
    
    // Legacy aliases (backward compatibility)
    photo,           // Legacy alias for data
    takePhoto,       // Legacy alias for execute
    clearPhoto       // Legacy alias for clear
  } = useCamera();

  const handleCapture = () => {
    if (isNative) {
      execute('takePhoto'); // Primary method - recommended
    } else {
      console.warn('Camera requires native environment');
    }
  };

  return (
    <div>
      <p>Environment: {isNative ? 'Native App' : 'Web Browser'}</p>
      
      <button onClick={handleCapture} disabled={loading}>
        {loading ? 'Capturing...' : 'Take Photo'}
      </button>
      
      {/* Progress Display */}
      {loading && progress && (
        <div>
          <p>Status: {progress.state}</p>
          {progress.message && <p>{progress.message}</p>}
          {progress.transport && <small>Transport: {progress.transport}</small>}
        </div>
      )}
      
      {/* Photo Display - Using modern data format */}
      {data && (
        <div>
          <img 
            src={data.fileSrc} 
            alt="Captured" 
            style={{ maxWidth: '300px', height: 'auto' }}
          />
          <p>Transport: {data.transport} | Size: {data.size} bytes</p>
          <button onClick={clear}>Clear Photo</button>
        </div>
      )}
      
      {/* Error Display */}
      {error && (
        <div style={{ color: 'red', border: '1px solid red', padding: '10px' }}>
          <h4>{error.message}</h4>
          <p>{error.details}</p>
          {error.recoverable && (
            <>
              <p><strong>Action:</strong> {error.action}</p>
              <button onClick={clearError}>Try Again</button>
            </>
          )}
          <small>Code: {error.code}</small>
        </div>
      )}
      
      <p>Permission: {permission?.status || 'Unknown'}</p>
    </div>
  );
}`
    }

    const generateUseCameraPermissionCode = () => {
        return `import React from 'react';
import { useCameraPermission } from "catalyst-core/hooks";

function CameraPermissionComponent() {
  const { 
    permission,      // string | null - Permission status
    isLoading        // boolean - Loading state
  } = useCameraPermission();

  if (isLoading) {
    return <p>Checking camera permission...</p>;
  }

  return (
    <div>
      <h3>Camera Permission Status</h3>
      <p>Current Status: <strong>{permission}</strong></p>
      
      {permission === 'GRANTED' && (
        <p style={{ color: 'green' }}>✅ Camera access granted</p>
      )}
      
      {permission === 'DENIED' && (
        <p style={{ color: 'red' }}>❌ Camera access denied</p>
      )}
      
      {permission === 'NOT_DETERMINED' && (
        <p style={{ color: 'orange' }}>⏳ Permission not determined</p>
      )}
    </div>
  );
}`
    }

    const generateRequestCameraPermissionCode = () => {
        return `import React, { useState } from 'react';
import { requestCameraPermission } from "catalyst-core/hooks";

function PermissionRequestComponent() {
  const [permissionStatus, setPermissionStatus] = useState(null);
  const [isRequesting, setIsRequesting] = useState(false);

  const handleRequestPermission = async () => {
    setIsRequesting(true);
    try {
      const permission = await requestCameraPermission();
      setPermissionStatus(permission);
      console.log('Permission granted:', permission);
    } catch (error) {
      setPermissionStatus('DENIED');
      console.error('Permission denied:', error.message);
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <div>
      <button 
        onClick={handleRequestPermission} 
        disabled={isRequesting}
      >
        {isRequesting ? 'Requesting...' : 'Request Permission'}
      </button>
      
      {permissionStatus && (
        <p>Result: <strong>{permissionStatus}</strong></p>
      )}
    </div>
  );
}`
    }

    const generateCombinedCode = () => {
        let imports = []
        if (selectedHooks.useCamera) imports.push('useCamera')
        if (selectedHooks.useCameraPermission)
            imports.push('useCameraPermission')
        if (selectedHooks.requestCameraPermission)
            imports.push('requestCameraPermission')

        if (imports.length === 0) return ''

        let code = `import React${selectedHooks.requestCameraPermission ? ', { useState }' : ''} from 'react';
import { ${imports.join(', ')} } from "catalyst-core/hooks";

function CameraApp() {`

        if (selectedHooks.useCameraPermission) {
            // Generate destructuring based on selected permission props
            const selectedPermissionPropsList = Object.keys(
                selectedPermissionProps
            ).filter((prop) => selectedPermissionProps[prop])
            if (selectedPermissionPropsList.length > 0) {
                // Rename permission to autoPermission to avoid conflicts
                const propsWithAlias = selectedPermissionPropsList.map(
                    (prop) =>
                        prop === 'permission'
                            ? 'permission: autoPermission'
                            : prop
                )
                code += `
  const { ${propsWithAlias.join(', ')} } = useCameraPermission();`
            }
        }

        if (selectedHooks.useCamera) {
            // Simple destructuring pattern - always show structure
            let standardProps = []
            let legacyProps = []

            // Standard interface
            if (selectedProperties.data) standardProps.push('data: photoData')
            if (selectedProperties.loading)
                standardProps.push('loading: photoLoading')
            if (selectedProperties.progress)
                standardProps.push('progress: photoProgress')
            if (selectedProperties.error)
                standardProps.push('error: photoError')
            if (selectedProperties.isWeb)
                standardProps.push('isWeb: photoIsWeb')
            if (selectedProperties.isNative)
                standardProps.push('isNative: photoIsNative')
            if (selectedProperties.execute)
                standardProps.push('execute: executeCamera')
            if (selectedProperties.clear)
                standardProps.push('clear: clearPhoto')
            if (selectedProperties.clearError)
                standardProps.push('clearError: clearPhotoError')

            // Camera-specific
            if (selectedProperties.permission)
                standardProps.push('permission: cameraPermission')

            // Legacy fallbacks
            if (selectedProperties.photo) legacyProps.push('photo')
            if (selectedProperties.takePhoto) legacyProps.push('takePhoto')
            if (selectedProperties.clearPhoto) legacyProps.push('clearPhoto')

            code += `
  const { 
    // New standardized interface
    ${standardProps.join(',\n    ')}${legacyProps.length > 0 ? ',\n    // Legacy fallbacks\n    ' + legacyProps.join(',\n    ') : ''}
  } = useCamera();`
        }

        if (selectedHooks.requestCameraPermission) {
            code += `
  const [manualPermission, setManualPermission] = useState(null);

  const handleManualPermissionRequest = async () => {
    try {
      const result = await requestCameraPermission();
      setManualPermission(result);
    } catch (error) {
      setManualPermission('DENIED');
    }
  };`
        }

        if (
            selectedHooks.useCameraPermission ||
            selectedHooks.requestCameraPermission
        ) {
            let permissionCheck = ''
            const hasAutoPermission =
                selectedHooks.useCameraPermission &&
                selectedPermissionProps.permission
            const hasManualPermission = selectedHooks.requestCameraPermission

            if (hasAutoPermission && hasManualPermission) {
                permissionCheck =
                    'autoPermission === "GRANTED" || manualPermission === "GRANTED"'
            } else if (hasAutoPermission) {
                permissionCheck = 'autoPermission === "GRANTED"'
            } else if (hasManualPermission) {
                permissionCheck = 'manualPermission === "GRANTED"'
            }

            if (permissionCheck) {
                code += `

  const hasPermission = ${permissionCheck};`
            }
        }

        // Add formatFileSize utility function if data is selected
        if (selectedProperties.data) {
            code += `

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }`
        }

        code += `

  return (
    <div style={{ padding: '20px' }}>
      <h2>📷 Camera Demo</h2>`

        // Add environment detection display if selected
        if (selectedProperties.isWeb && selectedProperties.isNative) {
            code += `
      
      <p>Environment: {photoIsNative ? '📱 Native' : '🌐 Web'}</p>`
        } else if (selectedProperties.isNative) {
            code += `
      
      <p>Environment: {photoIsNative ? '📱 Native' : 'Unknown'}</p>`
        } else if (selectedProperties.isWeb) {
            code += `
      
      <p>Environment: {photoIsWeb ? '🌐 Web' : 'Unknown'}</p>`
        }

        if (
            selectedHooks.useCameraPermission ||
            selectedHooks.requestCameraPermission ||
            selectedProperties.permission
        ) {
            code += `
      
      {/* Permission Status */}
      <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#f9f9f9' }}>
        <h3>Permission Status</h3>`

            if (
                selectedHooks.useCameraPermission &&
                selectedPermissionProps.permission
            ) {
                code += `
        <p>Auto Permission: {autoPermission || 'Loading...'}</p>`
            }

            if (
                selectedHooks.useCameraPermission &&
                selectedPermissionProps.isLoading
            ) {
                code += `
        {isLoading && <p>⏳ Checking permission...</p>}`
            }

            if (selectedProperties.permission && selectedHooks.useCamera) {
                code += `
        <p>Camera Permission: {permission || 'Not determined'}</p>`
            }

            if (selectedHooks.requestCameraPermission) {
                code += `
        {manualPermission && <p>Manual Permission: {manualPermission}</p>}
        
        <button onClick={handleManualPermissionRequest}>
          Request Camera Permission
        </button>`
            }

            code += `
      </div>`
        }

        if (selectedHooks.useCamera) {
            code += `

      {/* Camera Controls */}`

            if (
                selectedHooks.useCameraPermission ||
                selectedHooks.requestCameraPermission
            ) {
                code += `
      {hasPermission ? (`
            }

            code += `
        
        <button onClick={executeCamera} ${selectedProperties.loading ? 'disabled={photoLoading}' : ''}>
          ${selectedProperties.loading ? '{photoLoading ? "Taking Photo..." : "Take Photo"}' : '"Take Photo"'}
        </button>`

            if (selectedProperties.clear || selectedProperties.clearPhoto) {
                const dataVar = selectedProperties.data
                    ? 'data'
                    : selectedProperties.photo
                      ? 'photo'
                      : 'data'
                const clearFunc = selectedProperties.clear
                    ? 'clear'
                    : selectedProperties.clearPhoto
                      ? 'clearPhoto'
                      : 'clear'
                code += `
          
          {${dataVar} && (
            <button onClick={${clearFunc}} style={{ padding: '10px 20px' }}>
              🗑️ Clear Photo
            </button>
          )}`
            }

            code += `
        </div>`

            if (
                selectedHooks.useCameraPermission ||
                selectedHooks.requestCameraPermission
            ) {
                code += `
      ) : (
        <p>Camera permission required to take photos</p>
      )}`
            }
        }

        if (selectedProperties.data || selectedProperties.photo) {
            const dataVar = selectedProperties.data ? 'photoData' : 'photo'

            code += `
        
        {${dataVar} && (
          <div>
            <h3>Photo Captured!</h3>
            ${
                selectedProperties.data
                    ? `<p>Name: {photoData.fileName}</p>
            <p>Size: {formatFileSize(photoData.size)}</p>
            <img src={photoData.fileSrc} alt="Captured" style={{ maxWidth: '300px' }} />`
                    : `<img src={\`data:image/jpeg;base64,\${photo}\`} alt="Captured" style={{ maxWidth: '300px' }} />`
            }
            ${selectedProperties.clear ? '<button onClick={clearPhoto}>Clear</button>' : ''}
          </div>
        )}`
        }

        if (selectedProperties.error) {
            code += `
        
        {photoError && (
          <div style={{ color: 'red' }}>
            Error: {photoError.message || photoError}
            <button onClick={clearPhotoError}>Clear Error</button>
          </div>
        )}`
        }

        // Add progress display if selected
        if (selectedProperties.progress) {
            code += `
        
        {photoProgress && <p>Progress: {photoProgress.message}</p>}`
        }

        code += `
    </div>
  );
}

export default CameraApp;`

        return code
    }

    const handleCopy = async (text, type) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(type)
            setTimeout(() => setCopied(''), 2000)
        } catch (err) {
            setCopied('error')
        }
    }

    // Syntax Highlighted Code Component with dark VS Code theme
    const SyntaxHighlightedCode = ({ code, language = 'jsx' }) => (
        <Highlight
            {...defaultProps}
            theme={{
                plain: {
                    color: '#D4D4D4',
                    backgroundColor: '#1E1E1E',
                },
                styles: [
                    {
                        types: ['comment', 'prolog', 'doctype', 'cdata'],
                        style: {
                            color: '#6A9955',
                            fontStyle: 'italic',
                        },
                    },
                    {
                        types: ['string', 'attr-value'],
                        style: {
                            color: '#CE9178',
                        },
                    },
                    {
                        types: ['punctuation', 'operator'],
                        style: {
                            color: '#D4D4D4',
                        },
                    },
                    {
                        types: ['number', 'boolean', 'constant'],
                        style: {
                            color: '#B5CEA8',
                        },
                    },
                    {
                        types: ['keyword', 'atrule', 'attr-name'],
                        style: {
                            color: '#569CD6',
                        },
                    },
                    {
                        types: ['function'],
                        style: {
                            color: '#DCDCAA',
                        },
                    },
                    {
                        types: ['tag'],
                        style: {
                            color: '#569CD6',
                        },
                    },
                    {
                        types: ['class-name'],
                        style: {
                            color: '#4EC9B0',
                        },
                    },
                    {
                        types: ['variable'],
                        style: {
                            color: '#9CDCFE',
                        },
                    },
                    {
                        types: ['property'],
                        style: {
                            color: '#92C5F7',
                        },
                    },
                ],
            }}
            code={code}
            language={language}
        >
            {({ className, style, tokens, getLineProps, getTokenProps }) => (
                <pre
                    className={className}
                    style={{
                        ...style,
                        backgroundColor: '#1E1E1E',
                        color: '#D4D4D4',
                        padding: '1.5rem',
                        margin: 0,
                        overflow: 'auto',
                        fontFamily: 'var(--catalyst-code-font-family)',
                        fontSize: 'var(--catalyst-code-font-size)',
                        lineHeight: 'var(--catalyst-code-line-height)',
                        border: '1px solid #3C3C3C',
                        borderRadius: '6px',
                    }}
                >
                    {tokens.map((line, i) => (
                        <div {...getLineProps({ line, key: i })} key={i}>
                            <span
                                style={{
                                    display: 'inline-block',
                                    width: '2.5em',
                                    userSelect: 'none',
                                    opacity: 0.5,
                                    textAlign: 'right',
                                    marginRight: '1em',
                                    fontSize: '0.9em',
                                    color: '#858585',
                                }}
                            >
                                {i + 1}
                            </span>
                            {line.map((token, key) => (
                                <span
                                    {...getTokenProps({ token, key })}
                                    key={key}
                                />
                            ))}
                        </div>
                    ))}
                </pre>
            )}
        </Highlight>
    )

    const PropsTable = ({ props }) => (
        <div className={styles.propsTable}>
            <table>
                <thead>
                    <tr>
                        <th>Property</th>
                        <th>Type</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    {props.map((prop, index) => (
                        <tr key={index}>
                            <td>
                                <span className={styles.propName}>
                                    {prop.name}
                                </span>
                                {prop.required && (
                                    <span className={styles.requiredBadge}>
                                        required
                                    </span>
                                )}
                            </td>
                            <td>
                                <code className={styles.propType}>
                                    {prop.type}
                                </code>
                            </td>
                            <td className={styles.propDescription}>
                                {prop.description}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )

    const PlatformBehaviorTable = () => (
        <div className={styles.propsTable}>
            <table>
                <thead>
                    <tr>
                        <th>Platform</th>
                        <th>Status</th>
                        <th>Behavior</th>
                        <th>Notes</th>
                    </tr>
                </thead>
                <tbody>
                    {platformBehavior.map((platform, index) => (
                        <tr key={index}>
                            <td>
                                <span className={styles.propName}>
                                    {platform.platform}
                                </span>
                            </td>
                            <td>
                                <code className={styles.propType}>
                                    {platform.status}
                                </code>
                            </td>
                            <td className={styles.propDescription}>
                                {platform.behavior}
                            </td>
                            <td
                                className={styles.propDescription}
                                style={{
                                    fontSize: '0.85em',
                                    fontStyle: 'italic',
                                }}
                            >
                                {platform.notes}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )

    return (
        <div className={styles.cameraAPIDemo}>
            <h2>Camera APIs</h2>
            <p>
                Comprehensive camera functionality for universal apps with photo
                capture, permission management, and error handling.
            </p>

            {/* API Documentation Tables */}
            <div className={styles.apiSection}>
                <h3>useCamera() Hook</h3>
                <p>
                    Main hook for camera functionality including photo capture,
                    permission handling, and state management.
                </p>
                <PropsTable props={useCameraProps} />
            </div>

            <div className={styles.apiSection}>
                <h3>useCameraPermission() Hook</h3>
                <p>
                    Automatically requests and manages camera permission status
                    with loading states.
                </p>
                <PropsTable props={useCameraPermissionProps} />
            </div>

            <div className={styles.apiSection}>
                <h3>requestCameraPermission() Function</h3>
                <p>
                    Promise-based function for explicit camera permission
                    requests with async/await support.
                </p>
                <PropsTable props={requestCameraPermissionProps} />
            </div>

            {/* Platform Behavior */}
            <div className={styles.apiSection}>
                <h3>Platform & Device Behavior</h3>
                <p>
                    Camera API behavior varies across different platforms and
                    device types. See detailed breakdown below.
                </p>
                <PlatformBehaviorTable />
            </div>

            {/* Use Case Description */}
            <div className={styles.useCaseDescription}>
                <h3>📸 Avatar Photo Capture Example</h3>
                <p>
                    Capture and display user avatars with real-time camera
                    access and state management
                </p>
            </div>

            {/* Customize Your Example - Updated for Common Interface */}
            <div className={styles.propertyAccordion}>
                <h3>🎛️ Customize Your Example</h3>
                <p>
                    Select which hooks and properties to include in your
                    example. All hooks follow a common interface with
                    standardized properties and operations.
                </p>

                {/* Hook Selection - Expanded by default */}
                <div className={styles.accordionSection}>
                    <button
                        className={clsx(styles.accordionHeader, {
                            [styles.expanded]: accordionState.essential,
                        })}
                        onClick={() => toggleAccordion('essential')}
                    >
                        <span>📷 Camera Hooks</span>
                        <span className={styles.accordionIcon}>
                            {accordionState.essential ? '▼' : '▶'}
                        </span>
                    </button>
                    {accordionState.essential && (
                        <div className={styles.accordionContent}>
                            <div className={styles.propGrid}>
                                <label
                                    className={clsx(
                                        styles.propItem,
                                        styles.required
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedHooks.useCamera}
                                        disabled
                                    />
                                    <span>
                                        useCamera() <small>(required)</small>
                                    </span>
                                </label>
                                <label className={styles.propItem}>
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedHooks.useCameraPermission
                                        }
                                        onChange={() =>
                                            toggleHook('useCameraPermission')
                                        }
                                    />
                                    <span>useCameraPermission()</span>
                                </label>
                                <label className={styles.propItem}>
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedHooks.requestCameraPermission
                                        }
                                        onChange={() =>
                                            toggleHook(
                                                'requestCameraPermission'
                                            )
                                        }
                                    />
                                    <span>requestCameraPermission()</span>
                                </label>
                            </div>
                        </div>
                    )}
                </div>

                {/* Standard Interface Properties */}
                <div className={styles.accordionSection}>
                    <button
                        className={clsx(styles.accordionHeader, {
                            [styles.expanded]: accordionState.stateManagement,
                        })}
                        onClick={() => toggleAccordion('stateManagement')}
                    >
                        <span>⚡ Standard Interface Properties</span>
                        <span className={styles.accordionIcon}>
                            {accordionState.stateManagement ? '▼' : '▶'}
                        </span>
                    </button>
                    {accordionState.stateManagement && (
                        <div className={styles.accordionContent}>
                            <div className={styles.propGrid}>
                                <label
                                    className={clsx(
                                        styles.propItem,
                                        styles.required
                                    )}
                                >
                                    <input type="checkbox" checked disabled />
                                    <span>
                                        data <small>(required)</small>
                                    </span>
                                </label>
                                <label
                                    className={clsx(
                                        styles.propItem,
                                        styles.required
                                    )}
                                >
                                    <input type="checkbox" checked disabled />
                                    <span>
                                        execute <small>(required)</small>
                                    </span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() => toggleProperty('loading')}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedProperties.loading}
                                        onChange={() =>
                                            toggleProperty('loading')
                                        }
                                    />
                                    <span>loading</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() => toggleProperty('error')}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedProperties.error}
                                        onChange={() => toggleProperty('error')}
                                    />
                                    <span>error</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() => toggleProperty('progress')}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedProperties.progress}
                                        onChange={() =>
                                            toggleProperty('progress')
                                        }
                                    />
                                    <span>progress</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() => toggleProperty('isWeb')}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedProperties.isWeb}
                                        onChange={() => toggleProperty('isWeb')}
                                    />
                                    <span>isWeb</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() => toggleProperty('isNative')}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedProperties.isNative}
                                        onChange={() =>
                                            toggleProperty('isNative')
                                        }
                                    />
                                    <span>isNative</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() => toggleProperty('clear')}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedProperties.clear}
                                        onChange={() => toggleProperty('clear')}
                                    />
                                    <span>clear</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() => toggleProperty('clearError')}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedProperties.clearError}
                                        onChange={() =>
                                            toggleProperty('clearError')
                                        }
                                    />
                                    <span>clearError</span>
                                </label>
                            </div>
                        </div>
                    )}
                </div>

                {/* Other Properties */}
                <div className={styles.accordionSection}>
                    <button
                        className={clsx(styles.accordionHeader, {
                            [styles.expanded]: accordionState.permissions,
                        })}
                        onClick={() => toggleAccordion('permissions')}
                    >
                        <span>🔧 Other Properties</span>
                        <span className={styles.accordionIcon}>
                            {accordionState.permissions ? '▼' : '▶'}
                        </span>
                    </button>
                    {accordionState.permissions && (
                        <div className={styles.accordionContent}>
                            <div className={styles.propGrid}>
                                <label
                                    className={styles.propItem}
                                    onClick={() => toggleProperty('permission')}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedProperties.permission}
                                        onChange={() =>
                                            toggleProperty('permission')
                                        }
                                    />
                                    <span>permission</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() => toggleProperty('photo')}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedProperties.photo}
                                        onChange={() => toggleProperty('photo')}
                                    />
                                    <span>
                                        photo{' '}
                                        <small>(legacy alias for data)</small>
                                    </span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() => toggleProperty('takePhoto')}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedProperties.takePhoto}
                                        onChange={() =>
                                            toggleProperty('takePhoto')
                                        }
                                    />
                                    <span>
                                        takePhoto{' '}
                                        <small>
                                            (legacy alias for execute)
                                        </small>
                                    </span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() => toggleProperty('clearPhoto')}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedProperties.clearPhoto}
                                        onChange={() =>
                                            toggleProperty('clearPhoto')
                                        }
                                    />
                                    <span>clearPhoto</span>
                                </label>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Code Section */}
            <div className={styles.contentArea}>
                <div className={styles.codeTab}>
                    <div className={styles.codeCard}>
                        <div className={styles.codeHeader}>
                            <span>AvatarCapture.js</span>
                            <button
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copied === 'avatar-code',
                                })}
                                onClick={() => {
                                    const codeString = generateCombinedCode()
                                    handleCopy(codeString, 'avatar-code')
                                }}
                            >
                                {copied === 'avatar-code'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <SyntaxHighlightedCode
                            code={generateCombinedCode()}
                            language="jsx"
                        />
                    </div>
                </div>
            </div>

            <div className={styles.importantNotes}>
                <h4>Important Notes</h4>
                <ul>
                    <li>
                        <strong>Platform Support:</strong> Android (emulator +
                        physical) and iOS (simulator) supported. iOS physical
                        device coming soon
                    </li>
                    <li>
                        <strong>Parameters:</strong> Camera functions require no
                        parameters - all configuration is handled automatically
                    </li>
                    <li>
                        <strong>Emulator/Simulator:</strong> Camera works in
                        Android emulator and iOS simulator with virtual/sample
                        images
                    </li>
                    <li>
                        <strong>Permissions:</strong> Always check permission
                        status before capturing photos - required on physical
                        devices
                    </li>
                    <li>
                        <strong>Data Format:</strong> Photos returned as base64
                        JPEG strings ready for immediate display or upload
                    </li>
                    <li>
                        <strong>Error Handling:</strong> Built-in error handling
                        for permission denied, camera unavailable, and capture
                        failures
                    </li>
                    <li>
                        <strong>Web Fallback:</strong> Returns safe defaults
                        when running in web mode for graceful degradation
                    </li>
                </ul>
            </div>
        </div>
    )
}
