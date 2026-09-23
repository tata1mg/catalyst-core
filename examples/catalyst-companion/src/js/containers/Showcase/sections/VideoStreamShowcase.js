import React, { useCallback, useEffect, useState } from "react"
import { useVideoStream } from "catalyst-core/hooks"
import ShowcaseBar from "../ShowcaseBar"
import kit from "../../shared/appKit.scss"
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

    // Signals the tab bar to leave the paint path — its backdrop-filter would
    // otherwise composite opaquely over the native camera. See hub.scss.
    useEffect(() => {
        const root = document.documentElement
        if (isStreaming) root.setAttribute("data-camera", "on")
        else root.removeAttribute("data-camera")
        return () => root.removeAttribute("data-camera")
    }, [isStreaming])

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
            <p className={kit.lede}>
                Streams the device camera behind the WebView with live zoom, torch, camera
                flip, and QR/barcode detection.
            </p>

            {error && <div className={kit.bannerError}>{error}</div>}
            {!isNative && (
                <div className={kit.bannerInfo}>
                    Camera streaming needs the Companion app&rsquo;s native bridge.
                </div>
            )}

            <div className={kit.group}>
                <div className={kit.row}>
                    <span className={kit.rowLabel}>Camera</span>
                    <div className={`${kit.seg} ${kit.rowControl}`}>
                        {["back", "front"].map((f) => (
                            <button
                                key={f}
                                type="button"
                                className={`${kit.segItem} ${facing === f ? kit.segItemOn : ""}`}
                                onClick={() => setFacing(f)}
                            >
                                {f === "back" ? "Back" : "Front"}
                            </button>
                        ))}
                    </div>
                </div>
                <div className={kit.row}>
                    <span className={kit.rowLabel}>Scan format</span>
                    <div className={`${kit.seg} ${kit.rowControl}`}>
                        {["qr", "barcode", "all"].map((f) => (
                            <button
                                key={f}
                                type="button"
                                className={`${kit.segItem} ${format === f ? kit.segItemOn : ""}`}
                                onClick={() => setFormat(f)}
                            >
                                {f.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {lastScan && (
                <div className={kit.group}>
                    <div className={kit.row}>
                        <span className={kit.rowLabel}>
                            Last scan
                            <small>{lastScan}</small>
                        </span>
                    </div>
                </div>
            )}

            <button type="button" className={kit.btnPrimary} onClick={handleStart} disabled={!isNative}>
                Start Camera
            </button>
        </>
    )
}

export default VideoStreamShowcase
