import React, { useCallback, useEffect, useRef, useState } from "react"
import { useVideoStream } from "catalyst-core/hooks"
import css from "./TryApp.scss"

const COMPANION_PLUGIN_ID = "io.catalyst.companion"
const PREVIEW_COMMAND = "openPreview"
const BRIDGE_PLUGIN_ID = "__bridge__"
const BRIDGE_ERROR_EVENT = "PLUGIN_BRIDGE_ERROR"
const INVALID_URL_MESSAGE =
    "Enter a valid https:// URL (http works for local-network addresses)"
const UNSUPPORTED_SHELL_MESSAGE =
    "Previews require the Catalyst Companion app — this app can't open them."
const RECENTS_STORAGE_KEY = "catalyst-companion.recent-urls"
const MODE_STORAGE_KEY = "catalyst-companion.try-mode"
const SCAN_ACTIVATED_KEY = "catalyst-companion.try-scan-activated"
const MAX_RECENTS = 8

const isNativeShell = () =>
    typeof window !== "undefined" &&
    (!!window.PluginBridge || !!window.webkit?.messageHandlers?.PluginBridge)

const statusFor = (payload) =>
    payload?.code === "INVALID_URL" || payload?.code === "UNSUPPORTED_HOST"
        ? { kind: "field", message: INVALID_URL_MESSAGE }
        : { kind: "error", message: payload?.message || "Failed to open preview" }

const readStorage = (key, fallback) => {
    try {
        return window.localStorage.getItem(key) ?? fallback
    } catch {
        return fallback
    }
}

const writeStorage = (key, value) => {
    try {
        window.localStorage.setItem(key, value)
    } catch {
        return
    }
}

const loadRecents = () => {
    try {
        const parsed = JSON.parse(readStorage(RECENTS_STORAGE_KEY, "[]"))
        return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : []
    } catch {
        return []
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
        if (url.protocol === "https:" || url.protocol === "http:") {
            return url.toString()
        }
        return null
    } catch {
        return null
    }
}

function TryApp() {
    const [url, setUrl] = useState("")
    const [recents, setRecents] = useState([])
    const [status, setStatus] = useState(null)
    const [isAwaitingConfirm, setIsAwaitingConfirm] = useState(false)
    const [mode, setMode] = useState("scan")
    const [scanActivated, setScanActivated] = useState(false)

    const bridgeRef = useRef(null)
    const openPreviewRef = useRef(() => {})
    const pendingRef = useRef(false)

    const recordRecent = useCallback((entry) => {
        if (!entry) return
        setRecents((previous) => {
            const next = [entry, ...previous.filter((item) => item !== entry)].slice(0, MAX_RECENTS)
            writeStorage(RECENTS_STORAGE_KEY, JSON.stringify(next))
            return next
        })
    }, [])

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
        const storedRecents = loadRecents()
        setRecents(storedRecents)

        const storedMode = readStorage(MODE_STORAGE_KEY, "scan") === "manual" ? "manual" : "scan"
        setScanActivated(readStorage(SCAN_ACTIVATED_KEY, "0") === "1")

        const prefill = new URLSearchParams(window.location.search).get("url")
        const prefilled = Boolean(prefill)
        if (prefill) setUrl(prefill)
        setMode(prefilled ? "manual" : storedMode)

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

            const unsubscribeOpened = bridge.register({
                pluginId: COMPANION_PLUGIN_ID,
                eventName: "onPreviewOpened",
                handler: () => {
                    pendingRef.current = false
                    setIsAwaitingConfirm(false)
                    setStatus(null)
                },
            })

            const unsubscribeError = bridge.register({
                pluginId: COMPANION_PLUGIN_ID,
                eventName: "onPreviewError",
                handler: (payload) => {
                    pendingRef.current = false
                    setIsAwaitingConfirm(false)
                    setStatus(payload?.code === "PREVIEW_CANCELLED" ? null : statusFor(payload))
                },
            })

            const unsubscribeBridgeError = bridge.register({
                pluginId: BRIDGE_PLUGIN_ID,
                eventName: BRIDGE_ERROR_EVENT,
                handler: (payload) => {
                    if (payload?.pluginId !== COMPANION_PLUGIN_ID) {
                        return
                    }
                    pendingRef.current = false
                    setIsAwaitingConfirm(false)
                    setStatus({ kind: "info", message: UNSUPPORTED_SHELL_MESSAGE })
                },
            })

            cleanup = () => {
                unsubscribeOpened()
                unsubscribeError()
                unsubscribeBridgeError()
            }
        })
        return () => {
            cancelled = true
            cleanup()
        }
    }, [])

    const requestPreview = useCallback(
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
            if (pendingRef.current) return
            try {
                pendingRef.current = true
                recordRecent(targetUrl)
                bridge.emit({
                    pluginId: COMPANION_PLUGIN_ID,
                    command: PREVIEW_COMMAND,
                    data: { url: targetUrl },
                })
                setStatus(null)
                setIsAwaitingConfirm(true)
            } catch (error) {
                pendingRef.current = false
                setIsAwaitingConfirm(false)
                setStatus({ kind: "error", message: error.message })
            }
        },
        [recordRecent]
    )

    const openPreview = useCallback(
        (raw) => {
            const normalized = normalizeUrl(raw)
            if (!normalized) {
                setStatus({ kind: "field", message: INVALID_URL_MESSAGE })
                return
            }
            requestPreview(normalized)
        },
        [requestPreview]
    )
    openPreviewRef.current = openPreview

    const beginScan = useCallback(() => {
        setStatus(null)
        startCamera({ facing: "back", format: "qr" })
    }, [startCamera])

    const showManual = useCallback(() => {
        stopCamera()
        setMode("manual")
        writeStorage(MODE_STORAGE_KEY, "manual")
    }, [stopCamera])

    const showScan = useCallback(() => {
        setStatus(null)
        setMode("scan")
        writeStorage(MODE_STORAGE_KEY, "scan")
    }, [])

    const autoStartedRef = useRef(false)
    useEffect(() => {
        if (mode !== "scan") {
            autoStartedRef.current = false
        }
    }, [mode])

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

    useEffect(() => {
        if (isStreaming && !scanActivated) {
            setScanActivated(true)
            writeStorage(SCAN_ACTIVATED_KEY, "1")
        }
    }, [isStreaming, scanActivated])

    useEffect(() => {
        return () => {
            if (isStreaming) {
                stopCamera()
            }
        }
    }, [isStreaming, stopCamera])

    const banner = status && status.kind !== "field" && (
        <div className={status.kind === "info" ? css.bannerInfo : css.bannerError}>
            {status.message}
        </div>
    )
    const fieldError = status?.kind === "field" ? status.message : null

    return (
        <div className={css.home}>
            <div className={`web-only ${css.card}`}>
                <h2>Try Your Own App</h2>
                <p>
                    Preview any Catalyst app with the full native bridge — scan a QR from your dev
                    server and it runs on the device. This feature is available in the Catalyst
                    Companion app.
                </p>
            </div>

            {/*
             * Hidden outright while scanning. The overlay must stay transparent
             * to reveal the native camera behind the WebView, so anything left
             * mounted here would show through it.
             */}
            <section
                className="shell-only app-screen"
                hidden={isStreaming}
                aria-hidden={isStreaming || undefined}
            >
                <header className="app-screen-bar">
                    <span className="app-screen-title">Try Your Own App</span>
                </header>

                <p className={css.lede}>
                    Runs your app with the full native bridge — its config is fetched from the dev
                    server and applied for the session.
                </p>

                <div className={css.segmented} role="tablist" aria-label="How to choose an app">
                    <button
                        className={`${css.segment} ${mode === "scan" ? css.segmentOn : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={mode === "scan"}
                        onClick={showScan}
                    >
                        Scan QR
                    </button>
                    <button
                        className={`${css.segment} ${mode === "manual" ? css.segmentOn : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={mode === "manual"}
                        onClick={showManual}
                    >
                        Enter URL
                    </button>
                </div>

                {cameraError && mode === "scan" && (
                    <div className={css.bannerError}>
                        {cameraError.message || "Camera unavailable"}
                    </div>
                )}
                {banner}

                {mode === "scan" ? (
                    <div className={css.panel}>
                        <div className={css.qrMark} aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                                <path d="M14 14h3v3h-3zM18 18h3v3h-3z" strokeLinecap="round" />
                            </svg>
                        </div>

                        <h3 className={css.panelTitle}>Scan your dev server QR</h3>
                        <p className={css.panelBody}>
                            Run <code className={css.code}>npm start</code> in your Catalyst app —
                            the QR appears in your terminal.
                        </p>

                        {cameraIsNative ? (
                            <button
                                className={css.btnPrimary}
                                type="button"
                                onClick={beginScan}
                                disabled={isAwaitingConfirm}
                            >
                                {isAwaitingConfirm ? "Confirm on device…" : "Open camera"}
                            </button>
                        ) : (
                            <p className={css.panelNote}>Scanning needs the Companion app</p>
                        )}
                    </div>
                ) : (
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
                                aria-invalid={fieldError ? "true" : undefined}
                                aria-describedby={fieldError ? "try-url-error" : undefined}
                                value={url}
                                onChange={(event) => {
                                    setUrl(event.target.value)
                                    if (status?.kind === "field") setStatus(null)
                                }}
                            />
                        </div>

                        {fieldError && (
                            <div className={css.bannerError} id="try-url-error" role="alert">
                                {fieldError}
                            </div>
                        )}

                        <button className={css.btnPrimary} type="submit" disabled={isAwaitingConfirm}>
                            {isAwaitingConfirm ? "Confirm on device…" : "Open Preview"}
                        </button>
                    </form>
                )}

                {recents.length > 0 && (
                    <div className={css.recents}>
                        <h3>Recent</h3>
                        <div className={css.group}>
                            {recents.map((entry) => (
                                <button
                                    key={entry}
                                    className={css.recentRow}
                                    type="button"
                                    disabled={isAwaitingConfirm}
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

            {/*
             * Full-screen while scanning. The native camera renders behind the
             * WebView, so this layer must stay transparent and sit above the
             * bottom nav (z-index 30) — otherwise the tab bar paints over the
             * camera and there is no way out of the scanner.
             */}
            {isStreaming && (
                <div className={css.scanOverlay} role="dialog" aria-label="Scan a QR code">
                    <div className={css.scanTop}>
                        <button
                            className={css.scanClose}
                            type="button"
                            onClick={stopCamera}
                            aria-label="Close scanner"
                        >
                            ✕
                        </button>
                    </div>

                    <div className={css.scanCenter}>
                        <div className={css.viewfinder}>
                            <span className={`${css.corner} ${css.cornerTl}`} />
                            <span className={`${css.corner} ${css.cornerTr}`} />
                            <span className={`${css.corner} ${css.cornerBl}`} />
                            <span className={`${css.corner} ${css.cornerBr}`} />
                        </div>

                        <p className={css.scanTitle}>Scan your dev server QR</p>
                        <p className={css.scanCaption}>
                            Run <code className={css.scanCode}>npm start</code> and point at the
                            code in your terminal
                        </p>
                    </div>

                    <div className={css.scanBottom}>
                        <button className={css.scanManual} type="button" onClick={showManual}>
                            Enter URL manually
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default TryApp
