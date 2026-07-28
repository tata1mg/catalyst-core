import React, { useCallback, useEffect, useRef, useState } from "react"
import { useVideoStream } from "catalyst-core/hooks"
import css from "./TryApp.scss"

const PREVIEW_PLUGIN_ID = "io.catalyst.preview"
const RECENTS_STORAGE_KEY = "catalyst-companion.recent-urls"
const MODE_STORAGE_KEY = "catalyst-companion.try-mode"
// Set the first time the user explicitly taps "Start scanning". Until then the
// camera never auto-starts, so the OS permission prompt is always user-initiated.
const SCAN_ACTIVATED_KEY = "catalyst-companion.try-scan-activated"
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

const loadMode = () => {
    try {
        return window.localStorage.getItem(MODE_STORAGE_KEY) === "manual" ? "manual" : "scan"
    } catch {
        return "scan"
    }
}

const saveMode = (mode) => {
    try {
        window.localStorage.setItem(MODE_STORAGE_KEY, mode)
    } catch {
        // Storage unavailable: mode falls back to the scan-first default.
    }
}

const loadScanActivated = () => {
    try {
        return window.localStorage.getItem(SCAN_ACTIVATED_KEY) === "1"
    } catch {
        return false
    }
}

const saveScanActivated = () => {
    try {
        window.localStorage.setItem(SCAN_ACTIVATED_KEY, "1")
    } catch {
        // Storage unavailable: the user just taps "Start scanning" each visit.
    }
}

// Mirrors the native PreviewUrlPolicy: cleartext http is allowed only for
// private-network hosts (dev-server previews); public hosts stay https-only.
const isPrivateHost = (rawHost) => {
    const host = rawHost.toLowerCase().replace(/\.$/, "")
    if (host === "localhost" || host.endsWith(".local")) {
        return true
    }
    const parts = host.split(".")
    if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) {
        return false
    }
    const [a, b] = parts.map(Number)
    return (
        a === 127 ||
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)
    )
}

const normalizeUrl = (raw) => {
    const trimmed = raw.trim()
    if (!trimmed) {
        return null
    }
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
    try {
        const url = new URL(withScheme)
        if (url.protocol === "https:") {
            return url.toString()
        }
        if (url.protocol === "http:" && isPrivateHost(url.hostname)) {
            return url.toString()
        }
        return null
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
    // Scanner-first: "scan" is the SSR/default mode, so the server never has to
    // read localStorage; the stored preference is applied on mount.
    const [mode, setMode] = useState("scan")
    const [scanActivated, setScanActivated] = useState(false)

    const bridgeRef = useRef(null)
    const openPreviewRef = useRef(() => {})
    // True once the preview plugin answers (onOpened/onError). Lets us tell a
    // Companion shell from another Catalyst shell that lacks the plugin.
    const ackRef = useRef(false)

    // QR scanning reuses Catalyst's trusted-shell camera bridge — no new native
    // code. On a QR hit we stop the camera and hand the URL to the preview flow.
    const {
        isStreaming,
        isNative: cameraIsNative,
        error: cameraError,
        start: startCamera,
        stop: stopCamera,
    } = useVideoStream({
        onQRDetected: (data) => {
            const value = typeof data === "string" ? data : data?.value || data?.data
            if (value) {
                stopCamera()
                openPreviewRef.current(value)
            }
        },
    })

    useEffect(() => {
        setRecents(loadRecents())

        // localStorage reads live here, never in render: SSR has no window.
        const storedMode = loadMode()
        setScanActivated(loadScanActivated())

        // Deep-link prefill (e.g. /try?url=… from the App Home sample chip).
        // A deep-linked URL means the user wants the form, so force manual for
        // this visit without overwriting their stored preference.
        let prefilled = false
        try {
            const prefill = new URLSearchParams(window.location.search).get("url")
            if (prefill) {
                setUrl(prefill)
                prefilled = true
            }
        } catch {
            // Malformed query string: start with an empty field.
        }
        setMode(prefilled ? "manual" : storedMode)

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
                setStatus({
                    kind: "error",
                    message: "Enter a valid https:// URL (http works for local-network addresses)",
                })
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

    const beginScan = useCallback(() => {
        setStatus(null)
        startCamera({ facing: "back", format: "qr" })
    }, [startCamera])

    const showManual = useCallback(() => {
        stopCamera()
        setMode("manual")
        saveMode("manual")
    }, [stopCamera])

    const showScan = useCallback(() => {
        setMode("scan")
        saveMode("scan")
    }, [])

    // Guards the auto-start below against firing twice for one visit to scan
    // mode — notably after a QR hit stops the camera, which must NOT re-arm it
    // while the preview is opening.
    const autoStartedRef = useRef(false)
    useEffect(() => {
        if (mode !== "scan") {
            autoStartedRef.current = false
        }
    }, [mode])

    // Returning users who already granted the camera get a live viewfinder on
    // arrival; first-timers must tap "Start scanning" so the OS prompt is never
    // a surprise. Never auto-start outside the native shell.
    useEffect(() => {
        if (
            mode === "scan" &&
            scanActivated &&
            cameraIsNative &&
            !cameraError &&
            !autoStartedRef.current
        ) {
            autoStartedRef.current = true
            startCamera({ facing: "back", format: "qr" })
        }
    }, [mode, scanActivated, cameraIsNative, cameraError, startCamera])

    // Latch the flag only once the camera actually came up, so a denied
    // permission does not arm auto-start into a permanently failing state.
    useEffect(() => {
        if (isStreaming && !scanActivated) {
            setScanActivated(true)
            saveScanActivated()
        }
    }, [isStreaming, scanActivated])

    useEffect(() => {
        return () => {
            if (isStreaming) {
                stopCamera()
            }
        }
    }, [isStreaming, stopCamera])

    const banner = status && (
        <div className={status.kind === "info" ? css.bannerInfo : css.bannerError}>
            {status.message}
        </div>
    )

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
                {/* No back chevron: Try is a top-level tab in the bottom nav.
                    While streaming the page body is transparent, so the bar and
                    everything below the stage carry their own opaque surface. */}
                <header className={`app-screen-bar ${isStreaming ? css.opaque : ""}`}>
                    <span className="app-screen-title">Try Your Own App</span>
                </header>

                {mode === "scan" ? (
                    <>
                        {/* `scanner` stays on the STAGE while streaming: the
                            :has() rules keyed off it clear the html/body paint
                            so the native camera behind the WebView shows. */}
                        <div className={`${css.stage} ${isStreaming ? css.scanner : ""}`}>
                            {isStreaming ? (
                                <div className={css.viewfinder} />
                            ) : (
                                <div className={css.stagePlaceholder}>
                                    <svg
                                        className={css.stageIcon}
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.6"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                    >
                                        <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-2h6.2l1.2 2h1.7A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
                                        <circle cx="12" cy="12.5" r="3.5" />
                                    </svg>
                                    <p className={css.stageTitle}>Camera is off</p>
                                    {cameraIsNative ? (
                                        <button
                                            className={css.stageStart}
                                            type="button"
                                            onClick={beginScan}
                                        >
                                            Start scanning
                                        </button>
                                    ) : (
                                        <p className={css.stageNote}>
                                            Scanning needs the Companion app
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className={`${css.belowStage} ${isStreaming ? css.opaque : ""}`}>
                            {cameraError && (
                                <div className={css.bannerError}>
                                    {cameraError.message || "Camera unavailable"}
                                </div>
                            )}
                            {banner}

                            <p className={css.hint}>
                                Run <code>npm start</code> in your Catalyst app and scan the QR
                                from the terminal.
                            </p>

                            <button className={css.btn} type="button" onClick={showManual}>
                                Enter URL manually
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <button className={css.btn} type="button" onClick={showScan}>
                            Scan a QR instead
                        </button>

                        <p className={css.lede}>
                            Load any deployed HTTPS app in an isolated native WebView — storage
                            cleared per session.
                        </p>

                        {banner}

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
                                                onChange={(event) =>
                                                    setSplashColor(event.target.value)
                                                }
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
                                                onChange={(event) =>
                                                    setSplashDuration(event.target.value)
                                                }
                                            />
                                        </label>
                                    </>
                                )}
                            </div>

                            <button className={css.btnPrimary} type="submit">
                                Open Preview
                            </button>
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
                    </>
                )}
            </section>
        </div>
    )
}

export default TryApp
