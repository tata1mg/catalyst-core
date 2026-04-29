import React, { useState } from 'react'
import clsx from 'clsx'
import Highlight, { defaultProps } from 'prism-react-renderer'
import styles from './styles.module.css'

const presetColors = [
    { name: 'White', value: '#ffffff' },
    { name: 'Black', value: '#000000' },
    { name: 'Blue', value: '#2196F3' },
    { name: 'Dark Blue', value: '#1976D2' },
    { name: 'Green', value: '#4CAF50' },
    { name: 'Purple', value: '#9C27B0' },
    { name: 'Orange', value: '#FF9800' },
    { name: 'Red', value: '#F44336' },
    { name: 'Dark Gray', value: '#424242' },
    { name: 'Light Gray', value: '#E0E0E0' },
]

export default function SplashscreenDemo() {
    const [duration, setDuration] = useState(1000)
    const [backgroundColor, setBackgroundColor] = useState('#ffffff')
    const [customColor, setCustomColor] = useState('')
    const [useCustomIcon, setUseCustomIcon] = useState(false)
    const [copied, setCopied] = useState('')

    const generateConfig = () => {
        return {
            splashScreen: {
                duration: duration,
                backgroundColor: backgroundColor,
            },
        }
    }

    const copyToClipboard = async (text, key) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(key)
            setTimeout(() => setCopied(''), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    const handleColorPreset = (color) => {
        setBackgroundColor(color)
        setCustomColor('')
    }

    const handleCustomColor = (color) => {
        if (color && color.match(/^#[0-9A-F]{6}$/i)) {
            setBackgroundColor(color)
        }
    }

    const configCode = JSON.stringify(generateConfig(), null, 2)

    return (
        <div className={styles.splashscreenDemo}>
            {/* Configuration Section */}
            <div className={styles.configSection}>
                <h3>⚙️ Configuration</h3>

                {/* Duration Control */}
                <div className={styles.controlGroup}>
                    <label className={styles.controlLabel}>
                        <span>Duration (ms)</span>
                        <div className={styles.durationControl}>
                            <input
                                type="range"
                                min="500"
                                max="5000"
                                step="100"
                                value={duration}
                                onChange={(e) =>
                                    setDuration(parseInt(e.target.value))
                                }
                                className={styles.durationSlider}
                            />
                            <input
                                type="number"
                                min="500"
                                max="5000"
                                value={duration}
                                onChange={(e) =>
                                    setDuration(
                                        parseInt(e.target.value) || 1000
                                    )
                                }
                                className={styles.durationInput}
                            />
                            <span className={styles.durationLabel}>
                                {duration}ms
                            </span>
                        </div>
                    </label>
                </div>

                {/* Background Color Control */}
                <div className={styles.controlGroup}>
                    <label className={styles.controlLabel}>
                        <span>Background Color</span>
                        <div className={styles.colorControl}>
                            <div className={styles.colorPresets}>
                                {presetColors.map((color) => (
                                    <button
                                        key={color.value}
                                        className={clsx(styles.colorPreset, {
                                            [styles.active]:
                                                backgroundColor === color.value,
                                        })}
                                        style={{ backgroundColor: color.value }}
                                        onClick={() =>
                                            handleColorPreset(color.value)
                                        }
                                        title={color.name}
                                        aria-label={color.name}
                                    />
                                ))}
                            </div>
                            <div className={styles.customColorInput}>
                                <input
                                    type="text"
                                    value={customColor}
                                    onChange={(e) =>
                                        setCustomColor(e.target.value)
                                    }
                                    onBlur={(e) =>
                                        handleCustomColor(e.target.value)
                                    }
                                    onKeyPress={(e) =>
                                        e.key === 'Enter' &&
                                        handleCustomColor(e.target.value)
                                    }
                                    placeholder="Custom hex (e.g., #FF5722)"
                                    className={styles.colorInput}
                                />
                                <div
                                    className={styles.colorPreview}
                                    style={{ backgroundColor: backgroundColor }}
                                />
                            </div>
                        </div>
                    </label>
                </div>

                {/* Custom Icon Toggle */}
                <div className={styles.controlGroup}>
                    <label className={styles.controlLabel}>
                        <span>Custom Icon</span>
                        <div className={styles.iconControl}>
                            <label className={styles.toggleSwitch}>
                                <input
                                    type="checkbox"
                                    checked={useCustomIcon}
                                    onChange={(e) =>
                                        setUseCustomIcon(e.target.checked)
                                    }
                                />
                                <span className={styles.toggleSlider}></span>
                            </label>
                            <span className={styles.iconStatus}>
                                {useCustomIcon
                                    ? 'Custom icon (public/splashscreen.jpg)'
                                    : 'Catalyst logo (fallback)'}
                            </span>
                        </div>
                    </label>
                </div>
            </div>

            {/* Preview Section */}
            <div className={styles.previewSection}>
                <h3>📱 Preview</h3>
                <div className={styles.previewContainer}>
                    <div className={styles.phoneFrame}>
                        <div
                            className={styles.splashscreen}
                            style={{
                                backgroundColor: backgroundColor,
                            }}
                        >
                            <div className={styles.splashContent}>
                                {useCustomIcon ? (
                                    <div className={styles.customIcon}>
                                        <div className={styles.iconPlaceholder}>
                                            Custom Icon
                                        </div>
                                    </div>
                                ) : (
                                    <div className={styles.catalystLogo}>
                                        <img
                                            src="https://onemg.gumlet.io/staging/5066194c-4194-4070-9513-0c298ce01b50.png"
                                            alt="Catalyst Logo"
                                            className={styles.logoImage}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Generated Configuration */}
            <div className={styles.codeSection}>
                <div className={styles.codeCard}>
                    <div className={styles.codeHeader}>
                        <span>💻 Generated Configuration</span>
                        <button
                            className={clsx(styles.copyButton, {
                                [styles.copied]: copied === 'config',
                            })}
                            onClick={() =>
                                copyToClipboard(configCode, 'config')
                            }
                        >
                            {copied === 'config' ? '✓ Copied!' : '📋 Copy'}
                        </button>
                    </div>
                    <Highlight
                        {...defaultProps}
                        code={configCode}
                        language="json"
                    >
                        {({
                            className,
                            style,
                            tokens,
                            getLineProps,
                            getTokenProps,
                        }) => (
                            <pre className={className} style={style}>
                                {tokens.map((line, i) => (
                                    <div
                                        key={i}
                                        {...getLineProps({ line, key: i })}
                                    >
                                        {line.map((token, key) => (
                                            <span
                                                key={key}
                                                {...getTokenProps({
                                                    token,
                                                    key,
                                                })}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </pre>
                        )}
                    </Highlight>
                </div>
            </div>
        </div>
    )
}
