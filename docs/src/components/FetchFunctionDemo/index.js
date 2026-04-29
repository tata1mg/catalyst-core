import React, { useState } from 'react'
import clsx from 'clsx'
import styles from './styles.module.css'

const FetchFunctionDemo = () => {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [interceptorLog, setInterceptorLog] = useState([])
    const [copiedCode, setCopiedCode] = useState('')

    // Copy to clipboard function
    const copyToClipboard = async (text, codeType) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopiedCode(codeType)
            setTimeout(() => setCopiedCode(''), 2000)
        } catch (err) {
            console.error('Failed to copy: ', err)
        }
    }

    // Code examples
    const implementationCode = `const fetchFunction = (url, options = {}) => {
  let baseURL = process.env.API_URL
  let finalUrl = baseURL + url

  // Request Interceptor - modify request here
  options.headers = {
    'Content-Type': 'application/json',
    'X-Custom-Header': 'catalyst-demo',
    ...options.headers
  }

  return fetch(finalUrl, options)
    .then(response => {
      return response.json().then(parsedResponse => {
        // Response Interceptor - modify response here
        if (parsedResponse.error) {
          throw new Error(parsedResponse.error.message);
        }
        return parsedResponse
      })
    })
}

export default fetchFunction`

    const usageCode = `import fetchFunction from '@api'

const MyComponent = () => {
  const [data, setData] = useState(null)
  
  const fetchData = async () => {
    try {
      const result = await fetchFunction('/api/posts')
      setData(result)
    } catch (error) {
      console.error('Fetch error:', error)
    }
  }
  
  return (
    <div>
      <button onClick={fetchData}>Fetch Data</button>
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  )
}`

    // Simulated fetchFunction with interceptors
    const fetchFunction = (url, options = {}) => {
        let baseURL = 'https://jsonplaceholder.typicode.com'
        let finalUrl = baseURL + url

        // Request Interceptor
        const requestLog = `Request Interceptor: ${options.method || 'GET'} ${finalUrl}`
        setInterceptorLog((prev) => [
            ...prev,
            { type: 'request', message: requestLog, timestamp: new Date() },
        ])

        // Add custom headers
        options.headers = {
            'Content-Type': 'application/json',
            'X-Custom-Header': 'catalyst-demo',
            ...options.headers,
        }

        return fetch(finalUrl, options).then((response) => {
            return response.json().then((parsedResponse) => {
                // Response Interceptor
                const responseLog = `Response Interceptor: Status ${response.status}`
                setInterceptorLog((prev) => [
                    ...prev,
                    {
                        type: 'response',
                        message: responseLog,
                        timestamp: new Date(),
                    },
                ])

                // Transform response
                if (parsedResponse.error) {
                    throw new Error(parsedResponse.error.message)
                }

                return parsedResponse
            })
        })
    }

    const fetchPosts = async () => {
        setLoading(true)
        setError(null)
        setData(null)
        setInterceptorLog([])

        try {
            const result = await fetchFunction('/posts?_limit=3')
            setData(result)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const fetchWithError = async () => {
        setLoading(true)
        setError(null)
        setData(null)
        setInterceptorLog([])

        try {
            const result = await fetchFunction('/nonexistent')
            setData(result)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const clearLog = () => {
        setInterceptorLog([])
        setData(null)
        setError(null)
    }

    return (
        <div className={styles.fetchFunctionDemo}>
            <div className={styles.demoContent}>
                <div className={styles.benefits}>
                    <h3>Fetch Function Benefits</h3>
                    <div className={styles.benefitsGrid}>
                        <div className={styles.benefit}>
                            <h4>🔧 Interceptors</h4>
                            <p>
                                Request and response interceptors for custom
                                logic
                            </p>
                        </div>
                        <div className={styles.benefit}>
                            <h4>🛡️ Error Handling</h4>
                            <p>
                                Centralized error handling and response
                                validation
                            </p>
                        </div>
                        <div className={styles.benefit}>
                            <h4>⚙️ Configuration</h4>
                            <p>Easy base URL and header configuration</p>
                        </div>
                    </div>
                </div>

                <h2>Fetch Function Demo</h2>
                <p>
                    This demo shows how to use Catalyst's fetchFunction utility
                    with request and response interceptors. Click the buttons
                    below to test different scenarios.
                </p>

                <div className={styles.controls}>
                    <button
                        onClick={fetchPosts}
                        disabled={loading}
                        className={styles.primaryButton}
                    >
                        {loading ? 'Fetching...' : 'Fetch Posts'}
                    </button>
                    <button
                        onClick={fetchWithError}
                        disabled={loading}
                        className={styles.errorButton}
                    >
                        {loading ? 'Fetching...' : 'Test Error Handling'}
                    </button>
                    <button onClick={clearLog} className={styles.resetButton}>
                        Clear Log
                    </button>
                </div>

                <div className={styles.interceptorLog}>
                    <h3>Interceptor Log</h3>
                    <div className={styles.logContainer}>
                        {interceptorLog.length === 0 ? (
                            <div className={styles.emptyLog}>
                                <p>
                                    No interceptors logged yet. Click a button
                                    above to see request and response
                                    interceptors in action.
                                </p>
                                <p>
                                    Watch how the fetchFunction processes
                                    requests and responses in real-time.
                                </p>
                            </div>
                        ) : (
                            interceptorLog.map((log, index) => (
                                <div
                                    key={index}
                                    className={clsx(styles.logEntry, {
                                        [styles.request]:
                                            log.type === 'request',
                                        [styles.response]:
                                            log.type === 'response',
                                    })}
                                >
                                    <div className={styles.logHeader}>
                                        <span className={styles.logType}>
                                            {log.type === 'request'
                                                ? '🔵 Request'
                                                : '🟢 Response'}
                                        </span>
                                        <span className={styles.logTime}>
                                            {log.timestamp.toLocaleTimeString()}
                                        </span>
                                    </div>
                                    <div className={styles.logMessage}>
                                        {log.message}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {loading && (
                    <div className={styles.loading}>
                        <div className={styles.spinner}></div>
                        <p>Loading data...</p>
                    </div>
                )}

                {error && (
                    <div className={styles.error}>
                        <h3>❌ Error</h3>
                        <p>{error}</p>
                    </div>
                )}

                {data && (
                    <div className={styles.results}>
                        <h3>✅ Results</h3>
                        <div className={styles.dataPreview}>
                            <p>
                                <strong>Data Type:</strong>{' '}
                                {Array.isArray(data) ? 'Array' : 'Object'}
                            </p>
                            <p>
                                <strong>Items:</strong>{' '}
                                {Array.isArray(data)
                                    ? data.length
                                    : 'Single object'}
                            </p>
                        </div>
                        <pre>{JSON.stringify(data, null, 2)}</pre>
                    </div>
                )}

                <div className={styles.codeExample}>
                    <h3>Code Example</h3>
                    <div className={styles.codeBlock}>
                        <div className={styles.codeHeader}>
                            <h4>Fetch Function Implementation (api.js)</h4>
                            <button
                                onClick={() =>
                                    copyToClipboard(
                                        implementationCode,
                                        'implementation'
                                    )
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]:
                                        copiedCode === 'implementation',
                                })}
                            >
                                {copiedCode === 'implementation'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <pre>{implementationCode}</pre>
                    </div>

                    <div className={styles.codeBlock}>
                        <div className={styles.codeHeader}>
                            <h4>Usage in Component</h4>
                            <button
                                onClick={() =>
                                    copyToClipboard(usageCode, 'usage')
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copiedCode === 'usage',
                                })}
                            >
                                {copiedCode === 'usage'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <pre>{usageCode}</pre>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default FetchFunctionDemo
