import React, { useState } from 'react'
import clsx from 'clsx'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import { useColorMode } from '@docusaurus/theme-common'
import Highlight, { defaultProps } from 'prism-react-renderer'
import CopyButton from '../CopyButton'
import styles from './styles.module.css'

const NativeHooksDemo = () => {
    const { colorMode } = useColorMode()

    const initializationExample = `// client/index.js - Initialize WebBridge at app startup
import React from "react"
import "./styles"
import { hydrateRoot } from "react-dom/client"
import { loadableReady } from "@loadable/component"
import { Provider } from "react-redux"
import { RouterProvider } from "@tata1mg/router"
import clientRouter from "catalyst-core/router/ClientRouter"
import configureStore from "@store"
import WebBridge from "catalyst-core/WebBridge"

window.addEventListener("load", () => {
    loadableReady(() => {
        const { __ROUTER_INITIAL_DATA__: routerInitialData, __INITIAL_STATE__ } = window
        const store = configureStore(__INITIAL_STATE__ || {})

        const router = clientRouter({ store, routerInitialState: routerInitialData })

        const Application = (
            <Provider store={store} serverState={__INITIAL_STATE__}>
                <React.StrictMode>
                    <RouterProvider router={router} />
                </React.StrictMode>
            </Provider>
        )
        
        // Initialize WebBridge for native communication
        WebBridge.init(); // ⭐ Required for native hooks
        
        const container = document.getElementById("app")
        hydrateRoot(container, Application)
    })
})`

    const cameraHookExample = `// Using Camera Hook with Common Interface
import React from 'react';
import { useCamera } from "catalyst-core/hooks";

function CameraComponent() {
  const { 
    // Standard Interface Properties
    data: photo,        // Hook-specific result data
    loading,            // Operation in progress
    error,              // Standardized error object
    progress,           // Detailed progress information
    isWeb,              // Environment detection
    isNative,           // Environment detection
    
    // Standard Actions
    execute,            // Primary function (takePhoto)
    clear,              // Clear data and reset state
    clearError,         // Clear error state only
    
    // Camera-specific properties (legacy compatibility)
    permission,         // Camera permission status
    takePhoto,          // Semantic alias for execute
    clearPhoto          // Legacy alias for clear
  } = useCamera();

  const handleTakePhoto = () => {
    if (isNative) {
      execute('takePhoto'); // or just execute() for default
    } else {
      console.warn('Camera requires native environment');
    }
  };

  return (
    <div>
      <button onClick={handleTakePhoto} disabled={loading}>
        {loading ? 'Taking Photo...' : 'Take Photo'}
      </button>
      
      {/* Progress Tracking */}
      {loading && progress && (
        <div>
          <p>Status: {progress.state}</p>
          {progress.message && <p>{progress.message}</p>}
          {progress.transport && <small>Transport: {progress.transport}</small>}
        </div>
      )}
      
      {/* Standardized Error Display */}
      {error && (
        <div className="error">
          <h4>{error.message}</h4>
          <p>{error.details}</p>
          {error.recoverable && (
            <>
              <p><strong>Action:</strong> {error.action}</p>
              <button onClick={clearError}>Try Again</button>
            </>
          )}
          <small>Code: {error.code} | Category: {error.category}</small>
        </div>
      )}
      
      {/* Photo Display */}
      {photo && (
        <div>
          <img src={photo.fileSrc} alt="Captured" />
          <p>Transport: {photo.transport}</p>
          <p>Size: {photo.size} bytes</p>
          <button onClick={clear}>Clear Photo</button>
        </div>
      )}
      
      <p>Environment: {isNative ? 'Native' : 'Web'}</p>
      <p>Permission: {permission?.status || 'Unknown'}</p>
    </div>
  );
}`

    const availableAPIs = [
        {
            category: '📷 Camera APIs',
            link: '/content/API%20Reference/hooks',
            apis: [
                {
                    name: 'useCamera()',
                    description:
                        'Photo capture with integrated permission management, supports takePhoto, requestPermission operations',
                    legacy: true,
                },
                {
                    name: 'useCameraPermission()',
                    description: 'Standalone camera permission management',
                },
                {
                    name: 'requestCameraPermission()',
                    description: 'Promise-based permission request',
                },
            ],
        },
        {
            category: '📁 File Management APIs',
            link: '/content/API%20Reference/hooks',
            apis: [
                {
                    name: 'useFilePicker()',
                    description:
                        'File selection with MIME type filtering and transport tracking',
                    legacy: true,
                },
                {
                    name: 'useIntent()',
                    description:
                        'Open files with external applications, includes download progress',
                    legacy: true,
                },
            ],
        },
        {
            category: '📳 Haptic Feedback APIs',
            link: '/content/API%20Reference/hooks',
            apis: [
                {
                    name: 'useHapticFeedback()',
                    description:
                        'Platform-specific haptic feedback with capability detection and web fallbacks',
                    legacy: true,
                },
                {
                    name: 'requestHapticFeedback()',
                    description: 'Promise-based haptic requests',
                },
            ],
        },
        {
            category: '💾 Universal Storage API',
            link: '/content/API%20Reference/hooks',
            apis: [
                {
                    name: 'Storage',
                    description:
                        'Universal storage interface (localStorage + native persistence)',
                },
            ],
        },
    ]

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

    const [copied, setCopied] = useState('')

    return (
        <div className={styles.nativeHooksDemo}>
            <h2>Available Native APIs</h2>
            <p>
                Catalyst Core provides native APIs through React hooks with a{' '}
                <strong>common interface</strong> for consistent development
                experience across web and native platforms.
            </p>

            <div className={styles.apiSection}>
                <h3>Native Hooks Overview</h3>
                {availableAPIs.map((category, index) => (
                    <div key={index} className={styles.apiCategory}>
                        <h4>
                            <a
                                href={category.link}
                                className={styles.categoryLink}
                            >
                                {category.category}
                            </a>
                        </h4>
                        <div className={styles.apiTable}>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Hook/Function</th>
                                        <th>Description</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {category.apis.map((api, apiIndex) => (
                                        <tr key={apiIndex}>
                                            <td>
                                                <span
                                                    className={styles.hookName}
                                                >
                                                    {api.name}
                                                </span>
                                            </td>
                                            <td className={styles.description}>
                                                {api.description}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>

            <div className={styles.apiSection}>
                <h3>WebBridge Initialization</h3>
                <p>
                    Initialize WebBridge in client/index.js before using any
                    native hooks
                </p>

                <div className={styles.codeSection}>
                    <div className={styles.codeCard}>
                        <div className={styles.codeHeader}>
                            <span>client/index.js - Required Setup</span>
                            <button
                                onClick={() =>
                                    handleCopy(initializationExample, 'init')
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copied === 'init',
                                })}
                            >
                                {copied === 'init' ? '✓ Copied!' : '📋 Copy'}
                            </button>
                        </div>
                        <SyntaxHighlightedCode
                            code={initializationExample}
                            language="jsx"
                        />
                    </div>
                </div>
            </div>

            <div className={styles.apiSection}>
                <h3>Common Interface Example</h3>
                <p>
                    All hooks follow the same standardized interface pattern.
                    Here's the camera hook demonstrating the common interface:
                </p>

                <div className={styles.codeSection}>
                    <div className={styles.codeCard}>
                        <div className={styles.codeHeader}>
                            <span>CameraComponent.js</span>
                            <button
                                onClick={() =>
                                    handleCopy(cameraHookExample, 'camera')
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copied === 'camera',
                                })}
                            >
                                {copied === 'camera' ? '✓ Copied!' : '📋 Copy'}
                            </button>
                        </div>
                        <SyntaxHighlightedCode
                            code={cameraHookExample}
                            language="jsx"
                        />
                    </div>
                </div>
            </div>

            <div className={styles.importantNotes}>
                <h4>Implementation Notes</h4>
                <ul>
                    <li>
                        <strong>Initialization:</strong> Always call{' '}
                        <code>WebBridge.init()</code> before using hooks
                    </li>
                    <li>
                        <strong>Common Interface:</strong> All hooks use{' '}
                        <code>execute()</code> as primary function with semantic
                        aliases
                    </li>
                    <li>
                        <strong>Error Handling:</strong> Standardized error
                        system with recovery suggestions
                    </li>
                    <li>
                        <strong>Progress Tracking:</strong> Real-time operation
                        status with transport information
                    </li>
                    <li>
                        <strong>Environment Safety:</strong> Built-in SSR
                        protection and platform detection
                    </li>
                    <li>
                        <strong>Backward Compatibility:</strong> Legacy aliases
                        maintained for gradual migration
                    </li>
                </ul>
            </div>
        </div>
    )
}

export default NativeHooksDemo
