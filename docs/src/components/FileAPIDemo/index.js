import React, { useState } from 'react'
import clsx from 'clsx'
import Highlight, { defaultProps } from 'prism-react-renderer'
import styles from './styles.module.css'

const hooksList = [
    {
        key: 'useFilePicker',
        label: 'useFilePicker()',
        desc: 'File selection with configurable picker options, multi-file support, and state management',
    },
    {
        key: 'useIntent',
        label: 'useIntent()',
        desc: 'Open files with external applications and intent handling',
    },
]

// Common interface properties for useFilePicker
const useFilePickerProps = [
    // Standard Interface Properties
    {
        name: 'data',
        input: '-',
        output: 'object | null',
        description:
            'Normalized picker payload containing files[], count, totalSize, transport, and legacy fileSrc/fileName for compatibility.',
        required: true,
        category: 'standard',
    },
    {
        name: 'selectedFiles',
        input: '-',
        output: 'array',
        description:
            'Array of normalized file entries returned by the picker (one entry per selected file).',
        required: false,
        category: 'standard',
    },
    {
        name: 'loading',
        input: '-',
        output: 'boolean',
        description: 'Loading state during file selection operation.',
        required: true,
        category: 'standard',
    },
    {
        name: 'error',
        input: '-',
        output: 'object | null',
        description:
            'Standardized error object with code, category, message, details, and recovery info.',
        required: false,
        category: 'standard',
    },
    {
        name: 'progress',
        input: '-',
        output: 'object | null',
        description:
            'Progress tracking with opening/processing/routing phases and transport metadata.',
        required: false,
        category: 'standard',
    },
    {
        name: 'isWeb',
        input: '-',
        output: 'boolean',
        description: 'Environment detection flag for web context.',
        required: false,
        category: 'standard',
    },
    {
        name: 'isNative',
        input: '-',
        output: 'boolean',
        description: 'Environment detection flag for native app context.',
        required: false,
        category: 'standard',
    },
    {
        name: 'execute',
        input: 'options?: string | FilePickerOptions',
        output: 'void',
        description: (
            <>
                Primary function to open the file picker. Accepts a MIME type
                string or a <code>FilePickerOptions</code> object with{' '}
                <code>mimeType</code>, <code>multiple</code>,{' '}
                <code>minFiles</code>, <code>maxFiles</code>,{' '}
                <code>minFileSize</code>, and <code>maxFileSize</code>.
            </>
        ),
        required: true,
        category: 'standard',
    },
    {
        name: 'pickFile',
        input: 'options?: string | FilePickerOptions',
        output: 'void',
        description:
            'Semantic alias for execute() when you prefer imperative naming.',
        required: false,
        category: 'standard',
    },
    {
        name: 'getFileObject',
        input: 'index?: number',
        output: 'Promise<File>',
        description:
            'Lazily converts the selected entry at index (default 0) into a browser File instance.',
        required: false,
        category: 'standard',
    },
    {
        name: 'getAllFileObjects',
        input: '-',
        output: 'Promise<File[]>',
        description:
            'Resolves every selected entry into a File array for uploads or FormData.',
        required: false,
        category: 'standard',
    },
    {
        name: 'canCreateFileObject',
        input: '-',
        output: 'boolean',
        description:
            'Indicates whether the first selected file transport supports File conversion.',
        required: false,
        category: 'standard',
    },
    {
        name: 'canCreateFileObjects',
        input: '-',
        output: 'boolean[]',
        description:
            'Per-file transport capability flags matching the order of selectedFiles.',
        required: false,
        category: 'standard',
    },
    {
        name: 'clear',
        input: '-',
        output: 'void',
        description: 'Clear selected file data and reset all states.',
        required: false,
        category: 'standard',
    },
    {
        name: 'clearError',
        input: '-',
        output: 'void',
        description: 'Clear error state only, keeping file data intact.',
        required: false,
        category: 'standard',
    },
]

// Common interface properties for useIntent
const useIntentProps = [
    // Standard Interface Properties
    {
        name: 'data',
        input: '-',
        output: 'object | null',
        description:
            'Result data from intent operation including success status',
        required: false,
        category: 'standard',
    },
    {
        name: 'loading',
        input: '-',
        output: 'boolean',
        description: 'Loading state during intent processing',
        required: true,
        category: 'standard',
    },
    {
        name: 'error',
        input: '-',
        output: 'object | null',
        description: 'Standardized error object with recovery information',
        required: false,
        category: 'standard',
    },
    {
        name: 'progress',
        input: '-',
        output: 'object | null',
        description: 'Progress tracking during intent operation',
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
        input: 'fileUrl: string, mimeType?: string',
        output: 'void',
        description: (
            <>
                Primary function to open file with external app. Requires file
                URL, optional MIME type for better app matching. See{' '}
                <a
                    href="https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    MIME Types Reference
                </a>{' '}
                for complete list.
            </>
        ),
        required: true,
        category: 'standard',
    },
    {
        name: 'clear',
        input: '-',
        output: 'void',
        description: 'Clear intent data and reset all states',
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
]

const filePlatformBehavior = [
    {
        platform: '🤖 Android Emulator',
        status: '✅ Supported',
        behavior:
            'File picker works with emulator file system. File intents open with available apps.',
        notes: 'Uses Android Virtual Device file system and app intents',
    },
    {
        platform: '🤖 Android Physical',
        status: '✅ Supported',
        behavior:
            'Full file picker functionality with device storage. File intents use installed apps.',
        notes: 'Requires storage permissions. Works with all installed apps.',
    },
    {
        platform: '🍎 iOS Simulator',
        status: '✅ Supported',
        behavior:
            'iOS file picker and intent functionality currently in development.',
        notes: 'File management features not yet implemented for iOS Simulator',
    },
    {
        platform: '🍎 iOS Physical',
        status: '⏳ Coming Soon',
        behavior:
            'iOS file picker and intent functionality currently in development.',
        notes: 'Native iOS Files app integration planned for future release',
    },
    {
        platform: '🌐 Web Browser',
        status: '🔄 Fallback',
        behavior:
            'Browser file picker for uploads. Limited file opening capabilities.',
        notes: 'Browser security restrictions apply. Limited MIME type support.',
    },
]

// Use case definitions
const useCases = [
    {
        id: 'profile-photo',
        title: '📸 Profile Photo Upload',
        description:
            'Upload and preview profile pictures with validation and state management',
        icon: '📸',
    },
]

export default function FileAPIDemo() {
    const [selectedHooks, setSelectedHooks] = useState({
        useFilePicker: true,
        useIntent: false,
    })
    const [selectedProperties, setSelectedProperties] = useState({
        // useFilePicker properties
        'filePicker.data': true,
        'filePicker.selectedFiles': true,
        'filePicker.loading': false,
        'filePicker.error': false,
        'filePicker.progress': false,
        'filePicker.isWeb': false,
        'filePicker.isNative': false,
        'filePicker.execute': true,
        'filePicker.pickFile': false,
        'filePicker.getFileObject': false,
        'filePicker.getAllFileObjects': false,
        'filePicker.canCreateFileObject': false,
        'filePicker.canCreateFileObjects': false,
        'filePicker.clear': false,
        'filePicker.clearError': false,
        // useIntent properties
        'intent.data': false,
        'intent.loading': false,
        'intent.error': false,
        'intent.progress': false,
        'intent.isWeb': false,
        'intent.isNative': false,
        'intent.execute': true,
        'intent.clear': false,
        'intent.clearError': false,
    })
    const [copied, setCopied] = useState('')

    // Log state changes for debugging
    React.useEffect(() => {
        console.log('Selected properties updated:', selectedProperties)
    }, [selectedProperties])

    const toggleHook = (hook) => {
        setSelectedHooks((prev) => ({ ...prev, [hook]: !prev[hook] }))
    }

    const toggleProperty = (property) => {
        // Prevent toggling of core required properties
        const coreRequired = [
            'filePicker.data',
            'filePicker.execute',
            'intent.execute',
        ]
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
        let imports = []
        if (selectedHooks.useFilePicker) imports.push('useFilePicker')
        if (selectedHooks.useIntent) imports.push('useIntent')

        if (imports.length === 0) return ''

        let code = `import React from 'react';
import { ${imports.join(', ')} } from "catalyst-core/hooks";

function FileManagementApp() {`

        // Generate useFilePicker destructuring
        if (selectedHooks.useFilePicker) {
            let filePickerProps = []

            // Standard interface properties with aliases
            if (selectedProperties['filePicker.data'])
                filePickerProps.push('data: fileData')
            if (selectedProperties['filePicker.selectedFiles'])
                filePickerProps.push('selectedFiles')
            if (selectedProperties['filePicker.loading'])
                filePickerProps.push('loading: fileLoading')
            if (selectedProperties['filePicker.error'])
                filePickerProps.push('error: fileError')
            if (selectedProperties['filePicker.progress'])
                filePickerProps.push('progress: fileProgress')
            if (selectedProperties['filePicker.isWeb'])
                filePickerProps.push('isWeb: fileIsWeb')
            if (selectedProperties['filePicker.isNative'])
                filePickerProps.push('isNative: fileIsNative')
            if (selectedProperties['filePicker.execute'])
                filePickerProps.push('execute: executeFilePicker')
            if (selectedProperties['filePicker.pickFile'])
                filePickerProps.push('pickFile')
            if (selectedProperties['filePicker.clear'])
                filePickerProps.push('clear: clearFile')
            if (selectedProperties['filePicker.clearError'])
                filePickerProps.push('clearError: clearFileError')
            if (selectedProperties['filePicker.getFileObject'])
                filePickerProps.push('getFileObject')
            if (selectedProperties['filePicker.getAllFileObjects'])
                filePickerProps.push('getAllFileObjects')
            if (selectedProperties['filePicker.canCreateFileObject'])
                filePickerProps.push('canCreateFileObject')
            if (selectedProperties['filePicker.canCreateFileObjects'])
                filePickerProps.push('canCreateFileObjects')

            if (filePickerProps.length > 0) {
                code += `
  const { 
    ${filePickerProps.join(', \n    ')}
  } = useFilePicker();`
            }
        }

        // Generate useIntent destructuring
        if (selectedHooks.useIntent) {
            let intentProps = []

            // Standard interface properties with aliases
            if (selectedProperties['intent.data'])
                intentProps.push('data: intentData')
            if (selectedProperties['intent.loading'])
                intentProps.push('loading: intentLoading')
            if (selectedProperties['intent.error'])
                intentProps.push('error: intentError')
            if (selectedProperties['intent.progress'])
                intentProps.push('progress: intentProgress')
            if (selectedProperties['intent.isWeb'])
                intentProps.push('isWeb: intentIsWeb')
            if (selectedProperties['intent.isNative'])
                intentProps.push('isNative: intentIsNative')
            if (selectedProperties['intent.execute'])
                intentProps.push('execute: executeIntent')
            if (selectedProperties['intent.clear'])
                intentProps.push('clear: clearIntent')
            if (selectedProperties['intent.clearError'])
                intentProps.push('clearError: clearIntentError')

            if (intentProps.length > 0) {
                code += `
  const { 
    ${intentProps.join(', \n    ')}
  } = useIntent();`
            }
        }

        code += `

  return (
    <div style={{ padding: '20px', maxWidth: '600px' }}>
      <h2>📁 File Management Demo</h2>`

        // File picker section
        if (
            selectedHooks.useFilePicker &&
            selectedProperties['filePicker.execute']
        ) {
            code += `
      
      {/* File Picker Section */}
      <div style={{ marginBottom: '30px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
        <h3>📂 File Picker</h3>
        
        <div style={{ marginBottom: '15px' }}>
          <button 
            onClick={() => executeFilePicker({ mimeType: 'image/*' })} 
            ${selectedProperties['filePicker.loading'] ? 'disabled={fileLoading}' : ''}
            style={{ padding: '10px 15px', marginRight: '10px', fontSize: '14px' }}
          >
            ${selectedProperties['filePicker.loading'] ? "{fileLoading ? '📁 Picking Image...' : '📁 Pick Image'}" : "'📁 Pick Image'"}
          </button>
          
          <button 
            onClick={() => executeFilePicker({ mimeType: 'application/pdf' })} 
            ${selectedProperties['filePicker.loading'] ? 'disabled={fileLoading}' : ''}
            style={{ padding: '10px 15px', marginRight: '10px', fontSize: '14px' }}
          >
            ${selectedProperties['filePicker.loading'] ? "{fileLoading ? '📄 Picking PDF...' : '📄 Pick PDF'}" : "'📄 Pick PDF'"}
          </button>
          
          <button 
            onClick={() => executeFilePicker({
              mimeType: '*/*',
              multiple: true,
              maxFiles: 3,
              maxFileSize: 10 * 1024 * 1024,
            })} 
            ${selectedProperties['filePicker.loading'] ? 'disabled={fileLoading}' : ''}
            style={{ padding: '10px 15px', fontSize: '14px' }}
          >
            ${selectedProperties['filePicker.loading'] ? "{fileLoading ? '🗂️ Picking Files...' : '🗂️ Pick up to 3 files'}" : "'🗂️ Pick up to 3 files'"}
          </button>
          
          ${
              selectedProperties['filePicker.pickFile']
                  ? `
          <button 
            onClick={() => pickFile({
              mimeType: 'image/*',
              minFiles: 2,
              maxFiles: 4,
              multiple: true,
            })} 
            ${selectedProperties['filePicker.loading'] ? 'disabled={fileLoading}' : ''}
            style={{ padding: '10px 15px', fontSize: '14px', marginLeft: '10px' }}
          >
            Use pickFile alias
          </button>`
                  : ''
          }
        </div>`

            // Progress tracking
            if (selectedProperties['filePicker.progress']) {
                code += `

        {fileProgress && (
          <div style={{ color: '#007bff', fontStyle: 'italic' }}>
            <p>Status: {fileProgress.state}</p>
            {fileProgress.message && <p>{fileProgress.message}</p>}
            {fileProgress.transport && <small>Transport: {fileProgress.transport}</small>}
          </div>
        )}`
            }

            // File data display
            if (selectedProperties['filePicker.data']) {
                code += `

        {fileData && (
          <div style={{ 
            padding: '10px', 
            backgroundColor: '#e8f5e8', 
            borderRadius: '4px',
            marginBottom: '10px'
          }}>
            <p><strong>Selection Summary</strong></p>
            <p>📦 Files Selected: {fileData.count}</p>
            {typeof fileData.totalSize === 'number' && (
              <p>📏 Total Size: {(fileData.totalSize / 1024).toFixed(2)} KB</p>
            )}
            <p>🔗 Primary MIME: {fileData.mimeType || 'Unknown'}</p>
            <p>🚚 Transport: {fileData.transport}</p>
            ${
                selectedProperties['filePicker.canCreateFileObject']
                    ? `
            <p>🚦 First file convertible: {canCreateFileObject ? 'Yes' : 'No'}</p>`
                    : ''
            }
            ${
                selectedProperties['filePicker.canCreateFileObjects']
                    ? `
            <p>🚦 Conversion map: {JSON.stringify(canCreateFileObjects)}</p>`
                    : ''
            }
            {fileData.options && (
              <details style={{ marginTop: '10px' }}>
                <summary>Picker options</summary>
                <pre style={{ marginTop: '6px', background: '#fff', padding: '8px', borderRadius: '4px' }}>
                  {JSON.stringify(fileData.options, null, 2)}
                </pre>
              </details>
            )}
            ${
                selectedProperties['filePicker.selectedFiles']
                    ? `
            <div style={{ marginTop: '12px' }}>
              <p><strong>Files</strong></p>
              {selectedFiles.map((file, index) => (
                <div 
                  key={index}
                  style={{ 
                    marginBottom: '8px',
                    backgroundColor: '#fff',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid #cce5cc'
                  }}
                >
                  <p>📄 Name: {file.fileName || file.name}</p>
                  <p>📏 Size: {typeof file.size === 'number' ? (file.size / 1024).toFixed(2) : '0'} KB</p>
                  <p>🔗 Type: {file.mimeType || file.type || 'Unknown'}</p>
                  <p>🚚 Transport: {file.transport || 'N/A'}</p>
                  ${
                      selectedProperties['filePicker.getFileObject']
                          ? `
                  <button
                    onClick={async () => {
                      const browserFile = await getFileObject(index)
                      console.log('Browser File', browserFile)
                    }}
                    style={{ marginTop: '6px', padding: '6px 10px', borderRadius: '4px', border: '1px solid #28a745', backgroundColor: '#28a745', color: '#fff' }}
                  >
                    Convert to File
                  </button>`
                          : ''
                  }
                </div>
              ))}
            </div>`
                    : ''
            }
            ${
                selectedProperties['filePicker.getAllFileObjects']
                    ? `
            <button
              onClick={async () => {
                const browserFiles = await getAllFileObjects()
                console.log('All files ready for upload', browserFiles)
              }}
              style={{ marginTop: '10px', padding: '8px 12px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px' }}
            >
              🚀 Prepare Files for Upload
            </button>`
                    : ''
            }
            ${
                selectedProperties['filePicker.clear']
                    ? `
            
            <button 
              onClick={clearFile}
              style={{ padding: '5px 10px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', marginTop: '10px' }}
            >
              🗑️ Clear Selection
            </button>`
                    : ''
            }
          </div>
        )}`
            }

            // Error handling
            if (selectedProperties['filePicker.error']) {
                code += `

        {fileError && (
          <div style={{ 
            padding: '10px', 
            backgroundColor: '#ffe6e6', 
            color: 'red',
            borderRadius: '4px',
            marginBottom: '10px'
          }}>
            <h4>{fileError.message}</h4>
            <p>{fileError.details}</p>
            {fileError.recoverable && (
              <>
                <p><strong>Action:</strong> {fileError.action}</p>
                ${
                    selectedProperties['filePicker.clearError']
                        ? `<button onClick={clearFileError}>Try Again</button>`
                        : ''
                }
              </>
            )}
            <small>Code: {fileError.code} | Category: {fileError.category}</small>
          </div>
        )}`
            }

            // Environment detection
            if (
                selectedProperties['filePicker.isWeb'] ||
                selectedProperties['filePicker.isNative']
            ) {
                code += `
        
        <div style={{ marginTop: '15px' }}>`
                if (
                    selectedProperties['filePicker.isWeb'] &&
                    selectedProperties['filePicker.isNative']
                ) {
                    code += `
          <p>Environment: {fileIsNative ? 'Native App' : 'Web Browser'}</p>`
                } else if (selectedProperties['filePicker.isWeb']) {
                    code += `
          <p>Environment: {fileIsWeb ? 'Web Browser' : 'Other'}</p>`
                } else if (selectedProperties['filePicker.isNative']) {
                    code += `
          <p>Environment: {fileIsNative ? 'Native App' : 'Other'}</p>`
                }
                code += `
        </div>`
            }

            code += `
      </div>`
        }

        // Intent section
        if (selectedHooks.useIntent && selectedProperties['intent.execute']) {
            code += `
      
      {/* Intent Section */}
      <div style={{ marginBottom: '30px', padding: '15px', backgroundColor: '#f0f8ff', borderRadius: '8px' }}>
        <h3>🔗 Open with External App</h3>
        
        <div style={{ marginBottom: '15px' }}>
          <button 
            onClick={() => executeIntent('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', 'application/pdf')} 
            ${selectedProperties['intent.loading'] ? 'disabled={intentLoading}' : ''}
            style={{ padding: '10px 15px', marginRight: '10px', fontSize: '14px' }}
          >
            ${selectedProperties['intent.loading'] ? "{intentLoading ? '📄 Opening PDF...' : '📄 Open Sample PDF'}" : "'📄 Open Sample PDF'"}
          </button>
          
          <button 
            onClick={() => executeIntent('https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4', 'video/mp4')} 
            ${selectedProperties['intent.loading'] ? 'disabled={intentLoading}' : ''}
            style={{ padding: '10px 15px', fontSize: '14px' }}
          >
            ${selectedProperties['intent.loading'] ? "{intentLoading ? '🎥 Opening Video...' : '🎥 Open Sample Video'}" : "'🎥 Open Sample Video'"}
          </button>
        </div>`

            // Intent progress tracking
            if (selectedProperties['intent.progress']) {
                code += `

        {intentProgress && (
          <div style={{ color: '#007bff', fontStyle: 'italic' }}>
            <p>Status: {intentProgress.state}</p>
            {intentProgress.message && <p>{intentProgress.message}</p>}
          </div>
        )}`
            }

            // Intent data display
            if (selectedProperties['intent.data']) {
                code += `

        {intentData && (
          <div style={{ 
            padding: '10px', 
            backgroundColor: '#e8f5e8', 
            color: 'green',
            borderRadius: '4px',
            marginBottom: '10px'
          }}>
            <strong>Intent Result:</strong>
            <p>Success: {intentData.success ? 'Yes' : 'No'}</p>
            {intentData.result && <p>Details: {JSON.stringify(intentData.result)}</p>}
          </div>
        )}`
            }

            // Intent error handling
            if (selectedProperties['intent.error']) {
                code += `

        {intentError && (
          <div style={{ 
            padding: '10px', 
            backgroundColor: '#ffe6e6', 
            color: 'red',
            borderRadius: '4px',
            marginBottom: '10px'
          }}>
            <h4>{intentError.message}</h4>
            <p>{intentError.details}</p>
            {intentError.recoverable && (
              <>
                <p><strong>Action:</strong> {intentError.action}</p>
                ${
                    selectedProperties['intent.clearError']
                        ? `<button onClick={clearIntentError}>Try Again</button>`
                        : ''
                }
              </>
            )}
            <small>Code: {intentError.code} | Category: {intentError.category}</small>
          </div>
        )}`
            }

            // Intent environment detection
            if (
                selectedProperties['intent.isWeb'] ||
                selectedProperties['intent.isNative']
            ) {
                code += `
        
        <div style={{ marginTop: '15px' }}>`
                if (
                    selectedProperties['intent.isWeb'] &&
                    selectedProperties['intent.isNative']
                ) {
                    code += `
          <p>Environment: {intentIsNative ? 'Native App' : 'Web Browser'}</p>`
                } else if (selectedProperties['intent.isWeb']) {
                    code += `
          <p>Environment: {intentIsWeb ? 'Web Browser' : 'Other'}</p>`
                } else if (selectedProperties['intent.isNative']) {
                    code += `
          <p>Environment: {intentIsNative ? 'Native App' : 'Other'}</p>`
                }
                code += `
        </div>`
            }

            code += `
      </div>`
        }

        // Combined actions when both hooks are selected
        if (
            selectedHooks.useFilePicker &&
            selectedHooks.useIntent &&
            selectedProperties['filePicker.data'] &&
            selectedProperties['intent.execute']
        ) {
            code += `
      
      {/* Combined Actions */}
      {fileData && (
        <div style={{ padding: '15px', backgroundColor: '#fff3cd', borderRadius: '8px' }}>
          <h3>🔄 File Actions</h3>
          <p>Selected file: <strong>${selectedProperties['filePicker.selectedFiles'] ? '{selectedFiles[0]?.fileName || fileData.fileName}' : '{fileData.fileName}'}</strong></p>
          
          <button 
            onClick={() => executeIntent(${selectedProperties['filePicker.selectedFiles'] ? 'selectedFiles[0]?.fileSrc || fileData.fileSrc' : 'fileData.fileSrc'}, ${selectedProperties['filePicker.selectedFiles'] ? 'selectedFiles[0]?.mimeType || fileData.mimeType' : 'fileData.mimeType'})}
            ${selectedProperties['intent.loading'] ? 'disabled={intentLoading}' : ''}
            style={{ 
              padding: '10px 15px', 
              backgroundColor: '#28a745', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              marginRight: '10px'
            }}
          >
            ${selectedProperties['intent.loading'] ? "{intentLoading ? '🔗 Opening...' : '🔗 Open Selected File'}" : "'🔗 Open Selected File'"}
          </button>
          ${
              selectedProperties['filePicker.clear'] &&
              selectedProperties['intent.clear']
                  ? `
          
          <button 
            onClick={() => {
              clearFile();
              clearIntent();
            }}
            style={{ 
              padding: '10px 15px', 
              backgroundColor: '#6c757d', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px'
            }}
          >
            🔄 Clear All
          </button>`
                  : ''
          }
        </div>
      )}`
        }

        code += `
    </div>
  );
}

export default FileManagementApp;`

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
                    {filePlatformBehavior.map((platform, index) => (
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

    // Profile Photo Preview Component
    const ProfilePhotoPreview = () => (
        <div className={styles.previewDemo}>
            <div className={styles.demoContainer}>
                <div className={styles.uploadZone}>
                    <div className={styles.avatarContainer}>
                        <div className={styles.avatarPlaceholder}>👤</div>
                        <div className={styles.uploadOverlay}>
                            <button className={styles.uploadButton}>
                                📸 Choose Photo
                            </button>
                        </div>
                    </div>
                    <div className={styles.uploadHint}>
                        Click to upload or drag and drop your profile picture
                    </div>
                </div>

                <div className={styles.fileInfo}>
                    <div className={styles.infoItem}>
                        <strong>Supported formats:</strong> JPG, PNG, GIF
                    </div>
                    <div className={styles.infoItem}>
                        <strong>Max size:</strong> 5MB
                    </div>
                    <div className={styles.infoItem}>
                        <strong>Recommended:</strong> Square images work best
                    </div>
                </div>

                <div className={styles.stateSimulator}>
                    <h4>🎛️ Simulate States</h4>
                    <div className={styles.simulatorButtons}>
                        <button className={styles.simButton}>
                            📤 Uploading
                        </button>
                        <button className={styles.simButton}>✅ Success</button>
                        <button className={styles.simButton}>❌ Error</button>
                        <button className={styles.simButton}>🔄 Reset</button>
                    </div>
                </div>
            </div>
        </div>
    )

    return (
        <div className={styles.fileAPIDemo}>
            <h2>File Management APIs</h2>
            <p>
                Comprehensive file management functionality for selecting files
                and opening them with external applications in universal apps.
            </p>

            {/* Common Interface Note */}
            <div className={styles.commonInterfaceNote}>
                <h3>🔄 Common Interface</h3>
                <p>
                    All hooks now follow a standardized interface with{' '}
                    <code>execute()</code> as the primary function,
                    <code>data</code> for results, <code>loading</code> for
                    state tracking, and built-in error handling.
                </p>
            </div>

            {/* API Documentation Tables */}
            <div className={styles.apiSection}>
                <h3>useFilePicker() Hook</h3>
                <p>
                    File selection with configurable picker options (multiple
                    files, count and size limits), standardized progress
                    tracking, and comprehensive error handling.
                </p>
                <PropsTable props={useFilePickerProps} />
            </div>

            <div className={styles.apiSection}>
                <h3>useIntent() Hook</h3>
                <p>
                    Open files with external applications using standardized
                    interface with Android intents and iOS document interaction
                    support.
                </p>
                <PropsTable props={useIntentProps} />
            </div>

            {/* Use Case Description */}
            <div className={styles.useCaseDescription}>
                <h3>📁 File Management Example</h3>
                <p>
                    Select single or multiple files with picker constraints,
                    inspect metadata, and open them with external applications.
                </p>
            </div>

            {/* Hook and Property Selection */}
            <div className={styles.propertyAccordion}>
                <h3>🎯 Customize Your Example</h3>
                <p>
                    Select hooks and properties to generate a customized code
                    example demonstrating the common interface.
                </p>

                <div className={styles.accordionSection}>
                    <h4>🔗 Available Hooks</h4>
                    <div className={styles.accordionContent}>
                        <div className={styles.propGrid}>
                            <label className={styles.propItem}>
                                <input
                                    type="checkbox"
                                    checked={selectedHooks.useFilePicker}
                                    onChange={() => toggleHook('useFilePicker')}
                                />
                                <span>
                                    useFilePicker() - File selection with MIME
                                    filtering
                                </span>
                            </label>
                            <label className={styles.propItem}>
                                <input
                                    type="checkbox"
                                    checked={selectedHooks.useIntent}
                                    onChange={() => toggleHook('useIntent')}
                                />
                                <span>
                                    useIntent() - Open files with external apps
                                </span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Property Selection for useFilePicker */}
                {selectedHooks.useFilePicker && (
                    <div className={styles.accordionSection}>
                        <h4>🔧 useFilePicker Properties</h4>
                        <div className={styles.accordionContent}>
                            <div className={styles.propGrid}>
                                {useFilePickerProps.map((prop) => {
                                    const propKey = `filePicker.${prop.name}`
                                    const isRequired =
                                        prop.name === 'data' ||
                                        prop.name === 'execute'
                                    return (
                                        <label
                                            key={prop.name}
                                            className={clsx(styles.propItem, {
                                                [styles.required]: isRequired,
                                            })}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={
                                                    selectedProperties[propKey]
                                                }
                                                onChange={() =>
                                                    toggleProperty(propKey)
                                                }
                                                disabled={isRequired}
                                            />
                                            <span>
                                                {prop.name}{' '}
                                                {isRequired && (
                                                    <span
                                                        className={
                                                            styles.requiredBadge
                                                        }
                                                    >
                                                        required
                                                    </span>
                                                )}
                                            </span>
                                        </label>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* Property Selection for useIntent */}
                {selectedHooks.useIntent && (
                    <div className={styles.accordionSection}>
                        <h4>🔧 useIntent Properties</h4>
                        <div className={styles.accordionContent}>
                            <div className={styles.propGrid}>
                                {useIntentProps.map((prop) => {
                                    const propKey = `intent.${prop.name}`
                                    const isRequired = prop.name === 'execute'
                                    return (
                                        <label
                                            key={prop.name}
                                            className={clsx(styles.propItem, {
                                                [styles.required]: isRequired,
                                            })}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={
                                                    selectedProperties[propKey]
                                                }
                                                onChange={() =>
                                                    toggleProperty(propKey)
                                                }
                                                disabled={isRequired}
                                            />
                                            <span>
                                                {prop.name}{' '}
                                                {isRequired && (
                                                    <span
                                                        className={
                                                            styles.requiredBadge
                                                        }
                                                    >
                                                        required
                                                    </span>
                                                )}
                                            </span>
                                        </label>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Code Section */}

            <div className={styles.contentArea}>
                <div className={styles.codeTab}>
                    <div className={styles.codeCard}>
                        <div className={styles.codeHeader}>
                            <span>FileManagementDemo.js</span>
                            <button
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copied === 'file-code',
                                })}
                                onClick={() => {
                                    const codeString = generateCombinedCode()
                                    handleCopy(codeString, 'file-code')
                                }}
                            >
                                {copied === 'file-code'
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

            {/* Platform Behavior */}
            <div className={styles.apiSection}>
                <h3>Platform & Device Behavior</h3>
                <p>
                    File management API behavior varies across different
                    platforms and device types. See detailed breakdown below.
                </p>
                <PlatformBehaviorTable />
            </div>

            <div className={styles.importantNotes}>
                <h4>Important Notes</h4>
                <ul>
                    <li>
                        <strong>Platform Support:</strong> Works on both iOS and
                        Android native apps
                    </li>
                    <li>
                        <strong>MIME Types:</strong> Use specific MIME types for
                        better file filtering (e.g., "image/*",
                        "application/pdf")
                    </li>
                    <li>
                        <strong>File Access:</strong> Selected files provide URI
                        for further processing or opening with intents
                    </li>
                    <li>
                        <strong>Error Handling:</strong> Both hooks include
                        comprehensive error handling for failed operations
                    </li>
                    <li>
                        <strong>State Management:</strong> Processing states
                        help provide user feedback during operations
                    </li>
                    <li>
                        <strong>Web Fallback:</strong> Returns safe defaults
                        when running in web mode
                    </li>
                </ul>
            </div>
        </div>
    )
}
