import React, { useState } from "react"
import { Highlight } from "prism-react-renderer"

/**
 * Fenced code block renderer. Tokens are emitted with classNames only — the
 * palette (github light / dracula dark, matching the Docusaurus site) lives in
 * hub.scss under [data-theme] scopes. Inline theme styles would bake one
 * theme's colors into the SSR HTML and flash on hydration for users of the
 * other theme.
 */
const EMPTY_THEME = { plain: {}, styles: [] }

const CodeBlock = ({ children, className = "" }) => {
    const [copied, setCopied] = useState(false)

    const language = (className.match(/language-([\w-]+)/) || [])[1] || "text"
    const code = typeof children === "string" ? children.trimEnd() : ""

    const copy = () => {
        navigator.clipboard?.writeText(code).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
        })
    }

    return (
        <div className="doc-codeblock">
            <button className="doc-codeblock-copy" onClick={copy} type="button">
                {copied ? "Copied" : "Copy"}
            </button>
            <Highlight code={code} language={language} theme={EMPTY_THEME}>
                {({ tokens, getLineProps, getTokenProps }) => (
                    <pre>
                        {tokens.map((line, i) => (
                            <div key={i} {...getLineProps({ line })} style={undefined}>
                                {line.map((token, key) => (
                                    <span key={key} {...getTokenProps({ token })} style={undefined} />
                                ))}
                            </div>
                        ))}
                    </pre>
                )}
            </Highlight>
        </div>
    )
}

export default CodeBlock
