import React, { useState } from 'react'
import ChecklistToggle from './ChecklistToggle'
import ProgressBar from './ProgressBar'
import ChecklistStep from './ChecklistStep'
import styles from './styles.module.css'
import { calculateProgress, updateStepWithDependencies } from './utils'

const SetupChecklist = ({ config, children }) => {
    const [viewMode, setViewMode] = useState('documentation')

    // Initialize all steps as 'pending'
    const initializeSteps = () => {
        const initialStates = {}
        config.steps.forEach((step) => {
            initialStates[step.id] = 'pending'
        })
        return initialStates
    }

    const [stepStates, setStepStates] = useState(initializeSteps)

    const handleViewModeToggle = (isInteractive) => {
        const newMode = isInteractive ? 'interactive' : 'documentation'
        setViewMode(newMode)
    }

    const handleStepChange = (stepId, newState) => {
        console.log(`Changing step ${stepId} to ${newState}`)
        setStepStates((prev) => {
            const updated = updateStepWithDependencies(
                stepId,
                newState,
                config.steps,
                prev
            )
            console.log('Updated states:', updated)
            return updated
        })
    }

    const progress = calculateProgress(config.steps, stepStates)

    return (
        <div className={styles.setupChecklist}>
            <ChecklistToggle
                viewMode={viewMode}
                onToggle={handleViewModeToggle}
            />

            {viewMode === 'interactive' ? (
                <div className={styles.interactiveView}>
                    <div className={styles.checklistHeader}>
                        <h2>{config.title}</h2>
                        <p>{config.description}</p>
                    </div>

                    <ProgressBar progress={progress} />

                    <div className={styles.checklistSteps}>
                        {config.steps.map((step, index) => (
                            <ChecklistStep
                                key={step.id}
                                step={step}
                                stepState={stepStates[step.id] || 'pending'}
                                onStepChange={handleStepChange}
                                allSteps={config.steps}
                                allStepStates={stepStates}
                                stepNumber={index + 1}
                            />
                        ))}
                    </div>
                </div>
            ) : (
                <div className={styles.documentationView}>
                    <div className={styles.documentationContent}>
                        {children}
                    </div>
                </div>
            )}
        </div>
    )
}

export default SetupChecklist
