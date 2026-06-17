import React, { useCallback, useEffect, useRef, useState } from "react"
import css from "./BottomSheet.scss"

const DRAG_DISMISS_THRESHOLD = 0.3
const DISMISS_TOTAL_MS = 280 + 30 + 20

function BottomSheet({ open, onDismiss, ariaLabel, children }) {
    const [mounted, setMounted] = useState(open)
    const [visible, setVisible] = useState(false)
    const [dragOffset, setDragOffset] = useState(0)

    const sheetRef = useRef(null)
    const dragStartYRef = useRef(null)
    const restoreFocusRef = useRef(null)

    useEffect(() => {
        if (open) {
            restoreFocusRef.current =
                typeof document !== "undefined" ? document.activeElement : null
            setMounted(true)
            const id = requestAnimationFrame(() =>
                requestAnimationFrame(() => setVisible(true))
            )
            return () => cancelAnimationFrame(id)
        }
        if (mounted) {
            setVisible(false)
            const t = setTimeout(() => {
                setMounted(false)
                setDragOffset(0)
                if (restoreFocusRef.current?.focus) {
                    restoreFocusRef.current.focus()
                }
            }, DISMISS_TOTAL_MS)
            return () => clearTimeout(t)
        }
        return undefined
    }, [open, mounted])

    useEffect(() => {
        if (!mounted) return undefined
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = prev
        }
    }, [mounted])

    useEffect(() => {
        if (!open) return undefined
        const onKey = (e) => {
            if (e.key === "Escape") onDismiss()
        }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [open, onDismiss])

    const onPointerDown = useCallback((e) => {
        if (e.target.closest("button, input, [role='button']")) return
        dragStartYRef.current = e.clientY
        sheetRef.current?.setPointerCapture?.(e.pointerId)
    }, [])

    const onPointerMove = useCallback((e) => {
        if (dragStartYRef.current == null) return
        const delta = e.clientY - dragStartYRef.current
        if (delta > 0) setDragOffset(delta)
    }, [])

    const onPointerUp = useCallback(
        (e) => {
            if (dragStartYRef.current == null) return
            const delta = e.clientY - dragStartYRef.current
            dragStartYRef.current = null
            sheetRef.current?.releasePointerCapture?.(e.pointerId)
            const sheetH = sheetRef.current?.offsetHeight ?? 1
            if (delta / sheetH >= DRAG_DISMISS_THRESHOLD) {
                onDismiss()
            } else {
                setDragOffset(0)
            }
        },
        [onDismiss]
    )

    if (!mounted) return null

    // While dragging, suppress the spring-back transition so the sheet tracks
    // the finger 1:1; release will either commit dismiss or reset offset.
    const sheetStyle = dragOffset
        ? { transform: `translateY(${dragOffset}px)`, transition: "none" }
        : undefined

    return (
        <div className={css.root}>
            <button
                type="button"
                className={`${css.scrim} ${visible ? css.scrimVisible : ""}`}
                onClick={onDismiss}
                tabIndex={-1}
                aria-label="Dismiss"
            />
            <div
                ref={sheetRef}
                className={`${css.sheet} ${visible ? css.sheetVisible : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                style={sheetStyle}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                <div className={css.handleRow}>
                    <div className={css.handle} />
                </div>
                {children}
            </div>
        </div>
    )
}

export default BottomSheet
