import React, { useState } from 'react'
import { Checkbox, Collapse, Button } from 'antd'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'
import clsx from 'clsx'
import styles from './styles.module.css'
import SyntaxHighlighter from './SyntaxHighlighter'
import { canCompleteStep } from './utils'

const { Panel } = Collapse

const ChecklistStep = ({
    step,
    stepState,
    onStepChange,
    allSteps,
    allStepStates,
    stepNumber,
}) => {
    const [copied, setCopied] = useState('')
    const [activeKey, setActiveKey] = useState([])

    const isCompleted = stepState === 'completed'
    const canComplete = canCompleteStep(step.id, allSteps, allStepStates)
    const isDependencyBlocked = !canComplete && !isCompleted

    const handleCheckboxChange = (e) => {
        const newState = e.target.checked ? 'completed' : 'pending'
        onStepChange(step.id, newState)
    }

    const handleCopy = async (text, type) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(type)
            setTimeout(() => setCopied(''), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    const handlePanelChange = (key) => {
        setActiveKey(key)
    }

    const getDependencyText = () => {
        if (!step.dependencies || step.dependencies.length === 0) return null

        const dependencySteps = step.dependencies.map(
            (depId) => allSteps.find((s) => s.id === depId)?.title || depId
        )

        return `Requires: ${dependencySteps.join(', ')}`
    }

    const renderCodeSnippet = (code, label = 'code', language = 'bash') => {
        // Split commands by newlines and filter out comments and empty lines
        const lines = code.split('\n')
        const commands = lines.filter(
            (line) => line.trim() && !line.trim().startsWith('#')
        )

        // If there are multiple commands, show them separately
        if (commands.length > 1 && language === 'bash') {
            return (
                <div className={styles.commandsList}>
                    <div className={styles.commandsHeader}>
                        <h6>Commands to run:</h6>
                    </div>
                    {commands.map((cmd, index) => (
                        <div key={index} className={styles.individualCommand}>
                            <div className={styles.commandDescription}>
                                Step {index + 1}: {cmd.trim()}
                            </div>
                            <div className={styles.codeSnippet}>
                                <SyntaxHighlighter
                                    code={cmd.trim()}
                                    language={language}
                                />
                                <Button
                                    size="small"
                                    icon={
                                        copied === `${label}-${index}` ? (
                                            <CheckOutlined />
                                        ) : (
                                            <CopyOutlined />
                                        )
                                    }
                                    onClick={() =>
                                        handleCopy(
                                            cmd.trim(),
                                            `${label}-${index}`
                                        )
                                    }
                                    className={styles.copyButton}
                                >
                                    {copied === `${label}-${index}`
                                        ? 'Copied!'
                                        : 'Copy'}
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )
        }

        // Single command or non-bash code
        return (
            <div className={styles.codeSnippet}>
                <SyntaxHighlighter code={code} language={language} />
                <Button
                    size="small"
                    icon={
                        copied === label ? <CheckOutlined /> : <CopyOutlined />
                    }
                    onClick={() => handleCopy(code, label)}
                    className={styles.copyButton}
                >
                    {copied === label ? 'Copied!' : 'Copy'}
                </Button>
            </div>
        )
    }

    const renderStepContent = () => (
        <div className={styles.stepContent}>
            <div className={styles.stepDescription}>{step.content}</div>

            {step.codeSnippet && (
                <div className={styles.codeSection}>
                    <h5>Command:</h5>
                    {renderCodeSnippet(step.codeSnippet)}
                </div>
            )}

            {step.configExample && (
                <div className={styles.codeSection}>
                    <h5>Configuration:</h5>
                    {renderCodeSnippet(step.configExample, 'config', 'json')}
                </div>
            )}

            {step.links && step.links.length > 0 && (
                <div className={styles.linksSection}>
                    <h5>Related Links:</h5>
                    <ul className={styles.linksList}>
                        {step.links.map((link, index) => (
                            <li key={index}>
                                <a
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.stepLink}
                                >
                                    {link.text} →
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {step.substeps && step.substeps.length > 0 && (
                <div className={styles.substepsSection}>
                    <h5>Sub-steps:</h5>
                    <ul className={styles.substepsList}>
                        {step.substeps.map((substep, index) => (
                            <li key={index} className={styles.substepItem}>
                                {substep}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {step.estimatedTime && (
                <div className={styles.timeEstimate}>
                    ⏱️ Estimated time: {step.estimatedTime}
                </div>
            )}
        </div>
    )

    return (
        <div
            className={clsx(styles.checklistStep, {
                [styles.completed]: isCompleted,
                [styles.blocked]: isDependencyBlocked,
            })}
        >
            <div className={styles.stepHeader}>
                <div className={styles.stepCheckbox}>
                    <Checkbox
                        checked={isCompleted}
                        onChange={handleCheckboxChange}
                        disabled={isDependencyBlocked}
                        className={styles.checkbox}
                    />
                    <span className={styles.stepNumber}>{stepNumber}</span>
                </div>

                <div className={styles.stepTitleSection}>
                    <h4
                        className={clsx(styles.stepTitle, {
                            [styles.strikethrough]: isCompleted,
                        })}
                    >
                        {step.title}
                    </h4>

                    {step.description && (
                        <p className={styles.stepSummary}>{step.description}</p>
                    )}

                    {isDependencyBlocked && (
                        <div className={styles.dependencyWarning}>
                            🔒 {getDependencyText()}
                        </div>
                    )}
                </div>
            </div>

            <Collapse
                ghost
                activeKey={activeKey}
                onChange={handlePanelChange}
                className={styles.stepCollapse}
            >
                <Panel
                    header="View Details"
                    key="details"
                    className={styles.stepPanel}
                    showArrow={true}
                >
                    {renderStepContent()}
                </Panel>
            </Collapse>
        </div>
    )
}

export default ChecklistStep
