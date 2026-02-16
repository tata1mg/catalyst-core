import React from "react"

let sentryInitialized = false

function getSentryInstance() {
    let instance = null
    const isServer = typeof window === "undefined"

    if (isServer) {
        try {
            const sentryNodeModule = "@sentry/node"
            // eslint-disable-next-line security/detect-eval-with-expression, no-eval
            instance = eval(`require("${sentryNodeModule}")`)
        } catch (error) {
            console.warn("Failed to load @sentry/node:", error.message)
            return null
        }
    } else {
        try {
            instance = require("@sentry/react")
        } catch (error) {
            console.warn("Failed to load @sentry/react:", error.message)
            return null
        }
    }
    return instance
}

const Sentry = getSentryInstance()

export function init() {
    if (sentryInitialized) {
        console.warn("Sentry has already been initialized")
        return
    }

    let sentryConfig = process.env.SENTRY_CONFIG

    if (!sentryConfig) {
        console.warn("Sentry configuration not found, skipping initialization")
        return
    }

    try {
        sentryConfig = JSON.parse(sentryConfig)
    } catch (error) {
        console.warn("Invalid sentry configuration", error)
    }

    const isServer = typeof window === "undefined"

    if (!sentryConfig.dsn) {
        console.warn("Sentry DSN not found in configuration, skipping initialization")
        return
    }

    try {
        if (isServer) {
            Sentry.init({
                dsn: sentryConfig.dsn,
                tracesSampleRate: sentryConfig.tracesSampleRate || 1.0,
                ...sentryConfig.serverOptions,
            })
        } else {
            Sentry.init({
                dsn: sentryConfig.dsn,
                tracesSampleRate: sentryConfig.tracesSampleRate || 1.0,
                ...sentryConfig.clientOptions,
            })
        }

        sentryInitialized = true
    } catch (error) {
        console.error("Failed to initialize Sentry:", error.message)
        return
    }
}

export function captureException(error, context = {}) {
    Sentry.captureException(error, context)
}

export function captureMessage(message, level = "info") {
    Sentry.captureMessage(message, level)
}

export function addBreadcrumb(breadcrumb) {
    Sentry.addBreadcrumb(breadcrumb)
}

export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError() {
        return { hasError: true }
    }

    componentDidCatch(error, errorInfo) {
        captureException(error, { componentStack: errorInfo.componentStack })
    }

    render() {
        if (this.state.hasError) {
            // eslint-disable-next-line react/prop-types
            if (this.props.fallback) {
                // eslint-disable-next-line react/prop-types
                return this.props.fallback
            }
            return <h1>Something went wrong.</h1>
        }

        // eslint-disable-next-line react/prop-types
        return this.props.children
    }
}

export default {
    init,
    captureException,
    captureMessage,
    addBreadcrumb,
}
