import React, { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "catalyst-core"
import { useVideoStream } from "catalyst-core/hooks"
import css from "./TryApp.scss"

const PREVIEW_PLUGIN_ID = "io.catalyst.preview"
const RECENTS_STORAGE_KEY = "catalyst-companion.recent-urls"
const MAX_RECENTS = 8

const isNativeShell = () =>
    typeof window !== "undefined" &&
    (!!window.PluginBridge || !!window.webkit?.messageHandlers?.PluginBridge)

const loadRecents = () => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(RECENTS_STORAGE_KEY) || "[]")
        return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : []
    } catch {
        return []
    }
}

const saveRecents = (recents) => {
    try {
        window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(recents))
    } catch {
        // Storage unavailable: recents are a convenience only.
    }
}

const normalizeUrl = (raw) => {
    const trimmed = raw.trim()
    if (!trimmed) {
        return null
    }
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
    try {
        const url = new URL(withScheme)
        return url.protocol === "https:" ? url.toString() : null
    } catch {
        return null
    }
}

function TryApp() {
    const [url, setUrl] = useState("")
    const [edgeToEdge, setEdgeToEdge] = useState(true)
    const [splashEnabled, setSplashEnabled] = useState(false)
    const [splashColor, setSplashColor] = useState("#ffffff")
    const [splashDuration, setSplashDuration] = useState(1000)
    const [recents, setRecents] = useState([])
    const [status, setStatus] = useState(null)
    const [scanning, setScanning] = useState(false)

    const bridgeRef = useRef(null)
    const openPreviewRef = useRef(() => {})
    // True once the preview plugin answers (onOpened/onError). Lets us tell a
    // Companion shell from another Catalyst shell that lacks the plugin.
    const ackRef = useRef(false)

    // QR scanning reuses Catalyst's trusted-shell camera bridge — no new native
    // code. On a QR hit we stop the camera and hand the URL to the preview flow.
    const { isStreaming, isNative: cameraIsNative, start: startCamera, stop: stopCamera } =
        useVideoStream({
            onQRDetected: (data) => {
                const value = typeof data === "string" ? data : data?.value || data?.data
                if (value) {
                    stopCamera()
                    setScanning(false)
                    openPreviewRef.current(value)
                }
            },
        })

    useEffect(() => {
        setRecents(loadRecents())

        // Deep-link prefill (e.g. /try?url=… from the App Home sample chip).
        try {
            const prefill = new URLSearchParams(window.location.search).get("url")
            if (prefill) setUrl(prefill)
        } catch {
            // Malformed query string: start with an empty field.
        }

        // Client-only: the bridge module talks to window and ships as CJS,
        // so it must never be evaluated during SSR.
        let cancelled = false
        let cleanup = () => {}
        import("catalyst-core/PluginBridge").then((mod) => {
            if (cancelled) {
                return
            }
            const bridge = typeof mod.default?.emit === "function" ? mod.default : mod.default?.default
            if (!bridge) {
                return
            }
            bridgeRef.current = bridge
            bridge.init()
            const unsubscribeError = bridge.register({
                pluginId: PREVIEW_PLUGIN_ID,
                eventName: "onError",
                handler: (payload) => {
                    ackRef.current = true
                    setStatus({
                        kind: "error",
                        message: payload?.message || "Failed to open preview",
                    })
                },
            })
            const unsubscribeOpened = bridge.register({
                pluginId: PREVIEW_PLUGIN_ID,
                eventName: "onOpened",
                handler: () => {
                    ackRef.current = true
                    setStatus(null)
                },
            })
            cleanup = () => {
                unsubscribeError()
                unsubscribeOpened()
            }
        })
        return () => {
            cancelled = true
            cleanup()
        }
    }, [])

    const openBrowser = useCallback(
        (targetUrl) => {
            if (!isNativeShell()) {
                setStatus({
                    kind: "info",
                    message: "Open this page in Catalyst Companion to preview on a device.",
                })
                return
            }
            const bridge = bridgeRef.current
            if (!bridge) {
                setStatus({ kind: "error", message: "Native bridge is still loading, try again" })
                return
            }
            try {
                ackRef.current = false
                bridge.emit({
                    pluginId: PREVIEW_PLUGIN_ID,
                    command: "openBrowser",
                    data: {
                        url: targetUrl,
                        edgeToEdge,
                        splash: {
                            enabled: splashEnabled,
                            backgroundColor: splashColor,
                            duration: Number(splashDuration) || 1000,
                        },
                    },
                })
                setStatus(null)
                // Another Catalyst shell without the preview plugin swallows
                // the command silently: no plugin ack and the page never gets
                // backgrounded by a preview surface. Best-effort message.
                setTimeout(() => {
                    if (!ackRef.current && !document.hidden) {
                        setStatus({
                            kind: "info",
                            message:
                                "No response from this app — previews require the Catalyst Companion app.",
                        })
                    }
                }, 2500)
            } catch (error) {
                setStatus({ kind: "error", message: error.message })
            }
        },
        [edgeToEdge, splashEnabled, splashColor, splashDuration]
    )

    const openPreview = useCallback(
        (raw) => {
            const normalized = normalizeUrl(raw)
            if (!normalized) {
                setStatus({ kind: "error", message: "Enter a valid https:// URL" })
                return
            }
            const nextRecents = [
                normalized,
                ...recents.filter((entry) => entry !== normalized),
            ].slice(0, MAX_RECENTS)
            setRecents(nextRecents)
            saveRecents(nextRecents)
            openBrowser(normalized)
        },
        [openBrowser, recents]
    )
    openPreviewRef.current = openPreview

    const toggleScan = useCallback(() => {
        if (scanning) {
            stopCamera()
            setScanning(false)
        } else {
            setStatus(null)
            setScanning(true)
            startCamera({ facing: "back", format: "qr" })
        }
    }, [scanning, startCamera, stopCamera])

    useEffect(() => {
        return () => {
            if (isStreaming) {
                stopCamera()
            }
        }
    }, [isStreaming, stopCamera])

    if (scanning) {
        return (
            // app-screen keeps the docs navbar hidden while the scanner replaces
            // the normal page tree in the shell.
            <div className={`app-screen ${css.scanner}`}>
                <div className={css.scanFrame} />
                <p className={css.scanHint}>Point at your app&apos;s QR code</p>
                <button className={css.scanCancel} onClick={toggleScan}>
                    Cancel
                </button>
            </div>
        )
    }

    return (
        <div className={css.home}>
            {/* Web visitors get the message, never an unusable form; both
                variants ship in the SSR HTML and CSS picks via data-shell. */}
            <div className={`web-only ${css.card}`}>
                <h2>Try Your Own App</h2>
                <p>
                    Preview any deployed HTTPS app in an isolated native WebView. This feature is
                    available in the Catalyst Companion app.
                </p>
            </div>

            {/* In the shell this presents as a native screen: own app bar, the
                docs navbar is hidden via .app-screen, grouped rows + switches. */}
            <section className="shell-only app-screen">
                <header className="app-screen-bar">
                    <Link to="/app" className="app-screen-back" aria-label="Back to App Home">
                        ‹
                    </Link>
                    <span className="app-screen-title">Try Your Own App</span>
                </header>

                <p className={css.lede}>
                    Load any deployed HTTPS app in an isolated native WebView — storage cleared
                    per session.
                </p>

                {status && (
                    <div className={status.kind === "info" ? css.bannerInfo : css.bannerError}>
                        {status.message}
                    </div>
                )}

                <form
                    onSubmit={(event) => {
                        event.preventDefault()
                        openPreview(url)
                    }}
                >
                    <div className={css.group}>
                        <input
                            className={css.urlInput}
                            type="url"
                            inputMode="url"
                            autoCapitalize="none"
                            autoCorrect="off"
                            placeholder="https://your-app.example.com"
                            aria-label="App URL"
                            value={url}
                            onChange={(event) => setUrl(event.target.value)}
                        />
                    </div>

                    <div className={css.group}>
                        <label className={css.row}>
                            <span>Edge-to-edge display</span>
                            <input
                                type="checkbox"
                                className={css.switch}
                                checked={edgeToEdge}
                                onChange={(event) => setEdgeToEdge(event.target.checked)}
                            />
                        </label>

                        <label className={css.row}>
                            <span>Simulated splash screen</span>
                            <input
                                type="checkbox"
                                className={css.switch}
                                checked={splashEnabled}
                                onChange={(event) => setSplashEnabled(event.target.checked)}
                            />
                        </label>

                        {splashEnabled && (
                            <>
                                <label className={css.row}>
                                    <span>Splash color</span>
                                    <input
                                        type="color"
                                        className={css.colorInput}
                                        value={splashColor}
                                        onChange={(event) => setSplashColor(event.target.value)}
                                    />
                                </label>
                                <label className={css.row}>
                                    <span>Duration (ms)</span>
                                    <input
                                        type="number"
                                        className={css.durationInput}
                                        min="0"
                                        max="10000"
                                        step="100"
                                        value={splashDuration}
                                        onChange={(event) => setSplashDuration(event.target.value)}
                                    />
                                </label>
                            </>
                        )}
                    </div>

                    <button className={css.btnPrimary} type="submit">
                        Open Preview
                    </button>
                    {cameraIsNative && (
                        <button className={css.btn} type="button" onClick={toggleScan}>
                            Scan QR Code
                        </button>
                    )}
                </form>

                {recents.length > 0 && (
                    <div className={css.recents}>
                        <h3>Recent</h3>
                        <div className={css.group}>
                            {recents.map((entry) => (
                                <button
                                    key={entry}
                                    className={css.recentRow}
                                    onClick={() => openPreview(entry)}
                                >
                                    <span className={css.recentUrl}>{entry}</span>
                                    <span className={css.recentChevron}>›</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </section>
        </div>
    )
}

export default TryApp
