import React, { useEffect } from "react"
import { useSelector, useDispatch } from "react-redux"
import useViewTransitionNavigate from "@hooks/useViewTransitionNavigate"
import { Check, X } from "lucide-react"

import {
    setProgress,
    setCurrentStep,
    completeStep,
    cancelGeneration,
    resetGeneration,
} from "./reducer.js"
import css from "./Generating.scss"

const STEPS = [
    { id: "analyzing", label: "Analyzing attire" },
    { id: "selecting", label: "Selecting models" },
    { id: "rendering", label: "Rendering scenes…" },
]

// Progress ring geometry — derived from the locked 200×200 spec with hairline
// inner-radius factor 0.94 (see docs/GENERATING-IDEAS.md).
const RING_SIZE = 200
const RING_CENTER = RING_SIZE / 2
const RING_RADIUS = 94
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function ProgressRing({ progress }) {
    const dashOffset = RING_CIRCUMFERENCE * (1 - progress / 100)
    return (
        <div className={css.ring}>
            <svg
                width={RING_SIZE}
                height={RING_SIZE}
                viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                className={css.ringSvg}
                aria-hidden="true"
            >
                <circle
                    cx={RING_CENTER}
                    cy={RING_CENTER}
                    r={RING_RADIUS}
                    fill="none"
                    stroke="var(--color-border-subtle)"
                    strokeWidth="12"
                />
                <circle
                    cx={RING_CENTER}
                    cy={RING_CENTER}
                    r={RING_RADIUS}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth="12"
                    strokeLinecap="butt"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={dashOffset}
                    transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
                    className={css.ringArc}
                />
            </svg>
            <div className={css.ringCenter}>
                <span className={css.ringPercent}>{Math.round(progress)}%</span>
                <span className={css.ringCaption}>complete</span>
            </div>
        </div>
    )
}

function StepPill({ step, state }) {
    const isComplete = state === "complete"
    const isCurrent = state === "current"
    return (
        <div
            className={`${css.pill} ${isCurrent ? css.pillCurrent : ""} ${
                isComplete ? css.pillComplete : ""
            }`}
        >
            <span
                className={`${css.pillIcon} ${
                    isCurrent ? css.pillIconCurrent : ""
                }`}
                aria-hidden="true"
            >
                {isComplete ? (
                    <Check size={14} strokeWidth={2.5} />
                ) : isCurrent ? (
                    <svg
                        width="22"
                        height="22"
                        viewBox="0 0 22 22"
                        className={css.pillSpinner}
                    >
                        <circle
                            cx="11"
                            cy="11"
                            r="8"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeDasharray={`${(2 * Math.PI * 8 * 260) / 360} ${
                                2 * Math.PI * 8
                            }`}
                        />
                    </svg>
                ) : null}
            </span>
            <span className={css.pillLabel}>{step.label}</span>
        </div>
    )
}

function Generating() {
    const dispatch = useDispatch()
    const navigate = useViewTransitionNavigate()
    const variantCount = useSelector((s) => s.shootTypeReducer.variantCount)
    const { progress, currentStep, completedSteps } = useSelector(
        (s) => s.generatingReducer
    )

    // On mount: reset and tick progress upward; map thresholds to step transitions.
    useEffect(() => {
        dispatch(resetGeneration())
        let value = 0
        const id = setInterval(() => {
            value = Math.min(100, value + 2)
            dispatch(setProgress(value))
            if (value >= 33 && value < 66) {
                dispatch(completeStep("analyzing"))
                dispatch(setCurrentStep("selecting"))
            } else if (value >= 66 && value < 100) {
                dispatch(completeStep("analyzing"))
                dispatch(completeStep("selecting"))
                dispatch(setCurrentStep("rendering"))
            } else if (value >= 100) {
                dispatch(completeStep("analyzing"))
                dispatch(completeStep("selecting"))
                dispatch(completeStep("rendering"))
                dispatch(setCurrentStep("done"))
                clearInterval(id)
                setTimeout(() => navigate("/variants-gallery"), 400)
            }
        }, 100)
        return () => clearInterval(id)
    }, [dispatch, navigate])

    const handleCancel = () => {
        dispatch(cancelGeneration())
        navigate(-1)
    }

    return (
        <div className="screen">
            <div className={css.topBar}>
                <button
                    type="button"
                    className={css.cancelButton}
                    onClick={handleCancel}
                    aria-label="Cancel generation"
                >
                    <X size={18} strokeWidth={2} />
                </button>
            </div>

            <div className={css.center}>
                <ProgressRing progress={progress} />

                <div className={css.titleBlock}>
                    <h1 className={css.title}>Crafting your shoot</h1>
                    <p className={css.subtitle}>
                        Generating {variantCount} low-res previews…
                    </p>
                </div>

                <div className={css.steps}>
                    {STEPS.map((step) => {
                        const isComplete = completedSteps.includes(step.id)
                        const isCurrent =
                            !isComplete && currentStep === step.id
                        const state = isComplete
                            ? "complete"
                            : isCurrent
                              ? "current"
                              : "pending"
                        return (
                            <StepPill key={step.id} step={step} state={state} />
                        )
                    })}
                </div>
            </div>

            <div className={css.bottom}>
                <div className={css.skeletonRow} aria-hidden="true">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className={css.skeletonTile} />
                    ))}
                </div>
                <p className={css.reassurance}>
                    You can leave this screen — we'll notify you
                </p>
            </div>
        </div>
    )
}

export default Generating
