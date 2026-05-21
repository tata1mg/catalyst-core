import React from "react"
import { useSelector, useDispatch } from "react-redux"
import useViewTransitionNavigate from "@hooks/useViewTransitionNavigate"
import { ArrowRight, Check, MoreHorizontal, RefreshCw } from "lucide-react"

import {
    AppHeader,
    HeaderLeft,
    BackButton,
    HeaderTitleStack,
    HeaderIconButton,
} from "@components/AppHeader/AppHeader"
import TabBar from "@components/TabBar/TabBar"
import PrimaryCta from "@components/PrimaryCta/PrimaryCta"
import FadeImage from "@components/FadeImage/FadeImage"

import { selectVariant, regenerate } from "./reducer.js"
import css from "./VariantsGallery.scss"

const REVEAL_STAGGER_MS = 60
const REVEAL_STAGGER_CAP = 4

function VariantCell({ variant, selected, onSelect, index }) {
    const delay = Math.min(index, REVEAL_STAGGER_CAP) * REVEAL_STAGGER_MS
    return (
        <button
            type="button"
            className={`${css.cell} ${selected ? css.cellSelected : ""}`}
            onClick={() => onSelect(variant.id)}
            aria-pressed={selected}
            aria-label={`Preview ${variant.id}`}
        >
            <FadeImage
                src={variant.url}
                alt=""
                delayMs={delay}
                className={css.cellImage}
                variant="develop"
            />
            {selected && (
                <span className={css.cellCheck}>
                    <Check size={14} strokeWidth={2.5} />
                </span>
            )}
        </button>
    )
}

function VariantsGallery() {
    const dispatch = useDispatch()
    const navigate = useViewTransitionNavigate()
    const { variants, selectedVariantId, highResCount } = useSelector(
        (state) => state.variantsGalleryReducer
    )

    const selectedCount = selectedVariantId ? 1 : 0

    return (
        <div className="screen">
            <div className={css.body}>
                <div className={css.top}>
                    <AppHeader>
                        <HeaderLeft>
                            <BackButton onClick={() => navigate(-1)} />
                            <HeaderTitleStack title="Choose preview" subtitle="Step 3 of 3" />
                        </HeaderLeft>
                        <HeaderIconButton
                            icon={MoreHorizontal}
                            label="More"
                            onClick={() => console.log("ellipsis menu")}
                        />
                    </AppHeader>

                    <p className={css.helper}>
                        Tap a preview to upscale into high-res shots.
                    </p>

                    <div className={css.grid}>
                        {variants.map((variant, index) => (
                            <VariantCell
                                key={variant.id}
                                variant={variant}
                                index={index}
                                selected={selectedVariantId === variant.id}
                                onSelect={(id) => dispatch(selectVariant(id))}
                            />
                        ))}
                    </div>
                </div>

                <div className={css.bottom}>
                    <div className={css.infoRow}>
                        <span className={css.infoText}>
                            {`${selectedCount} selected · ${highResCount} high-res images`}
                        </span>
                        <button
                            type="button"
                            className={css.regenLink}
                            onClick={() => dispatch(regenerate())}
                        >
                            <RefreshCw size={14} strokeWidth={2} />
                            <span>Regenerate</span>
                        </button>
                    </div>

                    <PrimaryCta
                        icon={ArrowRight}
                        onClick={() => navigate("/final-results")}
                    >
                        Generate high-res
                    </PrimaryCta>
                </div>
            </div>

            <TabBar active="gallery" />
        </div>
    )
}

export default VariantsGallery
