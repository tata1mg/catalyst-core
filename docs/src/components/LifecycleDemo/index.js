import React, { useState, useEffect } from 'react'
import clsx from 'clsx'
import styles from './styles.module.css'

const LifecycleDemo = () => {
    const [lifecycleEvents, setLifecycleEvents] = useState([])
    const [currentStage, setCurrentStage] = useState('initialized')
    const [isRunning, setIsRunning] = useState(false)
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
    const lifecycleCode = `// server/index.js
export const preServerInit = () => {
  console.log('Server initialization started');
  // Initialize server configurations
  // Set up middleware
  // Configure logging
}

export const onServerError = (error) => {
  console.error('Server error:', error);
  // Handle server startup failures
  // Log critical errors
  // Send notifications
}

export const onRouteMatch = (route) => {
  console.log('Route matched:', route);
  // Handle route matching logic
  // Set up route-specific middleware
  // Validate route parameters
}

export const onFetcherSuccess = (data) => {
  console.log('Data fetched successfully:', data);
  // Process fetched data
  // Transform data for rendering
  // Cache results
}

export const onRenderError = (error) => {
  console.error('Render error:', error);
  // Handle component rendering errors
  // Fallback to error page
  // Log rendering issues
}

export const onRequestError = (error) => {
  console.error('Request error:', error);
  // Handle request-level errors
  // Return appropriate error responses
  // Log request failures
}`

    // Simulate lifecycle events with delays

    // Simulate lifecycle events with delays
    const simulateLifecycle = async () => {
        setIsRunning(true)
        setLifecycleEvents([])
        setCurrentStage('running')

        const events = [
            {
                stage: 'preServerInit',
                description: 'Server initialization started',
                timestamp: new Date(),
                delay: 500,
            },
            {
                stage: 'onRouteMatch',
                description: 'Route matching completed successfully',
                timestamp: new Date(),
                delay: 800,
            },
            {
                stage: 'onFetcherSuccess',
                description: 'Data fetching completed successfully',
                timestamp: new Date(),
                delay: 600,
            },
            {
                stage: 'render',
                description: 'Component rendering completed',
                timestamp: new Date(),
                delay: 400,
            },
        ]

        for (let i = 0; i < events.length; i++) {
            await new Promise((resolve) => setTimeout(resolve, events[i].delay))
            setLifecycleEvents((prev) => [
                ...prev,
                { ...events[i], timestamp: new Date() },
            ])
        }

        setCurrentStage('completed')
        setIsRunning(false)
    }

    const simulateError = async () => {
        setIsRunning(true)
        setLifecycleEvents([])
        setCurrentStage('running')

        const events = [
            {
                stage: 'preServerInit',
                description: 'Server initialization started',
                timestamp: new Date(),
                delay: 500,
            },
            {
                stage: 'onRouteMatch',
                description: 'Route matching completed',
                timestamp: new Date(),
                delay: 800,
            },
            {
                stage: 'onFetcherSuccess',
                description: 'Data fetching failed - Network error',
                timestamp: new Date(),
                delay: 600,
                isError: true,
            },
            {
                stage: 'onRequestError',
                description:
                    'Request handling error - 500 Internal Server Error',
                timestamp: new Date(),
                delay: 400,
                isError: true,
            },
        ]

        for (let i = 0; i < events.length; i++) {
            await new Promise((resolve) => setTimeout(resolve, events[i].delay))
            setLifecycleEvents((prev) => [
                ...prev,
                { ...events[i], timestamp: new Date() },
            ])
        }

        setCurrentStage('error')
        setIsRunning(false)
    }

    const resetDemo = () => {
        setLifecycleEvents([])
        setCurrentStage('initialized')
        setIsRunning(false)
    }

    return (
        <div className={styles.lifecycleDemo}>
            <div className={styles.demoContent}>
                <div className={styles.benefits}>
                    <h3>Lifecycle Benefits</h3>
                    <div className={styles.benefitsGrid}>
                        <div className={styles.benefit}>
                            <h4>🔧 Fine Control</h4>
                            <p>
                                Handle specific stages of the SSR process with
                                precision
                            </p>
                        </div>
                        <div className={styles.benefit}>
                            <h4>🐛 Error Handling</h4>
                            <p>
                                Comprehensive error handling at each lifecycle
                                stage
                            </p>
                        </div>
                        <div className={styles.benefit}>
                            <h4>📊 Monitoring</h4>
                            <p>
                                Track and monitor application performance and
                                errors
                            </p>
                        </div>
                    </div>
                </div>

                <h2>Lifecycle Methods Demo</h2>
                <p>
                    This demo shows Catalyst's SSR lifecycle methods and their
                    execution order. Click the buttons below to simulate
                    different lifecycle scenarios.
                </p>

                <div className={styles.controls}>
                    <button
                        onClick={simulateLifecycle}
                        disabled={isRunning || currentStage === 'completed'}
                        className={styles.primaryButton}
                    >
                        {isRunning && currentStage === 'running'
                            ? 'Running...'
                            : 'Simulate Normal Flow'}
                    </button>
                    <button
                        onClick={simulateError}
                        disabled={isRunning || currentStage === 'error'}
                        className={styles.errorButton}
                    >
                        {isRunning && currentStage === 'running'
                            ? 'Running...'
                            : 'Simulate Error Flow'}
                    </button>
                    <button onClick={resetDemo} className={styles.resetButton}>
                        Reset Demo
                    </button>
                </div>

                <div className={styles.lifecycleFlow}>
                    <h3>Lifecycle Flow</h3>
                    <div className={styles.flowDiagram}>
                        <div className={styles.stage}>
                            <div className={styles.stageNumber}>1</div>
                            <div className={styles.stageContent}>
                                <h4>preServerInit</h4>
                                <p>Before server starts</p>
                            </div>
                        </div>
                        <div className={styles.arrow}>→</div>
                        <div className={styles.stage}>
                            <div className={styles.stageNumber}>2</div>
                            <div className={styles.stageContent}>
                                <h4>onRouteMatch</h4>
                                <p>After route matching</p>
                            </div>
                        </div>
                        <div className={styles.arrow}>→</div>
                        <div className={styles.stage}>
                            <div className={styles.stageNumber}>3</div>
                            <div className={styles.stageContent}>
                                <h4>onFetcherSuccess</h4>
                                <p>After data fetching</p>
                            </div>
                        </div>
                        <div className={styles.arrow}>→</div>
                        <div className={styles.stage}>
                            <div className={styles.stageNumber}>4</div>
                            <div className={styles.stageContent}>
                                <h4>Render</h4>
                                <p>Component rendering</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.eventsLog}>
                    <h3>Events Log</h3>
                    <div className={styles.logContainer}>
                        {lifecycleEvents.length === 0 ? (
                            <div className={styles.emptyLog}>
                                <p>
                                    No events logged yet. Click a button above
                                    to simulate lifecycle.
                                </p>
                                <p>
                                    Watch the events appear in real-time as the
                                    lifecycle progresses.
                                </p>
                            </div>
                        ) : (
                            lifecycleEvents.map((event, index) => (
                                <div
                                    key={index}
                                    className={clsx(styles.eventEntry, {
                                        [styles.error]: event.isError,
                                    })}
                                >
                                    <div className={styles.eventHeader}>
                                        <span className={styles.eventStage}>
                                            {event.stage}
                                        </span>
                                        <span className={styles.eventTime}>
                                            {event.timestamp.toLocaleTimeString()}
                                        </span>
                                    </div>
                                    <div className={styles.eventDescription}>
                                        {event.description}
                                    </div>
                                    <div className={styles.eventStatus}>
                                        {event.isError
                                            ? '❌ Error'
                                            : '✅ Success'}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className={styles.codeExample}>
                    <h3>Code Example</h3>
                    <div className={styles.codeBlock}>
                        <div className={styles.codeHeader}>
                            <h4>Server Lifecycle Methods (server/index.js)</h4>
                            <button
                                onClick={() =>
                                    copyToClipboard(lifecycleCode, 'lifecycle')
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copiedCode === 'lifecycle',
                                })}
                            >
                                {copiedCode === 'lifecycle'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <pre>{lifecycleCode}</pre>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default LifecycleDemo
