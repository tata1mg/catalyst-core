import React from 'react'
import Highlight, { defaultProps } from 'prism-react-renderer'

const SyntaxHighlighter = ({ code, language = 'bash' }) => (
    <Highlight
        {...defaultProps}
        theme={{
            plain: {
                color: '#D4D4D4',
                backgroundColor: '#1E1E1E',
            },
            styles: [
                {
                    types: ['comment', 'prolog', 'doctype', 'cdata'],
                    style: {
                        color: '#6A9955',
                        fontStyle: 'italic',
                    },
                },
                {
                    types: ['string', 'attr-value'],
                    style: {
                        color: '#CE9178',
                    },
                },
                {
                    types: ['punctuation', 'operator'],
                    style: {
                        color: '#D4D4D4',
                    },
                },
                {
                    types: ['number', 'boolean', 'constant'],
                    style: {
                        color: '#B5CEA8',
                    },
                },
                {
                    types: ['keyword', 'atrule', 'attr-name'],
                    style: {
                        color: '#569CD6',
                    },
                },
                {
                    types: ['function'],
                    style: {
                        color: '#DCDCAA',
                    },
                },
                {
                    types: ['tag'],
                    style: {
                        color: '#569CD6',
                    },
                },
                {
                    types: ['class-name'],
                    style: {
                        color: '#4EC9B0',
                    },
                },
                {
                    types: ['variable'],
                    style: {
                        color: '#9CDCFE',
                    },
                },
                {
                    types: ['property'],
                    style: {
                        color: '#92C5F7',
                    },
                },
            ],
        }}
        code={code}
        language={language}
    >
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
                className={className}
                style={{
                    ...style,
                    backgroundColor: '#1E1E1E',
                    color: '#D4D4D4',
                    padding: '1.5rem',
                    margin: 0,
                    overflow: 'auto',
                    fontFamily:
                        'var(--catalyst-code-font-family, "Monaco", "Menlo", "Ubuntu Mono", monospace)',
                    fontSize: 'var(--catalyst-code-font-size, 0.9rem)',
                    lineHeight: 'var(--catalyst-code-line-height, 1.4)',
                    border: '1px solid #3C3C3C',
                    borderRadius: '6px',
                }}
            >
                {tokens.map((line, i) => (
                    <div {...getLineProps({ line, key: i })} key={i}>
                        <span
                            style={{
                                display: 'inline-block',
                                width: '2.5em',
                                userSelect: 'none',
                                opacity: 0.5,
                                textAlign: 'right',
                                marginRight: '1em',
                                fontSize: '0.9em',
                                color: '#858585',
                            }}
                        >
                            {i + 1}
                        </span>
                        {line.map((token, key) => (
                            <span
                                {...getTokenProps({ token, key })}
                                key={key}
                            />
                        ))}
                    </div>
                ))}
            </pre>
        )}
    </Highlight>
)

export default SyntaxHighlighter
