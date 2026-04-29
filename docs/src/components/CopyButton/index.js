import React, { useState } from 'react'
import clsx from 'clsx'

const CopyButton = ({ text, className, children }) => {
    const [copied, setCopied] = useState(false)

    const copyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy: ', err)
        }
    }

    return (
        <button
            onClick={copyToClipboard}
            className={clsx('copy-button', className, { copied })}
            title="Copy to clipboard"
        >
            {children || (copied ? '✓ Copied!' : '📋 Copy')}
        </button>
    )
}

export default CopyButton
