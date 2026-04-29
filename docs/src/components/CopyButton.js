import React, { useState } from 'react'
import styles from './CopyButton.module.css'

export default function CopyButton({ text, className = '' }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    return (
        <button
            className={`${styles.copyButton} ${className}`}
            onClick={handleCopy}
            aria-label="Copy to clipboard"
        >
            {copied ? (
                <>
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path
                            d="M13.5 4L6 11.5L2.5 8"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                    <span>Copied!</span>
                </>
            ) : (
                <>
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <rect
                            x="5"
                            y="5"
                            width="9"
                            height="9"
                            rx="1"
                            stroke="currentColor"
                            strokeWidth="1.5"
                        />
                        <path
                            d="M3 10.5V3C3 2.44772 3.44772 2 4 2H10.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                    </svg>
                    <span>Copy</span>
                </>
            )}
        </button>
    )
}
