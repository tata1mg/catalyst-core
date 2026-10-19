import React, { useEffect, useState } from "react"
import { useWire } from "./wire.js"
import css from "./ToolCallBanner.scss"

export default function ToolCallBanner() {
    const { events, firing } = useWire()
    const [activeBanner, setActiveBanner] = useState(null)
    const [expanded, setExpanded] = useState(false)

    useEffect(() => {
        if (!events || events.length === 0) return
        const latest = events[0]
        if (!latest) return

        if (latest.kind === "call") {
            setActiveBanner({
                id: latest.id,
                name: latest.name,
                args: latest.args || {},
                status: "running",
                startTime: latest.at,
                endTime: null,
                duration: null,
            })
        } else if (latest.kind === "result" || latest.kind === "error") {
            setActiveBanner((prev) => {
                if (prev && prev.name === latest.name) {
                    const duration = Math.max(12, latest.at - prev.startTime)
                    return {
                        ...prev,
                        status: latest.kind === "result" ? "ok" : "error",
                        result: latest.result,
                        error: latest.error,
                        endTime: latest.at,
                        duration,
                    }
                }
                return {
                    id: latest.id,
                    name: latest.name,
                    args: {},
                    status: latest.kind === "result" ? "ok" : "error",
                    result: latest.result,
                    error: latest.error,
                    startTime: latest.at - 25,
                    endTime: latest.at,
                    duration: 25,
                }
            })

            // Auto-hide the resolved banner after 3 seconds if no new tool starts
            const timer = setTimeout(() => {
                setActiveBanner((curr) => {
                    if (curr && curr.id === latest.id && curr.status !== "running") {
                        return null
                    }
                    return curr
                })
            }, 3200)
            return () => clearTimeout(timer)
        }
    }, [events])

    // Format argument preview
    const formatArgs = (args) => {
        if (!args || typeof args !== "object") return ""
        const entries = Object.entries(args)
        if (entries.length === 0) return "()"
        return entries
            .map(([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`)
            .join(", ")
    }

    const recentCalls = events.filter((e) => e.kind === "call").slice(0, 4)

    return (
        <div className={css.bannerContainer} aria-label="WebMCP Live Tool Execution">
            {activeBanner && (
                <div
                    className={`${css.banner} ${css[activeBanner.status] || ""}`}
                    role="status"
                    aria-live="polite"
                >
                    <div className={css.glowBackdrop} />

                    <div className={css.bannerContent}>
                        <div className={css.protocolTag}>
                            <span className={css.pulseDot} />
                            <span className={css.tagText}>WEBMCP PROTOCOL</span>
                        </div>

                        <div className={css.mainInfo}>
                            <span className={css.methodIcon}>⚡</span>
                            <span className={css.toolName}>webmcp.{activeBanner.name}</span>
                            <span className={css.toolArgs}>({formatArgs(activeBanner.args)})</span>
                        </div>

                        <div className={css.statusBadge} data-status={activeBanner.status}>
                            {activeBanner.status === "running" ? (
                                <>
                                    <span className={css.spinner} />
                                    <span>EXECUTING...</span>
                                </>
                            ) : activeBanner.status === "ok" ? (
                                <>
                                    <span className={css.checkMark}>✓</span>
                                    <span>RESOLVED {activeBanner.duration ? `(${activeBanner.duration}ms)` : ""}</span>
                                </>
                            ) : (
                                <>
                                    <span>✕ ERROR</span>
                                </>
                            )}
                        </div>

                        <button
                            className={css.toggleFeedBtn}
                            onClick={() => setExpanded(!expanded)}
                            title="Toggle WebMCP Wire Ticker"
                            aria-expanded={expanded}
                        >
                            {expanded ? "▲ Hide" : "▼ Wire Log"}
                        </button>
                    </div>
                </div>
            )}

            {/* Optional drop-down mini feed of recent tool calls */}
            {expanded && (
                <div className={css.feedDropdown}>
                    <div className={css.feedHeader}>
                        <span>Live WebMCP Handshake Log</span>
                        <span className={css.firingCount}>
                            {firing.length > 0 ? `${firing.length} active` : "Idle"}
                        </span>
                    </div>
                    <ul className={css.feedList}>
                        {recentCalls.map((rc) => (
                            <li key={rc.id} className={css.feedItem}>
                                <span className={css.feedTime}>
                                    {new Date(rc.at).toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" })}
                                </span>
                                <span className={css.feedTool}>webmcp.{rc.name}</span>
                                <span className={css.feedArgsPreview}>{formatArgs(rc.args)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}
