import React, { useState } from "react"
import useViewTransitionNavigate from "@hooks/useViewTransitionNavigate"

import PrimaryCta from "@components/PrimaryCta/PrimaryCta"
import FadeImage from "@components/FadeImage/FadeImage"

import css from "./Welcome.scss"

const HERO_URL = "/static/welcome/hero.png"

function Welcome() {
    const navigate = useViewTransitionNavigate()
    const [heroLoaded, setHeroLoaded] = useState(false)

    return (
        <div className="screen">
            <FadeImage
                src={HERO_URL}
                alt="Editorial fashion photograph"
                className={css.hero}
                variant="develop"
                loading="eager"
                onLoad={() => setHeroLoaded(true)}
            />
            <div className={`${css.content} ${heroLoaded ? css.contentRevealed : ""}`}>
                <h1 className={css.brand}>Drape</h1>
                <p className={css.tagline}>AI fashion shoots for your attire</p>
                <p className={css.description}>
                    Upload your saree, lehenga, or kurta and generate
                    editorial-grade fashion imagery in minutes.
                </p>
                <div className={css.spacer} />
                <div className={css.ctaWrap}>
                    <PrimaryCta onClick={() => navigate("/upload-attire")}>
                        Get Started
                    </PrimaryCta>
                    <button
                        type="button"
                        className={css.signIn}
                        onClick={() => navigate("/upload-attire")}
                    >
                        Sign in
                    </button>
                </div>
            </div>
        </div>
    )
}

export default Welcome
