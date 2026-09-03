import React from "react"
import { useNativeTransition } from "catalyst-core/hooks"
import ShowcaseBar from "./ShowcaseBar"
import kit from "../shared/appKit.scss"
import css from "./Showcase.scss"

const CAPABILITIES = [
    {
        path: "/showcase/video",
        title: "Video Stream",
        hook: "useVideoStream",
        blurb: "Native camera feed with QR scanning, zoom, torch, and flip.",
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="14" height="12" rx="2" />
                <path d="m22 8-6 4 6 4V8Z" />
            </svg>
        ),
    },
    {
        path: "/showcase/files",
        title: "File Picker",
        hook: "useFilePicker",
        blurb: "Pick documents and media through the native picker.",
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
            </svg>
        ),
    },
    {
        path: "/showcase/signin",
        title: "Google Sign-In",
        hook: "useGoogleSignIn",
        blurb: "One-tap account auth through the native Google SDK.",
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
            </svg>
        ),
    },
    {
        path: "/showcase/notifications",
        title: "Local Notification",
        hook: "useNotification",
        blurb: "Request permission and deliver real system notifications.",
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
            </svg>
        ),
    },
]

const ShowcaseIndex = () => {
    const { navigate } = useNativeTransition({ type: "slide", duration: 280 })

    return (
        <>
            <ShowcaseBar title="Showcase" back={false} />
            <p className={kit.lede}>
                Every demo below runs on real native APIs through Catalyst&rsquo;s bridge —
                tap one to try it on this device.
            </p>
            <div className={kit.group}>
                {CAPABILITIES.map((cap) => (
                    <button
                        key={cap.path}
                        type="button"
                        className={css.navRow}
                        onClick={() => navigate(cap.path, { direction: "right" })}
                    >
                        <span className={css.navIcon}>{cap.icon}</span>
                        <span className={css.navBody}>
                            <h2>{cap.title}</h2>
                            <p>{cap.blurb}</p>
                            <span className={css.navHook}>{cap.hook}</span>
                        </span>
                        <span className={css.navChevron} aria-hidden="true">
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="m9 5 7 7-7 7" />
                            </svg>
                        </span>
                    </button>
                ))}
            </div>
        </>
    )
}

export default ShowcaseIndex
