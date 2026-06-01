import React, { useState } from 'react'
import clsx from 'clsx'
import styles from './styles.module.css'

const storageAPIs = [
    {
        name: 'localStorage',
        description:
            'Standard Web Storage API for client-side data persistence',
        documentation:
            'https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage',
        support: 'Web ✅ | Android ✅ | iOS ✅',
    },
    {
        name: 'sessionStorage',
        description:
            'Session-based storage that persists for the browser session',
        documentation:
            'https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage',
        support: 'Web ✅ | Android ✅ | iOS ✅',
    },
    {
        name: 'document.cookie',
        description: 'HTTP cookies for storing small pieces of data',
        documentation:
            'https://developer.mozilla.org/en-US/docs/Web/API/Document/cookie',
        support: 'Web ✅ | Android ✅ | iOS ✅',
    },
]

export default function StorageAPIDemo() {
    const [copied, setCopied] = useState('')

    // No complex example needed - just reference standard APIs

    const handleCopy = async (text, type) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(type)
            setTimeout(() => setCopied(''), 2000)
        } catch (err) {
            setCopied('error')
        }
    }

    const StorageAPIsTable = () => (
        <div className={styles.propsTable}>
            <table>
                <thead>
                    <tr>
                        <th>Storage API</th>
                        <th>Description</th>
                        <th>Platform Support</th>
                        <th>Documentation</th>
                    </tr>
                </thead>
                <tbody>
                    {storageAPIs.map((api, index) => (
                        <tr key={index}>
                            <td>
                                <span className={styles.propName}>
                                    {api.name}
                                </span>
                            </td>
                            <td className={styles.propDescription}>
                                {api.description}
                            </td>
                            <td>
                                <code className={styles.propType}>
                                    {api.support}
                                </code>
                            </td>
                            <td>
                                <a
                                    href={api.documentation}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        color: 'var(--ifm-color-primary)',
                                        textDecoration: 'none',
                                    }}
                                >
                                    📖 MDN Docs
                                </a>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )

    return (
        <div className={styles.storageAPIDemo}>
            <h2>Storage APIs</h2>
            <p>
                Standard web storage APIs for client-side data persistence in
                Catalyst Core universal apps.
            </p>

            {/* Upcoming Feature Banner */}
            <div className={styles.upcomingBanner}>
                <h4>🚧 Platform Support Status</h4>
                <p>
                    Storage APIs work on Web and Android platforms. iOS support
                    is currently in development.
                </p>
            </div>

            {/* Available Storage APIs */}
            <div className={styles.apiSection}>
                <h3>Available Storage APIs</h3>
                <p>
                    Standard web storage APIs with platform-specific
                    availability shown below.
                </p>
                <StorageAPIsTable />
            </div>

            <div className={styles.importantNotes}>
                <h4>Important Notes</h4>
                <ul>
                    <li>
                        <strong>Web Platform:</strong> All storage APIs work as
                        expected in web browsers
                    </li>
                    <li>
                        <strong>Android Platform:</strong> Full support for
                        localStorage, sessionStorage, and cookies
                    </li>
                    <li>
                        <strong>iOS Platform:</strong> Storage API support is
                        currently in development
                    </li>
                    <li>
                        <strong>Standard APIs:</strong> Use familiar
                        localStorage, sessionStorage, and cookie APIs
                    </li>
                    <li>
                        <strong>No Special Setup:</strong> These APIs work out
                        of the box on supported platforms
                    </li>
                    <li>
                        <strong>MDN Documentation:</strong> Follow standard MDN
                        documentation for implementation details
                    </li>
                </ul>
            </div>
        </div>
    )
}
