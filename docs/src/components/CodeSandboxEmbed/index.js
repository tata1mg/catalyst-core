import React, { useState, useEffect } from 'react'
import clsx from 'clsx'
import styles from './styles.module.css'

const CodeSandboxSkeleton = ({ file = '', theme = 'dark' }) => {
    // Extract file info from the file prop
    const fileName = file ? file.split('/').pop() : 'App.js'
    const fileExtension = fileName.split('.').pop()

    // Simulate realistic file structure
    const fileTree = [
        { name: 'src', type: 'folder', expanded: true, level: 0 },
        { name: 'js', type: 'folder', expanded: true, level: 1 },
        { name: 'components', type: 'folder', expanded: false, level: 2 },
        { name: 'pages', type: 'folder', expanded: true, level: 2 },
        { name: fileName, type: 'file', active: true, level: 3 },
        { name: 'routes', type: 'folder', expanded: false, level: 2 },
        { name: 'store', type: 'folder', expanded: false, level: 2 },
        { name: 'public', type: 'folder', expanded: false, level: 0 },
        { name: 'package.json', type: 'file', active: false, level: 0 },
    ]

    // Generate realistic code lines based on file type
    const getCodeLines = () => {
        if (fileExtension === 'js' || fileExtension === 'jsx') {
            return [
                "import React from 'react'",
                "import { useCurrentRouteData } from '@tata1mg/router'",
                "import styles from './styles.module.css'",
                '',
                'const ComponentName = () => {',
                '  const { data, error, isFetching } = useCurrentRouteData()',
                '',
                '  if (isFetching) return <div>Loading...</div>',
                '  if (error) return <div>Error: {error.message}</div>',
                '',
                '  return (',
                '    <div className={styles.container}>',
                '      <h1>Welcome to Catalyst</h1>',
                '      <p>This is a live code example.</p>',
                '    </div>',
                '  )',
                '}',
                '',
                'export default ComponentName',
            ]
        } else if (fileExtension === 'css' || fileExtension === 'scss') {
            return [
                '.container {',
                '  max-width: 1200px;',
                '  margin: 0 auto;',
                '  padding: 2rem;',
                '}',
                '',
                '.title {',
                '  font-size: 2rem;',
                '  font-weight: 600;',
                '  margin-bottom: 1rem;',
                '}',
                '',
                '@media (max-width: 768px) {',
                '  .container {',
                '    padding: 1rem;',
                '  }',
                '}',
            ]
        } else {
            return [
                '// Loading file content...',
                '',
                '// This is a placeholder while',
                '// the CodeSandbox embed loads',
                '',
                "console.log('CodeSandbox loading...')",
            ]
        }
    }

    const codeLines = getCodeLines()

    return (
        <div className={clsx(styles.skeleton, styles[`skeleton--${theme}`])}>
            {/* Header */}
            <div className={styles.skeletonHeader}>
                <div className={styles.skeletonControls}>
                    <div className={styles.skeletonDot}></div>
                    <div className={styles.skeletonDot}></div>
                    <div className={styles.skeletonDot}></div>
                </div>
                <div className={styles.skeletonTabs}>
                    <div className={clsx(styles.skeletonTab, styles.active)}>
                        <span className={styles.fileIcon}>📄</span>
                        {fileName}
                    </div>
                </div>
                <div className={styles.skeletonActions}>
                    <div className={styles.skeletonButton}>▶</div>
                    <div className={styles.skeletonButton}>⚙</div>
                </div>
            </div>

            {/* Body */}
            <div className={styles.skeletonBody}>
                {/* Sidebar */}
                <div className={styles.skeletonSidebar}>
                    <div className={styles.sidebarHeader}>
                        <span className={styles.sidebarTitle}>Explorer</span>
                    </div>
                    <div className={styles.fileTree}>
                        {fileTree.map((item, index) => (
                            <div
                                key={index}
                                className={clsx(
                                    styles.fileItem,
                                    item.active && styles.fileItemActive
                                )}
                                style={{
                                    paddingLeft: `${item.level * 12 + 8}px`,
                                }}
                            >
                                <span className={styles.fileIcon}>
                                    {item.type === 'folder'
                                        ? item.expanded
                                            ? '📂'
                                            : '📁'
                                        : '📄'}
                                </span>
                                <span className={styles.fileName}>
                                    {item.name}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Editor */}
                <div className={styles.skeletonEditor}>
                    <div className={styles.editorContent}>
                        {codeLines.map((line, index) => (
                            <div key={index} className={styles.codeLine}>
                                <span className={styles.lineNumber}>
                                    {index + 1}
                                </span>
                                <span className={styles.codeText}>
                                    {line || '\u00A0'}{' '}
                                    {/* Non-breaking space for empty lines */}
                                </span>
                            </div>
                        ))}
                        <div className={styles.cursor}></div>
                    </div>
                </div>
            </div>

            {/* Loading overlay */}
            <div className={styles.loadingOverlay}>
                <div className={styles.loadingSpinner}></div>
                <p className={styles.loadingText}>Loading CodeSandbox...</p>
            </div>
        </div>
    )
}

const CodeSandboxEmbed = ({
    url,
    file = '',
    title = 'Live Example',
    description = 'Interactive code example',
    theme = 'dark',
    height = '400px',
    width = '100%',
    responsive = true,
    className,
    hideSidebar = true,
    hideTerminal = true,
    hideNavigation = false,
    hidePreview = true,
}) => {
    const [isLoading, setIsLoading] = useState(true)
    const [hasError, setHasError] = useState(false)

    // Handle different URL formats and add CodeSandbox parameters
    const getEmbedUrl = () => {
        let baseUrl

        // If URL already contains embed parameters, extract the base URL
        if (url.includes('embed=1')) {
            const urlObj = new URL(url)
            baseUrl = urlObj.origin + urlObj.pathname
        } else {
            baseUrl = url.endsWith('/') ? url.slice(0, -1) : url
        }

        // Build embed URL with parameters
        const params = new URLSearchParams()
        params.set('embed', '1')

        if (file) {
            params.set('file', file)
        }

        // CodeSandbox embed parameters - using correct parameter names
        if (hideSidebar) {
            params.set('hidenavigation', '1')
        }

        if (hideTerminal) {
            params.set('hidedevtools', '1')
            params.set('hideconsole', '1')
        }

        if (hideNavigation) {
            params.set('hidenavigation', '1')
        }

        if (hidePreview) {
            params.set('view', 'editor')
        }

        // Theme parameter
        params.set('theme', theme)

        // Additional parameters for cleaner embed
        params.set('fontsize', '14')
        params.set('hidenavigation', '1')
        params.set('hidedevtools', '1')

        return `${baseUrl}?${params.toString()}`
    }

    const embedUrl = getEmbedUrl()

    const handleLoad = () => {
        setIsLoading(false)
    }

    const handleError = () => {
        setIsLoading(false)
        setHasError(true)
    }

    const containerClass = clsx(
        styles.container,
        responsive && styles.responsive,
        className
    )

    const iframeClass = clsx(
        styles.iframe,
        theme === 'dark' && styles.darkTheme
    )

    const containerStyle = {
        width,
        height,
    }

    return (
        <div className={containerClass} style={containerStyle}>
            <div className={styles.header}>
                <div className={styles.titleSection}>
                    <h3 className={styles.title}>{title}</h3>
                    <p className={styles.description}>{description}</p>
                </div>
            </div>

            <div className={styles.embedContainer}>
                {isLoading && !hasError && (
                    <CodeSandboxSkeleton file={file} theme={theme} />
                )}

                {hasError ? (
                    <div className={styles.error}>
                        <p>Failed to load CodeSandbox</p>
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.fallbackLink}
                        >
                            Open in CodeSandbox
                        </a>
                    </div>
                ) : (
                    <iframe
                        src={embedUrl}
                        className={iframeClass}
                        title={title}
                        onLoad={handleLoad}
                        onError={handleError}
                        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                        loading="lazy"
                        style={{
                            height: '100%',
                            opacity: isLoading ? 0 : 1,
                            transition: 'opacity 0.3s ease-in-out',
                        }}
                    />
                )}
            </div>
        </div>
    )
}

export default CodeSandboxEmbed
