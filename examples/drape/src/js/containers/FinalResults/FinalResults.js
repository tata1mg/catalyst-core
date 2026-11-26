import React from "react"
import { useSelector, useDispatch } from "react-redux"
import useViewTransitionNavigate from "@hooks/useViewTransitionNavigate"
import { Bookmark, Download, RefreshCw, Share, Sparkles } from "lucide-react"

import {
    AppHeader,
    BackButton,
    HeaderIconButton,
    HeaderLeft,
    HeaderRight,
    HeaderTitleStack,
} from "@components/AppHeader/AppHeader"
import TabBar from "@components/TabBar/TabBar"
import FadeImage from "@components/FadeImage/FadeImage"

import { selectSibling, toggleBookmark } from "./reducer.js"
import css from "./FinalResults.scss"

function FeaturedImage({ url, descriptor, children }) {
    return (
        <div className={css.featured}>
            <FadeImage
                src={url}
                alt={descriptor || ""}
                className={css.featuredImage}
                variant="develop"
                loading="eager"
            />
            <div className={css.featuredOverlay}>{children}</div>
        </div>
    )
}

function SiblingThumb({ sibling, isSelected, onSelect, index }) {
    return (
        <button
            type="button"
            className={`${css.thumb} ${isSelected ? css.thumbSelected : ""}`}
            onClick={() => onSelect(sibling.id)}
            aria-pressed={isSelected}
            aria-label={`Variant ${sibling.id}`}
        >
            <FadeImage
                src={sibling.url}
                alt=""
                delayMs={Math.min(index, 3) * 60}
                className={css.thumbImage}
                variant="develop"
            />
        </button>
    )
}

function FinalResults() {
    const dispatch = useDispatch()
    const navigate = useViewTransitionNavigate()
    const { featured, siblings, selectedSiblingId, bookmarked } = useSelector(
        (state) => state.finalResultsReducer
    )

    const handleDownloadAll = () => {
        // TODO: hook up to download endpoint when API lands.
        // eslint-disable-next-line no-console
        console.log("Download all variants would happen here")
    }

    const handleRefresh = () => {
        // TODO: regenerate behaviour pending decision (re-run prompt vs reopen variants gallery).
        // eslint-disable-next-line no-console
        console.log("Regenerate would happen here")
    }

    const handleShare = () => {
        // TODO: share affordance pending decision (native sheet vs in-app preview).
        // eslint-disable-next-line no-console
        console.log("Share would happen here")
    }

    return (
        <div className="screen">
            <div className={css.body}>
                <AppHeader>
                    <HeaderLeft>
                        <BackButton onClick={() => navigate(-1)} />
                        <HeaderTitleStack
                            title="Your Shoot"
                            subtitle={`${siblings.length} high-res images`}
                        />
                    </HeaderLeft>
                    <HeaderRight>
                        <HeaderIconButton
                            icon={Share}
                            label="Share"
                            onClick={handleShare}
                        />
                        <HeaderIconButton
                            icon={Bookmark}
                            label={bookmarked ? "Unbookmark" : "Bookmark"}
                            onClick={() => dispatch(toggleBookmark())}
                        />
                    </HeaderRight>
                </AppHeader>

                <FeaturedImage url={featured.url} descriptor={featured.descriptor}>
                    <div className={css.scrimChip}>
                        <Sparkles size={13} strokeWidth={2} />
                        <span className={css.scrimText}>{featured.descriptor}</span>
                    </div>
                </FeaturedImage>

                <div className={css.thumbStrip}>
                    {siblings.map((sibling, index) => (
                        <SiblingThumb
                            key={sibling.id}
                            sibling={sibling}
                            index={index}
                            isSelected={sibling.id === selectedSiblingId}
                            onSelect={(id) => dispatch(selectSibling(id))}
                        />
                    ))}
                </div>

                <div className={css.actions}>
                    <button
                        type="button"
                        className={css.downloadCta}
                        onClick={handleDownloadAll}
                    >
                        <Download size={17} strokeWidth={2} />
                        <span>Download all</span>
                    </button>
                    <button
                        type="button"
                        className={css.refreshButton}
                        onClick={handleRefresh}
                        aria-label="Regenerate"
                    >
                        <RefreshCw size={18} strokeWidth={2} />
                    </button>
                </div>
            </div>

            <TabBar active="gallery" />
        </div>
    )
}

export default FinalResults
