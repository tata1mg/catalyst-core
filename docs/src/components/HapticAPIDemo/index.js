import React, { useState } from 'react'
import clsx from 'clsx'
import Highlight, { defaultProps } from 'prism-react-renderer'
import styles from './styles.module.css'

const hooksList = [
    {
        key: 'useHapticFeedback',
        label: 'useHapticFeedback()',
        desc: 'Haptic feedback with multiple intensity levels and availability check',
    },
    {
        key: 'requestHapticFeedback',
        label: 'requestHapticFeedback()',
        desc: 'Promise-based haptic feedback requests with feedback type control',
    },
]

// Common interface properties for useHapticFeedback
const useHapticFeedbackProps = [
    // Standard Interface Properties
    {
        name: 'data',
        input: '-',
        output: 'object | null',
        description:
            'Haptic feedback result data including last operation details, capabilities, and success status',
        required: false,
        category: 'standard',
    },
    {
        name: 'loading',
        input: '-',
        output: 'boolean',
        description: 'Loading state during haptic feedback operation',
        required: false,
        category: 'standard',
    },
    {
        name: 'error',
        input: '-',
        output: 'object | null',
        description:
            'Standardized error object with code, category, message, details, and recovery info',
        required: false,
        category: 'standard',
    },
    {
        name: 'progress',
        input: '-',
        output: 'object | null',
        description: 'Progress tracking during haptic feedback operations',
        required: false,
        category: 'standard',
    },
    {
        name: 'isWeb',
        input: '-',
        output: 'boolean',
        description: 'Environment detection flag for web context',
        required: false,
        category: 'standard',
    },
    {
        name: 'isNative',
        input: '-',
        output: 'boolean',
        description: 'Environment detection flag for native app context',
        required: false,
        category: 'standard',
    },
    {
        name: 'execute',
        input: 'feedbackType?: string, options?: object',
        output: 'Promise<boolean>',
        description:
            'Primary function to trigger haptic feedback. Optional feedbackType parameter (light, medium, heavy, success, warning, error)',
        required: true,
        category: 'standard',
    },
    {
        name: 'clear',
        input: '-',
        output: 'void',
        description: 'Clear haptic feedback data and reset all states',
        required: false,
        category: 'standard',
    },
    {
        name: 'clearError',
        input: '-',
        output: 'void',
        description: 'Clear error state only',
        required: false,
        category: 'standard',
    },
    // Haptic-Specific Properties
    {
        name: 'capabilities',
        input: '-',
        output: 'object',
        description:
            'Device haptic capabilities including isSupported, availableTypes, and platform info',
        required: false,
        category: 'specific',
    },
    {
        name: 'isSupported',
        input: '-',
        output: 'boolean',
        description:
            'Boolean indicating whether haptic feedback is supported on the current platform/device',
        required: false,
        category: 'specific',
    },
    // Semantic Shortcuts
    {
        name: 'light',
        input: '-',
        output: 'Promise<boolean>',
        description: 'Shortcut function for light haptic feedback',
        required: false,
        category: 'shortcuts',
    },
    {
        name: 'medium',
        input: '-',
        output: 'Promise<boolean>',
        description: 'Shortcut function for medium haptic feedback',
        required: false,
        category: 'shortcuts',
    },
    {
        name: 'heavy',
        input: '-',
        output: 'Promise<boolean>',
        description: 'Shortcut function for heavy haptic feedback',
        required: false,
        category: 'shortcuts',
    },
    {
        name: 'success',
        input: '-',
        output: 'Promise<boolean>',
        description: 'Shortcut function for success haptic feedback',
        required: false,
        category: 'shortcuts',
    },
    {
        name: 'warning',
        input: '-',
        output: 'Promise<boolean>',
        description: 'Shortcut function for warning haptic feedback',
        required: false,
        category: 'shortcuts',
    },
    {
        name: 'errorHaptic',
        input: '-',
        output: 'Promise<boolean>',
        description: 'Shortcut function for error haptic feedback',
        required: false,
        category: 'shortcuts',
    },
    // Legacy Properties for backward compatibility
    {
        name: 'triggerHaptic',
        input: 'feedbackType?: string',
        output: 'Promise<boolean>',
        description: 'Legacy alias for execute function',
        required: false,
        category: 'legacy',
    },
    {
        name: 'isAvailable',
        input: '-',
        output: 'boolean',
        description: 'Legacy alias for isSupported property',
        required: false,
        category: 'legacy',
    },
]

const requestHapticFeedbackProps = [
    {
        name: 'requestHapticFeedback',
        input: 'feedbackType?: string',
        output: 'Promise<string>',
        description:
            'Function to request haptic feedback with specified type. Returns promise that resolves with "SUCCESS" status or rejects with error message if haptic feedback fails. Types: "light", "medium", "heavy", "success", "warning", "error"',
    },
]

const hapticFeedbackTypes = [
    {
        type: 'light',
        description: 'Light haptic feedback - subtle vibration',
        emoji: '🔹',
    },
    {
        type: 'medium',
        description: 'Medium haptic feedback - moderate vibration',
        emoji: '🔸',
    },
    {
        type: 'heavy',
        description: 'Heavy haptic feedback - strong vibration',
        emoji: '🔶',
    },
    {
        type: 'success',
        description: 'Success haptic feedback - positive confirmation',
        emoji: '✅',
    },
    {
        type: 'warning',
        description: 'Warning haptic feedback - attention alert',
        emoji: '⚠️',
    },
    {
        type: 'error',
        description: 'Error haptic feedback - negative feedback',
        emoji: '❌',
    },
]

const hapticPlatformBehavior = [
    {
        platform: '🤖 Android Emulator',
        status: '🔄 Limited',
        behavior:
            'Haptic feedback simulated through system vibration. Limited intensity variation.',
        notes: 'Android emulator provides basic vibration simulation only',
    },
    {
        platform: '🤖 Android Physical',
        status: '✅ Supported',
        behavior:
            'Complete haptic feedback with all intensity levels and contextual feedback types.',
        notes: 'Requires vibration permission. Hardware-dependent intensity levels.',
    },
    {
        platform: '🍎 iOS Simulator',
        status: '✅ Supported',
        behavior: 'iOS haptic feedback functionality currently in development.',
        notes: 'Haptic feedback features not yet implemented for iOS Simulator',
    },
    {
        platform: '🍎 iOS Physical',
        status: '⏳ Coming Soon',
        behavior: 'iOS haptic feedback functionality currently in development.',
        notes: 'Native Taptic Engine integration planned for future release',
    },
    {
        platform: '🌐 Web Browser',
        status: '🔄 Fallback',
        behavior: 'Vibration API where supported, otherwise silent fallback.',
        notes: 'Browser security restrictions. Limited to vibration pattern API.',
    },
]

// Use case definitions
const useCases = [
    {
        id: 'button-feedback',
        title: '🔘 Button Feedback Demo',
        description:
            'Interactive button with haptic feedback for different user actions and states',
        icon: '🔘',
    },
]

export default function HapticAPIDemo() {
    const [selectedHooks, setSelectedHooks] = useState({
        useHapticFeedback: true,
        requestHapticFeedback: false,
    })
    const [selectedProperties, setSelectedProperties] = useState({
        // Standard Interface Properties
        'haptic.data': false,
        'haptic.loading': false,
        'haptic.error': false,
        'haptic.progress': false,
        'haptic.isWeb': false,
        'haptic.isNative': false,
        'haptic.execute': true,
        'haptic.clear': false,
        'haptic.clearError': false,
        // Haptic-Specific Properties
        'haptic.capabilities': false,
        'haptic.isSupported': true,
        // Semantic Shortcuts
        'haptic.light': false,
        'haptic.medium': false,
        'haptic.heavy': false,
        'haptic.success': false,
        'haptic.warning': false,
        'haptic.errorHaptic': false,
        // Legacy Properties
        'haptic.triggerHaptic': false,
        'haptic.isAvailable': false,
    })
    const [copied, setCopied] = useState('')
    const [accordionState, setAccordionState] = useState({
        standard: true, // Standard Interface Properties - expanded by default
        specific: false, // Haptic-Specific Properties
        shortcuts: false, // Semantic Shortcuts
        legacy: false, // Legacy Properties
        advanced: false, // Advanced Hooks
    })

    // Log state changes for debugging
    React.useEffect(() => {
        console.log('Selected properties updated:', selectedProperties)
    }, [selectedProperties])

    const toggleAccordion = (section) => {
        setAccordionState((prev) => ({
            ...prev,
            [section]: !prev[section],
        }))
    }

    const toggleHook = (hook) => {
        setSelectedHooks((prev) => ({ ...prev, [hook]: !prev[hook] }))
    }

    const toggleProperty = (property) => {
        // Prevent toggling of core required properties
        const coreRequired = ['haptic.execute']
        if (coreRequired.includes(property)) {
            console.log(`Cannot toggle core required property: ${property}`)
            return
        }

        setSelectedProperties((prev) => ({
            ...prev,
            [property]: !prev[property],
        }))
        console.log(`Toggled property: ${property}`)
    }

    const generateCombinedCode = () => {
        let imports = ['useHapticFeedback']
        if (selectedHooks.requestHapticFeedback)
            imports.push('requestHapticFeedback')

        let code = `import React${selectedHooks.requestHapticFeedback ? ', { useState }' : ''} from 'react';
import { ${imports.join(', ')} } from "catalyst-core/hooks";

function ButtonFeedbackDemo() {`

        // Generate useHapticFeedback destructuring
        if (selectedHooks.useHapticFeedback) {
            let hapticProps = []

            // Standard interface properties with aliases
            if (selectedProperties['haptic.data'])
                hapticProps.push('data: hapticData')
            if (selectedProperties['haptic.loading'])
                hapticProps.push('loading: hapticLoading')
            if (selectedProperties['haptic.error'])
                hapticProps.push('error: hapticError')
            if (selectedProperties['haptic.progress'])
                hapticProps.push('progress: hapticProgress')
            if (selectedProperties['haptic.isWeb'])
                hapticProps.push('isWeb: hapticIsWeb')
            if (selectedProperties['haptic.isNative'])
                hapticProps.push('isNative: hapticIsNative')
            if (selectedProperties['haptic.execute'])
                hapticProps.push('execute: executeHaptic')
            if (selectedProperties['haptic.clear'])
                hapticProps.push('clear: clearHaptic')
            if (selectedProperties['haptic.clearError'])
                hapticProps.push('clearError: clearHapticError')

            // Haptic-specific properties
            if (selectedProperties['haptic.capabilities'])
                hapticProps.push('capabilities')
            if (selectedProperties['haptic.isSupported'])
                hapticProps.push('isSupported')

            // Semantic shortcuts
            if (selectedProperties['haptic.light']) hapticProps.push('light')
            if (selectedProperties['haptic.medium']) hapticProps.push('medium')
            if (selectedProperties['haptic.heavy']) hapticProps.push('heavy')
            if (selectedProperties['haptic.success'])
                hapticProps.push('success')
            if (selectedProperties['haptic.warning'])
                hapticProps.push('warning')
            if (selectedProperties['haptic.errorHaptic'])
                hapticProps.push('errorHaptic')

            // Legacy fallbacks
            let legacyProps = []
            if (selectedProperties['haptic.triggerHaptic'])
                legacyProps.push('triggerHaptic')
            if (selectedProperties['haptic.isAvailable'])
                legacyProps.push('isAvailable')

            if (hapticProps.length > 0 || legacyProps.length > 0) {
                code += `
  const { 
    // New standardized interface`
                if (hapticProps.length > 0) {
                    code += `
    ${hapticProps.join(', \n    ')}`
                }
                if (legacyProps.length > 0) {
                    code += `,
    // Legacy fallbacks
    ${legacyProps.join(', \n    ')}`
                }
                code += `
  } = useHapticFeedback();`
            }
        }

        if (selectedHooks.requestHapticFeedback) {
            code += `
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);

  const handleHapticRequest = async (feedbackType) => {
    setIsRequesting(true);
    setFeedbackStatus('');
    try {
      const result = await requestHapticFeedback(feedbackType);
      setFeedbackStatus(\`✅ \${feedbackType} haptic triggered successfully\`);
    } catch (error) {
      setFeedbackStatus(\`❌ Haptic failed: \${error.message}\`);
    } finally {
      setIsRequesting(false);
    }
  };`
        }

        code += `

  return (
    <div style={{ padding: '20px', maxWidth: '500px' }}>
      <h2>🔘 Button Feedback Demo</h2>`

        // Device availability check
        if (
            selectedProperties['haptic.isSupported'] ||
            selectedProperties['haptic.isAvailable']
        ) {
            const supportProp = selectedProperties['haptic.isSupported']
                ? 'isSupported'
                : 'isAvailable'
            code += `
      
      {/* Device availability check */}
      {${supportProp} ? (
        <p style={{ color: 'green', marginBottom: '20px' }}>
          ✅ Haptic feedback is available on this device
        </p>
      ) : (
        <p style={{ color: 'red', marginBottom: '20px' }}>
          ❌ Haptic feedback is not available on this device
        </p>
      )}`
        }

        // Haptic feedback buttons using execute or shortcuts
        if (
            selectedProperties['haptic.execute'] ||
            selectedProperties['haptic.light'] ||
            selectedProperties['haptic.triggerHaptic']
        ) {
            code += `
      
      {/* Haptic feedback buttons */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', 
        gap: '1rem',
        marginBottom: '20px'
      }}>`

            // Use semantic shortcuts if available
            if (selectedProperties['haptic.light']) {
                code += `
        <button onClick={light}>🔹 Light</button>`
            } else if (selectedProperties['haptic.execute']) {
                code += `
        <button onClick={() => executeHaptic('light')}>🔹 Light</button>`
            } else if (selectedProperties['haptic.triggerHaptic']) {
                code += `
        <button onClick={() => triggerHaptic('light')}>🔹 Light</button>`
            }

            if (selectedProperties['haptic.medium']) {
                code += `
        <button onClick={medium}>🔸 Medium</button>`
            } else if (selectedProperties['haptic.execute']) {
                code += `
        <button onClick={() => executeHaptic('medium')}>🔸 Medium</button>`
            } else if (selectedProperties['haptic.triggerHaptic']) {
                code += `
        <button onClick={() => triggerHaptic('medium')}>🔸 Medium</button>`
            }

            if (selectedProperties['haptic.heavy']) {
                code += `
        <button onClick={heavy}>🔶 Heavy</button>`
            } else if (selectedProperties['haptic.execute']) {
                code += `
        <button onClick={() => executeHaptic('heavy')}>🔶 Heavy</button>`
            } else if (selectedProperties['haptic.triggerHaptic']) {
                code += `
        <button onClick={() => triggerHaptic('heavy')}>🔶 Heavy</button>`
            }

            if (selectedProperties['haptic.success']) {
                code += `
        <button onClick={success}>✅ Success</button>`
            } else if (selectedProperties['haptic.execute']) {
                code += `
        <button onClick={() => executeHaptic('success')}>✅ Success</button>`
            } else if (selectedProperties['haptic.triggerHaptic']) {
                code += `
        <button onClick={() => triggerHaptic('success')}>✅ Success</button>`
            }

            if (selectedProperties['haptic.warning']) {
                code += `
        <button onClick={warning}>⚠️ Warning</button>`
            } else if (selectedProperties['haptic.execute']) {
                code += `
        <button onClick={() => executeHaptic('warning')}>⚠️ Warning</button>`
            } else if (selectedProperties['haptic.triggerHaptic']) {
                code += `
        <button onClick={() => triggerHaptic('warning')}>⚠️ Warning</button>`
            }

            if (selectedProperties['haptic.errorHaptic']) {
                code += `
        <button onClick={errorHaptic}>❌ Error</button>`
            } else if (selectedProperties['haptic.execute']) {
                code += `
        <button onClick={() => executeHaptic('error')}>❌ Error</button>`
            } else if (selectedProperties['haptic.triggerHaptic']) {
                code += `
        <button onClick={() => triggerHaptic('error')}>❌ Error</button>`
            }

            code += `
      </div>`
        }

        // Progress tracking
        if (selectedProperties['haptic.progress']) {
            code += `
      
      {/* Progress tracking */}
      {hapticProgress && (
        <div style={{ color: '#007bff', fontStyle: 'italic' }}>
          <p>Status: {hapticProgress.state}</p>
          {hapticProgress.message && <p>{hapticProgress.message}</p>}
        </div>
      )}`
        }

        // Error handling
        if (selectedProperties['haptic.error']) {
            code += `
      
      {/* Error handling */}
      {hapticError && (
        <div style={{ 
          padding: '10px', 
          backgroundColor: '#ffe6e6', 
          color: 'red',
          borderRadius: '4px',
          marginBottom: '10px'
        }}>
          <h4>{hapticError.message}</h4>
          <p>{hapticError.details}</p>
          {hapticError.recoverable && (
            <>
              <p><strong>Action:</strong> {hapticError.action}</p>
              ${selectedProperties['haptic.clearError'] ? '<button onClick={clearHapticError}>Try Again</button>' : ''}
            </>
          )}
          <small>Code: {hapticError.code} | Category: {hapticError.category}</small>
        </div>
      )}`
        }

        // Environment detection
        if (
            selectedProperties['haptic.isWeb'] ||
            selectedProperties['haptic.isNative']
        ) {
            code += `
      
      {/* Environment detection */}`
            if (
                selectedProperties['haptic.isWeb'] &&
                selectedProperties['haptic.isNative']
            ) {
                code += `
      <p>Environment: {hapticIsNative ? 'Native App' : 'Web Browser'}</p>`
            } else if (selectedProperties['haptic.isWeb']) {
                code += `
      <p>Environment: {hapticIsWeb ? 'Web Browser' : 'Other'}</p>`
            } else if (selectedProperties['haptic.isNative']) {
                code += `
      <p>Environment: {hapticIsNative ? 'Native App' : 'Other'}</p>`
            }
        }

        // Haptic data display
        if (selectedProperties['haptic.data']) {
            code += `
      
      {/* Haptic operation data */}
      {hapticData && (
        <div style={{ 
          padding: '10px', 
          backgroundColor: '#e8f5e8', 
          borderRadius: '4px',
          marginBottom: '10px'
        }}>
          <p><strong>Last Operation:</strong> {hapticData.lastType}</p>
          <p><strong>Success:</strong> {hapticData.success ? 'Yes' : 'No'}</p>
          <p><strong>Timestamp:</strong> {new Date(hapticData.timestamp).toLocaleTimeString()}</p>
        </div>
      )}`
        }

        if (selectedHooks.requestHapticFeedback) {
            code += `
      
      {/* Promise-based requests with status */}
      <div style={{ marginTop: '20px' }}>
        <button onClick={() => handleHapticRequest('success')}>
          Request Success Haptic
        </button>
        {feedbackStatus && <p>{feedbackStatus}</p>}
      </div>`
        }

        code += `
    </div>
  );
}

export default HapticFeedbackApp;`

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
                        <th>Input</th>
                        <th>Output</th>
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
                            </td>
                            <td>
                                <code className={styles.propType}>
                                    {prop.input}
                                </code>
                            </td>
                            <td>
                                <code className={styles.propType}>
                                    {prop.output}
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

    const FeedbackTypesTable = () => (
        <div className={styles.propsTable}>
            <table>
                <thead>
                    <tr>
                        <th>Feedback Type</th>
                        <th>Usage</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    {hapticFeedbackTypes.map((type, index) => (
                        <tr key={index}>
                            <td>
                                <span className={styles.propName}>
                                    {type.emoji} {type.type}
                                </span>
                            </td>
                            <td>
                                <code className={styles.propType}>
                                    "{type.type}"
                                </code>
                            </td>
                            <td className={styles.propDescription}>
                                {type.description}
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
                    {hapticPlatformBehavior.map((platform, index) => (
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
        <div className={styles.hapticAPIDemo}>
            {/* Haptic Feedback Types */}
            <div className={styles.apiSection}>
                <h3>useHapticFeedback() Hook</h3>
                <p>
                    Hook-based haptic feedback with availability checking and
                    multiple intensity levels for enhanced user experience.
                </p>
                <FeedbackTypesTable />
            </div>

            <div className={styles.apiSection}>
                <h3>requestHapticFeedback() Function</h3>
                <p>
                    Promise-based function for explicit haptic feedback requests
                    with detailed success/failure handling.
                </p>
                <PropsTable props={requestHapticFeedbackProps} />
            </div>

            {/* Platform Behavior */}
            <div className={styles.apiSection}>
                <h3>Platform & Device Behavior</h3>
                <p>
                    Haptic feedback API behavior varies across different
                    platforms and device types. Hardware capabilities affect
                    intensity and feedback quality.
                </p>
                <PlatformBehaviorTable />
            </div>

            {/* Interactive Demo Controls */}
            <div className={styles.propertyAccordion}>
                <h3>🎛️ Interactive Demo</h3>
                <p>
                    Customize the haptic feedback demo by selecting different
                    feedback types and properties.
                </p>

                {/* Haptic-Specific Properties - Collapsed by default */}
                <div className={styles.accordionSection}>
                    <button
                        className={clsx(styles.accordionHeader, {
                            [styles.expanded]: accordionState.specific,
                        })}
                        onClick={() => toggleAccordion('specific')}
                    >
                        <span>
                            🔘 Haptic-Specific Properties{' '}
                            <small>(2 properties)</small>
                        </span>
                        <span className={styles.accordionIcon}>
                            {accordionState.specific ? '▼' : '▶'}
                        </span>
                    </button>
                    {accordionState.specific && (
                        <div className={styles.accordionContent}>
                            <div className={styles.propGrid}>
                                <label
                                    className={styles.propItem}
                                    onClick={() =>
                                        toggleProperty('haptic.capabilities')
                                    }
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedProperties[
                                                'haptic.capabilities'
                                            ]
                                        }
                                        onChange={() =>
                                            toggleProperty(
                                                'haptic.capabilities'
                                            )
                                        }
                                    />
                                    <span>capabilities</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() =>
                                        toggleProperty('haptic.isSupported')
                                    }
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedProperties[
                                                'haptic.isSupported'
                                            ]
                                        }
                                        onChange={() =>
                                            toggleProperty('haptic.isSupported')
                                        }
                                    />
                                    <span>isSupported</span>
                                </label>
                            </div>
                        </div>
                    )}
                </div>

                {/* Semantic Shortcuts - Collapsed by default */}
                <div className={styles.accordionSection}>
                    <button
                        className={clsx(styles.accordionHeader, {
                            [styles.expanded]: accordionState.shortcuts,
                        })}
                        onClick={() => toggleAccordion('shortcuts')}
                    >
                        <span>
                            🎯 Semantic Shortcuts <small>(6 shortcuts)</small>
                        </span>
                        <span className={styles.accordionIcon}>
                            {accordionState.shortcuts ? '▼' : '▶'}
                        </span>
                    </button>
                    {accordionState.shortcuts && (
                        <div className={styles.accordionContent}>
                            <div className={styles.propGrid}>
                                <label
                                    className={styles.propItem}
                                    onClick={() =>
                                        toggleProperty('haptic.light')
                                    }
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedProperties['haptic.light']
                                        }
                                        onChange={() =>
                                            toggleProperty('haptic.light')
                                        }
                                    />
                                    <span>light</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() =>
                                        toggleProperty('haptic.medium')
                                    }
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedProperties['haptic.medium']
                                        }
                                        onChange={() =>
                                            toggleProperty('haptic.medium')
                                        }
                                    />
                                    <span>medium</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() =>
                                        toggleProperty('haptic.heavy')
                                    }
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedProperties['haptic.heavy']
                                        }
                                        onChange={() =>
                                            toggleProperty('haptic.heavy')
                                        }
                                    />
                                    <span>heavy</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() =>
                                        toggleProperty('haptic.success')
                                    }
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedProperties['haptic.success']
                                        }
                                        onChange={() =>
                                            toggleProperty('haptic.success')
                                        }
                                    />
                                    <span>success</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() =>
                                        toggleProperty('haptic.warning')
                                    }
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedProperties['haptic.warning']
                                        }
                                        onChange={() =>
                                            toggleProperty('haptic.warning')
                                        }
                                    />
                                    <span>warning</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() =>
                                        toggleProperty('haptic.errorHaptic')
                                    }
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedProperties[
                                                'haptic.errorHaptic'
                                            ]
                                        }
                                        onChange={() =>
                                            toggleProperty('haptic.errorHaptic')
                                        }
                                    />
                                    <span>errorHaptic</span>
                                </label>
                            </div>
                        </div>
                    )}
                </div>

                {/* Legacy Properties - Collapsed by default */}
                <div className={styles.accordionSection}>
                    <button
                        className={clsx(styles.accordionHeader, {
                            [styles.expanded]: accordionState.legacy,
                        })}
                        onClick={() => toggleAccordion('legacy')}
                    >
                        <span>
                            ⚠️ Legacy Properties <small>(2 properties)</small>
                        </span>
                        <span className={styles.accordionIcon}>
                            {accordionState.legacy ? '▼' : '▶'}
                        </span>
                    </button>
                    {accordionState.legacy && (
                        <div className={styles.accordionContent}>
                            <div className={styles.propGrid}>
                                <label
                                    className={styles.propItem}
                                    onClick={() =>
                                        toggleProperty('haptic.triggerHaptic')
                                    }
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedProperties[
                                                'haptic.triggerHaptic'
                                            ]
                                        }
                                        onChange={() =>
                                            toggleProperty(
                                                'haptic.triggerHaptic'
                                            )
                                        }
                                    />
                                    <span>triggerHaptic</span>
                                </label>
                                <label
                                    className={styles.propItem}
                                    onClick={() =>
                                        toggleProperty('haptic.isAvailable')
                                    }
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedProperties[
                                                'haptic.isAvailable'
                                            ]
                                        }
                                        onChange={() =>
                                            toggleProperty('haptic.isAvailable')
                                        }
                                    />
                                    <span>isAvailable</span>
                                </label>
                            </div>
                        </div>
                    )}
                </div>

                {/* Advanced Hooks - Collapsed by default */}
                <div className={styles.accordionSection}>
                    <button
                        className={clsx(styles.accordionHeader, {
                            [styles.expanded]: accordionState.advanced,
                        })}
                        onClick={() => toggleAccordion('advanced')}
                    >
                        <span>
                            ⚙️ Advanced Hooks <small>(1 hook)</small>
                        </span>
                        <span className={styles.accordionIcon}>
                            {accordionState.advanced ? '▼' : '▶'}
                        </span>
                    </button>
                    {accordionState.advanced && (
                        <div className={styles.accordionContent}>
                            <div className={styles.propGrid}>
                                <label className={styles.propItem}>
                                    <input
                                        type="checkbox"
                                        checked={
                                            selectedHooks.requestHapticFeedback
                                        }
                                        onChange={() =>
                                            toggleHook('requestHapticFeedback')
                                        }
                                    />
                                    <span>requestHapticFeedback()</span>
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
                            <span>ButtonFeedbackDemo.js</span>
                            <button
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copied === 'button-code',
                                })}
                                onClick={() => {
                                    const codeString = generateCombinedCode()
                                    handleCopy(codeString, 'button-code')
                                }}
                            >
                                {copied === 'button-code'
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
                        <strong>Platform Support:</strong> Works on iOS and
                        Android devices with haptic capabilities
                    </li>
                    <li>
                        <strong>Availability Check:</strong> Always check
                        `isAvailable` before using haptic feedback
                    </li>
                    <li>
                        <strong>User Preferences:</strong> Respects system-level
                        haptic feedback settings
                    </li>
                    <li>
                        <strong>Battery Optimization:</strong> Use haptic
                        feedback judiciously to preserve battery life
                    </li>
                    <li>
                        <strong>Contextual Usage:</strong> Use appropriate
                        feedback types (success, error, warning) for better UX
                    </li>
                    <li>
                        <strong>Web Fallback:</strong> Returns safe defaults and
                        false availability when running in web mode
                    </li>
                </ul>
            </div>
        </div>
    )
}
