import React, { useState } from 'react'
import clsx from 'clsx'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import { useColorMode } from '@docusaurus/theme-common'
import CopyButton from '../CopyButton'
import '../CopyButton/styles.css'

const AssetsDemo = () => {
    const { colorMode } = useColorMode()

    const folderStructure = `static/
├── css/
│   ├── custom.css
│   └── fonts.css
├── images/
│   ├── logo.png
│   ├── hero-bg.jpg
│   └── icon.svg
├── fonts/
│   ├── Inter-Regular.woff2
│   ├── Inter-Bold.woff2
│   └── Roboto-Regular.woff2
└── documents/
    ├── manual.pdf
    └── data.json`

    const cssExample = `/* static/css/fonts.css */
@font-face {
  font-family: 'Inter';
  src: url('../fonts/Inter-Regular.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: 'Inter';
  src: url('../fonts/Inter-Bold.woff2') format('woff2');
  font-weight: 600;
  font-display: swap;
}

@font-face {
  font-family: 'Roboto';
  src: url('../fonts/Roboto-Regular.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}`

    const usageExample = `// In your component
import logo from '/assets/images/logo.png';
import customFont from '/assets/css/fonts.css';

function MyComponent() {
  return (
    <div style={{ fontFamily: 'Inter, sans-serif' }}>
      <img src={logo} alt="Logo" />
      <h1>Styled with custom font</h1>
    </div>
  );
}`

    return (
        <div className="demoContainer">
            <div className="demo-section">
                <h3>Folder Structure</h3>
                <p>Organize your static assets in the static directory</p>

                <div className="code-block">
                    <div className="code-header">
                        <span>Folder Structure</span>
                        <CopyButton text={folderStructure} />
                    </div>
                    <pre>
                        <code>{folderStructure}</code>
                    </pre>
                </div>
            </div>

            <div className="demo-section">
                <h3>CSS Font Loading</h3>
                <p>Define custom fonts with optimal loading strategies</p>

                <div className="code-block">
                    <div className="code-header">
                        <span>static/css/fonts.css</span>
                        <CopyButton text={cssExample} />
                    </div>
                    <pre>
                        <code>{cssExample}</code>
                    </pre>
                </div>
            </div>

            <div className="demo-section">
                <h3>Usage in Components</h3>
                <p>Import and use static assets in your React components</p>

                <div className="code-block">
                    <div className="code-header">
                        <span>Component Example</span>
                        <CopyButton text={usageExample} />
                    </div>
                    <pre>
                        <code>{usageExample}</code>
                    </pre>
                </div>
            </div>
        </div>
    )
}

export default AssetsDemo
