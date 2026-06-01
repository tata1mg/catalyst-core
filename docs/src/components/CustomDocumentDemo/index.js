/**
 * CustomDocumentDemo - Docusaurus-optimized interactive demo for custom document features in Catalyst
 */
import React, { useState } from 'react'
import clsx from 'clsx'
import styles from './styles.module.css'

const featureList = [
    {
        key: 'metaTags',
        label: 'Meta Tags',
        desc: 'Add SEO-friendly meta tags for better search engine optimization and social media sharing.',
    },
    {
        key: 'googleFonts',
        label: 'Google Fonts',
        desc: 'Include Google Fonts for better typography and design consistency across browsers.',
    },
    {
        key: 'thirdPartyScripts',
        label: 'Third-party Scripts',
        desc: 'Add analytics, tracking, or other third-party scripts that need to load before your app.',
    },
    {
        key: 'customStyles',
        label: 'Custom Styles',
        desc: 'Include global CSS or critical styles that should be loaded before the main application.',
    },
]

export default function CustomDocumentDemo() {
    const [selectedFeatures, setSelectedFeatures] = useState({
        metaTags: true,
        thirdPartyScripts: false,
        customStyles: false,
        googleFonts: false,
    })
    const [copied, setCopied] = useState('')

    const toggleFeature = (feature) => {
        setSelectedFeatures((prev) => ({ ...prev, [feature]: !prev[feature] }))
    }

    const generateDocumentCode = () => {
        let code = `import { Head, Body } from "catalyst"

function Document(props) {
    return (
        <html lang="en">
`
        if (selectedFeatures.metaTags) {
            code += `            <Head {...props}>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <meta name="description" content="Catalyst Demo Application" />
                <meta name="keywords" content="catalyst, react, ssr" />
`
        }
        if (selectedFeatures.googleFonts) {
            code += `                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
                <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet" />
`
        }
        if (selectedFeatures.customStyles) {
            code += `                <link rel="stylesheet" href="/static/css/custom.css" />
`
        }
        if (selectedFeatures.thirdPartyScripts) {
            code +=
                `                <script dangerouslySetInnerHTML={{ __html: ` +
                "`console.log('Third-party script loaded');\\nwindow.analytics = { track: (event) => console.log('Track:', event) };`" +
                ` }} />
`
        }
        if (
            selectedFeatures.metaTags ||
            selectedFeatures.googleFonts ||
            selectedFeatures.thirdPartyScripts ||
            selectedFeatures.customStyles
        ) {
            code += `            </Head>\n`
        } else {
            code += `            <Head {...props} />\n`
        }
        code += `            <Body {...props} />\n        </html>\n    )\n}\n\nexport default Document`
        return code
    }

    const generateHTMLOutput = () => {
        let html = `<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n`
        if (selectedFeatures.metaTags) {
            html += `    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <meta name=\"description\" content=\"Catalyst Demo Application\">\n    <meta name=\"keywords\" content=\"catalyst, react, ssr\">\n`
        }
        if (selectedFeatures.googleFonts) {
            html += `    <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n    <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin=\"\">\n    <link href=\"https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap\" rel=\"stylesheet\">\n`
        }
        if (selectedFeatures.customStyles) {
            html += `    <link rel=\"stylesheet\" href=\"/static/css/custom.css\">\n`
        }
        if (selectedFeatures.thirdPartyScripts) {
            html += `    <script>\n      console.log('Third-party script loaded');\n      window.analytics = { track: (event) => console.log('Track:', event) };\n    </script>\n`
        }
        html += `</head>\n<body>\n    <!-- Your app content here -->\n</body>\n</html>`
        return html
    }

    const handleCopy = async (text, type) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(type)
            setTimeout(() => setCopied(''), 2000)
        } catch (err) {
            setCopied('error')
        }
    }

    return (
        <div className="demoContainer">
            <h2>Custom Document Demo</h2>
            <p>
                This demo shows how to create a custom document in Catalyst with
                various features.
            </p>

            <div className={styles.importantNotes}>
                <h3>Important Notes</h3>
                <ul>
                    <li>
                        <strong>Head and Body tags are required</strong> - The
                        application won&apos;t work without them
                    </li>
                    <li>
                        <strong>Props must be passed</strong> - They are used
                        internally by Head and Body components
                    </li>
                    <li>
                        <strong>Server-side rendering</strong> - The document is
                        always rendered on the server
                    </li>
                    <li>
                        <strong>Custom content</strong> - Add custom tags
                        between Head and Body components
                    </li>
                </ul>
            </div>

            <div className={styles.featureSelector}>
                <h3>Document Features</h3>
                <div className={styles.featureGrid}>
                    {featureList.map((f) => (
                        <label className={styles.featureItem} key={f.key}>
                            <input
                                type="checkbox"
                                checked={selectedFeatures[f.key]}
                                onChange={() => toggleFeature(f.key)}
                            />
                            <span>{f.label}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div className={styles.codeSection}>
                <h3>Generated Document Code</h3>
                <div className={styles.codeCard}>
                    <div className={styles.codeHeader}>
                        <span>server/document.js</span>
                        <button
                            onClick={() =>
                                handleCopy(generateDocumentCode(), 'doc')
                            }
                            className={clsx(styles.copyButton, {
                                [styles.copied]: copied === 'doc',
                            })}
                        >
                            {copied === 'doc' ? '✓ Copied!' : '📋 Copy'}
                        </button>
                    </div>
                    <pre>{generateDocumentCode()}</pre>
                </div>
            </div>

            <div className={styles.htmlSection}>
                <h3>Generated HTML Output</h3>
                <div className={styles.htmlCard}>
                    <div className={styles.codeHeader}>
                        <span>HTML Output</span>
                        <button
                            onClick={() =>
                                handleCopy(generateHTMLOutput(), 'html')
                            }
                            className={clsx(styles.copyButton, {
                                [styles.copied]: copied === 'html',
                            })}
                        >
                            {copied === 'html' ? '✓ Copied!' : '📋 Copy'}
                        </button>
                    </div>
                    <pre>{generateHTMLOutput()}</pre>
                </div>
            </div>
        </div>
    )
}
