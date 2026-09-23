import React, { useCallback, useEffect, useRef, useState } from "react"
import { isNativeShell } from "./DocumentBootstrap"
import onboardingSrc from "../../../static/media/onboarding.mp4"
import css from "./OnboardingVideo.scss"

const SEEN_KEY = "catalyst-companion.onboarding-seen"

/**
 * First-launch demo. Shown once, then never again.
 *
 * Gated behind a mounted flag rather than rendered during SSR: the server
 * build has no asset base, so a server-rendered <video src> would point at
 * /server/... and 404. Deciding on the client also means localStorage is
 * readable, so the video never flashes for someone who has already seen it.
 */
const OnboardingVideo = () => {
    const [visible, setVisible] = useState(false)
    const [leaving, setLeaving] = useState(false)
    const [playing, setPlaying] = useState(false)
    const videoRef = useRef(null)

    useEffect(() => {
        // /app is reachable from a browser too, and this is an app demo — do
        // not spend an 11 MB download on a web visitor.
        if (!isNativeShell()) return

        let seen = true
        try {
            seen = window.localStorage.getItem(SEEN_KEY) === "1"
        } catch {
            // Private mode or storage disabled — treat as seen so a broken
            // storage API can never trap the user behind the video.
            seen = true
        }
        if (!seen) setVisible(true)
    }, [])

    const dismiss = useCallback(() => {
        try {
            window.localStorage.setItem(SEEN_KEY, "1")
        } catch {
            // Non-fatal: worst case it plays again next launch.
        }
        setLeaving(true)
        window.setTimeout(() => setVisible(false), 260)
    }, [])

    // Autoplay is only permitted while muted; unmuting needs a user gesture.
    useEffect(() => {
        if (!visible) return
        videoRef.current?.play?.().catch(() => {})
    }, [visible])

    if (!visible) return null

    return (
        <div className={`${css.overlay} ${leaving ? css.leaving : ""}`} role="dialog" aria-label="Welcome">
            {/* Hidden until the first frame is actually painting. Android's
                WebView draws a large grey play glyph over a video that has no
                frame yet, which flashes for a beat before playback starts. */}
            <video
                ref={videoRef}
                className={`${css.video} ${playing ? css.videoReady : ""}`}
                src={onboardingSrc}
                muted
                playsInline
                autoPlay
                preload="auto"
                controls={false}
                disablePictureInPicture
                onPlaying={() => setPlaying(true)}
                onEnded={dismiss}
            />

            <button className={css.skip} type="button" onClick={dismiss}>
                Skip
            </button>

            <button className={css.cta} type="button" onClick={dismiss}>
                Get started
            </button>
        </div>
    )
}

export { SEEN_KEY }
export default OnboardingVideo
