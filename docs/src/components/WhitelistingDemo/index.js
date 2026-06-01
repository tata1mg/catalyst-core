import React, { useState } from 'react'
import clsx from 'clsx'
import Highlight, { defaultProps } from 'prism-react-renderer'
import styles from './styles.module.css'

const patternTypes = [
    {
        key: 'exact',
        label: 'Exact Match',
        desc: 'Match URLs exactly as specified',
        example: 'https://api.example.com/users',
    },
    {
        key: 'wildcard',
        label: 'Wildcard Match',
        desc: 'Use * to match any characters within URL segments',
        example: 'https://api.example.com/*',
    },
    {
        key: 'subdomain',
        label: 'Subdomain Match',
        desc: 'Match all subdomains of a domain',
        example: '*.example.com',
    },
]

export default function WhitelistingDemo() {
    const [allowedUrls, setAllowedUrls] = useState([])
    const [newUrl, setNewUrl] = useState('')
    const [testUrl, setTestUrl] = useState('')
    const [testResult, setTestResult] = useState(null)
    const [copied, setCopied] = useState('')

    const addUrl = () => {
        if (!newUrl.trim()) return

        const urlEntry = {
            id: Date.now(),
            url: newUrl.trim(),
        }

        setAllowedUrls((prev) => [...prev, urlEntry])
        setNewUrl('')
    }

    const removeUrl = (id) => {
        setAllowedUrls((prev) => prev.filter((url) => url.id !== id))
    }

    const testUrlMatch = () => {
        if (!testUrl.trim()) return

        const urlPatterns = allowedUrls.map((u) => u.url)

        const isAllowed = urlPatterns.some((pattern) => {
            // Convert pattern to regex
            const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const regexPattern = escaped.replace(/\\\*/g, '.*')
            const regex = new RegExp(`^${regexPattern}$`)
            return regex.test(testUrl)
        })

        setTestResult({
            url: testUrl,
            allowed: isAllowed,
            matchedPattern: isAllowed
                ? urlPatterns.find((pattern) => {
                      const escaped = pattern.replace(
                          /[.*+?^${}()|[\]\\]/g,
                          '\\$&'
                      )
                      const regexPattern = escaped.replace(/\\\*/g, '.*')
                      const regex = new RegExp(`^${regexPattern}$`)
                      return regex.test(testUrl)
                  })
                : null,
        })
    }

    const generateConfig = () => {
        return {
            accessControl: {
                allowedUrls: allowedUrls.map((u) => u.url),
            },
        }
    }

    const copyToClipboard = async (text, key) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(key)
            setTimeout(() => setCopied(''), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    const configCode = JSON.stringify(generateConfig(), null, 2)

    return (
        <div className={styles.whitelistingDemo}>
            {/* Pattern Types Reference */}
            <div className={styles.patternReference}>
                <h3>🎯 URL Pattern Types</h3>
                <div className={styles.patternGrid}>
                    {patternTypes.map((pattern) => (
                        <div key={pattern.key} className={styles.patternCard}>
                            <h4>{pattern.label}</h4>
                            <p>{pattern.desc}</p>
                            <code className={styles.exampleCode}>
                                {pattern.example}
                            </code>
                        </div>
                    ))}
                </div>
            </div>

            {/* URL Management */}
            <div className={styles.urlSection}>
                <h3>📝 Manage URLs</h3>
                <div className={styles.urlControls}>
                    <div className={styles.urlEntry}>
                        <input
                            type="text"
                            value={newUrl}
                            onChange={(e) => setNewUrl(e.target.value)}
                            placeholder="Enter URL pattern (e.g., https://api.example.com/*)"
                            className={styles.urlInput}
                            onKeyPress={(e) => e.key === 'Enter' && addUrl()}
                        />
                        <button onClick={addUrl} className={styles.addButton}>
                            ➕ Add URL
                        </button>
                    </div>

                    <div className={styles.testControls}>
                        <input
                            type="text"
                            value={testUrl}
                            onChange={(e) => setTestUrl(e.target.value)}
                            placeholder="Test URL (e.g., https://api.example.com/users)"
                            className={styles.urlInput}
                            onKeyPress={(e) =>
                                e.key === 'Enter' && testUrlMatch()
                            }
                        />
                        <button
                            onClick={testUrlMatch}
                            className={styles.testButton}
                        >
                            🧪 Test
                        </button>
                    </div>
                </div>
                {testResult && (
                    <div
                        className={clsx(styles.testResult, {
                            [styles.allowed]: testResult.allowed,
                            [styles.blocked]: !testResult.allowed,
                        })}
                    >
                        <div className={styles.resultHeader}>
                            <span className={styles.resultIcon}>
                                {testResult.allowed ? '✅' : '❌'}
                            </span>
                            <span className={styles.resultStatus}>
                                {testResult.allowed ? 'ALLOWED' : 'BLOCKED'}
                            </span>
                        </div>
                        <div className={styles.resultDetails}>
                            <p>
                                <strong>URL:</strong>{' '}
                                <code>{testResult.url}</code>
                            </p>
                            {testResult.matchedPattern && (
                                <p>
                                    <strong>Matched Pattern:</strong>{' '}
                                    <code>{testResult.matchedPattern}</code>
                                </p>
                            )}
                            {!testResult.allowed && (
                                <p>
                                    <strong>Reason:</strong> No matching
                                    patterns found
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Generated Configuration */}
            <div className={styles.configSection}>
                <div className={styles.codeCard}>
                    <div className={styles.codeHeader}>
                        <span>💻 Generated Configuration</span>
                        <button
                            className={clsx(styles.copyButton, {
                                [styles.copied]: copied === 'config',
                            })}
                            onClick={() =>
                                copyToClipboard(configCode, 'config')
                            }
                        >
                            {copied === 'config' ? '✓ Copied!' : '📋 Copy'}
                        </button>
                    </div>
                    <Highlight
                        {...defaultProps}
                        code={configCode}
                        language="json"
                    >
                        {({
                            className,
                            style,
                            tokens,
                            getLineProps,
                            getTokenProps,
                        }) => (
                            <pre className={className} style={style}>
                                {tokens.map((line, i) => (
                                    <div
                                        key={i}
                                        {...getLineProps({ line, key: i })}
                                    >
                                        {line.map((token, key) => (
                                            <span
                                                key={key}
                                                {...getTokenProps({
                                                    token,
                                                    key,
                                                })}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </pre>
                        )}
                    </Highlight>
                </div>
            </div>
        </div>
    )
}
