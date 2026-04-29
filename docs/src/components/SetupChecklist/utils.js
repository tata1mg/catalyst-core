// Utility functions for checklist management

export const calculateProgress = (steps, stepStates) => {
    const totalSteps = steps.length
    const completedSteps = steps.filter(
        (step) => stepStates[step.id] === 'completed'
    ).length
    const percentage =
        totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0

    return {
        total: totalSteps,
        completed: completedSteps,
        remaining: totalSteps - completedSteps,
        percentage,
    }
}

export const canCompleteStep = (stepId, steps, stepStates) => {
    const step = steps.find((s) => s.id === stepId)

    // If step has no dependencies, it can always be completed
    if (!step || !step.dependencies || step.dependencies.length === 0) {
        return true
    }

    // Check if all dependencies are completed
    const canComplete = step.dependencies.every((depId) => {
        const depState = stepStates[depId]
        const isCompleted = depState === 'completed'
        console.log(
            `Checking dependency ${depId} for step ${stepId}: ${depState} -> ${isCompleted}`
        )
        return isCompleted
    })

    console.log(`Can complete step ${stepId}:`, canComplete)
    return canComplete
}

export const getDependentSteps = (stepId, steps) => {
    // Find all steps that depend on this stepId
    return steps
        .filter(
            (step) => step.dependencies && step.dependencies.includes(stepId)
        )
        .map((step) => step.id)
}

export const updateStepWithDependencies = (
    stepId,
    newState,
    steps,
    currentStepStates
) => {
    const updatedStates = { ...currentStepStates }

    // Update the current step
    updatedStates[stepId] = newState

    // If unchecking a step, recursively uncheck all dependent steps
    if (newState === 'pending') {
        const uncheckDependents = (stepToUncheck) => {
            const dependentSteps = getDependentSteps(stepToUncheck, steps)
            console.log(
                `Unchecking dependents of ${stepToUncheck}:`,
                dependentSteps
            )

            dependentSteps.forEach((depStepId) => {
                if (updatedStates[depStepId] === 'completed') {
                    console.log(`Unchecking dependent step: ${depStepId}`)
                    updatedStates[depStepId] = 'pending'
                    // Recursively uncheck this step's dependents
                    uncheckDependents(depStepId)
                }
            })
        }

        uncheckDependents(stepId)
    }

    return updatedStates
}
