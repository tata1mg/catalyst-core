import React from "react"
import { useSelector, useDispatch } from "react-redux"
import useViewTransitionNavigate from "@hooks/useViewTransitionNavigate"
import { ArrowRight, Check, Minus, Plus } from "lucide-react"

import {
    AppHeader,
    BackButton,
    HeaderTitle,
    StepBadge,
} from "@components/AppHeader/AppHeader"
import TabBar from "@components/TabBar/TabBar"
import PrimaryCta from "@components/PrimaryCta/PrimaryCta"
import FadeImage from "@components/FadeImage/FadeImage"

import {
    decrementVariants,
    incrementVariants,
    setModelPreference,
    setShootType,
} from "./reducer.js"
import css from "./ShootType.scss"

// TODO: API — replace with GET /shoot-types when the backend ships it.
const SHOOT_TYPES = [
    {
        id: "studio",
        name: "Studio",
        descriptor: "Clean backdrop, soft light",
        imageUrl: "/static/shoot-types/studio.png",
    },
    {
        id: "outdoor",
        name: "Outdoor",
        descriptor: "Garden, natural light",
        imageUrl: "/static/shoot-types/outdoor.png",
    },
    {
        id: "urban",
        name: "Urban",
        descriptor: "Street, contemporary edge",
        imageUrl: "/static/shoot-types/urban.png",
    },
    {
        id: "palace",
        name: "Palace",
        descriptor: "Heritage, regal mood",
        imageUrl: "/static/shoot-types/palace.png",
    },
]

const MODEL_OPTIONS = [
    { id: "female", label: "Female" },
    { id: "male", label: "Male" },
    { id: "both", label: "Both" },
]

function ShootTypeCard({ option, selected, onSelect, index }) {
    return (
        <button
            type="button"
            className={`${css.card} ${selected ? css.cardSelected : ""}`}
            onClick={() => onSelect(option.id)}
            aria-pressed={selected}
        >
            <div className={css.cardTop}>
                <FadeImage
                    src={option.imageUrl}
                    alt={option.name}
                    delayMs={Math.min(index, 3) * 60}
                    className={css.cardThumb}
                    variant="develop"
                />
                {selected && (
                    <div className={css.cardCheck}>
                        <Check size={14} strokeWidth={2.5} />
                    </div>
                )}
            </div>
            <span className={css.cardName}>{option.name}</span>
            <span className={css.cardDescriptor}>{option.descriptor}</span>
        </button>
    )
}

function SegmentedControl({ value, options, onChange }) {
    const activeIndex = Math.max(
        0,
        options.findIndex((opt) => opt.id === value)
    )
    return (
        <div
            className={css.segmented}
            role="tablist"
            style={{ "--segment-active-index": activeIndex }}
        >
            <span className={css.segmentIndicator} aria-hidden="true" />
            {options.map((opt) => {
                const isActive = opt.id === value
                return (
                    <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`${css.segment} ${isActive ? css.segmentActive : ""}`}
                        onClick={() => onChange(opt.id)}
                    >
                        {opt.label}
                    </button>
                )
            })}
        </div>
    )
}

function VariantStepper({ value, onIncrement, onDecrement }) {
    const prevRef = React.useRef(value)
    const direction = value > prevRef.current ? "up" : "down"
    React.useEffect(() => {
        prevRef.current = value
    }, [value])

    return (
        <div className={css.stepper}>
            <button
                type="button"
                className={css.stepperButton}
                onClick={onDecrement}
                aria-label="Decrease variants"
            >
                <Minus size={18} strokeWidth={2} />
            </button>
            <div className={css.stepperValueWrap} aria-live="polite">
                <span
                    key={value}
                    className={`${css.stepperValue} ${
                        direction === "up" ? css.stepperValueEnter : css.stepperValueEnterDown
                    }`}
                >
                    {value}
                </span>
            </div>
            <button
                type="button"
                className={`${css.stepperButton} ${css.stepperButtonDark}`}
                onClick={onIncrement}
                aria-label="Increase variants"
            >
                <Plus size={18} strokeWidth={2} />
            </button>
        </div>
    )
}

function ShootType() {
    const dispatch = useDispatch()
    const navigate = useViewTransitionNavigate()
    const { selectedShootType, modelPreference, variantCount } = useSelector(
        (state) => state.shootTypeReducer
    )

    return (
        <div className="screen">
            <div className={css.body}>
                <AppHeader>
                    <BackButton onClick={() => navigate(-1)} />
                    <HeaderTitle>New Shoot</HeaderTitle>
                    <StepBadge>2 of 3</StepBadge>
                </AppHeader>

                <section className={css.section}>
                    <h2 className={css.sectionTitle}>Choose shoot type</h2>
                    <div className={css.cardGrid}>
                        {SHOOT_TYPES.map((option, index) => (
                            <ShootTypeCard
                                key={option.id}
                                option={option}
                                index={index}
                                selected={selectedShootType === option.id}
                                onSelect={(id) => dispatch(setShootType(id))}
                            />
                        ))}
                    </div>
                </section>

                <section className={css.section}>
                    <h3 className={css.sectionTitleSmall}>Model preferences</h3>
                    <SegmentedControl
                        value={modelPreference}
                        options={MODEL_OPTIONS}
                        onChange={(id) => dispatch(setModelPreference(id))}
                    />
                </section>

                <section className={css.section}>
                    <h3 className={css.sectionTitleSmall}>How many variants?</h3>
                    <VariantStepper
                        value={variantCount}
                        onIncrement={() => dispatch(incrementVariants())}
                        onDecrement={() => dispatch(decrementVariants())}
                    />
                    <span className={css.helperCaption}>Low-res preview, ~30 sec</span>
                </section>
            </div>

            <div className={css.continueArea}>
                <PrimaryCta icon={ArrowRight} onClick={() => navigate("/generating")}>
                    Generate Preview
                </PrimaryCta>
            </div>

            <TabBar active="shoots" />
        </div>
    )
}

export default ShootType
