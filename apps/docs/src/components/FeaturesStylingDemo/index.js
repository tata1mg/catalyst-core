import React, { useState } from 'react'
import clsx from 'clsx'
import styles from './styles.module.css'

const FeaturesStylingDemo = () => {
    const [theme, setTheme] = useState('light')
    const [fontSize, setFontSize] = useState('medium')
    const [copiedCode, setCopiedCode] = useState('')

    // Copy to clipboard function
    const copyToClipboard = async (text, codeType) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopiedCode(codeType)
            setTimeout(() => setCopiedCode(''), 2000)
        } catch (err) {
            console.error('Failed to copy: ', err)
        }
    }

    // Code examples
    const scssVariablesCode = `// src/static/css/resources/_variables.scss
$primary-color: #007bff;
$secondary-color: #6c757d;
$success-color: #28a745;
$danger-color: #dc3545;

$font-family-base: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
$font-size-base: 1rem;
$line-height-base: 1.5;

$border-radius: 4px;
$border-radius-lg: 8px;
$border-radius-sm: 2px;

$spacing-unit: 1rem;
$container-max-width: 1200px;`

    const cssModulesCode = `// Component.module.scss
.container {
  padding: $spacing-unit;
  border-radius: $border-radius;
  background: var(--ifm-background-color);
  border: 1px solid var(--ifm-color-emphasis-300);
}

.button {
  @include button-mixin;
  
  &.primary {
    background: $primary-color;
    color: white;
    
    &:hover {
      background: darken($primary-color, 10%);
    }
  }
  
  &.secondary {
    background: $secondary-color;
    color: white;
  }
}

// Responsive design
@media (max-width: 768px) {
  .container {
    padding: $spacing-unit * 0.5;
  }
}`

    const mixinsCode = `// src/static/css/resources/_mixins.scss
@mixin button-mixin {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: $border-radius;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s ease;
  font-weight: 500;
  
  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
}

@mixin responsive-grid($columns: 3, $gap: 1rem) {
  display: grid;
  grid-template-columns: repeat($columns, 1fr);
  gap: $gap;
  
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
}

@mixin theme-aware {
  background: var(--ifm-background-color);
  color: var(--ifm-font-color-base);
  border-color: var(--ifm-color-emphasis-300);
}`

    return (
        <div className={styles.featuresStylingDemo}>
            <div className={styles.demoContent}>
                <h2>Advanced Styling Features</h2>
                <p>
                    This example demonstrates Catalyst's advanced styling
                    capabilities including SCSS, CSS modules, dynamic theming,
                    and responsive design patterns.
                </p>

                <div className={styles.benefits}>
                    <h3>Styling Benefits</h3>
                    <div className={styles.benefitsGrid}>
                        <div className={styles.benefit}>
                            <h4>🎨 SCSS Power</h4>
                            <p>
                                Variables, mixins, nesting, and advanced CSS
                                features
                            </p>
                        </div>
                        <div className={styles.benefit}>
                            <h4>📱 Responsive Design</h4>
                            <p>Mobile-first approach with flexible layouts</p>
                        </div>
                        <div className={styles.benefit}>
                            <h4>🌙 Theme Support</h4>
                            <p>Light/dark mode with CSS custom properties</p>
                        </div>
                    </div>
                </div>

                <div className={styles.stylingExamples}>
                    <div className={styles.stylingExample}>
                        <h3>Dynamic Theming</h3>
                        <p>
                            Switch between light and dark themes with CSS custom
                            properties
                        </p>

                        <div className={`${styles.themeDemo} ${styles[theme]}`}>
                            <div className={styles.themeControls}>
                                <button
                                    className={
                                        theme === 'light' ? styles.active : ''
                                    }
                                    onClick={() => setTheme('light')}
                                >
                                    ☀️ Light Theme
                                </button>
                                <button
                                    className={
                                        theme === 'dark' ? styles.active : ''
                                    }
                                    onClick={() => setTheme('dark')}
                                >
                                    🌙 Dark Theme
                                </button>
                            </div>

                            <div className={styles.themePreview}>
                                <div className={styles.previewHeader}>
                                    <h4>Theme Preview</h4>
                                    <p>
                                        Current theme: <strong>{theme}</strong>
                                    </p>
                                </div>
                                <div className={styles.previewContent}>
                                    <div className={styles.card}>
                                        <h5>Sample Card</h5>
                                        <p>
                                            This card adapts to the selected
                                            theme using CSS custom properties.
                                        </p>
                                        <button className={styles.btnPrimary}>
                                            Primary Button
                                        </button>
                                        <button className={styles.btnSecondary}>
                                            Secondary Button
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={styles.stylingExample}>
                        <h3>Responsive Design</h3>
                        <p>
                            Responsive layout that adapts to different screen
                            sizes
                        </p>

                        <div className={styles.responsiveDemo}>
                            <div className={styles.screenSizes}>
                                <div
                                    className={`${styles.screenSize} ${styles.mobile}`}
                                >
                                    <span className={styles.label}>
                                        📱 Mobile
                                    </span>
                                    <div className={styles.screenPreview}>
                                        <div className={styles.mobileContent}>
                                            <div
                                                className={styles.mobileHeader}
                                            >
                                                Header
                                            </div>
                                            <div className={styles.mobileBody}>
                                                Content
                                            </div>
                                            <div
                                                className={styles.mobileFooter}
                                            >
                                                Footer
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div
                                    className={`${styles.screenSize} ${styles.tablet}`}
                                >
                                    <span className={styles.label}>
                                        📱 Tablet
                                    </span>
                                    <div className={styles.screenPreview}>
                                        <div className={styles.tabletContent}>
                                            <div
                                                className={styles.tabletSidebar}
                                            >
                                                Sidebar
                                            </div>
                                            <div className={styles.tabletMain}>
                                                Main Content
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div
                                    className={`${styles.screenSize} ${styles.desktop}`}
                                >
                                    <span className={styles.label}>
                                        💻 Desktop
                                    </span>
                                    <div className={styles.screenPreview}>
                                        <div className={styles.desktopContent}>
                                            <div
                                                className={styles.desktopHeader}
                                            >
                                                Header
                                            </div>
                                            <div className={styles.desktopBody}>
                                                <div
                                                    className={
                                                        styles.desktopSidebar
                                                    }
                                                >
                                                    Sidebar
                                                </div>
                                                <div
                                                    className={
                                                        styles.desktopMain
                                                    }
                                                >
                                                    Main Content
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={styles.stylingExample}>
                        <h3>SCSS Features & CSS Modules</h3>
                        <p>
                            Component-scoped styles with SCSS variables, mixins,
                            and nesting
                        </p>

                        <div className={styles.scssDemo}>
                            <div className={styles.scssFeatures}>
                                <div className={styles.featureItem}>
                                    <h4>🎨 Variables</h4>
                                    <div className={styles.colorPalette}>
                                        <div
                                            className={`${styles.colorSwatch} ${styles.primary}`}
                                            title="Primary"
                                        ></div>
                                        <div
                                            className={`${styles.colorSwatch} ${styles.secondary}`}
                                            title="Secondary"
                                        ></div>
                                        <div
                                            className={`${styles.colorSwatch} ${styles.success}`}
                                            title="Success"
                                        ></div>
                                        <div
                                            className={`${styles.colorSwatch} ${styles.danger}`}
                                            title="Danger"
                                        ></div>
                                    </div>
                                    <p>
                                        Centralized color and spacing variables
                                    </p>
                                </div>

                                <div className={styles.featureItem}>
                                    <h4>🔧 Mixins</h4>
                                    <div className={styles.mixinExamples}>
                                        <button
                                            className={`${styles.btnMixin} ${styles.btnPrimary}`}
                                        >
                                            Primary
                                        </button>
                                        <button
                                            className={`${styles.btnMixin} ${styles.btnSecondary}`}
                                        >
                                            Secondary
                                        </button>
                                        <button
                                            className={`${styles.btnMixin} ${styles.btnOutline}`}
                                        >
                                            Outline
                                        </button>
                                    </div>
                                    <p>Reusable style patterns and functions</p>
                                </div>

                                <div className={styles.featureItem}>
                                    <h4>📦 Nesting</h4>
                                    <div className={styles.nestedStructure}>
                                        <div className={styles.parent}>
                                            <div className={styles.child}>
                                                <div
                                                    className={
                                                        styles.grandchild
                                                    }
                                                >
                                                    Nested Elements
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <p>Logical CSS structure with nesting</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.codeExample}>
                    <h3>Code Examples</h3>
                    <div className={styles.codeBlock}>
                        <div className={styles.codeHeader}>
                            <h4>
                                SCSS Variables
                                (src/static/css/resources/_variables.scss)
                            </h4>
                            <button
                                onClick={() =>
                                    copyToClipboard(
                                        scssVariablesCode,
                                        'variables'
                                    )
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copiedCode === 'variables',
                                })}
                            >
                                {copiedCode === 'variables'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <pre>{scssVariablesCode}</pre>
                    </div>

                    <div className={styles.codeBlock}>
                        <div className={styles.codeHeader}>
                            <h4>
                                CSS Modules with SCSS (Component.module.scss)
                            </h4>
                            <button
                                onClick={() =>
                                    copyToClipboard(cssModulesCode, 'modules')
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copiedCode === 'modules',
                                })}
                            >
                                {copiedCode === 'modules'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <pre>{cssModulesCode}</pre>
                    </div>

                    <div className={styles.codeBlock}>
                        <div className={styles.codeHeader}>
                            <h4>
                                SCSS Mixins
                                (src/static/css/resources/_mixins.scss)
                            </h4>
                            <button
                                onClick={() =>
                                    copyToClipboard(mixinsCode, 'mixins')
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copiedCode === 'mixins',
                                })}
                            >
                                {copiedCode === 'mixins'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <pre>{mixinsCode}</pre>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default FeaturesStylingDemo
