import React, { useState } from "react"

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
            {children || (copied ? "✓ Copied!" : "📋 Copy")}
        </button>
    )
}

export default CopyButton
