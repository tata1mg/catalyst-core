import React, { useState } from "react"

const IconCopy = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <rect x="9" y="9" width="12" height="12" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
)

const IconCheck = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <path d="m4 12.5 5.5 5.5L20 6.5" />
    </svg>
)

const CopyButton = ({ text, className = "", children }) => {
    const [copied, setCopied] = useState(false)

    const copy = () => {
        navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }

    return (
        <button
            type="button"
            className={`copy-button ${className} ${copied ? "copied" : ""}`}
            title="Copy to clipboard"
            onClick={copy}
        >
            {children ||
                (copied ? (
                    <>
                        <IconCheck /> Copied!
                    </>
                ) : (
                    <>
                        <IconCopy /> Copy
                    </>
                ))}
        </button>
    )
}

export default CopyButton
