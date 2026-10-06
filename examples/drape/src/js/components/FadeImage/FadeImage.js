import React, { useEffect, useRef, useState } from "react"
import { getCurrentViewTransition } from "@hooks/useViewTransitionNavigate"
import css from "./FadeImage.scss"

// Lazy-loaded photographic surface with a skeleton-shimmer placeholder
// and a one-shot reveal mechanic that fires once the image's bitmap is
// decoded into the GPU cache. The reveal mechanic is selected per-call
// via the `variant` prop:
//
//   "snap"    — image appears at full opacity once decoded. No motion.
//               Default. Safe under any condition.
//   "develop" — image mounts with a desaturated/low-contrast filter
//               that resolves to clarity, while a cream shimmer
//               overlay fades out concurrently. The "darkroom
//               emergence" reveal — soft, gradient-driven, non-
//               invasive. Used on every photographic surface in the
//               app today (Welcome hero, UploadAttire / ShootType /
//               VariantsGallery / FinalResults grids, FinalResults
//               featured).
//
// iOS WebView constraint that shapes these variants:
// During route View Transitions API cross-fade, VTA captures a frozen
// snapshot of the new DOM. If the live DOM continues animating any
// visible property (opacity, transform, filter, clip-path, mask-image)
// during the cross-fade, there's a visible jump when VTA hands off the
// snapshot back to the live DOM at the end. The fix is to defer the
// reveal animation until VTA's `.finished` promise resolves — by that
// point the live DOM is uncovered and free to animate without
// fighting a frozen snapshot. Implemented via the global ref exposed
// by `useViewTransitionNavigate.getCurrentViewTransition()`.
//
// `delayMs` lets callers stagger reveals across a grid (typically index
// * 60ms).
//
// Dev tooling: append `?imgdelay=<ms>` to the URL to artificially delay
// every FadeImage's reveal by that many milliseconds. Useful for
// observing the develop variant on a fast local network. Read once on
// mount.
function readDebugDelay() {
    if (typeof window === "undefined") return 0
    try {
        const v = parseInt(
            new URLSearchParams(window.location.search).get("imgdelay") || "",
            10
        )
        return Number.isFinite(v) && v > 0 ? v : 0
    } catch {
        return 0
    }
}

function FadeImage({
    src,
    alt = "",
    delayMs = 0,
    className = "",
    variant = "snap",
    onLoad,
    loading,
    ...rest
}) {
    const [ready, setReady] = useState(false)
    const onLoadRef = useRef(onLoad)
    useEffect(() => {
        onLoadRef.current = onLoad
    }, [onLoad])

    useEffect(() => {
        if (!src) return undefined
        let cancelled = false
        let timeoutId
        const debugDelay = readDebugDelay()

        const finish = async () => {
            if (cancelled) return
            const vta = getCurrentViewTransition()
            if (vta && typeof vta.finished?.then === "function") {
                try {
                    await vta.finished
                } catch {
                    // VTA can be cancelled (e.g., a fresh navigation
                    // pre-empts it). We still want to reveal in that
                    // case — fall through.
                }
                if (cancelled) return
            }
            setReady(true)
            onLoadRef.current?.()
        }

        const probe = new Image()
        probe.src = src

        const reveal = () => {
            if (cancelled) return
            const decodePromise =
                typeof probe.decode === "function"
                    ? probe.decode().catch(() => {})
                    : Promise.resolve()
            decodePromise.then(() => {
                if (cancelled) return
                const totalDelay = delayMs + debugDelay
                if (totalDelay > 0) {
                    timeoutId = setTimeout(finish, totalDelay)
                } else {
                    finish()
                }
            })
        }

        if (probe.complete && probe.naturalWidth > 0) {
            reveal()
        } else {
            const onError = () => {
                if (!cancelled) finish()
            }
            probe.addEventListener("load", reveal, { once: true })
            probe.addEventListener("error", onError, { once: true })
        }

        return () => {
            cancelled = true
            if (timeoutId) clearTimeout(timeoutId)
        }
    }, [src, delayMs])

    const variantClass = css[`variant_${variant}`] || css.variant_snap
    const wrapClasses = `${css.fade} ${variantClass} ${
        ready ? css.revealed : ""
    } ${className}`

    return (
        <div className={wrapClasses}>
            {ready && (
                <img
                    src={src}
                    alt={alt}
                    loading={loading}
                    decoding="sync"
                    className={css.fadeImg}
                    {...rest}
                />
            )}
            {variant === "develop" && (
                <div className={css.developShimmer} aria-hidden="true" />
            )}
        </div>
    )
}

export default FadeImage
