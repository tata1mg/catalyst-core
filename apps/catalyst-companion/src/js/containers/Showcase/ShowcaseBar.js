import React from "react"
import { useNativeTransition } from "catalyst-core/hooks"
import css from "./Showcase.scss"

/**
 * App bar for showcase screens. Back navigation runs through
 * useNativeTransition so leaving a section feels like a native pop. Pass
 * back={false} on top-level tab screens, which are reached from the bottom
 * nav and so have nothing to pop back to.
 */
const ShowcaseBar = ({ title, backTo = "/showcase", back = true }) => {
    const { navigate } = useNativeTransition({ type: "slide", duration: 280 })
    return (
        <header className="app-screen-bar">
            {back && (
                <button
                    type="button"
                    className={`app-screen-back ${css.backBtn}`}
                    aria-label="Back"
                    onClick={() => navigate(backTo, { direction: "left" })}
                >
                    ‹
                </button>
            )}
            <span className="app-screen-title">{title}</span>
        </header>
    )
}

export default ShowcaseBar
