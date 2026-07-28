import React, { useCallback, useEffect, useState } from "react"
import { useVideoStream } from "catalyst-core/hooks"
import ShowcaseBar from "../ShowcaseBar"
import css from "../Showcase.scss"

/**
 * useVideoStream demo. While streaming, the native camera renders BEHIND the
 * WebView, so the page swaps to a transparent full-screen stage (same pattern
 * as the /try QR scanner) with a viewfinder and live controls.
 */
const VideoStreamShowcase = () => {
    const [facing, setFacing] = useState("back")
    const [format, setFormat] = useState("all")
    const [zoom, setZoom] = useState(1)
    const [lastScan, setLastScan] = useState(null)
    const [error, setError] = useState(null)

    const onQRDetected = useCallback((data) => {
        const value = typeof data === "string" ? data : data?.value || data?.data
        setLastScan(value ? String(value) : JSON.stringify(data))
    }, [])

    const {
        isStreaming,
        streamState,
        error: hookError,
        start,
        stop,
        sendCommand,
        flip,
        isNative,
    } = useVideoStream({ onQRDetected })

    useEffect(() => {
        if (hookError) setError(hookError.message || "Video stream error")
    }, [hookError])

    useEffect(() => {
        if (streamState?.zoom !== undefined && streamState?.zoom !== null) {
            setZoom(streamState.zoom)
        }
    }, [streamState?.zoom])

    useEffect(() => {
        return () => {
            if (isStreaming) stop()
        }
    }, [isStreaming, stop])

    const handleStart = () => {
        setError(null)
        start({ facing, format, zoom: { auto: false, initial: 1 } })
    }

    const handleZoom = (event) => {
        const value = parseFloat(event.target.value)
        setZoom(value)
        sendCommand("zoom", value)
    }

    if (isStreaming) {
        return (
            <div className={css.cameraStage}>
                {lastScan && <div className={css.scanResult}>Scanned: {lastScan}</div>}
                <div className={css.viewfinder} />
                <div className={css.cameraControls}>
                    <div className={css.zoomRow}>
                        <span>1×</span>
                        <input
                            type="range"
                            min="1"
                            max="5"
                            step="0.1"
                            value={zoom || 1}
                            onChange={handleZoom}
                        />
                        <span>{(zoom || 1).toFixed(1)}×</span>
                    </div>
                    <div className={css.cameraBtnRow}>
                        <button
                            type="button"
                            className={css.cameraBtn}
                            onClick={() => sendCommand("torch", !streamState?.torchOn)}
                        >
                            {streamState?.torchOn ? "Torch off" : "Torch"}
                        </button>
                        <button
                            type="button"
                            className={css.cameraBtn}
                            onClick={() => {
                                flip()
                                setFacing((f) => (f === "back" ? "front" : "back"))
                            }}
                        >
                            Flip
                        </button>
                        <button
                            type="button"
                            className={`${css.cameraBtn} ${css.cameraBtnStop}`}
                            onClick={stop}
                        >
                            Stop
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <>
            <ShowcaseBar title="Video Stream" />
            <p className={css.lede}>
                Streams the device camera behind the WebView with live zoom, torch, camera
                flip, and QR/barcode detection.
            </p>

            {error && <div className={css.bannerError}>{error}</div>}
            {!isNative && (
                <div className={css.bannerInfo}>
                    Camera streaming needs the Companion app&rsquo;s native bridge.
                </div>
            )}

            <div className={css.group}>
                <div className={css.row}>
                    <span className={css.rowLabel}>Camera</span>
                    <div className={css.seg} style={{ width: 180 }}>
                        {["back", "front"].map((f) => (
                            <button
                                key={f}
                                type="button"
                                className={`${css.segItem} ${facing === f ? css.segItemActive : ""}`}
                                onClick={() => setFacing(f)}
                            >
                                {f === "back" ? "Back" : "Front"}
                            </button>
                        ))}
                    </div>
                </div>
                <div className={css.row}>
                    <span className={css.rowLabel}>Scan format</span>
                    <div className={css.seg} style={{ width: 220 }}>
                        {["qr", "barcode", "all"].map((f) => (
                            <button
                                key={f}
                                type="button"
                                className={`${css.segItem} ${format === f ? css.segItemActive : ""}`}
                                onClick={() => setFormat(f)}
                            >
                                {f.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {lastScan && (
                <div className={css.group}>
                    <div className={css.row}>
                        <span className={css.rowLabel}>
                            Last scan
                            <small>{lastScan}</small>
                        </span>
                    </div>
                </div>
            )}

            <button type="button" className={css.btnPrimary} onClick={handleStart} disabled={!isNative}>
                Start Camera
            </button>
        </>
    )
}

export default VideoStreamShowcase
